import { Client, GatewayIntentBits } from 'discord.js';
import { loadCommands, registerCommands } from './commands/loadCommands.js';
import { config } from './config/index.js';
import { closeDatabase, initializeDatabase } from './database/index.js';
import { createInteractionCreateEvent } from './events/interactionCreate.js';
import { loadEvents } from './events/loadEvents.js';
import { logger } from './utils/logger.js';

const start = async (): Promise<void> => {
  initializeDatabase();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  const loadedCommands = await loadCommands();

  await loadEvents(client);
  const interactionEvent = createInteractionCreateEvent(loadedCommands.commands);
  client.on(interactionEvent.name, (...args) => {
    void interactionEvent.execute(...args);
  });

  await registerCommands(loadedCommands.definitions);
  await client.login(config.discord.token);

  const shutdown = (): void => {
    logger.info('Shutting down.');
    void client.destroy();
    closeDatabase();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

start().catch((error: unknown) => {
  logger.error('Bot failed to start.', error);
  closeDatabase();
  process.exitCode = 1;
});
