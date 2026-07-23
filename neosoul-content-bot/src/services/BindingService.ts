import Database from 'better-sqlite3';
import { initializeDatabase } from '../database/index.js';
import { GuildSettingsService } from './GuildSettingsService.js';
import { PointService } from './PointService.js';

// SQLite date modifiers do not accept IANA zone names. Malaysia observes UTC+8
// year-round, so this is equivalent to the configured Asia/Kuala_Lumpur zone.
const MALAYSIA_UTC_OFFSET = '+8 hours';

interface BindingRow {
  xUsername: string;
}

interface ProfileRow {
  xUsername: string | null;
  totalPoints: number;
  todayValidSubmissions: number;
  approvedSubmissions: number;
  rejectedSubmissions: number;
}

export interface BindingProfile {
  xUsername: string | null;
  totalPoints: number;
  todayValidSubmissions: number;
  todayRemainingSubmissions: number;
  approvedSubmissions: number;
  rejectedSubmissions: number;
  rank: number | null;
}

export type BindResult = 'bound' | 'username-taken';

export class BindingService {
  public constructor(private readonly database: Database.Database = initializeDatabase()) {}

  public static normalizeUsername(username: string): string | null {
    const normalizedUsername = username.trim().replace(/^@/, '').toLowerCase();
    return /^[a-z0-9_]{1,15}$/.test(normalizedUsername) ? normalizedUsername : null;
  }

  public bind(guildId: string, discordUserId: string, xUsername: string): BindResult {
    const bindAccount = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO guild_settings (guild_id)
           VALUES (?)
           ON CONFLICT (guild_id) DO NOTHING`,
        )
        .run(guildId);

      this.database
        .prepare(
          `INSERT INTO x_bindings (guild_id, discord_user_id, x_username)
           VALUES (?, ?, ?)
           ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
             x_user_id = NULL,
             x_username = excluded.x_username,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .run(guildId, discordUserId, xUsername);
    });

    try {
      bindAccount();
      return 'bound';
    } catch (error) {
      if (
        error instanceof Database.SqliteError &&
        error.code.startsWith('SQLITE_CONSTRAINT_UNIQUE')
      ) {
        return 'username-taken';
      }

      throw error;
    }
  }

  public unbind(guildId: string, discordUserId: string): boolean {
    const result = this.database
      .prepare('DELETE FROM x_bindings WHERE guild_id = ? AND discord_user_id = ?')
      .run(guildId, discordUserId);
    return result.changes > 0;
  }

  public getProfile(guildId: string, discordUserId: string): BindingProfile {
    const { dailySubmissionLimit } = new GuildSettingsService(this.database).get(guildId);
    const row = this.database
      .prepare(
        `SELECT
           (
             SELECT x_username
             FROM x_bindings
             WHERE guild_id = ? AND discord_user_id = ?
           ) AS xUsername,
           COALESCE((
             SELECT SUM(amount)
             FROM point_ledger
             WHERE guild_id = ? AND discord_user_id = ?
           ), 0) AS totalPoints,
           (
             SELECT COUNT(*)
             FROM submissions
             WHERE guild_id = ?
               AND discord_user_id = ?
               AND status IN ('APPROVED', 'REJECTED')
               AND date(submitted_at, '${MALAYSIA_UTC_OFFSET}') =
                   date('now', '${MALAYSIA_UTC_OFFSET}')
           ) AS todayValidSubmissions,
           (
             SELECT COUNT(*)
             FROM submissions
             WHERE guild_id = ?
               AND discord_user_id = ?
               AND status = 'APPROVED' COLLATE NOCASE
           ) AS approvedSubmissions,
           (
             SELECT COUNT(*)
             FROM submissions
             WHERE guild_id = ?
               AND discord_user_id = ?
               AND status = 'REJECTED' COLLATE NOCASE
           ) AS rejectedSubmissions`,
      )
      .get(
        guildId,
        discordUserId,
        guildId,
        discordUserId,
        guildId,
        discordUserId,
        guildId,
        discordUserId,
        guildId,
        discordUserId,
      ) as ProfileRow;

    return {
      ...row,
      todayRemainingSubmissions: Math.max(0, dailySubmissionLimit - row.todayValidSubmissions),
      rank: new PointService(this.database).getUserRank(guildId, discordUserId).rank,
    };
  }

  public getBinding(guildId: string, discordUserId: string): string | null {
    const binding = this.database
      .prepare(
        `SELECT x_username AS xUsername
         FROM x_bindings
         WHERE guild_id = ? AND discord_user_id = ?`,
      )
      .get(guildId, discordUserId) as BindingRow | undefined;
    return binding?.xUsername ?? null;
  }
}
