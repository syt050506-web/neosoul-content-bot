import {
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { WalletBindingService } from '../services/WalletBindingService.js';
import type { SlashCommand } from '../types/command.js';
import { requireAdministrator } from './moderationCommand.js';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('export-wallets')
    .setDescription("Export this server's submitted wallets as a private CSV attachment.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),
  async execute(interaction) {
    const guildId = await requireAdministrator(interaction);
    if (!guildId) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { csv, count } = new WalletBindingService().exportCsv(guildId);
    if (count === 0) {
      await interaction.editReply({
        content: 'No wallet bindings have been collected in this server.',
      });
      return;
    }
    if (csv.length > interaction.attachmentSizeLimit) {
      await interaction.editReply({
        content:
          "The CSV exceeds Discord's attachment limit. The records are retained in SQLite; contact the bot operator for an offline export.",
      });
      return;
    }

    const attachment = new AttachmentBuilder(csv, {
      name: `wallet-bindings-${guildId}-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    await interaction.editReply({
      content: `${count} wallet binding(s) exported. Names are snapshots from submission; Discord User ID is the stable identity. Import the ID column as text to preserve all digits. Wallet ownership is not verified.`,
      files: [attachment],
      allowedMentions: { parse: [] },
    });
  },
};

export default command;
