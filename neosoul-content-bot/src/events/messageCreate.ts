import { EmbedBuilder, Events, type Message } from 'discord.js';
import { GuildSettingsService } from '../services/GuildSettingsService.js';
import { SubmissionService, type SubmissionResult } from '../services/SubmissionService.js';
import type { DiscordEvent } from '../types/event.js';
import { logger } from '../utils/logger.js';

const submissionService = new SubmissionService();
const settingsService = new GuildSettingsService();

export const createSubmissionEmbed = (
  result: Exclude<SubmissionResult, { outcome: 'IGNORED' }>,
): EmbedBuilder => {
  if (result.outcome === 'PENDING') {
    return new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('✅ Submission received. Status: Pending Review.')
      .addFields(
        {
          name: "Today's Submissions",
          value: `${result.todaySubmissions}/${result.dailyLimit}`,
          inline: true,
        },
        { name: 'X Username', value: result.xUsername, inline: true },
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
  if (message.author.bot) return;

  try {
    const settings = message.guildId ? settingsService.find(message.guildId) : null;
    if (!settings?.submissionChannelId || settings.submissionChannelId !== message.channelId) {
      return;
    }

    logger.info(`Submission-channel message received: ${message.id}.`);
    logger.info(`Configured channel ID: ${settings.submissionChannelId}.`);
    logger.info(`Actual channel ID: ${message.channelId}.`);
    logger.info(`Raw message content: ${message.content}.`);

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

    if (result.outcome === 'IGNORED') {
      logger.info('Submission ignored: message is not eligible for processing.');
      return;
    }
    if (result.outcome === 'PENDING') {
      logger.info(`Submission saved: ${result.submissionId}.`);
      try {
        await message.reply('✅ Submission received. Status: Pending Review.');
      } catch (error) {
        logger.error('Submission reply failed: Discord permission/API error.', error);
      }
      return;
    }
    try {
      await message.reply(result.reason);
    } catch (error) {
      logger.error('Submission reply failed: Discord permission/API error.', error);
    }
  } catch (error) {
    logger.error('Submission failed: database error.', error);
    try {
      await message.reply('❌ The submission could not be saved. Please try again.');
    } catch (replyError) {
      logger.error('Submission reply failed: Discord permission/API error.', replyError);
    }
  }
};

const event: DiscordEvent<Events.MessageCreate> = {
  name: Events.MessageCreate,
  async execute(message) {
    await handleSubmissionMessage(message);
  },
};

export default event;
