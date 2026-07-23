import { MessageFlags, type SlashCommandBuilder } from 'discord.js';
import type { SlashCommand } from '../types/command.js';

export const createPlaceholderCommand = (data: SlashCommandBuilder): SlashCommand => ({
  data,
  async execute(interaction) {
    await interaction.reply({
      content: 'This command is not implemented yet.',
      flags: MessageFlags.Ephemeral,
    });
  },
});
