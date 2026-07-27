import {
  ChannelType,
  type Guild,
  type Message,
  type MessageReaction,
  type NewsChannel,
  type TextChannel,
} from 'discord.js';

const DISCORD_EPOCH = 1_420_070_400_000n;
const IMAGE_EXTENSIONS = /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i;
const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi;

export interface MemeLeaderboardEntry {
  message: Message<true>;
  validReactions: number;
}

export type MemeChannel = TextChannel | NewsChannel;

export class MemeLeaderboardError extends Error {}

export const parseShanghaiTime = (value: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new MemeLeaderboardError(
      `Invalid time "${value}". Use YYYY-MM-DD HH:mm (Asia/Shanghai).`,
    );
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const timestamp = Date.UTC(year, month - 1, day, hour - 8, minute);
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const actual = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  if (
    actual.year !== yearText ||
    actual.month !== monthText ||
    actual.day !== dayText ||
    actual.hour !== hourText ||
    actual.minute !== minuteText
  ) {
    throw new MemeLeaderboardError(`Invalid calendar time "${value}".`);
  }
  return date;
};

export const messageHasMemeMedia = (message: Message): boolean => {
  if (message.attachments.size > 0) return true;

  if (
    message.embeds.some(
      (embed) =>
        Boolean(embed.image?.url || embed.thumbnail?.url) ||
        (embed.url ? IMAGE_EXTENSIONS.test(embed.url) : false),
    )
  ) {
    return true;
  }

  return (message.content.match(URL_PATTERN) ?? []).some((url) => IMAGE_EXTENSIONS.test(url));
};

const emojiKey = (value: string): string => value.replaceAll('\uFE0F', '').trim();

const reactionMatches = (reaction: MessageReaction, requestedEmoji: string): boolean => {
  const customEmoji = /^<a?:[^:>]+:(\d+)>$/.exec(requestedEmoji);
  if (customEmoji) return reaction.emoji.id === customEmoji[1];
  return emojiKey(reaction.emoji.name ?? '') === emojiKey(requestedEmoji);
};

const countValidReactionUsers = async (
  reaction: MessageReaction,
  authorId: string,
): Promise<number> => {
  let after: string | undefined;
  let count = 0;

  do {
    const users = await reaction.users.fetch({ limit: 100, ...(after ? { after } : {}) });
    for (const user of users.values()) {
      if (!user.bot && user.id !== authorId) count += 1;
    }
    after = users.size === 100 ? users.lastKey() : undefined;
  } while (after);

  return count;
};

const snowflakeAfterTimestamp = (timestamp: number): string =>
  ((BigInt(timestamp) - DISCORD_EPOCH) << 22n).toString();

export class MemeLeaderboardService {
  async findChannel(
    guild: Guild,
    requestedChannel: MemeChannel | null,
    defaultName: string,
  ): Promise<MemeChannel> {
    if (requestedChannel) return requestedChannel;

    const channels = await guild.channels.fetch();
    const channel = channels.find(
      (candidate): candidate is MemeChannel =>
        candidate?.name === defaultName &&
        (candidate.type === ChannelType.GuildText ||
          candidate.type === ChannelType.GuildAnnouncement),
    );
    if (!channel) {
      throw new MemeLeaderboardError(`Channel #${defaultName} was not found.`);
    }
    return channel;
  }

  async collect(
    channel: MemeChannel,
    start: Date,
    end: Date,
    emoji: string,
  ): Promise<MemeLeaderboardEntry[]> {
    if (start.getTime() > end.getTime()) {
      throw new MemeLeaderboardError('Start time must be before or equal to end time.');
    }

    const candidates: Message<true>[] = [];
    let before = snowflakeAfterTimestamp(end.getTime() + 60_000);
    let reachedStart = false;

    while (!reachedStart) {
      const messages = await channel.messages.fetch({ limit: 100, before, cache: false });
      if (messages.size === 0) break;

      for (const message of messages.values()) {
        if (message.createdTimestamp < start.getTime()) {
          reachedStart = true;
          continue;
        }
        if (
          message.createdTimestamp <= end.getTime() &&
          !message.author.bot &&
          message.webhookId === null &&
          messageHasMemeMedia(message)
        ) {
          candidates.push(message);
        }
      }
      before = messages.lastKey() ?? before;
      if (messages.size < 100) break;
    }

    const entries: MemeLeaderboardEntry[] = [];
    for (const message of candidates) {
      const reaction = message.reactions.cache.find((item) => reactionMatches(item, emoji));
      const validReactions = reaction
        ? await countValidReactionUsers(reaction, message.author.id)
        : 0;
      entries.push({ message, validReactions });
    }

    return entries.sort(
      (left, right) =>
        right.validReactions - left.validReactions ||
        left.message.createdTimestamp - right.message.createdTimestamp,
    );
  }
}
