import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/index.js';
import { schema } from './schema.js';

let database: Database.Database | undefined;

const migrateGuildSettingsColumns = (connection: Database.Database): void => {
  const columns = connection.pragma('table_info(guild_settings)') as { name: string }[];
  const columnNames = new Set(columns.map(({ name }) => name));

  if (!columnNames.has('submission_channel_id')) {
    connection.exec('ALTER TABLE guild_settings ADD COLUMN submission_channel_id TEXT');
    if (columnNames.has('review_channel_id')) {
      connection.exec(
        `UPDATE guild_settings
         SET submission_channel_id = review_channel_id
         WHERE submission_channel_id IS NULL`,
      );
    }
  }
  if (!columnNames.has('daily_submission_limit')) {
    connection.exec(
      'ALTER TABLE guild_settings ADD COLUMN daily_submission_limit INTEGER NOT NULL DEFAULT 3',
    );
  }
  if (!columnNames.has('points_per_submission')) {
    connection.exec(
      'ALTER TABLE guild_settings ADD COLUMN points_per_submission INTEGER NOT NULL DEFAULT 1',
    );
  }
};

const migratePointLedgerAmountColumn = (connection: Database.Database): void => {
  const columns = connection.pragma('table_info(point_ledger)') as { name: string }[];
  const usesLegacyPointsColumn = columns.some(({ name }) => name === 'points');
  const hasAmountColumn = columns.some(({ name }) => name === 'amount');

  if (usesLegacyPointsColumn && !hasAmountColumn) {
    connection.exec('ALTER TABLE point_ledger RENAME COLUMN points TO amount');
  }
};

const migrateSubmissionColumns = (connection: Database.Database): void => {
  const columns = connection.pragma('table_info(submissions)') as { name: string }[];
  const columnNames = new Set(columns.map(({ name }) => name));

  if (!columnNames.has('post_id')) {
    connection.exec('ALTER TABLE submissions ADD COLUMN post_id TEXT');
  }
  if (!columnNames.has('x_username')) {
    connection.exec('ALTER TABLE submissions ADD COLUMN x_username TEXT');
  }
  if (!columnNames.has('message_id')) {
    connection.exec('ALTER TABLE submissions ADD COLUMN message_id TEXT');
  }
  if (!columnNames.has('rejection_reason')) {
    connection.exec('ALTER TABLE submissions ADD COLUMN rejection_reason TEXT');
  }

  connection.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_guild_post
     ON submissions(guild_id, post_id)
     WHERE post_id IS NOT NULL;
     CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_guild_message
     ON submissions(guild_id, message_id)
     WHERE message_id IS NOT NULL;
     CREATE UNIQUE INDEX IF NOT EXISTS idx_point_ledger_submission_reward
     ON point_ledger(submission_id, reason)
     WHERE submission_id IS NOT NULL AND reason = 'Approved X submission'`,
  );
};

export const initializeDatabase = (): Database.Database => {
  if (database) return database;

  mkdirSync(path.dirname(config.database.path), { recursive: true });
  database = new Database(config.database.path);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.exec(schema);
  migrateGuildSettingsColumns(database);
  migratePointLedgerAmountColumn(database);
  migrateSubmissionColumns(database);

  return database;
};

export const closeDatabase = (): void => {
  database?.close();
  database = undefined;
};
