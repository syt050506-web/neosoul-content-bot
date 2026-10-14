import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { WalletBindingService } from '../services/WalletBindingService.js';
import type { SlashCommand } from '../types/command.js';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('my-wallet')
    .setDescription('Privately view your submitted wallet in this server.')
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: '❌ This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const binding = new WalletBindingService().getBinding(interaction.guildId, interaction.user.id);
    await interaction.reply({
      content: binding
        ? `Your wallet: \`${binding.walletAddress}\`\nDiscord User ID: \`${binding.discordUserId}\`\nBound at: ${binding.boundAt}\nThis is a submitted address; wallet ownership has not been verified.`
        : 'No wallet submitted in this server. Use /bind-wallet to submit your address.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};

export default command;
