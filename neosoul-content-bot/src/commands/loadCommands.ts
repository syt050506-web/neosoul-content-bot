import path from 'node:path';
import { REST, Routes } from 'discord.js';
import { config } from '../config/index.js';
import type { LoadedCommands, SlashCommand } from '../types/command.js';
import { directoryFromMetaUrl, importModule, listRuntimeModules } from '../utils/moduleFiles.js';
import { logger } from '../utils/logger.js';

type CommandModule = { default: SlashCommand };

export const loadCommands = async (): Promise<LoadedCommands> => {
  const commandDirectory = directoryFromMetaUrl(import.meta.url);
  const infrastructureModules = new Set([
    'loadCommands',
    'createPlaceholderCommand',
    'moderationCommand',
  ]);
  const files = (await listRuntimeModules(commandDirectory)).filter(
    (file) => !infrastructureModules.has(path.basename(file, path.extname(file))),
  );
  const commands = new Map<string, SlashCommand>();

  for (const file of files) {
    const { default: command } = await importModule<CommandModule>(file);
    commands.set(command.data.name, command);
  }

  return {
    commands,
    definitions: [...commands.values()].map((command) => command.data.toJSON()),
  };
};

export const registerCommands = async (
  definitions: LoadedCommands['definitions'],
): Promise<void> => {
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  await rest.put(Routes.applicationCommands(config.discord.clientId), { body: definitions });
  logger.info(`Registered ${definitions.length} global slash commands.`);
};
