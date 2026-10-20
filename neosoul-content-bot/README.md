# NeoSoul Content Bot

A Discord content submission and points bot with self-service wallet collection
and administrator CSV exports.

## Requirements

- Node.js 22 or newer
- A Discord application and bot token

## Setup

1. Install dependencies:

   ```sh
   pnpm install --frozen-lockfile
   ```

2. Copy `.env.example` to `.env` and provide the Discord token and application
   client ID.

3. Start the development process:

   ```sh
   pnpm run dev
   ```

Global slash commands are registered at startup. Discord may take time to make
global command changes available in every server.

## Wallet collection

Use the existing content bot; the deactivated BSC bot is not needed. Invite the
content bot with the `bot` and `applications.commands` scopes. The existing content
submission features also require **Message Content Intent** in the Discord
Developer Portal. Wallet commands do not need the Server Members Intent or a
separate API key. Restart the bot after building to register the new commands.

- `/bind-wallet address:<address>` — submit a BSC/EVM wallet using your own
  authenticated Discord account. Only the invoking user's ID and Discord-provided
  names are recorded; there is no option to submit on another user's behalf.
- `/my-wallet` — privately check your binding in the server where you submitted it.
- `/export-wallets` — server administrators receive a private CSV attachment with
  all bindings collected in that server. Runtime authorization is checked even
  when Discord command permissions have been customized.

Addresses must contain `0x` and 40 hexadecimal characters. The zero address is
rejected. Addresses are stored in lowercase so differently cased versions cannot
be claimed twice. This validates address format; it does **not** verify checksum,
wallet ownership, balances, or whether the wallet is an externally owned account.
No wallet signature is required.

The first successful submission is locked. Repeating the same address is safe and
keeps the original record. Changing the wallet or claiming another account's
wallet is rejected. Double-check the address before submitting. There is no
self-service unbind or administrator rebind command in this version.

Uniqueness applies across all servers using this bot's SQLite database: one
Discord User ID has at most one wallet, and one wallet has at most one User ID.
The binding belongs to the server where it was first collected, and other servers
cannot view or export it. Separate bot installations with separate databases do
not share bindings. Multiple Discord accounts belonging to the same person cannot
be identified by this address collection workflow.

The CSV contains **Discord User ID**, **Discord Username (at submission)**,
**Discord Display Name (at submission)**, **Wallet Address**, and **Bound At (UTC)**.
Names are submission-time snapshots (the display name is the global Discord name,
falling back to the username). User ID is the permanent identity even after a
rename. Only users who submitted a wallet appear in the total. Import User ID as
**text** in Excel or other spreadsheet software to preserve all digits. CSV files
use UTF-8 with a BOM for Chinese names and neutralize spreadsheet formulas in
user-controlled names. Oversized exports report Discord's attachment limit and
retain all database records.

Bindings are stored in the existing `DATABASE_PATH` (default
`./data/neosoul.sqlite`); the new table is added automatically at startup without
changing existing X bindings, submissions, or points. Retain this database and its
backups across redeployments. Replies and CSV attachments are ephemeral and wallet
addresses are not added to application logs.

### Operator validation

```sh
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm test
```

The tests exercise duplicate wallets, renamed accounts, simultaneous submissions
from independent processes, restart persistence, server isolation, CSV handling,
administrator authorization, and command discovery. `DATABASE_PATH=:memory:` uses
a real in-memory database for tests.

After securely configuring `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` in the ignored
`.env`, run `pnpm start` from this directory and wait for the authenticated ready
message. In a test server, submit two different wallets from two different users,
check `/my-wallet`, verify a duplicate submission is rejected, and export with an
administrator account. A non-administrator must be denied export access. These
live Discord checks require valid credentials and are separate from automated
tests. Never share bot tokens in chat or commit `.env`.

### Deploy with Docker Compose

Run from this directory on a server with Docker and Docker Compose. Use an
always-on worker or server; this bot maintains a Discord Gateway connection and
does not expose an HTTP service. A Codex environment snapshot saves files and
configuration; it does not keep the bot process online permanently.

1. Securely create the ignored `.env` using `.env.example` and supply this bot's
   `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`. Alternatively, inject those two
   variables through your deployment platform's secure configuration.
2. Enable **Message Content Intent** for the existing content features. Invite
   the bot with the `bot` and `applications.commands` scopes to the server where
   users will submit wallets. Ensure ordinary members can use `/bind-wallet` and
   `/my-wallet`; export is restricted to administrators.
