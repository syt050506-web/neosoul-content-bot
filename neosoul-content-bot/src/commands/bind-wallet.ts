import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { WalletBindingService, type WalletBindResult } from '../services/WalletBindingService.js';
import type { SlashCommand } from '../types/command.js';

const responses: Record<WalletBindResult, string> = {
  bound:
    '✅ Wallet bound to your Discord account. Use /my-wallet to check it. This address is now locked.',
  'already-bound':
    '✅ This wallet is already bound to your account. Your original record has been kept.',
  'account-locked':
    '❌ Your account already has a locked wallet binding. Use /my-wallet to check it.',
  'wallet-taken': '❌ This wallet is already bound to another Discord account.',
  'other-server': '❌ Your account already has a binding in another server using this bot.',
  'invalid-address':
    '❌ Enter a BSC/EVM address: 0x followed by 40 hexadecimal characters. The zero address is not accepted.',
};

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('bind-wallet')
    .setDescription('Bind one BSC/EVM wallet to your own account. The first address is locked.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('address')
        .setDescription('Your BSC/EVM wallet address. Double-check it: bindings cannot be changed.')
        .setRequired(true)
        .setMaxLength(100),
    ),
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: '❌ This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = new WalletBindingService().bind({
      guildId: interaction.guildId,
      discordUserId: interaction.user.id,
      discordUsername: interaction.user.username,
      discordDisplayName: interaction.user.globalName ?? interaction.user.username,
      walletAddress: interaction.options.getString('address', true),
    });
    await interaction.reply({
      content: responses[result],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};

export default command;
