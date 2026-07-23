import { EmbedBuilder, Events, type Message } from 'discord.js';
import { SubmissionService, type SubmissionResult } from '../services/SubmissionService.js';
import type { DiscordEvent } from '../types/event.js';
import { logger } from '../utils/logger.js';

const submissionService = new SubmissionService();

export const createSubmissionEmbed = (
  result: Exclude<SubmissionResult, { outcome: 'IGNORED' }>,
): EmbedBuilder => {
  if (result.outcome === 'APPROVED') {
    return new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ Submission Approved')
      .addFields(
        { name: 'Points Earned', value: `+${result.pointsEarned}`, inline: true },
        {
          name: "Today's Submissions",
          value: `${result.todaySubmissions}/${result.dailyLimit}`,
          inline: true,
        },
        { name: 'X Username', value: 'matched', inline: true },
      );
  }

  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('❌ Submission Not Approved')
    .addFields(
      { name: 'Reason', value: result.reason },
      { name: 'Points Earned', value: '0', inline: true },
      {
        name: "Today's Submissions",
        value: `${result.todaySubmissions}/${result.dailyLimit}`,
        inline: true,
      },
    );
};

export const handleSubmissionMessage = async (message: Message): Promise<void> => {
  try {
    const result = submissionService.process({
      messageId: message.id,
      guildId: message.guildId,
      channelId: message.channelId,
      discordUserId: message.author.id,
      content: message.content,
      authorIsBot: message.author.bot,
      isWebhook: message.webhookId !== null,
      hasEmbeds: message.embeds.length > 0,
    });

    if (result.outcome === 'IGNORED') return;
    await message.reply({ embeds: [createSubmissionEmbed(result)] });
  } catch (error) {
    logger.error('Failed to process an X submission.', error);
  }
};

const event: DiscordEvent<Events.MessageCreate> = {
  name: Events.MessageCreate,
  async execute(message) {
    await handleSubmissionMessage(message);
  },
};

export default event;
