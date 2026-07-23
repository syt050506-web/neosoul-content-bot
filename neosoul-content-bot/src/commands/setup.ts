import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { GUILD_SETTING_LIMITS, GuildSettingsService } from '../services/GuildSettingsService.js';
import type { SlashCommand } from '../types/command.js';

const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure submissions for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addChannelOption((option) =>
    option
      .setName('submission_channel')
      .setDescription('Channel where submissions are accepted')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(true),
  )
  .addIntegerOption((option) =>
    option
      .setName('daily_submission_limit')
      .setDescription('Maximum submissions per member per day')
      .setMinValue(GUILD_SETTING_LIMITS.dailySubmissionLimit.minimum)
      .setMaxValue(GUILD_SETTING_LIMITS.dailySubmissionLimit.maximum)
      .setRequired(true),
  )
  .addIntegerOption((option) =>
    option
      .setName('points_per_submission')
      .setDescription('Points awarded for each approved submission')
      .setMinValue(GUILD_SETTING_LIMITS.pointsPerSubmission.minimum)
      .setMaxValue(GUILD_SETTING_LIMITS.pointsPerSubmission.maximum)
      .setRequired(true),
  );

const command: SlashCommand = {
  data,
  async execute(interaction) {
    if (
      !interaction.guildId ||
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({
        content: '❌ You must be a server administrator to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const submissionChannel = interaction.options.getChannel('submission_channel', true);
    const dailySubmissionLimit = interaction.options.getInteger('daily_submission_limit', true);
    const pointsPerSubmission = interaction.options.getInteger('points_per_submission', true);

    new GuildSettingsService().update(interaction.guildId, {
      submissionChannelId: submissionChannel.id,
      dailySubmissionLimit,
      pointsPerSubmission,
    });

    await interaction.reply({
      content: [
        '✅ Server settings saved.',
        `Submission Channel: <#${submissionChannel.id}>`,
        `Daily Submission Limit: ${dailySubmissionLimit}`,
        `Points Per Submission: ${pointsPerSubmission}`,
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
