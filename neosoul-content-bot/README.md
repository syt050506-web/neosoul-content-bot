# NeoSoul Content Bot

A scalable TypeScript foundation for a Discord content submission and points bot.
Business rules are intentionally not implemented in this initial architecture.

## Requirements

- Node.js 22 or newer
- A Discord application and bot token

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and provide the Discord token and application
   client ID.

3. Start the development process:

   ```sh
   npm run dev
   ```

Global slash commands are registered at startup. Discord may take time to make
global command changes available in every server.

## Scripts

- `npm run dev` — run the bot in watch mode
- `npm run build` — compile TypeScript into `dist/`
- `npm start` — run the compiled application
- `npm run typecheck` — check types without emitting files
- `npm run lint` — run ESLint
- `npm run format` — apply Prettier formatting

## Structure

```text
src/
  commands/   Slash command definitions and loading
  config/     Environment-backed configuration
  database/   SQLite lifecycle and schema
  events/     Discord event definitions and loading
  models/     Domain and persistence models
  services/   Business service boundaries
  types/      Shared TypeScript contracts
  utils/      Cross-cutting utilities
  index.ts    Application composition root
```

SQLite is created at `DATABASE_PATH` (default: `./data/neosoul.sqlite`) with WAL
mode and foreign-key enforcement enabled.
