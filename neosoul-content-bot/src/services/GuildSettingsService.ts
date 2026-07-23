import type Database from 'better-sqlite3';
import { initializeDatabase } from '../database/index.js';

export const GUILD_SETTING_LIMITS = Object.freeze({
  dailySubmissionLimit: { minimum: 1, maximum: 1000 },
  pointsPerSubmission: { minimum: 1, maximum: 100000 },
});

export interface GuildSettings {
  submissionChannelId: string | null;
  dailySubmissionLimit: number;
  pointsPerSubmission: number;
}

interface GuildSettingsRow {
  submissionChannelId: string | null;
  dailySubmissionLimit: number;
  pointsPerSubmission: number;
}

export class GuildSettingsService {
  public constructor(private readonly database: Database.Database = initializeDatabase()) {}

  public get(guildId: string): GuildSettings {
    this.ensureGuild(guildId);
    const settings = this.find(guildId);
    if (!settings) {
      throw new Error(`Guild settings could not be loaded for guild ${guildId}.`);
    }
    return settings;
  }

  public find(guildId: string): GuildSettings | null {
    const row = this.database
      .prepare(
        `SELECT
           submission_channel_id AS submissionChannelId,
           daily_submission_limit AS dailySubmissionLimit,
           points_per_submission AS pointsPerSubmission
         FROM guild_settings
         WHERE guild_id = ?`,
      )
      .get(guildId) as GuildSettingsRow | undefined;

    return row ?? null;
  }

  public update(guildId: string, settings: GuildSettings): void {
    this.assertInRange(
      'Daily submission limit',
      settings.dailySubmissionLimit,
      GUILD_SETTING_LIMITS.dailySubmissionLimit,
    );
    this.assertInRange(
      'Points per submission',
      settings.pointsPerSubmission,
      GUILD_SETTING_LIMITS.pointsPerSubmission,
    );

    this.database
      .prepare(
        `INSERT INTO guild_settings (
           guild_id, submission_channel_id, daily_submission_limit, points_per_submission
         )
         VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET
           submission_channel_id = excluded.submission_channel_id,
           daily_submission_limit = excluded.daily_submission_limit,
           points_per_submission = excluded.points_per_submission,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(
        guildId,
        settings.submissionChannelId,
        settings.dailySubmissionLimit,
        settings.pointsPerSubmission,
      );
  }

  private ensureGuild(guildId: string): void {
    this.database
      .prepare(
        `INSERT INTO guild_settings (guild_id)
         VALUES (?)
         ON CONFLICT (guild_id) DO NOTHING`,
      )
      .run(guildId);
  }

  private assertInRange(
    name: string,
    value: number,
    range: { minimum: number; maximum: number },
  ): void {
    if (!Number.isSafeInteger(value) || value < range.minimum || value > range.maximum) {
      throw new RangeError(`${name} must be between ${range.minimum} and ${range.maximum}.`);
    }
  }
}
