import { Events, MessageFlags, type InteractionReplyOptions } from 'discord.js';
import type { SlashCommand } from '../types/command.js';
import type { DiscordEvent } from '../types/event.js';
import { logger } from '../utils/logger.js';

export const createInteractionCreateEvent = (
  commands: ReadonlyMap<string, SlashCommand>,
): DiscordEvent<Events.InteractionCreate> => ({
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);
    if (!command) {
      logger.warn(`No handler found for /${interaction.commandName}.`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error(`Command /${interaction.commandName} failed.`, error);
      const response: InteractionReplyOptions = {
        content: 'The command could not be completed.',
        flags: MessageFlags.Ephemeral,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
  },
});
