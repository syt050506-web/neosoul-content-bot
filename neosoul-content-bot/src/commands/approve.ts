import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ModerationService } from '../services/ModerationService.js';
import type { SlashCommand } from '../types/command.js';
import { moderationFailure, requireAdministrator } from './moderationCommand.js';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('approve')
    .setDescription('Manually approve a pending submission.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName('submission_id')
        .setDescription('Submission ID')
        .setMinValue(1)
        .setRequired(true),
    ),
  async execute(interaction) {
    const guildId = await requireAdministrator(interaction);
    if (!guildId) return;
    try {
      const result = new ModerationService().approve(
        guildId,
        interaction.user.id,
        interaction.options.getInteger('submission_id', true),
      );
      await interaction.reply({
        content: `✅ Submission #${result.submissionId} approved. <@${result.discordUserId}> received ${result.pointsChanged} point(s).`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({ content: moderationFailure(error), flags: MessageFlags.Ephemeral });
    }
  },
};

export default command;
