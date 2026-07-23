import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ModerationService } from '../services/ModerationService.js';
import type { SlashCommand } from '../types/command.js';
import { moderationFailure, requireAdministrator } from './moderationCommand.js';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('adjust-points')
    .setDescription('Add or deduct points from a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption((option) =>
      option.setName('user').setDescription('Discord member').setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Positive to add, negative to deduct')
        .setMinValue(-1_000_000)
        .setMaxValue(1_000_000)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Reason for adjustment')
        .setMaxLength(1000)
        .setRequired(true),
    ),
  async execute(interaction) {
    const guildId = await requireAdministrator(interaction);
    if (!guildId) return;
    try {
      const user = interaction.options.getUser('user', true);
      const result = new ModerationService().adjustPoints(
        guildId,
        interaction.user.id,
        user.id,
        interaction.options.getInteger('amount', true),
        interaction.options.getString('reason', true),
      );
      const sign = result.pointsChanged > 0 ? '+' : '';
      await interaction.reply({
        content: `✅ Points adjusted for <@${user.id}>: ${sign}${result.pointsChanged}.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({ content: moderationFailure(error), flags: MessageFlags.Ephemeral });
    }
  },
};

export default command;
