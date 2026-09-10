import { Schema, model } from 'mongoose';

export interface MuteScheduleDocument {
  guildId: string;
  userId: string;
  roleId: string;
  executeAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MuteScheduleSchema = new Schema<MuteScheduleDocument>(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    roleId: { type: String, required: true },
    executeAt: { type: Date, required: true }
  },
  { timestamps: true }
);

MuteScheduleSchema.index({ guildId: 1, userId: 1 }, { unique: true });
MuteScheduleSchema.index({ executeAt: 1 });

export const MuteScheduleModel = model<MuteScheduleDocument>('MuteSchedule', MuteScheduleSchema);
