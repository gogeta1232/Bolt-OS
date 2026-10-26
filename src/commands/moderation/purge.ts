import { ApplyOptions } from '@sapphire/decorators';
import { Args, Command, RegisterBehavior } from '@sapphire/framework';
import { Collection, Message, MessageFlags } from 'discord.js';
import type {
  ChatInputCommandInteraction,
  GuildTextBasedChannel,
  Message as DjsMessage,
  TextBasedChannel,
  User
} from 'discord.js';

import { createEmbed } from '../../config/theme.js';
import { getEmoji } from '../../config/emojis.js';
import { buildModerationContext } from '../../config/logging.js';
import { replyToast } from '../../lib/respond.js';
import { deletePurgeMessages } from '../../services/moderation/purge-service.js';

const BULK_LIMIT = 100;
const MAX_MESSAGE_AGE_MS = 1_209_600_000; // 14 days
const DEFAULT_SCOPE_AMOUNT = 10; // Default when no amount specified for scope commands

type PurgeScope =
  | { type: 'all' }
  | { type: 'bots' }
  | { type: 'users' }
  | {
      type: 'user';
      userId: string;
      tag?: string;
      filter?: { type: 'bots' | 'users' };
    };

@ApplyOptions<Command.Options>({
  name: 'purge',
  aliases: ['clean', 'clear'],
  description: 'Remove recent messages quickly.',
  runIn: ['GUILD_ANY'],
  requiredClientPermissions: ['ManageMessages', 'ReadMessageHistory', 'SendMessages'],
  requiredUserPermissions: ['ManageMessages'],
  fullCategory: ['moderation']
})
export class PurgeCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      (builder) =>
        builder
          .setName(this.name)
          .setDescription(this.description)
          .addIntegerOption((option) =>
            option
              .setName('amount')
              .setDescription('How many messages to remove (processed in batches of 100)')
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(1000)
          )
          .addUserOption((option) => option.setName('user').setDescription('Only delete messages from this user'))
          .addStringOption((option) =>
            option
              .setName('scope')
              .setDescription('Limit deletion to bot or user messages')
              .addChoices(
                { name: 'Bots only', value: 'bots' },
                { name: 'Users only', value: 'users' },
                { name: 'Both', value: 'both' }
              )
          ),
      { behaviorWhenNotIdentical: RegisterBehavior.Overwrite }
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const amount = interaction.options.getInteger('amount');
    const user = interaction.options.getUser('user');
    const scopeOption = interaction.options.getString('scope');
    const channel = interaction.channel;

    if (!channel || !this.isGuildTextChannel(channel)) {
      await replyToast(interaction, 'warning', 'This command only works in text channels.');
      return;
    }

    // If user is specified, always prioritize user scope regardless of scopeOption
    let finalAmount = amount ?? DEFAULT_SCOPE_AMOUNT;
    let finalScope: PurgeScope;

    if (user) {
      // User mention takes priority - combine with scope if provided
      if (scopeOption === 'bots') {
        finalScope = {
          type: 'user',
          userId: user.id,
          tag: user.tag,
          filter: { type: 'bots' }
        };
      } else if (scopeOption === 'users') {
        finalScope = {
          type: 'user',
          userId: user.id,
          tag: user.tag,
          filter: { type: 'users' }
        };
      } else {
        finalScope = { type: 'user', userId: user.id, tag: user.tag };
      }

      if (!amount) {
        finalAmount = 50; // Default higher amount when targeting specific user
      }
    } else if (scopeOption) {
      // No user specified, use scope-only logic
      finalScope = this.resolveScopeFromInteraction(null, scopeOption);
    } else {
      // No user or scope specified - default to all
      finalScope = { type: 'all' };
    }

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const deleted = await this.purge(channel, finalAmount, finalScope, interaction.user, undefined);

      await interaction.editReply({
        embeds: [this.buildSummaryEmbed(deleted, channel)]
      });
    } catch (error) {
      console.error('Error during slash command purge operation:', error);
      await replyToast(
        interaction,
        'warning',
        'Purge operation encountered an error. Some messages may have been deleted.'
      );
    }
  }

  public override async messageRun(message: Message, _args: Args) {
    void _args;
    const channel = message.channel;
    if (!channel || !this.isGuildTextChannel(channel)) return;

    const parsed = this.parseMessageArguments(message);
    if ('error' in parsed) {
      await replyToast(message, 'warning', parsed.error);
      return;
    }

    const { amount, scope } = parsed;

    // Delete the command message immediately for cleanup
    await message.delete().catch(() => undefined);

    try {
      // Purge the requested amount of messages from the channel
      // The command message is deleted separately, not counted in the amount
      const deleted = await this.purge(
        channel,
        amount,
        scope,
        message.author,
        message.id // Start deleting after the command message
      );

      const summary = await channel.send({
        embeds: [this.buildSummaryEmbed(deleted, channel)]
      });
      setTimeout(() => {
        void summary.delete().catch(() => undefined);
      }, 7_000).unref?.();
    } catch (error) {
      // Even if purge fails partway through, try to send a summary of what was deleted
      console.error('Error during purge operation:', error);
      try {
        // Send a failure message indicating the operation didn't complete as expected
        const errorSummary = await channel.send({
          embeds: [
            createEmbed({
              description: `Purge operation encountered an error. Some messages may have been deleted.`,
              type: 'warning'
            })
          ]
        });
        setTimeout(() => {
          void errorSummary.delete().catch(() => undefined);
        }, 7_000).unref?.();
      } catch (summaryError) {
        console.error('Failed to send error summary:', summaryError);
      }
    }
  }

  private async purge(
    channel: GuildTextBasedChannel,
    amount: number,
    scope: PurgeScope,
    actor: User,
    beforeId?: string
  ) {
    let totalMatched = 0; // Count only messages that match the scope
    let humanCount = 0;
    let botCount = 0;
    let before = beforeId;

    const recentMessages: DjsMessage[] = []; // ≤14 days (bulk deletable)
    const oldMessages: DjsMessage[] = []; // >14 days (individual delete)

    // Match the requested scope while scanning each history page.
    const matchFunction = this.createOptimizedMatcher(scope);

    const processBatch = (messages: Collection<string, DjsMessage>) => {
      before = messages.lastKey();
      for (const msg of messages.values()) {
        if (totalMatched >= amount) break;

        // Match only the requested messages.
        if (matchFunction(msg)) {
          totalMatched++;

          // Count types
          if (msg.author.bot) {
            botCount++;
          } else {
            humanCount++;
          }

          // Sort by age for optimal deletion strategy
          if (Date.now() - msg.createdTimestamp <= MAX_MESSAGE_AGE_MS) {
            recentMessages.push(msg);
          } else {
            oldMessages.push(msg);
          }
        }
      }
    };

    // Discord history is cursor-based, so every page must use the previous
    // page's final message ID. The old fake parallel loop stopped after page one.
    while (totalMatched < amount) {
      const messages = await this.fetchWithRetry(channel, before, BULK_LIMIT);
      if (messages.size === 0) break;
      processBatch(messages);
      if (!before || messages.size < BULK_LIMIT) break;
    }

    const totalDeleted = await deletePurgeMessages(recentMessages, oldMessages, async (chunk) => {
      const deleted = await channel.bulkDelete(chunk, true);
      return deleted.size;
    });

    const guild = channel.guild;
    const scopeFragment = this.getScopeLogFragment(scope);
    const summaryText = scopeFragment
      ? `${getEmoji('deletion')} Purged ${totalDeleted} message(s) ${scopeFragment} in ${channel.toString()}.`
      : `${getEmoji('deletion')} Purged ${totalDeleted} message(s) in ${channel.toString()}.`;

    // WHY no reason: the summary sentence already says it — a Reason line would just echo.
    const moderationContext = buildModerationContext({
      actor,
      target: null,
      caseId: null,
      channel,
      reason: null,
      duration: null
    });

    // WHY minimal metadata: scope is already in the sentence; Deleted/Processed/
    // Recent all equal the total. Only old messages (single-delete fallback) add info.
    moderationContext.metadata = {
      ...(oldMessages.length > 0 ? { Old: oldMessages.length } : {})
    };

    // Log asynchronously for speed (use administrative log for purge actions)
    void this.container.logging.sendAdministrativeLog(guild, summaryText, moderationContext);

    return this.buildResult(totalDeleted, humanCount, botCount);
  }

  // Keep scope matching consistent between prefix and slash commands.
  private createOptimizedMatcher(scope: PurgeScope) {
    switch (scope.type) {
      case 'user': {
        const userId = scope.userId;
        const filter = scope.filter;
        if (filter) {
          if (filter.type === 'bots') {
            return (msg: DjsMessage) => msg.author.id === userId && msg.author.bot;
          } else {
            return (msg: DjsMessage) => msg.author.id === userId && !msg.author.bot;
          }
        }
        return (msg: DjsMessage) => msg.author.id === userId;
      }
      case 'bots':
        return (msg: DjsMessage) => msg.author.bot;
      case 'users':
        return (msg: DjsMessage) => !msg.author.bot;
      default:
        return () => true;
    }
  }

  // A failed page fetch stops the scan.
  private async fetchWithRetry(
    channel: GuildTextBasedChannel,
    before: string | undefined,
    limit: number
  ): Promise<Collection<string, DjsMessage>> {
    try {
      return await channel.messages.fetch({ limit, before });
    } catch (error) {
      console.error('Failed to fetch messages:', error);
      return new Collection();
    }
  }

  private buildResult(total: number, humans: number, bots: number) {
    return { total, humans, bots };
  }

  private buildSummaryEmbed(deleted: { total: number; humans: number; bots: number }, channel: GuildTextBasedChannel) {
    const lines = [
      `### ${getEmoji('deletion')} Purged Messages`,
      `> **Total Deleted:** ${deleted.total}`,
      `> **Users:** ${deleted.humans}`,
      `> **Bots:** ${deleted.bots}`,
      `> **Channel:** ${channel.toString()}`
    ];
    return createEmbed({
      description: lines.join('\n'),
      type: 'primary',
      styled: false
    });
  }

  private resolveScopeFromInteraction(user: User | null, scopeOption: string | null): PurgeScope {
    if (user) {
      return { type: 'user', userId: user.id, tag: user.tag };
    }

    if (!scopeOption) return { type: 'all' };

    if (scopeOption === 'bots') return { type: 'bots' };
    if (scopeOption === 'users') return { type: 'users' };

    return { type: 'all' };
  }

  private parseMessageArguments(message: Message): { amount: number; scope: PurgeScope } | { error: string } {
    const tokens = message.content.trim().split(/\s+/).slice(1);

    if (tokens.length === 0) {
      return { error: 'Usage: `!purge <amount> [@user|bots|users]`.' };
    }

    const mentionedUser = message.mentions.users.first() ?? null;
    let amount: number | null = null;
    let scopeToken: 'bots' | 'users' | null = null;

    for (const raw of tokens) {
      // Check for amount first
      if (amount === null) {
        const num = parseInt(raw);
        if (!isNaN(num) && num > 0) {
          amount = num;
          continue;
        }
      }

      // Check for scope token
      if (!scopeToken) {
        const match = this.matchScopeToken(raw);
        if (match) scopeToken = match;
      }
    }

    // Handle user mention with amount
    if (mentionedUser && amount !== null) {
      return {
        amount,
        scope: {
          type: 'user',
          userId: mentionedUser.id,
          tag: mentionedUser.tag
        }
      };
    }

    // Handle user mention without amount
    if (mentionedUser) {
      return {
        amount: 50, // Default when targeting specific user
        scope: {
          type: 'user',
          userId: mentionedUser.id,
          tag: mentionedUser.tag
        }
      };
    }

    // No amount specified - use defaults based on scope
    if (amount === null || amount <= 0) {
      if (scopeToken === 'bots') {
        return { amount: DEFAULT_SCOPE_AMOUNT, scope: { type: 'bots' } };
      }
      if (scopeToken === 'users') {
        return { amount: DEFAULT_SCOPE_AMOUNT, scope: { type: 'users' } };
      }
      return {
        error: 'Please provide how many messages to remove (e.g. `!purge 100` or `!purge bots`).'
      };
    }

    if (scopeToken === 'bots') {
      return { amount, scope: { type: 'bots' } };
    }

    if (scopeToken === 'users') {
      return { amount, scope: { type: 'users' } };
    }

    return { amount, scope: { type: 'all' } };
  }

  private matchScopeToken(token: string): 'bots' | 'users' | null {
    const lower = token.toLowerCase();
    switch (lower) {
      case 'bot':
      case 'bots':
        return 'bots';
      case 'user':
      case 'users':
      case 'human':
      case 'humans':
        return 'users';
      default:
        return null;
    }
  }

  private getScopeLogFragment(scope: PurgeScope) {
    switch (scope.type) {
      case 'user':
        return `from <@${scope.userId}>`;
      case 'bots':
        return 'from bots';
      case 'users':
        return 'from users';
      default:
        return '';
    }
  }

  private isGuildTextChannel(channel: TextBasedChannel): channel is GuildTextBasedChannel {
    return 'bulkDelete' in channel && 'guild' in channel;
  }
}
