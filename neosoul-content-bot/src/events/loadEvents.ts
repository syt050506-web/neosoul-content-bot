import path from 'node:path';
import type { Client } from 'discord.js';
import type { EventModule } from '../types/event.js';
import { directoryFromMetaUrl, importModule, listRuntimeModules } from '../utils/moduleFiles.js';
import { logger } from '../utils/logger.js';

export const loadEvents = async (client: Client): Promise<void> => {
  const eventDirectory = directoryFromMetaUrl(import.meta.url);
  const infrastructureModules = new Set(['loadEvents', 'interactionCreate']);
  const files = (await listRuntimeModules(eventDirectory)).filter(
    (file) => !infrastructureModules.has(path.basename(file, path.extname(file))),
  );

  for (const file of files) {
    const { default: event } = await importModule<EventModule>(file);
    const execute = event.execute.bind(event);
    const listener = (...args: unknown[]): void => {
      void Reflect.apply(execute, event, args);
    };

    if (event.once) {
      client.once(event.name, listener);
    } else {
      client.on(event.name, listener);
    }
    logger.info(`Registered Discord event listener: ${String(event.name)}.`);
  }
};
