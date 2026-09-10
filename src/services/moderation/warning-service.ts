import { WarningModel } from '../../database/models/moderation/Warning.js';

interface IssueWarningOptions {
  guildId: string;
  userId: string;
  moderatorId: string;
  moderatorTag: string;
  reason: string;
  caseId: number;
  expiresAt?: Date | null;
}

class WarningService {
  public async issue(options: IssueWarningOptions) {
    const doc = await WarningModel.create({
      ...options,
      createdAt: new Date(),
      expiresAt: options.expiresAt ?? null
    });
    return doc.toObject();
  }

  public async list(guildId: string, userId: string, limit = 10) {
    const now = new Date();
    return WarningModel.find({
      guildId,
      userId,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  public async clear(guildId: string, userId: string) {
    return WarningModel.deleteMany({ guildId, userId }).exec();
  }

  public async removeById(guildId: string, warningId: string) {
    return WarningModel.findOneAndDelete({ _id: warningId, guildId }).exec();
  }
}

export const warningService = new WarningService();
