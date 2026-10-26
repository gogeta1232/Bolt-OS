import { Client, User } from 'discord.js';
import { describe, expect, test, vi } from 'vitest';

import { fetchUserProfile } from '../../src/lib/user-profile.js';

describe('fresh profile requests', () => {
  test('shares overlapping requests but refreshes the next command', async () => {
    const user = new User(new Client({ intents: [] }), { id: '123456789012345678', username: 'test' });
    const fetch = vi.spyOn(user, 'fetch').mockResolvedValue(user);
    const results = await Promise.all(Array.from({ length: 20 }, () => fetchUserProfile(user)));
    expect(results.every((result) => result === user)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    await fetchUserProfile(user);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(true);
  });

  test('returns null on failure and allows the next request to recover', async () => {
    const user = new User(new Client({ intents: [] }), { id: '123456789012345678', username: 'test' });
    vi.spyOn(user, 'fetch').mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(user);
    expect(await fetchUserProfile(user)).toBeNull();
    expect(await fetchUserProfile(user)).toBe(user);
  });
});
