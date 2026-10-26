import { Schema, model } from 'mongoose';

export interface GreetDeletionDocument {
  guildId: string;
  channelId: string;
  messageId: string;
  deleteAt: Date;
  nextAttemptAt: Date;
}

const GreetDeletionSchema = new Schema<GreetDeletionDocument>({
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  messageId: { type: String, required: true, unique: true },
  deleteAt: { type: Date, required: true },
  nextAttemptAt: { type: Date, required: true }
});

// Each process queries only its gateway guilds, ordered by the next deletion attempt.
GreetDeletionSchema.index({ guildId: 1, nextAttemptAt: 1 });

export const GreetDeletionModel = model<GreetDeletionDocument>('GreetDeletion', GreetDeletionSchema);
