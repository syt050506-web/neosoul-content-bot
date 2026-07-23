import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { ModerationError } from '../services/ModerationService.js';

export const requireAdministrator = async (
  interaction: ChatInputCommandInteraction,
): Promise<string | null> => {
  if (
    !interaction.guildId ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  ) {
    await interaction.reply({
      content: '❌ You must be a server administrator to use this command.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  return interaction.guildId;
};

export const moderationFailure = (error: unknown): string => {
  if (error instanceof ModerationError) return `❌ ${error.message}`;
  throw error;
};
