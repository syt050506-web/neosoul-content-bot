import { SlashCommandBuilder } from 'discord.js';
import { PointService } from '../services/PointService.js';
import type { SlashCommand } from '../types/command.js';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the community points leaderboard.'),
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply('❌ This command can only be used in a server.');
      return;
    }

    await interaction.deferReply();
    const leaderboard = new PointService().getLeaderboardPage(interaction.guildId, 1, 10);
    if (leaderboard.entries.length === 0) {
      await interaction.editReply('No one has earned points yet.');
      return;
    }

    const usernames = await Promise.all(
      leaderboard.entries.map(async ({ discordUserId }) => {
        try {
          return (await interaction.client.users.fetch(discordUserId)).username;
        } catch {
          return `Unknown user (${discordUserId})`;
        }
      }),
    );
    const rows = leaderboard.entries.map(
      ({ rank, totalPoints }, index) =>
        `**${rank}.** ${usernames[index] ?? 'Unknown user'} — ${totalPoints} points`,
    );

    await interaction.editReply(['**Leaderboard**', ...rows].join('\n'));
  },
};

export default command;
