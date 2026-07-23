import type { Client, ClientEvents } from 'discord.js';

export interface DiscordEvent<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute(...args: ClientEvents[K]): Promise<void> | void;
}

export type EventModule = {
  default: DiscordEvent;
};

export type DiscordClient = Client<true>;
