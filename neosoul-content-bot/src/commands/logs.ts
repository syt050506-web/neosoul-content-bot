import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ModerationService, type LogFilters } from '../services/ModerationService.js';
import type { SlashCommand } from '../types/command.js';
import { moderationFailure, requireAdministrator } from './moderationCommand.js';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Search recent submission history.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('user').setDescription('Filter by Discord user'))
    .addStringOption((option) =>
      option.setName('x_username').setDescription('Filter by X username').setMaxLength(50),
    )
    .addStringOption((option) =>
      option.setName('post_id').setDescription('Filter by X post ID').setMaxLength(100),
    )
    .addIntegerOption((option) =>
      option.setName('limit').setDescription('Number of results').setMinValue(1).setMaxValue(25),
    ),
  async execute(interaction) {
    const guildId = await requireAdministrator(interaction);
    if (!guildId) return;
    try {
      const filters: LogFilters = { limit: interaction.options.getInteger('limit') ?? 10 };
      const user = interaction.options.getUser('user');
      const xUsername = interaction.options.getString('x_username');
      const postId = interaction.options.getString('post_id');
      if (user) filters.discordUserId = user.id;
      if (xUsername) filters.xUsername = xUsername;
      if (postId) filters.postId = postId;
      const rows = new ModerationService().searchLogs(guildId, interaction.user.id, filters);
      const content =
        rows.length === 0
          ? 'No matching submissions found.'
          : rows
              .map((row) => {
                const reason = row.rejectionReason ? ` — ${row.rejectionReason.slice(0, 120)}` : '';
                return `**#${row.id} · ${row.status}** · <@${row.discordUserId}> · @${row.xUsername ?? 'unknown'} · Post \`${row.postId ?? 'unknown'}\` · <t:${Math.floor(new Date(`${row.submittedAt}Z`).getTime() / 1000)}:R>${reason}`;
              })
              .join('\n');
      await interaction.reply({ content: content.slice(0, 2000), flags: MessageFlags.Ephemeral });
    } catch (error) {
      await interaction.reply({ content: moderationFailure(error), flags: MessageFlags.Ephemeral });
    }
  },
};

export default command;
