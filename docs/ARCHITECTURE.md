# Architecture

Bolt is a modular Discord application built around Sapphire pieces and explicitly wired services.

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

Environment variables are parsed first. MongoDB must connect before Discord login. Schedulers are restored after durable storage is ready.

On termination, Bolt stops timers and schedulers, destroys the Discord client, closes the health server and disconnects MongoDB. Shutdown is idempotent.

## Reliability rules

- MongoDB writes that create shared configuration or counters should be atomic.
- Long timers re-arm until their true execution timestamp; JavaScript timer limits must never make moderation expire early.
- External media is accepted only from trusted Discord HTTPS hosts and is streamed through a byte limit.
- Component and modal handlers re-evaluate the actor's current permissions.
