import type { User } from 'discord.js';

const inFlight = new WeakMap<User, Promise<User | null>>();

/** Share overlapping profile requests without retaining stale banners or flags. */
export function fetchUserProfile(user: User): Promise<User | null> {
  const pending = inFlight.get(user);
  if (pending) return pending;
  const request = user
    .fetch(true)
    .catch(() => null)
    .finally(() => inFlight.delete(user));
  inFlight.set(user, request);
  return request;
}
