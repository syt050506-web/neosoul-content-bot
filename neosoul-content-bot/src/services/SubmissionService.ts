import Database from 'better-sqlite3';
import { initializeDatabase } from '../database/index.js';
import { GuildSettingsService, type GuildSettings } from './GuildSettingsService.js';
import { ParserService, type ParsedXPost } from './ParserService.js';
import { logger } from '../utils/logger.js';

// Malaysia is UTC+8 year-round. SQLite date modifiers do not accept IANA names.
const MALAYSIA_UTC_OFFSET = '+8 hours';
export const USERNAME_MISMATCH_REASON =
  'The X username in the URL does not match your bound account.';

interface BindingRow {
  username: string;
}

interface CountRow {
  count: number;
}

export interface SubmissionMessage {
  messageId: string;
  guildId: string | null;
  channelId: string;
  discordUserId: string;
  content: string;
  authorIsBot: boolean;
  isWebhook: boolean;
  hasEmbeds: boolean;
}

interface RejectedResult {
  outcome: 'REJECTED';
  code:
    | 'NO_URL'
    | 'MULTIPLE_URLS'
    | 'INVALID_STATUS_URL'
    | 'NO_BINDING'
    | 'USERNAME_MISMATCH'
    | 'DUPLICATE_POST'
    | 'DUPLICATE_MESSAGE'
    | 'DAILY_LIMIT';
  reason: string;
  todaySubmissions: number;
  dailyLimit: number;
}

export type SubmissionResult =
  | { outcome: 'IGNORED' }
  | RejectedResult
  | {
      outcome: 'PENDING';
      submissionId: number;
      todaySubmissions: number;
      dailyLimit: number;
      xUsername: string;
    };

export class SubmissionService {
  private readonly settingsService: GuildSettingsService;

  public constructor(
    private readonly database: Database.Database = initializeDatabase(),
    private readonly parserService: ParserService = new ParserService(),
  ) {
    this.settingsService = new GuildSettingsService(database);
  }

  public process(message: SubmissionMessage): SubmissionResult {
    const settings = message.guildId ? this.settingsService.find(message.guildId) : null;
    if (
      !message.guildId ||
      message.authorIsBot ||
      !settings?.submissionChannelId ||
      settings.submissionChannelId !== message.channelId
    ) {
      return { outcome: 'IGNORED' };
    }

    if (this.isDuplicateMessage(message.guildId, message.messageId)) {
      logger.info('Submission rejected: duplicate Discord message ID.');
      return this.rejected(
        message.guildId,
        message.discordUserId,
        'DUPLICATE_MESSAGE',
        'This Discord message has already been submitted.',
      );
    }

    const parsed = this.parserService.parseXPost(message.content);
    if (!parsed.ok) {
      logger.info(`Submission rejected: ${this.parserDiagnostic(parsed.reason)}.`);
      return this.rejected(
        message.guildId,
        message.discordUserId,
        parsed.reason,
        this.parserFailureReason(parsed.reason),
      );
    }
    logger.info(`Parsed X username: ${parsed.post.username}.`);
    logger.info(`Parsed post ID: ${parsed.post.postId}.`);

    const binding = this.getBinding(message.guildId, message.discordUserId);
    if (!binding) {
      logger.info('Submission rejected: user has no X binding.');
      return this.rejected(
        message.guildId,
        message.discordUserId,
        'NO_BINDING',
        '❌ Please bind your X account first.',
      );
    }
    logger.info(`Bound X username: ${binding}.`);

    if (this.isDuplicatePost(message.guildId, parsed.post.postId)) {
      logger.info('Submission rejected: duplicate post ID.');
      return this.rejected(
        message.guildId,
        message.discordUserId,
        'DUPLICATE_POST',
        'This X post has already been submitted.',
      );
    }

    return this.savePending(
      message.guildId,
      message.discordUserId,
      message.messageId,
      binding,
      parsed.post,
      settings,
    );
  }

  private getBinding(guildId: string, discordUserId: string): string | null {
    const binding = this.database
      .prepare(
        `SELECT x_username AS username
         FROM x_bindings
         WHERE guild_id = ? AND discord_user_id = ?`,
      )
      .get(guildId, discordUserId) as BindingRow | undefined;
    return binding?.username ?? null;
  }

