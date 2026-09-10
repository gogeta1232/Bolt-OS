import { model, Schema } from 'mongoose';

export interface CaseCounterDocument {
  guildId: string;
  seq: number;
}

const CaseCounterSchema = new Schema<CaseCounterDocument>({
  guildId: { type: String, required: true, unique: true },
  seq: { type: Number, required: true, default: 0, min: 0 }
});

export const CaseCounterModel = model<CaseCounterDocument>('CaseCounter', CaseCounterSchema);
