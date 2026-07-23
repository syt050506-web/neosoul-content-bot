import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder,
} from 'discord.js';

export type SlashCommandData = Pick<SlashCommandBuilder, 'name' | 'toJSON'>;

export interface SlashCommand {
  data: SlashCommandData;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export interface LoadedCommands {
  commands: Map<string, SlashCommand>;
  definitions: RESTPostAPIChatInputApplicationCommandsJSONBody[];
}
