import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { BindingService } from '../services/BindingService.js';
import type { SlashCommand } from '../types/command.js';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('unbind-x')
    .setDescription('Remove the X account bound to your Discord profile.'),
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: '❌ This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const removed = new BindingService().unbind(interaction.guildId, interaction.user.id);
    await interaction.reply({
      content: removed
        ? '✅ X account unbound successfully.'
        : '❌ You do not have an X account bound in this server.',
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
