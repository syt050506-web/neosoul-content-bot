import type Database from 'better-sqlite3';
import { initializeDatabase } from '../database/index.js';

interface LeaderboardRow {
  discordUserId: string;
  totalPoints: number;
  rank: number;
}

interface CountRow {
  count: number;
}

export interface LeaderboardEntry {
  discordUserId: string;
  totalPoints: number;
  rank: number;
}

export interface LeaderboardPage {
  entries: LeaderboardEntry[];
  page: number;
  pageSize: number;
  totalUsers: number;
  totalPages: number;
}

export interface UserRank {
  rank: number | null;
  totalPoints: number;
}

export class PointService {
  public constructor(private readonly database: Database.Database = initializeDatabase()) {}

  public addSubmissionPoints(
    guildId: string,
    discordUserId: string,
    submissionId: number,
    points: number,
  ): void {
    this.database
      .prepare(
        `INSERT INTO point_ledger (
           guild_id, discord_user_id, submission_id, amount, reason
         )
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(guildId, discordUserId, submissionId, points, 'Approved X submission');
  }

  public adjust(
    guildId: string,
    discordUserId: string,
    amount: number,
    reason: string,
    submissionId: number | null = null,
  ): void {
    if (!Number.isSafeInteger(amount) || amount === 0) {
      throw new RangeError('amount must be a non-zero integer');
    }
    this.database
      .prepare(
        `INSERT INTO point_ledger (
           guild_id, discord_user_id, submission_id, amount, reason
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(guildId, discordUserId, submissionId, amount, reason);
  }

  /**
   * Returns a stable, paginated leaderboard. RANK uses competition ranking, so
   * equal point totals share a rank and the following position is skipped.
   */
  public getLeaderboardPage(guildId: string, page = 1, pageSize = 10): LeaderboardPage {
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new RangeError('page must be a positive integer');
    }
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new RangeError('pageSize must be an integer between 1 and 100');
    }

    const totalUsers = (
      this.database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM (
             SELECT discord_user_id
             FROM point_ledger
             WHERE guild_id = ?
             GROUP BY discord_user_id
           )`,
        )
        .get(guildId) as CountRow
    ).count;

    const entries = this.database
      .prepare(
        `WITH totals AS (
           SELECT
             discord_user_id,
             SUM(amount) AS total_points
           FROM point_ledger
           WHERE guild_id = ?
           GROUP BY discord_user_id
         ),
         ranked AS (
           SELECT
             discord_user_id AS discordUserId,
             total_points AS totalPoints,
             RANK() OVER (ORDER BY total_points DESC) AS rank
           FROM totals
         )
         SELECT discordUserId, totalPoints, rank
         FROM ranked
         ORDER BY rank ASC, discordUserId ASC
         LIMIT ? OFFSET ?`,
      )
      .all(guildId, pageSize, (page - 1) * pageSize) as LeaderboardRow[];

    return {
      entries,
      page,
      pageSize,
      totalUsers,
      totalPages: Math.ceil(totalUsers / pageSize),
    };
  }

  public getUserRank(guildId: string, discordUserId: string): UserRank {
    const row = this.database
      .prepare(
        `WITH totals AS (
           SELECT
             discord_user_id,
             SUM(amount) AS total_points
           FROM point_ledger
           WHERE guild_id = ?
           GROUP BY discord_user_id
         ),
         ranked AS (
           SELECT
             discord_user_id,
             total_points,
             RANK() OVER (ORDER BY total_points DESC) AS rank
           FROM totals
         )
         SELECT total_points AS totalPoints, rank
         FROM ranked
         WHERE discord_user_id = ?`,
      )
      .get(guildId, discordUserId) as { totalPoints: number; rank: number } | undefined;

    return row ?? { rank: null, totalPoints: 0 };
  }
}
