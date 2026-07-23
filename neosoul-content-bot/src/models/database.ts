export interface GuildSettings {
  guildId: string;
  submissionChannelId: string | null;
  dailySubmissionLimit: number;
  pointsPerSubmission: number;
  createdAt: string;
  updatedAt: string;
}

export interface XBinding {
  guildId: string;
  discordUserId: string;
  xUserId: string | null;
  xUsername: string;
  createdAt: string;
  updatedAt: string;
}

export interface Submission {
  id: number;
  guildId: string;
  discordUserId: string;
  messageId: string | null;
  sourceUrl: string;
  postId: string | null;
  xUsername: string | null;
  status: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
}

export interface ModerationAction {
  id: number;
  guildId: string;
  administratorId: string;
  action: string;
  submissionId: number | null;
  discordUserId: string | null;
  amount: number | null;
  reason: string | null;
  details: string | null;
  createdAt: string;
}

export interface PointLedgerEntry {
  id: number;
  guildId: string;
  discordUserId: string;
  submissionId: number | null;
  amount: number;
  reason: string;
  createdAt: string;
}
