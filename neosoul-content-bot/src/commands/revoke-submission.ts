import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ModerationService } from '../services/ModerationService.js';
import type { SlashCommand } from '../types/command.js';
import { moderationFailure, requireAdministrator } from './moderationCommand.js';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('revoke-submission')
    .setDescription('Revoke an approved submission and its awarded points.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName('submission_id')
        .setDescription('Submission ID')
        .setMinValue(1)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Reason for revocation')
        .setMaxLength(1000)
        .setRequired(true),
    ),
  async execute(interaction) {
    const guildId = await requireAdministrator(interaction);
    if (!guildId) return;
    try {
      const result = new ModerationService().revoke(
        guildId,
        interaction.user.id,
        interaction.options.getInteger('submission_id', true),
        interaction.options.getString('reason', true),
      );
      await interaction.reply({
        content: `✅ Submission #${result.submissionId} revoked. ${Math.abs(result.pointsChanged)} point(s) deducted from <@${result.discordUserId}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({ content: moderationFailure(error), flags: MessageFlags.Ephemeral });
    }
  },
};

export default command;
