import { Events } from 'discord.js';
import type { DiscordEvent } from '../types/event.js';
import { logger } from '../utils/logger.js';
import { handleSubmissionMessage } from './messageCreate.js';

const event: DiscordEvent<Events.MessageUpdate> = {
  name: Events.MessageUpdate,
  async execute(_oldMessage, updatedMessage) {
    try {
      const message = updatedMessage.partial ? await updatedMessage.fetch() : updatedMessage;
      await handleSubmissionMessage(message);
    } catch (error) {
      logger.error('Failed to process an updated X submission.', error);
    }
  },
};

export default event;
