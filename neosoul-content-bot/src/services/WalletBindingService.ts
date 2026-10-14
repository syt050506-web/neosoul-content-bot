import type Database from 'better-sqlite3';
import { initializeDatabase } from '../database/index.js';

export interface WalletBinding {
  discordUserId: string;
  guildId: string;
  discordUsername: string;
  discordDisplayName: string;
  walletAddress: string;
  boundAt: string;
}

export interface WalletSubmission {
  guildId: string;
  discordUserId: string;
  discordUsername: string;
  discordDisplayName: string;
  walletAddress: string;
}

export type WalletBindResult =
  | 'bound'
  | 'already-bound'
  | 'account-locked'
  | 'wallet-taken'
  | 'other-server'
  | 'invalid-address';

const SELECT_BINDING = `SELECT
  discord_user_id AS discordUserId,
  guild_id AS guildId,
  discord_username AS discordUsername,
  discord_display_name AS discordDisplayName,
  wallet_address AS walletAddress,
  bound_at AS boundAt
  FROM wallet_bindings`;

// Quote every field and neutralize spreadsheet formulas in user-controlled names.
const csvCell = (value: string): string => {
  const firstVisibleCharacter = [...value].find(
    (character) => character.charCodeAt(0) > 32 && character.trim() !== '',
  );
  const isFormula = firstVisibleCharacter !== undefined && '=+@-'.includes(firstVisibleCharacter);
  const safeValue = isFormula || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
};

export class WalletBindingService {
  public constructor(private readonly database: Database.Database = initializeDatabase()) {}

  public static normalizeAddress(address: string): string | null {
    const normalized = address.trim().toLowerCase();
    return /^0x[0-9a-f]{40}$/.test(normalized) && normalized !== `0x${'0'.repeat(40)}`
      ? normalized
      : null;
  }

  public bind(submission: WalletSubmission): WalletBindResult {
    const walletAddress = WalletBindingService.normalizeAddress(submission.walletAddress);
    if (!walletAddress) return 'invalid-address';

    const bind = this.database.transaction((): WalletBindResult => {
      const existing = this.database
        .prepare(`${SELECT_BINDING} WHERE discord_user_id = ?`)
        .get(submission.discordUserId) as WalletBinding | undefined;
      if (existing) {
        if (existing.guildId !== submission.guildId) return 'other-server';
        return existing.walletAddress === walletAddress ? 'already-bound' : 'account-locked';
      }
      if (
        this.database
          .prepare('SELECT 1 FROM wallet_bindings WHERE wallet_address = ?')
          .get(walletAddress)
      ) {
        return 'wallet-taken';
      }

      this.database
        .prepare('INSERT INTO guild_settings (guild_id) VALUES (?) ON CONFLICT DO NOTHING')
        .run(submission.guildId);
      this.database
        .prepare(
          `INSERT INTO wallet_bindings (
            discord_user_id, guild_id, discord_username, discord_display_name, wallet_address
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          submission.discordUserId,
          submission.guildId,
          submission.discordUsername,
          submission.discordDisplayName,
          walletAddress,
        );
      return 'bound';
    });

    // Acquire the write lock before checking: concurrent clients cannot claim the same wallet.
    return bind.immediate();
  }

  public getBinding(guildId: string, discordUserId: string): WalletBinding | null {
    return (
      (this.database
        .prepare(`${SELECT_BINDING} WHERE guild_id = ? AND discord_user_id = ?`)
        .get(guildId, discordUserId) as WalletBinding | undefined) ?? null
    );
  }

  public exportCsv(guildId: string): { csv: Buffer; count: number } {
    const bindings = this.database
      .prepare(`${SELECT_BINDING} WHERE guild_id = ? ORDER BY bound_at, discord_user_id`)
      .all(guildId) as WalletBinding[];
    const rows = [
      [
        'Discord User ID',
        'Discord Username (at submission)',
        'Discord Display Name (at submission)',
        'Wallet Address',
        'Bound At (UTC)',
      ],
      ...bindings.map((binding) => [
        binding.discordUserId,
        binding.discordUsername,
        binding.discordDisplayName,
        binding.walletAddress,
        binding.boundAt,
      ]),
    ];
    return {
      csv: Buffer.from(
        `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`,
        'utf8',
      ),
      count: bindings.length,
    };
  }
}
