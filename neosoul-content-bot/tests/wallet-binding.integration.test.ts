import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import Database from 'better-sqlite3';
import { schema } from '../src/database/schema.js';
import {
  WalletBindingService,
  type WalletSubmission,
} from '../src/services/WalletBindingService.js';

const ADDRESS = `0x${'ab'.repeat(20)}`;
const OTHER_ADDRESS = `0x${'cd'.repeat(20)}`;
const submission = (overrides: Partial<WalletSubmission> = {}): WalletSubmission => ({
  guildId: 'guild',
  discordUserId: '1482307119498920012',
  discordUsername: 'alice',
  discordDisplayName: 'Alice',
  walletAddress: ADDRESS,
  ...overrides,
});

describe('Wallet binding persistence and uniqueness', () => {
  let database: Database.Database;
  let service: WalletBindingService;

  beforeEach(() => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(schema);
    service = new WalletBindingService(database);
  });
  afterEach(() => database.close());

  test('normalizes address casing and rejects invalid or zero addresses without writing', () => {
    for (const address of [
      '',
      '0x123',
      'ab'.repeat(20),
      `0x${'g'.repeat(40)}`,
      `0x${'0'.repeat(40)}`,
    ]) {
      assert.equal(service.bind(submission({ walletAddress: address })), 'invalid-address');
    }
    assert.equal(database.prepare('SELECT COUNT(*) FROM wallet_bindings').pluck().get(), 0);
    assert.equal(
      service.bind(submission({ walletAddress: `  ${ADDRESS.toUpperCase()}  ` })),
      'bound',
    );
    assert.equal(service.getBinding('guild', submission().discordUserId)?.walletAddress, ADDRESS);
  });

  test('a repeated submission preserves the original record, including username and time', () => {
    assert.equal(service.bind(submission()), 'bound');
    const original = service.getBinding('guild', submission().discordUserId);
    assert.ok(original?.boundAt.endsWith('Z'));
    assert.equal(service.bind(submission({ discordUsername: 'renamed' })), 'already-bound');
    assert.deepEqual(service.getBinding('guild', submission().discordUserId), original);
  });

  test('rejects a second wallet for the same ID even after the user changes their name', () => {
    service.bind(submission());
    assert.equal(
      service.bind(submission({ discordUsername: 'renamed', walletAddress: OTHER_ADDRESS })),
      'account-locked',
    );
    assert.equal(service.getBinding('guild', submission().discordUserId)?.walletAddress, ADDRESS);
  });

  test('rejects another user claiming the same wallet with different casing or from another server', () => {
    service.bind(submission());
    assert.equal(
      service.bind(submission({ discordUserId: 'other', walletAddress: ADDRESS.toUpperCase() })),
      'wallet-taken',
    );
    assert.equal(
      service.bind(submission({ guildId: 'other-guild', discordUserId: 'other' })),
      'wallet-taken',
    );
    assert.equal(service.bind(submission({ guildId: 'other-guild' })), 'other-server');
  });

  test('database constraints enforce the one-to-one mapping independently of the service', () => {
    service.bind(submission());
    const insert = database.prepare(
      `INSERT INTO wallet_bindings (discord_user_id, guild_id, discord_username, discord_display_name, wallet_address)
       VALUES (?, 'guild', 'other', 'Other', ?)`,
    );
    assert.throws(() => insert.run('other', ADDRESS), /UNIQUE constraint/);
    assert.throws(() => insert.run(submission().discordUserId, OTHER_ADDRESS), /UNIQUE constraint/);
    assert.throws(() => insert.run('other', ADDRESS.toUpperCase()), /CHECK constraint/);
  });

  test('users sharing a display name can bind different wallets, and exports stay inside the server', () => {
    service.bind(submission());
    service.bind(
      submission({ guildId: 'other-guild', discordUserId: 'other', walletAddress: OTHER_ADDRESS }),
    );
    assert.equal(service.getBinding('other-guild', submission().discordUserId), null);
    const { csv, count } = service.exportCsv('guild');
    assert.equal(count, 1);
    assert.ok(csv.toString().includes(submission().discordUserId));
    assert.ok(csv.toString().includes(ADDRESS));
    assert.ok(!csv.toString().includes(OTHER_ADDRESS));
    assert.equal(service.exportCsv('empty-guild').count, 0);
  });

  test('CSV supports Chinese names, commas, quotes and newlines and prevents spreadsheet formulas', () => {
    service.bind(submission({ discordUsername: '=1+1', discordDisplayName: '灵魂,"Alice"\n中文' }));
    const { csv } = service.exportCsv('guild');
    assert.deepEqual([...csv.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.ok(csv.toString().includes('"\'=1+1"'));
    assert.ok(csv.toString().includes('"灵魂,""Alice""\n中文"'));
    for (const [index, name] of ['@SUM(1,2)', '+1', '-1', '   =1', '\t=1', '\r=1'].entries()) {
      const guildId = `formula-guild-${index}`;
      service.bind(
        submission({
          guildId,
          discordUserId: `formula-user-${index}`,
          discordUsername: name,
          walletAddress: `0x${(index + 1).toString(16).padStart(40, '0')}`,
        }),
      );
      assert.ok(service.exportCsv(guildId).csv.toString().includes(`"'${name}"`));
    }
  });
});

test('schema upgrades an existing database without losing content data, and wallets survive restart', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'neosoul-wallet-'));
  const filename = path.join(directory, 'bot.sqlite');
  let database: Database.Database | undefined;
  try {
    database = new Database(filename);
    database.pragma('foreign_keys = ON');
    database.exec(schema);
    database.exec('DROP TABLE wallet_bindings');
    database.exec("INSERT INTO guild_settings (guild_id) VALUES ('legacy')");
    database.exec(
      "INSERT INTO x_bindings (guild_id, discord_user_id, x_username) VALUES ('legacy', 'existing-user', 'creator')",
    );
    database.exec(schema);
    const service = new WalletBindingService(database);
    service.bind(submission());
    const before = service.getBinding('guild', submission().discordUserId);
    database.close();
    database = new Database(filename);
    database.exec(schema);
    assert.deepEqual(
      new WalletBindingService(database).getBinding('guild', submission().discordUserId),
      before,
    );
    assert.equal(database.prepare('SELECT x_username FROM x_bindings').pluck().get(), 'creator');
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('two independent processes racing for the same wallet produce exactly one binding', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'neosoul-wallet-race-'));
  const filename = path.join(directory, 'bot.sqlite');
  const database = new Database(filename);
  database.pragma('journal_mode = WAL');
  database.exec(schema);
  database.close();

  const code = `
    import Database from 'better-sqlite3';
    import { WalletBindingService } from './src/services/WalletBindingService.ts';
    const db = new Database(process.argv[1]);
    db.pragma('foreign_keys = ON');
    process.stdout.write('ready\\n');
    process.stdin.once('data', () => {
      try {
        const result = new WalletBindingService(db).bind({
          guildId: 'guild', discordUserId: process.argv[2], discordUsername: 'alice',
          discordDisplayName: 'Alice', walletAddress: '${ADDRESS}'
        });
        process.stdout.write(result + '\\n');
      } finally { db.close(); process.stdin.destroy(); }
    });
  `;
  const racers = ['one', 'two'].map((id) => {
    const child = spawn(process.execPath, [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      code,
      filename,
      id,
    ]);
    let output = '';
    let errors = '';
    const ready = new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('ready\n')) resolve();
      });
      child.on('error', reject);
      child.on('exit', () => {
        if (!output.includes('ready\n'))
          reject(new Error(errors || 'Worker exited before readiness'));
      });
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    const done = new Promise<string>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (status) => {
        if (status === 0) resolve(output.trim().split('\n').at(-1) ?? '');
        else reject(new Error(errors || `Worker exit status ${status}`));
      });
    });
    return { child, ready, done };
  });
  try {
    await Promise.all(racers.map((racer) => racer.ready));
    for (const racer of racers) racer.child.stdin.end('go');
    const results = await Promise.all(racers.map((racer) => racer.done));
    assert.deepEqual(results.sort(), ['bound', 'wallet-taken']);
    const persisted = new Database(filename);
    try {
      assert.equal(persisted.prepare('SELECT COUNT(*) FROM wallet_bindings').pluck().get(), 1);
    } finally {
      persisted.close();
    }
  } finally {
    for (const racer of racers) racer.child.kill();
    await Promise.allSettled(racers.map((racer) => racer.done));
    rmSync(directory, { recursive: true, force: true });
  }
});
