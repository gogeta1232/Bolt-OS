import { Schema, model } from 'mongoose';

export interface AfkProfileDocument {
  guildId: string;
  userId: string;
  message: string;
  attachmentUrl?: string | null;
  setAt: Date;
  lastNotifiedAt?: Date;
}

const AfkProfileSchema = new Schema<AfkProfileDocument>(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    message: { type: String, required: true, maxlength: 200 },
    attachmentUrl: { type: String, required: false, default: null },
    setAt: { type: Date, default: () => new Date() },
    lastNotifiedAt: { type: Date, required: false }
  },
  { timestamps: false }
);

// Composite index for AFK lookups
AfkProfileSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const AfkProfileModel = model<AfkProfileDocument>('AfkProfile', AfkProfileSchema);
