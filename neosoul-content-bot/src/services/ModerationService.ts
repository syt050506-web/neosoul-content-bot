import type Database from 'better-sqlite3';
import { initializeDatabase } from '../database/index.js';
import { GuildSettingsService } from './GuildSettingsService.js';
import { PointService } from './PointService.js';

export type ModerationActionType =
  'APPROVE' | 'REJECT' | 'ADJUST_POINTS' | 'REVOKE_SUBMISSION' | 'LOGS_SEARCH';

export class ModerationError extends Error {
  public constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID_STATE' | 'INVALID_INPUT',
    message: string,
  ) {
    super(message);
    this.name = 'ModerationError';
  }
}

interface SubmissionRow {
  id: number;
  discordUserId: string;
  status: string;
}

interface RewardRow {
  points: number;
}

export interface ModerationResult {
  submissionId: number;
  discordUserId: string;
  pointsChanged: number;
  status: string;
}

export interface SubmissionLog {
  id: number;
  discordUserId: string;
  xUsername: string | null;
  postId: string | null;
  sourceUrl: string;
  status: string;
  rejectionReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  latestAction: string | null;
  latestActionAt: string | null;
}

export interface LogFilters {
  discordUserId?: string;
  xUsername?: string;
  postId?: string;
  limit?: number;
}

export class ModerationService {
  private readonly points: PointService;
  private readonly settings: GuildSettingsService;

  public constructor(private readonly database: Database.Database = initializeDatabase()) {
    this.points = new PointService(database);
    this.settings = new GuildSettingsService(database);
  }

  public approve(guildId: string, administratorId: string, submissionId: number): ModerationResult {
    return this.database
      .transaction(() => {
        const submission = this.getSubmission(guildId, submissionId);
        if (submission.status !== 'PENDING') {
          throw new ModerationError(
            'INVALID_STATE',
            submission.status === 'APPROVED'
              ? 'This submission is already approved.'
              : `Only pending submissions can be approved (current status: ${submission.status}).`,
          );
        }

        const reward = this.settings.get(guildId).pointsPerSubmission;
        this.points.addSubmissionPoints(guildId, submission.discordUserId, submission.id, reward);
        const updated = this.database
          .prepare(
            `UPDATE submissions
           SET status = 'APPROVED', reviewed_at = CURRENT_TIMESTAMP,
               reviewed_by = ?, rejection_reason = NULL
           WHERE guild_id = ? AND id = ? AND status = 'PENDING'`,
          )
          .run(administratorId, guildId, submissionId);
        if (updated.changes !== 1) {
          throw new ModerationError('INVALID_STATE', 'This submission is no longer pending.');
        }
        this.audit(guildId, administratorId, 'APPROVE', submission, reward, null);
        return {
          submissionId,
          discordUserId: submission.discordUserId,
          pointsChanged: reward,
          status: 'APPROVED',
        };
      })
      .immediate();
  }

  public reject(
    guildId: string,
    administratorId: string,
    submissionId: number,
    reason: string,
  ): ModerationResult {
    const cleanReason = this.requireReason(reason);
    return this.database
      .transaction(() => {
        const submission = this.getSubmission(guildId, submissionId);
        if (submission.status !== 'PENDING') {
          throw new ModerationError(
            'INVALID_STATE',
            `Only pending submissions can be rejected (current status: ${submission.status}).`,
          );
        }
        const updated = this.database
          .prepare(
            `UPDATE submissions
           SET status = 'REJECTED', reviewed_at = CURRENT_TIMESTAMP,
               reviewed_by = ?, rejection_reason = ?
           WHERE guild_id = ? AND id = ? AND status = 'PENDING'`,
          )
          .run(administratorId, cleanReason, guildId, submissionId);
        if (updated.changes !== 1) {
          throw new ModerationError('INVALID_STATE', 'This submission is no longer pending.');
        }
        this.audit(guildId, administratorId, 'REJECT', submission, null, cleanReason);
        return {
          submissionId,
          discordUserId: submission.discordUserId,
          pointsChanged: 0,
          status: 'REJECTED',
        };
      })
      .immediate();
  }

