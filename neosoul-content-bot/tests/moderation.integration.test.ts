import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import Database from 'better-sqlite3';
import { schema } from '../src/database/schema.js';
import { ModerationError, ModerationService } from '../src/services/ModerationService.js';

describe('ModerationService integration', () => {
  let database: Database.Database;
  let service: ModerationService;

  beforeEach(() => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(schema);
    database.exec(
      `CREATE UNIQUE INDEX idx_test_submission_reward
       ON point_ledger(submission_id, reason)
       WHERE submission_id IS NOT NULL AND reason = 'Approved X submission'`,
    );
    database
      .prepare(
        `INSERT INTO guild_settings (guild_id, points_per_submission)
         VALUES ('guild', 5)`,
      )
      .run();
    service = new ModerationService(database);
  });

  afterEach(() => database.close());

  const addSubmission = (status = 'PENDING'): number =>
    Number(
      database
        .prepare(
          `INSERT INTO submissions (
             guild_id, discord_user_id, source_url, post_id, x_username, status
           ) VALUES ('guild', 'member', ?, ?, 'creator', ?)`,
        )
        .run(`https://x.com/creator/status/${Math.random()}`, `${Math.random()}`, status)
        .lastInsertRowid,
    );

  test('approves once, awards configured points, and audits the action', () => {
    const id = addSubmission();
    assert.equal(service.approve('guild', 'admin', id).pointsChanged, 5);
    assert.equal(database.prepare('SELECT SUM(amount) FROM point_ledger').pluck().get(), 5);
    assert.equal(
      database.prepare('SELECT action FROM moderation_actions').pluck().get(),
      'APPROVE',
    );
    assert.throws(
      () => service.approve('guild', 'admin', id),
      (error: unknown) =>
        error instanceof ModerationError &&
        error.message === 'This submission is already approved.',
    );
    assert.equal(database.prepare('SELECT COUNT(*) FROM point_ledger').pluck().get(), 1);
  });

  test('rejects only a pending submission and stores its reason', () => {
    const id = addSubmission();
    service.reject('guild', 'admin', id, 'Off topic');
    const row = database
      .prepare('SELECT status, rejection_reason AS reason FROM submissions WHERE id = ?')
      .get(id) as { status: string; reason: string };
    assert.deepEqual(row, { status: 'REJECTED', reason: 'Off topic' });
    assert.equal(database.prepare('SELECT action FROM moderation_actions').pluck().get(), 'REJECT');
  });

  test('records positive and negative manual adjustments in the ledger and audit', () => {
    service.adjustPoints('guild', 'admin', 'member', 8, 'Bonus');
    service.adjustPoints('guild', 'admin', 'member', -3, 'Correction');
    assert.equal(database.prepare('SELECT SUM(amount) FROM point_ledger').pluck().get(), 5);
    assert.equal(database.prepare('SELECT COUNT(*) FROM moderation_actions').pluck().get(), 2);
  });

  test('revokes an approval exactly once while preserving ledger history', () => {
    const id = addSubmission();
    service.approve('guild', 'admin-one', id);
    assert.equal(service.revoke('guild', 'admin-two', id, 'Policy violation').pointsChanged, -5);
    assert.equal(database.prepare('SELECT SUM(amount) FROM point_ledger').pluck().get(), 0);
    assert.equal(database.prepare('SELECT COUNT(*) FROM point_ledger').pluck().get(), 2);
    assert.equal(database.prepare('SELECT status FROM submissions').pluck().get(), 'REVOKED');
    assert.throws(() => service.revoke('guild', 'admin-two', id, 'Again'), ModerationError);
  });

  test('searches by all supported filters and audits log access', () => {
    const id = addSubmission();
    const rows = service.searchLogs('guild', 'admin', {
      discordUserId: 'member',
      xUsername: '@CREATOR',
      postId: database
        .prepare('SELECT post_id FROM submissions WHERE id = ?')
        .pluck()
        .get(id) as string,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, id);
    assert.equal(
      database.prepare('SELECT action FROM moderation_actions').pluck().get(),
      'LOGS_SEARCH',
    );
  });
});
