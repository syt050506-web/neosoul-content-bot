import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import Database from 'better-sqlite3';
import { schema } from '../src/database/schema.js';
import { createSubmissionEmbed } from '../src/events/messageCreate.js';
import { ParserService } from '../src/services/ParserService.js';
import { PointService } from '../src/services/PointService.js';
import {
  SubmissionService,
  USERNAME_MISMATCH_REASON,
  type SubmissionMessage,
} from '../src/services/SubmissionService.js';

interface AggregateRow {
  submissions: number;
  ledgerEntries: number;
  points: number;
}

const GUILD_ID = 'guild-1';
const CHANNEL_ID = 'channel-1';
const USER_ID = 'user-1';

const createMessage = (
  messageId: string,
  postId: string,
  username = 'MatchedUser',
): SubmissionMessage => ({
  messageId,
  guildId: GUILD_ID,
  channelId: CHANNEL_ID,
  discordUserId: USER_ID,
  content: `https://x.com/${username}/status/${postId}`,
  authorIsBot: false,
  isWebhook: false,
  hasEmbeds: true,
});

describe('SubmissionService integration', () => {
  let database: Database.Database;
  let service: SubmissionService;

  beforeEach(() => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(schema);
    database.exec(
      `CREATE UNIQUE INDEX idx_test_guild_post
       ON submissions(guild_id, post_id) WHERE post_id IS NOT NULL;
       CREATE UNIQUE INDEX idx_test_guild_message
       ON submissions(guild_id, message_id) WHERE message_id IS NOT NULL;
       CREATE UNIQUE INDEX idx_test_submission_reward
       ON point_ledger(submission_id, reason)
       WHERE submission_id IS NOT NULL AND reason = 'Approved X submission'`,
    );
    database
      .prepare(
        `INSERT INTO guild_settings (
           guild_id, submission_channel_id, daily_submission_limit, points_per_submission
         )
         VALUES (?, ?, 3, 1)`,
      )
      .run(GUILD_ID, CHANNEL_ID);
    database
      .prepare(
        `INSERT INTO x_bindings (guild_id, discord_user_id, x_username)
         VALUES (?, ?, ?)`,
      )
      .run(GUILD_ID, USER_ID, 'MatchedUser');
    service = new SubmissionService(database);
  });

  afterEach(() => {
    database.close();
  });

  const aggregates = (): AggregateRow =>
    database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM submissions) AS submissions,
           (SELECT COUNT(*) FROM point_ledger) AS ledgerEntries,
           COALESCE((SELECT SUM(amount) FROM point_ledger), 0) AS points`,
      )
      .get() as AggregateRow;

  test('approves a valid submission, awards exactly one point, and builds the embed', () => {
    const result = service.process(createMessage('message-1', '1001'));

    assert.deepEqual(result, {
      outcome: 'APPROVED',
      todaySubmissions: 1,
      dailyLimit: 3,
      xUsername: 'MatchedUser',
      pointsEarned: 1,
    });
    assert.deepEqual(aggregates(), {
      submissions: 1,
      ledgerEntries: 1,
      points: 1,
    });
    assert.equal(database.prepare('SELECT status FROM submissions').pluck().get(), 'APPROVED');

    const embed = createSubmissionEmbed(result).toJSON();
    assert.equal(embed.title, '✅ Submission Approved');
    assert.ok(embed.fields?.some(({ name, value }) => name === 'Points Earned' && value === '+1'));
    assert.ok(
      embed.fields?.some(({ name, value }) => name === "Today's Submissions" && value === '1/3'),
    );
  });

  test('rejects a duplicate post without consuming quota or awarding points', () => {
    service.process(createMessage('message-1', '1001'));
    const result = service.process(createMessage('message-2', '1001'));

    assert.equal(result.outcome, 'REJECTED');
    assert.deepEqual(aggregates(), {
      submissions: 1,
      ledgerEntries: 1,
      points: 1,
    });
  });

  test('ignores a repeated Discord message event', () => {
    service.process(createMessage('message-1', '1001'));
    const result = service.process(createMessage('message-1', '1001'));

    assert.deepEqual(result, { outcome: 'IGNORED' });
    assert.deepEqual(aggregates(), {
      submissions: 1,
      ledgerEntries: 1,
      points: 1,
    });
  });

  test('stores a username mismatch as rejected and consumes one daily slot', () => {
    const result = service.process(createMessage('message-1', '1001', 'SomeoneElse'));

    assert.deepEqual(result, {
      outcome: 'REJECTED',
      reason: USERNAME_MISMATCH_REASON,
      todaySubmissions: 1,
      dailyLimit: 3,
    });
    assert.deepEqual(aggregates(), {
      submissions: 1,
      ledgerEntries: 0,
      points: 0,
    });
    assert.equal(database.prepare('SELECT status FROM submissions').pluck().get(), 'REJECTED');
  });

  test('rejects a fourth daily submission without storing or rewarding it', () => {
    for (let index = 1; index <= 3; index += 1) {
      assert.equal(
        service.process(createMessage(`message-${index}`, `100${index}`)).outcome,
        'APPROVED',
      );
    }

    const result = service.process(createMessage('message-4', '1004'));
    assert.deepEqual(result, {
      outcome: 'REJECTED',
      reason: "You have reached today's limit of 3 submissions.",
      todaySubmissions: 3,
      dailyLimit: 3,
    });
    assert.deepEqual(aggregates(), {
      submissions: 3,
      ledgerEntries: 3,
      points: 3,
    });
  });

  test('uses the guild-configured daily limit and points reward', () => {
    database
      .prepare(
        `UPDATE guild_settings
         SET daily_submission_limit = 1, points_per_submission = 7
         WHERE guild_id = ?`,
      )
      .run(GUILD_ID);

    const approved = service.process(createMessage('message-1', '1001'));
    assert.deepEqual(approved, {
      outcome: 'APPROVED',
      todaySubmissions: 1,
      dailyLimit: 1,
      xUsername: 'MatchedUser',
      pointsEarned: 7,
    });

    const rejected = service.process(createMessage('message-2', '1002'));
    assert.deepEqual(rejected, {
      outcome: 'REJECTED',
      reason: "You have reached today's limit of 1 submissions.",
      todaySubmissions: 1,
      dailyLimit: 1,
    });
    assert.deepEqual(aggregates(), {
      submissions: 1,
      ledgerEntries: 1,
      points: 7,
    });
  });

  test('rolls back the submission when the ledger insert fails', () => {
    class FailingPointService extends PointService {
      public override addSubmissionPoints(): void {
        throw new Error('simulated ledger failure');
      }
    }

    const failingService = new SubmissionService(
      database,
      new ParserService(),
      new FailingPointService(database),
    );

    assert.throws(
      () => failingService.process(createMessage('message-1', '1001')),
      /simulated ledger failure/,
    );
    assert.deepEqual(aggregates(), {
      submissions: 0,
      ledgerEntries: 0,
      points: 0,
    });
  });

  test('serializes two submissions when only one daily slot remains', async () => {
    service.process(createMessage('message-1', '1001'));
    service.process(createMessage('message-2', '1002'));

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => service.process(createMessage('message-3', '1003'))),
      Promise.resolve().then(() => service.process(createMessage('message-4', '1004'))),
    ]);

    assert.deepEqual([first.outcome, second.outcome].sort(), ['APPROVED', 'REJECTED']);
    assert.deepEqual(aggregates(), {
      submissions: 3,
      ledgerEntries: 3,
      points: 3,
    });
  });
});