  public adjustPoints(
    guildId: string,
    administratorId: string,
    discordUserId: string,
    amount: number,
    reason: string,
  ): ModerationResult {
    const cleanReason = this.requireReason(reason);
    if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) {
      throw new ModerationError(
        'INVALID_INPUT',
        'Point adjustment must be a non-zero integer between -1,000,000 and 1,000,000.',
      );
    }
    this.settings.get(guildId);
    return this.database
      .transaction(() => {
        this.points.adjust(guildId, discordUserId, amount, `Admin adjustment: ${cleanReason}`);
        this.audit(
          guildId,
          administratorId,
          'ADJUST_POINTS',
          { id: 0, discordUserId, status: '' },
          amount,
          cleanReason,
          null,
        );
        return {
          submissionId: 0,
          discordUserId,
          pointsChanged: amount,
          status: 'ADJUSTED',
        };
      })
      .immediate();
  }

  public revoke(
    guildId: string,
    administratorId: string,
    submissionId: number,
    reason: string,
  ): ModerationResult {
    const cleanReason = this.requireReason(reason);
    return this.database
      .transaction(() => {
        const submission = this.getSubmission(guildId, submissionId);
        if (submission.status !== 'APPROVED') {
          throw new ModerationError(
            'INVALID_STATE',
            `Only approved submissions can be revoked (current status: ${submission.status}).`,
          );
        }
        const reward = this.database
          .prepare(
            `SELECT COALESCE(SUM(amount), 0) AS points
           FROM point_ledger
           WHERE guild_id = ? AND submission_id = ?
             AND reason = 'Approved X submission'`,
          )
          .get(guildId, submissionId) as RewardRow;
        if (reward.points > 0) {
          this.points.adjust(
            guildId,
            submission.discordUserId,
            -reward.points,
            `Revoked submission: ${cleanReason}`,
            submissionId,
          );
        }
        const updated = this.database
          .prepare(
            `UPDATE submissions
           SET status = 'REVOKED', reviewed_at = CURRENT_TIMESTAMP,
               reviewed_by = ?, rejection_reason = ?
           WHERE guild_id = ? AND id = ? AND status = 'APPROVED'`,
          )
          .run(administratorId, cleanReason, guildId, submissionId);
        if (updated.changes !== 1) {
          throw new ModerationError('INVALID_STATE', 'This submission is no longer approved.');
        }
        this.audit(
          guildId,
          administratorId,
          'REVOKE_SUBMISSION',
          submission,
          -reward.points,
          cleanReason,
        );
        return {
          submissionId,
          discordUserId: submission.discordUserId,
          pointsChanged: -reward.points,
          status: 'REVOKED',
        };
      })
      .immediate();
  }

  public searchLogs(
    guildId: string,
    administratorId: string,
    filters: LogFilters,
  ): SubmissionLog[] {
    const limit = filters.limit ?? 10;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
      throw new ModerationError('INVALID_INPUT', 'Log limit must be between 1 and 25.');
    }
    this.settings.get(guildId);
    const clauses = ['s.guild_id = ?'];
    const values: Array<string | number> = [guildId];
    if (filters.discordUserId) {
      clauses.push('s.discord_user_id = ?');
      values.push(filters.discordUserId);
    }
    if (filters.xUsername) {
      clauses.push("lower(ltrim(s.x_username, '@')) = lower(ltrim(?, '@'))");
      values.push(filters.xUsername.trim());
    }
    if (filters.postId) {
      clauses.push('s.post_id = ?');
      values.push(filters.postId.trim());
    }
    values.push(limit);

    return this.database
      .transaction(() => {
        const rows = this.database
          .prepare(
            `SELECT s.id, s.discord_user_id AS discordUserId,
             s.x_username AS xUsername, s.post_id AS postId, s.source_url AS sourceUrl,
             s.status, s.rejection_reason AS rejectionReason,
             s.submitted_at AS submittedAt, s.reviewed_at AS reviewedAt,
             s.reviewed_by AS reviewedBy,
             (SELECT action FROM moderation_actions ma
              WHERE ma.submission_id = s.id ORDER BY ma.id DESC LIMIT 1) AS latestAction,
             (SELECT created_at FROM moderation_actions ma
              WHERE ma.submission_id = s.id ORDER BY ma.id DESC LIMIT 1) AS latestActionAt
           FROM submissions s
           WHERE ${clauses.join(' AND ')}
           ORDER BY s.submitted_at DESC, s.id DESC
           LIMIT ?`,
          )
          .all(...values) as SubmissionLog[];
        this.database
          .prepare(
            `INSERT INTO moderation_actions
           (guild_id, administrator_id, action, details)
           VALUES (?, ?, 'LOGS_SEARCH', ?)`,
          )
          .run(guildId, administratorId, JSON.stringify(filters));
        return rows;
      })
      .immediate();
  }

  private getSubmission(guildId: string, submissionId: number): SubmissionRow {
    if (!Number.isSafeInteger(submissionId) || submissionId < 1) {
      throw new ModerationError('INVALID_INPUT', 'Submission ID must be a positive integer.');
    }
    const row = this.database
      .prepare(
        `SELECT id, discord_user_id AS discordUserId, status
         FROM submissions WHERE guild_id = ? AND id = ?`,
      )
      .get(guildId, submissionId) as SubmissionRow | undefined;
    if (!row) throw new ModerationError('NOT_FOUND', 'Submission not found in this server.');
    return row;
  }

  private requireReason(reason: string): string {
    const clean = reason.trim();
    if (!clean) throw new ModerationError('INVALID_INPUT', 'A reason is required.');
    if (clean.length > 1000) {
      throw new ModerationError('INVALID_INPUT', 'Reason must be 1,000 characters or fewer.');
    }
    return clean;
  }

  private audit(
    guildId: string,
    administratorId: string,
    action: ModerationActionType,
    submission: SubmissionRow,
    amount: number | null,
    reason: string | null,
    submissionId: number | null = submission.id,
  ): void {
    this.database
      .prepare(
        `INSERT INTO moderation_actions (
           guild_id, administrator_id, action, submission_id,
           discord_user_id, amount, reason
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        guildId,
        administratorId,
        action,
        submissionId,
        submission.discordUserId,
        amount,
        reason,
      );
  }
}
