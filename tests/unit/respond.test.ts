import {
  ChatInputCommandInteraction,
  Client,
  ContainerBuilder,
  MessageFlags,
  Message,
  InteractionResponse
} from 'discord.js';
import { describe, expect, test, vi } from 'vitest';

import { replyOrEdit, replyToast } from '../../src/lib/respond.js';

const interaction = (): ChatInputCommandInteraction =>
  new ChatInputCommandInteraction(new Client({ intents: [] }), {
    id: '123456789012345678',
    application_id: '123456789012345678',
    type: 2,
    token: 'unused-test-token',
    version: 1,
    entitlements: [],
    authorizing_integration_owners: {},
    attachment_size_limit: 8000000,
    user: { id: '123456789012345678', username: 'test', discriminator: '0', avatar: null },
    data: { id: '123456789012345678', name: 'test', type: 1 }
  });

describe('command acknowledgement completion', () => {
  test.each(['reply', 'editReply', 'followUp'] as const)(
    'keeps %s command responses silent even with an unsafe payload override',
    async (method) => {
      const source = interaction();
      source.deferred = method === 'editReply';
      source.replied = method === 'followUp';
      const reply = vi.spyOn(source, 'reply').mockResolvedValue(new InteractionResponse(source));
      const edit = vi.spyOn(source, 'editReply').mockResolvedValue(new Message(source.client, { id: source.id }));
      const follow = vi.spyOn(source, 'followUp').mockResolvedValue(new Message(source.client, { id: source.id }));
      const text = '<@&123456789012345678> @everyone';
      await replyOrEdit(source, {
        content: text,
        allowedMentions: { parse: ['roles', 'everyone'], repliedUser: true }
      });
      const calls =
        method === 'reply' ? reply.mock.calls : method === 'editReply' ? edit.mock.calls : follow.mock.calls;
      expect(calls[0]?.[0]).toMatchObject({
        content: text,
        allowedMentions: { parse: [], users: [], roles: [], repliedUser: false }
      });
    }
  );
  test('edits a deferred toast rather than leaving a loading reply and posting a follow-up', async () => {
    const source = interaction();
    source.deferred = true;
    source.ephemeral = true;
    const edit = vi.spyOn(source, 'editReply').mockResolvedValueOnce(new Message(source.client, { id: source.id }));
    const follow = vi.spyOn(source, 'followUp');
    await replyToast(source, 'success', 'Saved');
    expect(edit).toHaveBeenCalledOnce();
    expect(edit.mock.calls[0]?.[0]).toMatchObject({ flags: [], allowedMentions: { parse: [] } });
    expect(follow).not.toHaveBeenCalled();
  });

  test('preserves V2 when editing and removes ephemeral from editable flags', async () => {
    const source = interaction();
    source.deferred = true;
    source.ephemeral = true;
    const edit = vi.spyOn(source, 'editReply').mockResolvedValueOnce(new Message(source.client, { id: source.id }));
    await replyOrEdit(source, {
      components: [new ContainerBuilder()],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
    expect(edit.mock.calls[0]?.[0]).toMatchObject({ flags: [MessageFlags.IsComponentsV2] });
  });

  test('replies normally before acknowledgement and follows up after a completed response', async () => {
    const source = interaction();
    const reply = vi.spyOn(source, 'reply').mockResolvedValueOnce(new InteractionResponse(source));
    await replyToast(source, 'warning', 'No access');
    expect(reply).toHaveBeenCalledOnce();
    source.replied = true;
    const follow = vi.spyOn(source, 'followUp').mockResolvedValueOnce(new Message(source.client, { id: source.id }));
    await replyToast(source, 'info', 'Additional information');
    expect(follow).toHaveBeenCalledOnce();
  });

  test('keeps a private error private after a public defer and removes the loading response', async () => {
    const source = interaction();
    source.deferred = true;
    source.ephemeral = false;
    const edit = vi.spyOn(source, 'editReply');
    const follow = vi.spyOn(source, 'followUp').mockResolvedValue(new Message(source.client, { id: source.id }));
    const remove = vi.spyOn(source, 'deleteReply').mockResolvedValue(undefined);
    await replyToast(source, 'warning', 'No cases found');
    expect(follow.mock.calls[0]?.[0]).toMatchObject({ flags: MessageFlags.Ephemeral });
    expect(remove).toHaveBeenCalledOnce();
    expect(edit).not.toHaveBeenCalled();
  });
});
