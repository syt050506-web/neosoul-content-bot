import 'dotenv/config';
import path from 'node:path';

const requireEnvironmentVariable = (name: string): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

export const config = Object.freeze({
  discord: {
    token: requireEnvironmentVariable('DISCORD_TOKEN'),
    clientId: requireEnvironmentVariable('DISCORD_CLIENT_ID'),
  },
  database: {
    path:
      process.env.DATABASE_PATH === ':memory:'
        ? ':memory:'
        : path.resolve(process.env.DATABASE_PATH ?? './data/neosoul.sqlite'),
  },
  environment: process.env.NODE_ENV ?? 'development',
});
