# Architecture

Bolt is a modular Discord application built around [Sapphire Framework](https://github.com/sapphiredev/framework) pieces and explicitly wired services.

```text
Discord events and interactions
            │
            ▼
 commands / listeners / interaction handlers
            │
            ▼
     domain services in the container
            │
            ▼
     MongoDB (durable)
```

## Boundaries

- **Pieces** translate Discord input into validated application calls. They should stay thin.
- **Services** own reusable business behavior, caching and lifecycle cleanup.
- **Models** define persistence constraints and query indexes. MongoDB remains the source of truth.
- **Libraries** contain stateless formatting, permission, parsing and safety helpers.
- **Setup** constructs shared services before logging in to Discord, avoiding partially initialized behavior.

## Startup and shutdown

The bot, cluster manager and explicit index job share Node's native loader for the optional working-directory `.env` file. Host environment variables take priority. Loading runs before environment validation. MongoDB must connect before Discord login. Schedulers are restored after durable storage is ready.

On termination, Bolt stops timers and schedulers, destroys the Discord client, closes the health server and disconnects MongoDB. Shutdown is idempotent.

Automatic greetings delegate to `GreetingService`. It stores message IDs and deletion deadlines in `GreetDeletion`, starts after Discord is ready, and processes bounded batches for the process's gateway guilds. Atomic leases prevent workers from claiming the same deletion at once; failed attempts remain retryable. One disposable timer checks real deadlines, including durations longer than JavaScript's timer limit. Shutdown waits for the active deletion batch before disconnecting.

Application commands use Sapphire's bulk registration so removed commands disappear on the next successful registration. Production builds clean `dist` first to prevent deleted pieces from being loaded from stale output.

## Reliability rules

- MongoDB writes that create shared configuration or counters should be atomic.
- Long timers re-arm until their true execution timestamp; JavaScript timer limits must never make moderation expire early.
- External media is accepted only from trusted Discord HTTPS hosts and is streamed through a byte limit.
- Component and modal handlers re-evaluate the actor's current permissions.

## Log presentation

Bot accounts are excluded from global and server avatar, username, display-name and nickname change logs. Their other events, including role and banner changes, remain eligible for logging.

Nickname logs compare the gateway's old and new nickname values; partial old members are skipped rather than inventing a previous value. Username and global display-name changes are owned by the user-update listener. Name logs label sets, changes and resets, preserve full Unicode names and show the visible fallback after a reset. Nickname command logs capture the previous nickname before the Discord edit mutates the member.

Command messages retain rendered user and role labels while disabling user, role, everyone and reply pings. The client default, Components V2 payload builder and response helpers share `NO_MENTIONS`; intentional greeting notifications remain explicitly scoped to the greeted user.

Staff logs use the shared Components V2 formatter in `src/config/logging.ts`. Every category has a single subtext header; event content, details, message links and IDs remain separate. Reaction and voice producers pass a typed `LogContext.activity` so the header can select the specific action label and emoji without parsing message text. Reaction emojis appear inline without a duplicate thumbnail. Voice leave durations share the footer with the member ID.

Message edit and deletion logs exclude Bolt's own messages, including its log cards, to prevent feedback loops. Messages from members and other bots remain eligible, even in log channels. Edit comparison ignores Discord-assigned component IDs, internal custom IDs, media proxy URLs, dimensions and loading metadata. Member link-preview updates without an actual edit are ignored. Attachment and sticker replacements are compared by identity, not just counts. Unknown previous message bodies and deletions with no captured content are skipped; existing Discord audit entries remain separate.

The logging service suppresses repeated deliveries of the same message state for one minute, including concurrent duplicates, while permitting real reversals and later edits. This cache holds at most 2,000 digests, expires lazily, and is cleared on guild removal and shutdown. Failed sends release their duplicate reservation so a later delivery can retry. Before/after previews are bounded; longer message evidence is attached as readable text rather than raw component JSON. This is process-local suppression, not a durable or cross-process exactly-once guarantee.

## Command performance

Prefix commands retain Sapphire's parsing, command store and precondition lifecycle. Warm prefix detection reads synchronously from the configuration service's bounded cache. Successful utility arguments resolve once through `Args.pickResult`, and member name search defers fuzzy-index construction until simpler matching fails. Configuration write/removal invalidation prevents older pending reads from restoring stale cache entries.

Overlapping guild statistics and user profile requests share their pending operation without keeping a separate stale result cache. Autoresponder queries share pending reads within their existing bounded cache; writes, guild removal and shutdown invalidate read ownership. Purge uses ordered bulk requests and five lazy workers for individual deletion, including failed-bulk fallbacks. Slow command paths defer their initial response and complete it through the shared reply helpers. Command logs include Sapphire's handler `durationMs`. See [command performance](PERFORMANCE.md) for the command map, controlled measurements and production measurement limits.
