import { Schema, model } from 'mongoose';

export interface WarningDocument {
  guildId: string;
  userId: string;
  moderatorId: string;
  moderatorTag: string;
  reason: string;
  createdAt: Date;
  expiresAt: Date | null;
  caseId: number;
}

const WarningSchema = new Schema<WarningDocument>({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  moderatorId: { type: String, required: true },
  moderatorTag: { type: String, required: true },
  reason: { type: String, required: true, maxlength: 1_000 },
  createdAt: { type: Date, default: () => new Date() },
  expiresAt: { type: Date, default: null },
  caseId: { type: Number, required: true }
});

WarningSchema.index({ guildId: 1, userId: 1, createdAt: -1 });
WarningSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } }
);

export const WarningModel = model<WarningDocument>('Warning', WarningSchema);
