import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { BindingService } from '../services/BindingService.js';
import type { SlashCommand } from '../types/command.js';

const command: SlashCommand = {
  data: new SlashCommandBuilder().setName('profile').setDescription('View your content profile.'),
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
        '**Your profile**',
        `X account: ${profile.xUsername ? `@${profile.xUsername}` : 'Not bound'}`,
        `Total points: ${profile.totalPoints}`,
        `Today's valid submissions: ${profile.todayValidSubmissions}`,
        `Today's remaining submissions: ${profile.todayRemainingSubmissions}`,
        `Approved submissions: ${profile.approvedSubmissions}`,
        `Rejected submissions: ${profile.rejectedSubmissions}`,
        `Current rank: ${profile.rank === null ? 'Unranked' : `#${profile.rank}`}`,
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
