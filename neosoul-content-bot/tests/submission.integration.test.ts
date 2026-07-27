import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import Database from 'better-sqlite3';
import type { Message } from 'discord.js';
import { initializeDatabase } from '../src/database/index.js';
import { schema } from '../src/database/schema.js';
import { createSubmissionEmbed, handleSubmissionMessage } from '../src/events/messageCreate.js';
import { ParserService } from '../src/services/ParserService.js';
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

  test('saves a valid submission as pending without awarding points', () => {
    const result = service.process(createMessage('message-1', '1001'));

    assert.deepEqual(result, {
      outcome: 'PENDING',
      submissionId: 1,
      todaySubmissions: 1,
      dailyLimit: 3,
      xUsername: 'MatchedUser',
    });
    assert.deepEqual(aggregates(), {
      submissions: 1,
      ledgerEntries: 0,
      points: 0,
    });
    assert.equal(database.prepare('SELECT status FROM submissions').pluck().get(), 'PENDING');

    const embed = createSubmissionEmbed(result).toJSON();
    assert.equal(embed.title, '✅ Submission received. Status: Pending Review.');
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
      ledgerEntries: 0,
      points: 0,
    });
  });

  test('rejects a repeated Discord message event with a user-facing result', () => {
    service.process(createMessage('message-1', '1001'));
    const result = service.process(createMessage('message-1', '1001'));

    assert.deepEqual(result, {
      outcome: 'REJECTED',
      code: 'DUPLICATE_MESSAGE',
      reason: 'This Discord message has already been submitted.',
      todaySubmissions: 1,
      dailyLimit: 3,
    });
    assert.deepEqual(aggregates(), {
      submissions: 1,
      ledgerEntries: 0,
      points: 0,
    });
  });

  test('rejects a username mismatch without saving or consuming a daily slot', () => {
    const result = service.process(createMessage('message-1', '1001', 'SomeoneElse'));

    assert.deepEqual(result, {
      outcome: 'REJECTED',
      code: 'USERNAME_MISMATCH',
      reason: USERNAME_MISMATCH_REASON,
      todaySubmissions: 0,
      dailyLimit: 3,
    });
    assert.deepEqual(aggregates(), {
      submissions: 0,
      ledgerEntries: 0,
      points: 0,
    });
  });

  test('rejects a fourth daily submission without storing or rewarding it', () => {
    for (let index = 1; index <= 3; index += 1) {
      assert.equal(
        service.process(createMessage(`message-${index}`, `100${index}`)).outcome,
        'PENDING',
      );
    }

    const result = service.process(createMessage('message-4', '1004'));
    assert.deepEqual(result, {
      outcome: 'REJECTED',
      code: 'DAILY_LIMIT',
      reason: "You have reached today's limit of 3 submissions.",
      todaySubmissions: 3,
      dailyLimit: 3,
    });
    assert.deepEqual(aggregates(), {
      submissions: 3,
      ledgerEntries: 0,
      points: 0,
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

    const pending = service.process(createMessage('message-1', '1001'));
    assert.deepEqual(pending, {
      outcome: 'PENDING',
      submissionId: 1,
      todaySubmissions: 1,
      dailyLimit: 1,
      xUsername: 'MatchedUser',
    });

    const rejected = service.process(createMessage('message-2', '1002'));
    assert.deepEqual(rejected, {
      outcome: 'REJECTED',
      code: 'DAILY_LIMIT',
      reason: "You have reached today's limit of 1 submissions.",
      todaySubmissions: 1,
      dailyLimit: 1,
    });
    assert.deepEqual(aggregates(), {
      submissions: 1,
      ledgerEntries: 0,
      points: 0,
    });
  });

  test('does not require an X embed preview to save a submission', () => {
    const result = service.process({ ...createMessage('message-1', '1001'), hasEmbeds: false });
    assert.equal(result.outcome, 'PENDING');
    assert.equal(database.prepare('SELECT status FROM submissions').pluck().get(), 'PENDING');
  });

  test('serializes two submissions when only one daily slot remains', async () => {
    service.process(createMessage('message-1', '1001'));
    service.process(createMessage('message-2', '1002'));

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => service.process(createMessage('message-3', '1003'))),
      Promise.resolve().then(() => service.process(createMessage('message-4', '1004'))),
    ]);

    assert.deepEqual([first.outcome, second.outcome].sort(), ['PENDING', 'REJECTED']);
    assert.deepEqual(aggregates(), {
      submissions: 3,
      ledgerEntries: 0,
      points: 0,
    });
  });
});

test('parser accepts every supported X/Twitter status URL host from message content', () => {
  const parser = new ParserService();
  for (const url of [
    'https://x.com/username/status/123',
    'https://www.x.com/username/status/123',
    'https://twitter.com/username/status/123',
    'https://mobile.twitter.com/username/status/123',
  ]) {
    assert.deepEqual(parser.parseXPost(`proof: ${url}`), {
      ok: true,
      post: { username: 'username', postId: '123', originalUrl: url },
    });
  }
});

test('messageCreate handler saves and replies to an X URL in the configured channel', async () => {
  const appDatabase = initializeDatabase();
  const testSuffix = `${process.pid}-${Date.now()}`;
  const guildId = `handler-guild-${testSuffix}`;
  const channelId = `handler-channel-${testSuffix}`;
  const userId = `handler-user-${testSuffix}`;
  appDatabase
    .prepare(
      `INSERT INTO guild_settings (
         guild_id, submission_channel_id, daily_submission_limit, points_per_submission
       ) VALUES (?, ?, 3, 1)`,
    )
    .run(guildId, channelId);
  appDatabase
    .prepare(
      `INSERT INTO x_bindings (guild_id, discord_user_id, x_username)
       VALUES (?, ?, ?)`,
    )
    .run(guildId, userId, 'MatchedUser');

  const replies: unknown[] = [];
  const message = {
    id: 'handler-message',
    guildId,
    channelId,
    content: 'https://x.com/MatchedUser/status/999001',
    author: { id: userId, bot: false },
    webhookId: null,
    embeds: [],
    reply: (reply: unknown) => {
      replies.push(reply);
      return Promise.resolve();
    },
  } as unknown as Message;

  await handleSubmissionMessage(message);

  assert.deepEqual(replies, ['✅ Submission received. Status: Pending Review.']);
  assert.equal(
    appDatabase
      .prepare('SELECT status FROM submissions WHERE guild_id = ? AND message_id = ?')
      .pluck()
      .get(guildId, message.id),
    'PENDING',
  );
});
