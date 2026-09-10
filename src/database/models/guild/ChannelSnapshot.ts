import { Schema, model } from 'mongoose';

export interface ChannelSnapshotDocument {
  _id?: string;
  channelId: string;
  guildId: string;
  targetType: 'user' | 'role' | 'everyone';
  targetId: string;
  permissionState: {
    allow?: string;
    deny?: string;
  };
  createdAt: Date;
  createdBy: string;
}

const ChannelSnapshotSchema = new Schema<ChannelSnapshotDocument>(
  {
    channelId: { type: String, required: true },
    guildId: { type: String, required: true },
    targetType: { type: String, enum: ['user', 'role', 'everyone'], required: true },
    targetId: { type: String, required: true },
    permissionState: {
      allow: { type: String, required: false },
      deny: { type: String, required: false }
    },
    createdAt: { type: Date, default: Date.now, required: true },
    createdBy: { type: String, required: true }
  },
  {
    strict: true,
    minimize: false
  }
);

// Create compound index for efficient lookups
ChannelSnapshotSchema.index({ channelId: 1, targetType: 1, targetId: 1 }, { unique: true });

export const ChannelSnapshotModel = model<ChannelSnapshotDocument>('ChannelSnapshot', ChannelSnapshotSchema);
