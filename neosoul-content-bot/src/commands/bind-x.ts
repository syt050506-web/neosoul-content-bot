import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { BindingService } from '../services/BindingService.js';
import type { SlashCommand } from '../types/command.js';

const data = new SlashCommandBuilder()
  .setName('bind-x')
  .setDescription('Bind an X account to your Discord profile.')
  .addStringOption((option) =>
    option.setName('username').setDescription('Your X username').setRequired(true),
  );

const command: SlashCommand = {
  data,
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: '❌ This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const username = BindingService.normalizeUsername(
      interaction.options.getString('username', true),
    );
    if (!username) {
      await interaction.reply({
        content: '❌ Invalid X username\nUse 1–15 letters, numbers, or underscores.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = new BindingService().bind(interaction.guildId, interaction.user.id, username);
    await interaction.reply({
      content:
        result === 'bound'
          ? `✅ X account bound successfully\nAccount: @${username}`
          : '❌ This X account is already bound to another Discord user.',
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
