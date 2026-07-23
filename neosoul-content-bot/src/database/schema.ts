export const schema = `
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    submission_channel_id TEXT,
    daily_submission_limit INTEGER NOT NULL DEFAULT 3
      CHECK (daily_submission_limit BETWEEN 1 AND 1000),
    points_per_submission INTEGER NOT NULL DEFAULT 1
      CHECK (points_per_submission BETWEEN 1 AND 100000),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS x_bindings (
    guild_id TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    x_user_id TEXT,
    x_username TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, discord_user_id),
    UNIQUE (guild_id, x_username),
    FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    message_id TEXT,
    source_url TEXT NOT NULL,
    post_id TEXT,
    x_username TEXT,
    status TEXT NOT NULL DEFAULT 'APPROVED',
    submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    reviewed_by TEXT,
    rejection_reason TEXT,
    UNIQUE (guild_id, source_url),
    FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS point_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    submission_id INTEGER,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
    FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS moderation_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    administrator_id TEXT NOT NULL,
    action TEXT NOT NULL,
    submission_id INTEGER,
    discord_user_id TEXT,
    amount INTEGER,
    reason TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE,
    FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_submissions_guild_user
    ON submissions(guild_id, discord_user_id);
  CREATE INDEX IF NOT EXISTS idx_submissions_status
    ON submissions(guild_id, status);
  CREATE INDEX IF NOT EXISTS idx_point_ledger_guild_user
    ON point_ledger(guild_id, discord_user_id);
  CREATE INDEX IF NOT EXISTS idx_moderation_actions_guild_created
    ON moderation_actions(guild_id, created_at DESC, id DESC);
`;
