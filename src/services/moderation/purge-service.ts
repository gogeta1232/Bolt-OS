import { mapConcurrent } from '../../lib/map-concurrent.js';

const BULK_LIMIT = 100;
const DELETE_CONCURRENCY = 5;

interface DeletableMessage {
  delete(): Promise<unknown>;
}

/** Preserve bulk deletion; bound old-message and fallback requests across the operation. */
export async function deletePurgeMessages<T extends DeletableMessage>(
  recent: readonly T[],
  old: readonly T[],
  bulkDelete: (chunk: T[]) => Promise<number>
): Promise<number> {
  let deleted = 0;
  const fallback: T[] = [...old];
  // Bulk requests use one channel route; submitting every chunk at once only
  // grows the REST queue. Complete them before starting individual fallbacks.
  for (let offset = 0; offset < recent.length; offset += BULK_LIMIT) {
    const chunk = recent.slice(offset, offset + BULK_LIMIT);
    try {
      deleted += await bulkDelete(chunk);
    } catch {
      fallback.push(...chunk);
    }
  }
  await mapConcurrent(fallback, DELETE_CONCURRENCY, async (message) => {
    try {
      await message.delete();
      deleted++;
    } catch {
      // Missing messages and permission failures do not count as deletions.
    }
  });
  return deleted;
}
