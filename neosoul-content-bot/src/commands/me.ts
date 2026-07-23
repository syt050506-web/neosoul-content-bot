import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { BindingService } from '../services/BindingService.js';
import type { SlashCommand } from '../types/command.js';

const command: SlashCommand = {
  data: new SlashCommandBuilder().setName('me').setDescription('View your content statistics.'),
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: '❌ This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const profile = new BindingService().getProfile(interaction.guildId, interaction.user.id);
    await interaction.reply({
      content: [
        `Bound X username: ${profile.xUsername ? `@${profile.xUsername}` : 'Not bound'}`,
        `Total points: ${profile.totalPoints}`,
        `Today's submissions: ${profile.todayValidSubmissions}`,
        `Remaining submissions: ${profile.todayRemainingSubmissions}`,
        `Approved submissions: ${profile.approvedSubmissions}`,
        `Rejected submissions: ${profile.rejectedSubmissions}`,
        `Current rank: ${profile.rank === null ? 'Unranked' : `#${profile.rank}`}`,
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
