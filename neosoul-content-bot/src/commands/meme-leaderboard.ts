import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  MemeLeaderboardError,
  MemeLeaderboardService,
  parseShanghaiTime,
  type MemeChannel,
} from '../services/MemeLeaderboardService.js';
import type { SlashCommand } from '../types/command.js';
import { requireAdministrator } from './moderationCommand.js';

const DEFAULT_CHANNEL = 'community-vibe';
const DEFAULT_START = '2026-07-22 15:00';
const DEFAULT_END = '2026-07-26 23:59';
const DEFAULT_EMOJI = '❤️';
const DISCORD_MESSAGE_LIMIT = 2_000;

const splitContent = (heading: string, rows: string[]): string[] => {
  const chunks: string[] = [];
  let current = heading;

  for (const row of rows) {
    if (`${current}\n${row}`.length > DISCORD_MESSAGE_LIMIT) {
      chunks.push(current);
      current = row;
    } else {
      current += `\n${row}`;
    }
  }
  chunks.push(current);
  return chunks;
};

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('meme_leaderboard')
    .setDescription('Rank Meme submissions by valid reactions in a date range.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription(`Submission channel (default: #${DEFAULT_CHANNEL})`)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addStringOption((option) =>
      option
        .setName('start')
        .setDescription(`Asia/Shanghai time, YYYY-MM-DD HH:mm (default: ${DEFAULT_START})`),
    )
    .addStringOption((option) =>
      option
        .setName('end')
        .setDescription(`Asia/Shanghai time, YYYY-MM-DD HH:mm (default: ${DEFAULT_END})`),
    )
    .addIntegerOption((option) =>
      option
        .setName('limit')
        .setDescription('Number of ranked submissions (default: 10)')
        .setMinValue(1)
        .setMaxValue(25),
    )
    .addStringOption((option) =>
      option.setName('emoji').setDescription(`Reaction emoji (default: ${DEFAULT_EMOJI})`),
    ),
  async execute(interaction) {
    const guildId = await requireAdministrator(interaction);
    if (!guildId || !interaction.guild) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const startText = interaction.options.getString('start') ?? DEFAULT_START;
    const endText = interaction.options.getString('end') ?? DEFAULT_END;
    const limit = interaction.options.getInteger('limit') ?? 10;
    const emoji = interaction.options.getString('emoji')?.trim() || DEFAULT_EMOJI;

    try {
      const service = new MemeLeaderboardService();
      const selected = interaction.options.getChannel('channel');
      const requestedChannel =
        selected?.type === ChannelType.GuildText || selected?.type === ChannelType.GuildAnnouncement
          ? (selected as MemeChannel)
          : null;
      const channel = await service.findChannel(
        interaction.guild,
        requestedChannel,
        DEFAULT_CHANNEL,
      );
      const start = parseShanghaiTime(startText);
      const end = parseShanghaiTime(endText);
      end.setSeconds(59, 999);
      const entries = (await service.collect(channel, start, end, emoji)).slice(0, limit);

      if (entries.length === 0) {
        await interaction.editReply(
          `No Meme submissions were found in <#${channel.id}> between ${startText} and ${endText} (Asia/Shanghai).`,
        );
        return;
      }

      const rows = await Promise.all(
        entries.map(async ({ message, validReactions }, index) => {
          let displayName = message.member?.displayName ?? message.author.globalName;
          if (!displayName) {
            try {
              displayName = (await interaction.guild!.members.fetch(message.author.id)).displayName;
            } catch {
              displayName = message.author.username;
            }
          }
          const postedAt = new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).format(message.createdAt);
          return `**${index + 1}.** ${displayName} (@${message.author.username}) — ${validReactions} ${emoji}\n北京时间：${postedAt} · [原消息](${message.url})`;
        }),
      );
      const heading = `**Meme Leaderboard** · <#${channel.id}>\n${startText} → ${endText}（北京时间）`;
      const chunks = splitContent(heading, rows);
      await interaction.editReply(chunks[0] ?? heading);
      for (const chunk of chunks.slice(1)) {
        await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
      const detail =
        error instanceof MemeLeaderboardError
          ? error.message
          : 'Unable to read the channel history or reactions. Check the bot permissions.';
      await interaction.editReply(`❌ ${detail}`);
    }
  },
};

export default command;
