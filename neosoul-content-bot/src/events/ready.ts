import { Events } from 'discord.js';
import type { DiscordEvent } from '../types/event.js';
import { logger } from '../utils/logger.js';

const event: DiscordEvent<Events.ClientReady> = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    logger.info(`Discord client ready as ${client.user.tag}.`);
  },
};

export default event;