3. Build and start:

   ```sh
   docker compose up --build -d
   docker compose logs --tail=100 bot
   ```

4. Confirm `Registered ... global slash commands` and
   `Discord client ready as ...`, then perform the live checks above. Global
   commands can take time to appear. A running container alone does not establish
   that login and command registration succeeded.

The container runs as a non-root user. Tokens and local databases are excluded
from the build context. The named `wallet-data` volume retains the SQLite database
across container updates. The bot restarts after a process failure or server
reboot while the Docker service is active. Run only one replica per database.

To stop without deleting bindings, run `docker compose down`. **Do not add
`--volumes`** when updating or stopping: it deletes the wallet database.
If using a hosted worker platform, mount persistent storage at `/app/data`;
an ephemeral container filesystem would lose bindings on replacement.

On DigitalOcean, an existing Droplet with persistent disk is the recommended
target for this SQLite version. Confirm available disk space and Docker before
deploying. Keep SSH access through your existing secure authentication; do not
put SSH keys or API tokens into this repository. No incoming bot port is needed;
the server must be able to reach Discord over HTTPS and WebSocket connections.
Copy this project to the Droplet, securely configure the bot's `.env` there, and
run the Compose commands above. An API token can list existing Droplets and apps,
but does not by itself provide SSH access to the operating system.

For a consistent backup, briefly stop the bot and copy the volume's database:

```sh
mkdir -p backups
docker compose stop bot
docker compose cp bot:/app/data/neosoul.sqlite backups/neosoul.sqlite
docker compose start bot
```

Keep the backup private because it contains the submitted wallet mappings. For
unexpected crashes where the SQLite WAL files are still present, back up the
whole data directory or use SQLite's online backup API rather than copying only
the main database file.

### Update the existing DigitalOcean systemd deployment

The existing `neosoul-bot` Droplet runs this project from
`/root/neosoul-content-bot/neosoul-content-bot` as
`neosoul-content-bot.service`. Use its current service and database for this
deployment. The separate Telegram service has its own working directory.

`scripts/deploy-wallets.sh` targets this specific server layout and the verified
wallet implementation commit. Run it as root from the Droplet Console after
fetching the `codex/wallet-bindings` branch. It rejects tracked local changes,
checks the runtime version and service process cleanup, locates the database from
the service environment or local dotenv configuration, and preserves a SQLite
backup plus the old dependencies and build before updating. Untracked files and
local credential files are retained. It installs frozen dependencies, builds with
a bounded heap, runs the tests serially for the 1 GiB server, and requires new
command-registration and authenticated-ready journal messages. A failed update
restores the previous code, dependencies and build and restarts the original
service. The live database is retained during rollback so new submissions are not
discarded. Backups are private directories under
`/root/neosoul-content-bot-backup.*`.

The script is prepared for execution on the server; local syntax and non-root
guard checks do not establish a completed remote deployment. After it succeeds,
complete the live wallet and export checks in Discord.

### Retire the other bots and retain Dragon Ball

The server-specific `scripts/retire-other-bots.py` keeps
`neosoul-discord-bot.service` and `/root/NeoSoul-Discord-Bot`. It starts the retained
service and requires its authenticated Discord login before retiring Growth Bot,
Content Bot, the old EVOEVO Guardian deployment and the specified old Content Bot
backup. It operates on server deployments; repository hosting and Discord
application registrations are separate.

Fetch the cleanup branch, copy the script into a root-owned `mktemp` file, change
to `/root`, and run it using Python 3 from the DigitalOcean Console. The executing
script must remain outside the Content Bot directory because that directory is a
removal target. `--dry-run` prints the plan without changing files or services.

The script checks retained-service dependencies and database paths, refuses
overlapping paths and shared Docker volumes, preserves complete project contents
and service definitions in a root-only archive, verifies the archive, and then
removes the retired service definitions and deployment directories. Dedicated
retired containers and volumes are also backed up and removed when present.
System services such as TPM and certificate renewal are outside its selection.
An unresolved shared dependency or unmanaged bot process stops the cleanup.
Failures before deletion restore the retired services' previous running state.

The recovery directory is `/root/retired-bots-*`, containing `bots.tar.gz` and a
manifest with its SHA-256. The archive includes application configuration and
databases and is restricted to root. It is retained for recovery after the live
deployments have been removed.

Run the local deletion-protection checks with:

```sh
python3 -B scripts/test-retire-other-bots.py
```

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
