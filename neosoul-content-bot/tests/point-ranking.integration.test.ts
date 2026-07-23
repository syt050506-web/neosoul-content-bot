import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import Database from 'better-sqlite3';
import { schema } from '../src/database/schema.js';
import { PointService } from '../src/services/PointService.js';

const GUILD_ID = 'guild-1';

describe('PointService rankings', () => {
  let database: Database.Database;
  let service: PointService;

  beforeEach(() => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(schema);
    database
      .prepare('INSERT INTO guild_settings (guild_id) VALUES (?), (?)')
      .run(GUILD_ID, 'guild-2');
    service = new PointService(database);
  });

  afterEach(() => {
    database.close();
  });

  const addPoints = (guildId: string, userId: string, ...amounts: number[]): void => {
    const insert = database.prepare(
      `INSERT INTO point_ledger (guild_id, discord_user_id, amount, reason)
       VALUES (?, ?, ?, 'test')`,
    );
    for (const amount of amounts) insert.run(guildId, userId, amount);
  };

  test('aggregates the ledger and gives tied users the same competition rank', () => {
    addPoints(GUILD_ID, 'user-a', 4, 6);
    addPoints(GUILD_ID, 'user-b', 7);
    addPoints(GUILD_ID, 'user-c', 2, 5);
    addPoints(GUILD_ID, 'user-d', 1);
    addPoints('guild-2', 'other-guild-user', 100);

    assert.deepEqual(service.getLeaderboardPage(GUILD_ID).entries, [
      { discordUserId: 'user-a', totalPoints: 10, rank: 1 },
      { discordUserId: 'user-b', totalPoints: 7, rank: 2 },
      { discordUserId: 'user-c', totalPoints: 7, rank: 2 },
      { discordUserId: 'user-d', totalPoints: 1, rank: 4 },
    ]);
    assert.deepEqual(service.getUserRank(GUILD_ID, 'user-c'), {
      rank: 2,
      totalPoints: 7,
    });
  });

  test('paginates without recalculating ranks within each page', () => {
    for (let index = 1; index <= 5; index += 1) {
      addPoints(GUILD_ID, `user-${index}`, 6 - index);
    }

    assert.deepEqual(service.getLeaderboardPage(GUILD_ID, 2, 2), {
      entries: [
        { discordUserId: 'user-3', totalPoints: 3, rank: 3 },
        { discordUserId: 'user-4', totalPoints: 2, rank: 4 },
      ],
      page: 2,
      pageSize: 2,
      totalUsers: 5,
      totalPages: 3,
    });
  });

  test('returns zero points and no position for a user absent from the ledger', () => {
    assert.deepEqual(service.getUserRank(GUILD_ID, 'new-user'), {
      rank: null,
      totalPoints: 0,
    });
  });

  test('rejects invalid pagination arguments', () => {
    assert.throws(() => service.getLeaderboardPage(GUILD_ID, 0), RangeError);
    assert.throws(() => service.getLeaderboardPage(GUILD_ID, 1, 101), RangeError);
  });
});
