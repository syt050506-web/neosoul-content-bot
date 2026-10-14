import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';
import bindWallet from '../src/commands/bind-wallet.js';
import exportWallets from '../src/commands/export-wallets.js';
import myWallet from '../src/commands/my-wallet.js';
import { loadCommands } from '../src/commands/loadCommands.js';
import { initializeDatabase } from '../src/database/index.js';
import { WalletBindingService } from '../src/services/WalletBindingService.js';

interface RecordedReply {
  content?: string;
  flags?: number;
  files?: AttachmentBuilder[];
}

const ADDRESS = `0x${'12'.repeat(20)}`;
const GUILD = 'wallet-command-guild';
const USER = '1482307119498920012';
const database = initializeDatabase();

beforeEach(() => {
  database.prepare('DELETE FROM wallet_bindings').run();
});

const mockInteraction = (overrides: Record<string, unknown> = {}) => {
  const replies: RecordedReply[] = [];
  const deferred: RecordedReply[] = [];
  const edited: RecordedReply[] = [];
  const interaction = {
    guildId: GUILD,
    user: { id: USER, username: 'real-user', globalName: 'Real User' },
    memberPermissions: { has: () => false },
    attachmentSizeLimit: 10 * 1024 * 1024,
    options: { getString: () => ADDRESS },
    reply: (reply: RecordedReply) => {
      replies.push(reply);
      return Promise.resolve();
    },
    deferReply: (reply: RecordedReply) => {
      deferred.push(reply);
      return Promise.resolve();
    },
    editReply: (reply: RecordedReply) => {
      edited.push(reply);
      return Promise.resolve();
    },
    ...overrides,
  } as unknown as ChatInputCommandInteraction;
  return { interaction, replies, deferred, edited };
};

const addBinding = (guildId = GUILD, userId = USER, address = ADDRESS): void => {
  new WalletBindingService(database).bind({
    guildId,
    discordUserId: userId,
    discordUsername: 'alice',
    discordDisplayName: 'Alice',
    walletAddress: address,
  });
};

test('the authenticated submitter is the only identity used, even if user options are supplied', async () => {
  const mock = mockInteraction({
    options: {
      getString: () => ADDRESS,
      getUser: () => ({ id: 'impersonated-user' }),
    },
  });
  await bindWallet.execute(mock.interaction);
  assert.equal(
    new WalletBindingService(database).getBinding(GUILD, USER)?.discordUsername,
    'real-user',
  );
  assert.equal(new WalletBindingService(database).getBinding(GUILD, 'impersonated-user'), null);
  assert.equal(mock.replies[0]?.flags, MessageFlags.Ephemeral);
});

test('DM binding and lookup are rejected and do not create any rows', async () => {
  for (const command of [bindWallet, myWallet]) {
    const mock = mockInteraction({ guildId: null });
    await command.execute(mock.interaction);
    assert.match(mock.replies[0]?.content ?? '', /only be used in a server/);
  }
  assert.equal(database.prepare('SELECT COUNT(*) FROM wallet_bindings').pluck().get(), 0);
});

test('binding replies explain invalid addresses, locked accounts and duplicate wallets privately', async () => {
  const invalid = mockInteraction({ options: { getString: () => 'invalid' } });
  await bindWallet.execute(invalid.interaction);
  assert.match(invalid.replies[0]?.content ?? '', /40 hexadecimal/);
  addBinding();
  const locked = mockInteraction({ options: { getString: () => `0x${'34'.repeat(20)}` } });
  await bindWallet.execute(locked.interaction);
  assert.match(locked.replies[0]?.content ?? '', /locked wallet/);
  const duplicate = mockInteraction({ user: { id: 'other', username: 'other' } });
  await bindWallet.execute(duplicate.interaction);
  assert.match(duplicate.replies[0]?.content ?? '', /another Discord account/);
  assert.equal(duplicate.replies[0]?.flags, MessageFlags.Ephemeral);
});

test('wallet lookup is private and limited to the invoking user and server', async () => {
  addBinding();
  const own = mockInteraction();
  await myWallet.execute(own.interaction);
  assert.ok(own.replies[0]?.content?.includes(ADDRESS));
  assert.equal(own.replies[0]?.flags, MessageFlags.Ephemeral);
  for (const overrides of [{ user: { id: 'other' } }, { guildId: 'other-server' }]) {
    const mock = mockInteraction(overrides);
    await myWallet.execute(mock.interaction);
    assert.match(mock.replies[0]?.content ?? '', /No wallet submitted/);
    assert.ok(!mock.replies[0]?.content?.includes(ADDRESS));
  }
});

test('export enforces Administrator at runtime, including when Discord command permissions are overridden', async () => {
  addBinding();
  for (const overrides of [
    {},
    { memberPermissions: null },
    { guildId: null, memberPermissions: { has: () => true } },
  ]) {
    const mock = mockInteraction(overrides);
    await exportWallets.execute(mock.interaction);
    assert.match(mock.replies[0]?.content ?? '', /administrator/);
    assert.equal(mock.replies[0]?.flags, MessageFlags.Ephemeral);
    assert.equal(mock.deferred.length, 0);
    assert.equal(mock.edited.length, 0);
  }
});

test("an administrator receives a private CSV attachment containing only this server's total", async () => {
  addBinding();
  const otherAddress = `0x${'56'.repeat(20)}`;
  addBinding('other-server', 'other-user', otherAddress);
  const mock = mockInteraction({ memberPermissions: { has: () => true } });
  await exportWallets.execute(mock.interaction);
  assert.equal(mock.deferred[0]?.flags, MessageFlags.Ephemeral);
  assert.match(mock.edited[0]?.content ?? '', /1 wallet binding/);
  const file = mock.edited[0]?.files?.[0];
  assert.ok(file instanceof AttachmentBuilder);
  assert.ok(file.name?.endsWith('.csv'));
  assert.ok(Buffer.isBuffer(file.attachment));
  const csv = file.attachment.toString('utf8');
  assert.ok(csv.includes(ADDRESS));
  assert.ok(csv.includes(USER));
  assert.ok(!csv.includes(otherAddress));
});

test('empty and oversized exports produce useful replies and retain database records', async () => {
  const empty = mockInteraction({ memberPermissions: { has: () => true } });
  await exportWallets.execute(empty.interaction);
  assert.match(empty.edited[0]?.content ?? '', /No wallet bindings/);
  assert.equal(empty.edited[0]?.files, undefined);
  addBinding();
  const tooLarge = mockInteraction({
    memberPermissions: { has: () => true },
    attachmentSizeLimit: 10,
  });
  await exportWallets.execute(tooLarge.interaction);
  assert.match(tooLarge.edited[0]?.content ?? '', /attachment limit/);
  assert.equal(tooLarge.edited[0]?.files, undefined);
  assert.ok(new WalletBindingService(database).getBinding(GUILD, USER));
});

test('the runtime loader discovers all three commands and restricts export by default', async () => {
  const { commands, definitions } = await loadCommands();
  for (const name of ['bind-wallet', 'my-wallet', 'export-wallets']) {
    assert.ok(commands.has(name));
    assert.ok(definitions.some((definition) => definition.name === name));
  }
  const bind = bindWallet.data.toJSON();
  assert.equal(bind.options?.length, 1);
  assert.equal(bind.options?.[0]?.name, 'address');
  assert.equal(
    exportWallets.data.toJSON().default_member_permissions,
    PermissionFlagsBits.Administrator.toString(),
  );
});
