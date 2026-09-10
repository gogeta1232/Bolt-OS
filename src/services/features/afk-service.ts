import { AfkProfileModel, type AfkProfileDocument } from '../../database/models/features/AfkProfile.js';
import { logger } from '../../lib/logger.js';

interface SetAfkOptions {
  guildId: string;
  userId: string;
  message: string;
  attachmentUrl?: string | null;
}

type AfkProfile = Pick<
  AfkProfileDocument,
  'guildId' | 'userId' | 'message' | 'attachmentUrl' | 'setAt' | 'lastNotifiedAt'
>;

export class AfkService {
  public async set({ guildId, userId, message, attachmentUrl }: SetAfkOptions): Promise<AfkProfile | null> {
    try {
      const setFields: Record<string, unknown> = { message, setAt: new Date() };
      const unsetFields: Record<string, string> = { lastNotifiedAt: '' };

      if (attachmentUrl !== undefined) {
        if (attachmentUrl) setFields['attachmentUrl'] = attachmentUrl;
        else unsetFields['attachmentUrl'] = '';
      }

      return await AfkProfileModel.findOneAndUpdate(
        { guildId, userId },
        { $set: setFields, $unset: unsetFields },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, runValidators: true }
      )
        .lean<AfkProfile>()
        .exec();
    } catch (error) {
      logger.error({ err: error, guildId, userId }, 'Failed to set AFK status');
      return null;
    }
  }

  public async clear(guildId: string, userId: string): Promise<boolean> {
    try {
      await AfkProfileModel.deleteOne({ guildId, userId }).exec();
      return true;
    } catch (error) {
      logger.error({ err: error, guildId, userId }, 'Failed to clear AFK status');
      return false;
    }
  }

  public async fetch(guildId: string, userId: string): Promise<AfkProfile | null> {
    try {
      return await AfkProfileModel.findOne({ guildId, userId }).lean<AfkProfile>().exec();
    } catch (error) {
      logger.error({ err: error, guildId, userId }, 'Failed to fetch AFK status');
      return null;
    }
  }

  public async fetchBatch(guildId: string, userIds: string[]): Promise<Map<string, AfkProfile>> {
    const results = new Map<string, AfkProfile>();
    const uniqueUserIds = [...new Set(userIds)];
    if (uniqueUserIds.length === 0) return results;

    try {
      const profiles = await AfkProfileModel.find({
        guildId,
        userId: { $in: uniqueUserIds }
      })
        .lean<AfkProfile[]>()
        .exec();

      for (const profile of profiles) results.set(profile.userId, profile);
    } catch (error) {
      logger.error({ err: error, guildId, userCount: uniqueUserIds.length }, 'Failed to fetch AFK statuses');
    }

    return results;
  }

  public async markNotified(guildId: string, userId: string): Promise<boolean> {
    try {
      const result = await AfkProfileModel.updateOne(
        { guildId, userId },
        { $set: { lastNotifiedAt: new Date() } }
      ).exec();
      return result.matchedCount > 0;
    } catch (error) {
      logger.error({ err: error, guildId, userId }, 'Failed to mark AFK notification');
      return false;
    }
  }
}

export const afkService = new AfkService();
