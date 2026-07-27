import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseShanghaiTime } from '../src/services/MemeLeaderboardService.js';

describe('Meme leaderboard time parsing', () => {
  test('parses activity times as Asia/Shanghai regardless of server timezone', () => {
    assert.equal(parseShanghaiTime('2026-07-22 15:00').toISOString(), '2026-07-22T07:00:00.000Z');
    assert.equal(parseShanghaiTime('2026-07-26 23:59').toISOString(), '2026-07-26T15:59:00.000Z');
  });

  test('rejects malformed and impossible dates', () => {
    assert.throws(() => parseShanghaiTime('2026/07/22 15:00'));
    assert.throws(() => parseShanghaiTime('2026-02-30 15:00'));
    assert.throws(() => parseShanghaiTime('2026-07-22 24:00'));
  });
});
