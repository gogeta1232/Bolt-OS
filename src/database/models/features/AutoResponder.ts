import { Schema, model } from 'mongoose';

export interface AutoResponderDocument {
  guildId: string;
  trigger: string;
  response: string;
  caseSensitive: boolean;
  useEmbed: boolean;
  createdBy: string;
  createdAt: Date;
}

const AutoResponderSchema = new Schema<AutoResponderDocument>({
  guildId: { type: String, required: true },
  trigger: { type: String, required: true, maxlength: 200 },
  response: { type: String, required: true, maxlength: 2_000 },
  caseSensitive: { type: Boolean, default: false },
  useEmbed: { type: Boolean, default: false },
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: () => new Date() }
});

AutoResponderSchema.index({ guildId: 1, trigger: 1 }, { unique: true });

export const AutoResponderModel = model<AutoResponderDocument>('AutoResponder', AutoResponderSchema, 'auto_responders');