  private savePending(
    guildId: string,
    discordUserId: string,
    messageId: string,
    boundUsername: string,
    post: ParsedXPost,
    settings: GuildSettings,
  ): SubmissionResult {
    const review = this.database.transaction((): SubmissionResult => {
      // Repeat both checks inside the write transaction to close the concurrency window.
      if (this.isDuplicateMessage(guildId, messageId)) {
        logger.info('Submission rejected: duplicate Discord message ID.');
        return this.rejected(
          guildId,
          discordUserId,
          'DUPLICATE_MESSAGE',
          'This Discord message has already been submitted.',
        );
      }
      if (this.isDuplicatePost(guildId, post.postId)) {
        logger.info('Submission rejected: duplicate post ID.');
        return this.rejected(
          guildId,
          discordUserId,
          'DUPLICATE_POST',
          'This X post has already been submitted.',
        );
      }

      const todaySubmissions = this.getTodaySubmissionCount(guildId, discordUserId);
      if (todaySubmissions >= settings.dailySubmissionLimit) {
        logger.info('Submission rejected: daily limit reached.');
        return {
          outcome: 'REJECTED',
          code: 'DAILY_LIMIT',
          reason: `You have reached today's limit of ${settings.dailySubmissionLimit} submissions.`,
          todaySubmissions,
          dailyLimit: settings.dailySubmissionLimit,
        };
      }

      if (boundUsername.toLowerCase() !== post.username.toLowerCase()) {
        logger.info('Submission rejected: bound username mismatch.');
        return {
          outcome: 'REJECTED',
          code: 'USERNAME_MISMATCH',
          reason: USERNAME_MISMATCH_REASON,
          todaySubmissions,
          dailyLimit: settings.dailySubmissionLimit,
        };
      }

      const submissionId = this.insertSubmission(
        guildId,
        discordUserId,
        messageId,
        post,
        'PENDING',
      );

      return {
        outcome: 'PENDING',
        submissionId,
        todaySubmissions: todaySubmissions + 1,
        dailyLimit: settings.dailySubmissionLimit,
        xUsername: boundUsername,
      };
    });

    try {
      return review.immediate();
    } catch (error) {
      if (
        error instanceof Database.SqliteError &&
        error.code.startsWith('SQLITE_CONSTRAINT_UNIQUE')
      ) {
        if (this.isDuplicateMessage(guildId, messageId)) {
          logger.info('Submission rejected: duplicate Discord message ID.');
          return this.rejected(
            guildId,
            discordUserId,
            'DUPLICATE_MESSAGE',
            'This Discord message has already been submitted.',
          );
        }
        logger.info('Submission rejected: duplicate post ID.');
        return this.rejected(
          guildId,
          discordUserId,
          'DUPLICATE_POST',
          'This X post has already been submitted.',
        );
      }
      throw error;
    }
  }

  private insertSubmission(
    guildId: string,
    discordUserId: string,
    messageId: string,
    post: ParsedXPost,
    status: 'PENDING' | 'REJECTED',
  ): number {
    const result = this.database
      .prepare(
        `INSERT INTO submissions (
           guild_id, discord_user_id, message_id, source_url, post_id,
           x_username, status, reviewed_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'REJECTED'
           THEN CURRENT_TIMESTAMP ELSE NULL END)`,
      )
      .run(
        guildId,
        discordUserId,
        messageId,
        post.originalUrl,
        post.postId,
        post.username,
        status,
        status,
      );
    return Number(result.lastInsertRowid);
  }

  private isDuplicatePost(guildId: string, postId: string): boolean {
    return (
      this.database
        .prepare('SELECT 1 FROM submissions WHERE guild_id = ? AND post_id = ? LIMIT 1')
        .get(guildId, postId) !== undefined
    );
  }

  private isDuplicateMessage(guildId: string, messageId: string): boolean {
    return (
      this.database
        .prepare('SELECT 1 FROM submissions WHERE guild_id = ? AND message_id = ? LIMIT 1')
        .get(guildId, messageId) !== undefined
    );
  }

  private getTodaySubmissionCount(guildId: string, discordUserId: string): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM submissions
         WHERE guild_id = ?
           AND discord_user_id = ?
           AND status IN ('PENDING', 'APPROVED', 'REJECTED')
           AND date(submitted_at, '${MALAYSIA_UTC_OFFSET}') =
               date('now', '${MALAYSIA_UTC_OFFSET}')`,
      )
      .get(guildId, discordUserId) as CountRow;
    return row.count;
  }

  private rejected(
    guildId: string,
    discordUserId: string,
    code: RejectedResult['code'],
    reason: string,
  ): RejectedResult {
    const { dailySubmissionLimit } = this.settingsService.get(guildId);
    return {
      outcome: 'REJECTED',
      code,
      reason,
      todaySubmissions: this.getTodaySubmissionCount(guildId, discordUserId),
      dailyLimit: dailySubmissionLimit,
    };
  }

  private parserFailureReason(reason: 'NO_URL' | 'MULTIPLE_URLS' | 'INVALID_STATUS_URL'): string {
    switch (reason) {
      case 'NO_URL':
        return 'Please include exactly one X post URL.';
      case 'MULTIPLE_URLS':
        return 'Please include only one X post URL.';
      case 'INVALID_STATUS_URL':
        return 'The URL must be a valid X status URL.';
    }
  }

  private parserDiagnostic(reason: 'NO_URL' | 'MULTIPLE_URLS' | 'INVALID_STATUS_URL'): string {
    switch (reason) {
      case 'NO_URL':
        return 'no valid X URL';
      case 'MULTIPLE_URLS':
        return 'multiple X URLs';
      case 'INVALID_STATUS_URL':
        return 'unsupported URL format';
    }
  }
}
