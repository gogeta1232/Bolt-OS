import { Schema, model } from 'mongoose';

export type CaseAction =
  'ban' | 'softban' | 'kick' | 'mute' | 'timeout' | 'warn' | 'unban' | 'unmute' | 'role' | 'note' | 'jail' | 'unjail';

export interface CaseDocument {
  guildId: string;
  caseId: number;
  action: CaseAction;
  targetId: string;
  targetTag: string;
  moderatorId: string;
  moderatorTag: string;
  reason: string;
  evidence: string[];
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const CaseSchema = new Schema<CaseDocument>(
  {
    guildId: { type: String, required: true },
    caseId: { type: Number, required: true },
    action: { type: String, required: true },
    targetId: { type: String, required: true },
    targetTag: { type: String, required: true },
    moderatorId: { type: String, required: true },
    moderatorTag: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 1_000 },
    evidence: { type: [String], default: [] },
    expiresAt: { type: Date, required: false, default: null },
    metadata: { type: Schema.Types.Mixed, required: false, default: null }
  },
  {
    timestamps: true
  }
);

// Indexes for efficient querying
CaseSchema.index({ guildId: 1, caseId: -1 }, { unique: true });
CaseSchema.index({ guildId: 1, targetId: 1, caseId: -1 });
CaseSchema.index({ guildId: 1, moderatorId: 1, caseId: -1 });
CaseSchema.index({ guildId: 1, action: 1, caseId: -1 }); // Action filtering
CaseSchema.index({ guildId: 1, createdAt: -1 }); // Time-based queries
CaseSchema.index({ guildId: 1, expiresAt: 1 }); // Expiry cleanup

export const CaseModel = model<CaseDocument>('Case', CaseSchema);
