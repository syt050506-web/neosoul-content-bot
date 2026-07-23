import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PointService } from '../services/PointService.js';
import type { SlashCommand } from '../types/command.js';

const command: SlashCommand = {
  data: new SlashCommandBuilder().setName('rank').setDescription('View your leaderboard rank.'),
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: '❌ This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = new PointService().getUserRank(interaction.guildId, interaction.user.id);
    await interaction.reply({
      content: [
        `Current rank: ${result.rank === null ? 'Unranked' : `#${result.rank}`}`,
        `Total points: ${result.totalPoints}`,
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
