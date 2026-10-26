<p align="center">
  <img src=".github/assets/bolt_banner.png" width="920" alt="Bolt Discord moderation bot">
</p>

# Bolt

A Discord moderation bot built with TypeScript, Sapphire, discord.js and MongoDB. Bolt supports slash and prefix commands, numbered moderation cases, configurable permissions and server event logs.

[Documentation](https://boltdoc.vercel.app) · [Commands](https://boltdoc.vercel.app/commands) · [Contributing](.github/CONTRIBUTING.md) · [Security](.github/SECURITY.md)

[![CI](https://github.com/gogeta1232/Bolt-OS/actions/workflows/ci.yml/badge.svg)](https://github.com/gogeta1232/Bolt-OS/actions/workflows/ci.yml)
[![License: ELv2](https://img.shields.io/badge/license-ELv2-blue)](LICENSE.md)

## Features

- **Moderation:** warnings, timeouts, mute, kick, ban, softban, jail, purge and channel controls.
- **Cases:** numbered records with reasons, evidence and DM status.
- **Permissions:** Discord permissions, configured moderator roles and granular bot-side grants, rechecked when an action runs.
- **Logging:** audit, moderation, message, member, role, channel, emoji and voice events.
- **Server tools:** expiring greetings, autoresponders, AFK status, snipes and member/server information.

The [command reference](https://boltdoc.vercel.app/commands) covers all 42 commands, their aliases and slash options.

## Quick start

You need Node.js **20.19+**, MongoDB and your own Discord application.

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Enable **Server Members** and **Message Content** intents. Invite the bot with the `bot` and `applications.commands` scopes and the [required permissions](https://boltdoc.vercel.app/guides/invite-permissions).
3. Install and configure Bolt:

```bash
git clone https://github.com/gogeta1232/Bolt-OS.git
cd Bolt-OS
npm ci
cp .env.example .env
```

Set `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` and `MONGO_URI` in `.env`, then run:

```bash
npm run dev
```

Host environment variables take priority over the optional `.env` file. Never commit credentials.

## Configure a server

Use these commands after inviting Bolt:

```text
/setup                              Choose log channels
/setprefix !                        Set the server prefix
/fadmin @Role                       Grant a Bolt admin role (server owner only)
/givepermission add @Role ban kick   Grant specific moderation actions
/setjailrole @Role                   Choose the jail role
/setjailchannel #channel             Choose the jail channel
/setgreetchannel add channels:#chat  Enable automatic greetings
/setgreetchannel duration time:5m    Set greeting expiry
/autoresponder                      Manage automatic responses
```

See the [configuration guide](https://boltdoc.vercel.app/guides/configuration) and [permission guide](https://boltdoc.vercel.app/guides/fake-permissions) for full syntax and behavior.

## Production

```bash
npm run validate
npm run docs:check
npm audit --omit=dev --audit-level=high
# Review index changes and verify a database backup before the next command.
npm run db:indexes
npm start
```

`validate` runs formatting, type checks, lint, tests and the production build. Database indexes are applied explicitly; they are not synchronized at startup. See [operations](docs/operations.md) for deployment, health checks, scheduled actions and clustering.

## Development

```bash
npm run dev           # Watch the bot during development
npm test              # Run the unit tests
npm run test:watch    # Run tests while editing
npm run docs:export   # Refresh docs/commands.json after command changes
npm run validate      # Run the required quality gates
```

```text
.github/  CI, community guidance and README artwork
docs/     Architecture, operations and the generated command registry
src/      Commands, listeners, interaction handlers and typed services
tests/    Deterministic regression tests
```

Read [contributing](.github/CONTRIBUTING.md) for the development workflow and [architecture](docs/architecture.md) for service ownership and lifecycle rules. The website and user guides are maintained in [bolt-docs](https://github.com/gogeta1232/bolt-docs).

## Security

Report vulnerabilities privately using the [security policy](.github/SECURITY.md). Do not post credentials or an unpatched proof of concept in a public issue.

## License

Bolt is source-available under the **Elastic License 2.0**. Use and redistribution are subject to [LICENSE.md](LICENSE.md).
