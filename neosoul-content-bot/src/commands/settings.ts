import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { GuildSettingsService } from '../services/GuildSettingsService.js';
import type { SlashCommand } from '../types/command.js';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('View this server’s submission settings.')
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: '❌ This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const settings = new GuildSettingsService().get(interaction.guildId);
    await interaction.reply({
      content: [
        '**Server Settings**',
        `Submission Channel: ${
          settings.submissionChannelId ? `<#${settings.submissionChannelId}>` : 'Not configured'
        }`,
        `Daily Submission Limit: ${settings.dailySubmissionLimit}`,
        `Points Per Submission: ${settings.pointsPerSubmission}`,
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
