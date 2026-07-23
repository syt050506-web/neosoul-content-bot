import Database from 'better-sqlite3';
import { initializeDatabase } from '../database/index.js';
import { GuildSettingsService, type GuildSettings } from './GuildSettingsService.js';
import { ParserService, type ParsedXPost } from './ParserService.js';
import { PointService } from './PointService.js';

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
  reason: string;
  todaySubmissions: number;
  dailyLimit: number;
}

export type SubmissionResult =
  | { outcome: 'IGNORED' }
  | RejectedResult
  | {
      outcome: 'APPROVED';
      todaySubmissions: number;
      dailyLimit: number;
      xUsername: string;
      pointsEarned: number;
    };

export class SubmissionService {
  private readonly pointService: PointService;
  private readonly settingsService: GuildSettingsService;

  public constructor(
    private readonly database: Database.Database = initializeDatabase(),
    private readonly parserService: ParserService = new ParserService(),
    pointService?: PointService,
  ) {
    this.pointService = pointService ?? new PointService(database);
    this.settingsService = new GuildSettingsService(database);
  }

  public process(message: SubmissionMessage): SubmissionResult {
    const settings = message.guildId ? this.settingsService.find(message.guildId) : null;
    if (
      !message.guildId ||
      message.authorIsBot ||
      message.isWebhook ||
      !settings?.submissionChannelId ||
      settings.submissionChannelId !== message.channelId
    ) {
      return { outcome: 'IGNORED' };
    }

    if (this.isDuplicateMessage(message.guildId, message.messageId)) {
      return { outcome: 'IGNORED' };
    }

    const parsed = this.parserService.parseXPost(message.content);
    if (!parsed.ok) {
      return this.rejected(
        message.guildId,
        message.discordUserId,
        this.parserFailureReason(parsed.reason),
      );
    }

    const binding = this.getBinding(message.guildId, message.discordUserId);
    if (!binding) {
      return this.rejected(
        message.guildId,
        message.discordUserId,
        '❌ Please bind your X account first.',
      );
    }

    if (this.isDuplicatePost(message.guildId, parsed.post.postId)) {
      return this.rejected(
        message.guildId,
        message.discordUserId,
        'This X post has already been submitted.',
      );
    }

    if (!message.hasEmbeds) {
      return this.rejected(
        message.guildId,
        message.discordUserId,
        'The X post preview is missing.',
      );
    }

    return this.formallyReview(
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

  private formallyReview(
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
        return { outcome: 'IGNORED' };
      }
      if (this.isDuplicatePost(guildId, post.postId)) {
        return this.rejected(guildId, discordUserId, 'This X post has already been submitted.');
      }

      const todaySubmissions = this.getTodayFormalCount(guildId, discordUserId);
      if (todaySubmissions >= settings.dailySubmissionLimit) {
        return {
          outcome: 'REJECTED',
          reason: `You have reached today's limit of ${settings.dailySubmissionLimit} submissions.`,
          todaySubmissions,
          dailyLimit: settings.dailySubmissionLimit,
        };
      }

      if (boundUsername.toLowerCase() !== post.username.toLowerCase()) {
        this.insertSubmission(guildId, discordUserId, messageId, post, 'REJECTED');
        return {
          outcome: 'REJECTED',
          reason: USERNAME_MISMATCH_REASON,
          todaySubmissions: todaySubmissions + 1,
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
      this.pointService.addSubmissionPoints(
        guildId,
        discordUserId,
        submissionId,
        settings.pointsPerSubmission,
      );

      const approval = this.database
        .prepare(
          `UPDATE submissions
           SET status = 'APPROVED', reviewed_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'PENDING'`,
        )
        .run(submissionId);
      if (approval.changes !== 1) {
        throw new Error('Submission approval update failed.');
      }

      return {
        outcome: 'APPROVED',
        todaySubmissions: todaySubmissions + 1,
        dailyLimit: settings.dailySubmissionLimit,
        xUsername: boundUsername,
        pointsEarned: settings.pointsPerSubmission,
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
          return { outcome: 'IGNORED' };
        }
        return this.rejected(guildId, discordUserId, 'This X post has already been submitted.');
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

  private getTodayFormalCount(guildId: string, discordUserId: string): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM submissions
         WHERE guild_id = ?
           AND discord_user_id = ?
           AND status IN ('APPROVED', 'REJECTED')
           AND date(submitted_at, '${MALAYSIA_UTC_OFFSET}') =
               date('now', '${MALAYSIA_UTC_OFFSET}')`,
      )
      .get(guildId, discordUserId) as CountRow;
    return row.count;
  }

  private rejected(guildId: string, discordUserId: string, reason: string): RejectedResult {
    const { dailySubmissionLimit } = this.settingsService.get(guildId);
    return {
      outcome: 'REJECTED',
      reason,
      todaySubmissions: this.getTodayFormalCount(guildId, discordUserId),
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
}
