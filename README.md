<div align="center">
  <img src="https://cdn.discordapp.com/banners/1545068462118805534/10b74420e24a21949872914b6afd23a6.png?size=2048" alt="Bolt Discord profile banner" width="920" />

  <br />
  <br />

  <img src="https://cdn.discordapp.com/avatars/1545068462118805534/b6e4af15c01e7bf475e1b80a982e4da8.png?size=1024" alt="Bolt profile picture" width="132" />

  <h1>Bolt-OS</h1>

  <p>Discord moderation bot in TypeScript. Permission checks at execution time, MongoDB-backed state, strict defaults.</p>

  <p>
    <a href="https://github.com/gogeta1232/Bolt-OS/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/gogeta1232/Bolt-OS/actions/workflows/ci.yml/badge.svg" /></a>
    <img alt="Node 20.19+" src="https://img.shields.io/badge/Node.js-20.19%2B-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white" />
    <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" />
    <img alt="Sapphire Framework" src="https://img.shields.io/badge/Sapphire-powered-5865F2?style=flat-square" />
    <img alt="Elastic License 2.0" src="https://img.shields.io/badge/license-ELv2-F7C948?style=flat-square" />
  </p>
</div>

Bolt-OS is the public copy of Bolt: moderation, cases, logging, AFK tools and server utilities in one TypeScript codebase. It runs on Sapphire and discord.js, with MongoDB as the source of truth.

> [!IMPORTANT]
> Bolt-OS is distributed under the Elastic License 2.0. You can read, modify and self-host it under those terms, but ELv2 is source-available rather than OSI open source, and it restricts offering the software as a hosted or managed service. See [LICENSE.md](LICENSE.md).

## What it covers

- Moderation: ban, unban, softban, kick, timeout, mute, warn, jail, purge, slowmode, nick, role and voice controls. Permissions and role hierarchy are rechecked when the action runs, not when the menu was opened.
- Cases and warnings: indexed lookups, per-guild configuration, confirmation flows for destructive actions.
- Logging: member, message, channel, role and moderation events with compact embeds.
- Utilities: afk, snipe and editsnipe, userinfo and serverinfo, avatar and banner lookups, help, ping and counters.
- Admin setup: prefix, admin role, greet and welcome channels, jail role and channel, autoresponder, all through atomic guild config writes.

## Requirements

- Node.js 20.19 or newer
- A MongoDB deployment (Atlas or self-hosted)
- A Discord application with a bot token, and the gateway intents your deployment uses enabled in the Developer Portal

## Quick start

```bash
git clone https://github.com/gogeta1232/Bolt-OS.git
cd Bolt-OS
npm ci
cp .env.example .env
npm run dev
```

Fill in `.env` with development credentials only. The file is ignored by git, so it never leaves your machine. `.env.example` lists every variable the bot reads.

For production:

```bash
npm run validate
npm run db:indexes
npm run build
npm start
```

Use `npm run start:cluster` for a built clustered deployment. Sharding notes are in [docs/SHARDING.md](docs/SHARDING.md).

## Scripts

| Command              | Purpose                                       |
| -------------------- | --------------------------------------------- |
| `npm run dev`        | Start one bot process with file watching      |
| `npm run check`      | Run strict TypeScript checks                  |
| `npm run lint`       | Check code quality and unsafe patterns        |
| `npm test`           | Run the unit suite once                       |
| `npm run build`      | Produce `dist/`                               |
| `npm run validate`   | Run the full pre-merge quality gate           |
| `npm run db:indexes` | Synchronize MongoDB indexes during deployment |

## Project map

```text
src/
├── commands/              Discord commands grouped by capability
├── interaction-handlers/  Buttons, select menus, modals and autocomplete
├── listeners/             Sapphire/Discord event pieces
├── services/              Stateful application and infrastructure services
├── database/models/       Mongoose schemas and indexes
├── lib/                   Shared, mostly stateless building blocks
├── setup/                 Dependency wiring and startup
└── scripts/               Explicit operational jobs
```

Design notes live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATABASE.md](docs/DATABASE.md) and [docs/TESTING.md](docs/TESTING.md). Agent and contributor rules are in [AGENTS.md](AGENTS.md).

## Security

Do not open a public issue for an unpatched vulnerability. Follow [SECURITY.md](SECURITY.md). Config is validated before the bot connects, remote media downloads are limited to trusted Discord HTTPS hosts with size limits, and the health endpoint exposes no secrets.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Keep changes focused, add tests for behavior you changed, and run `npm run validate` before opening a pull request.

## License

Licensed under the [Elastic License 2.0](LICENSE.md). Check the hosted-service restriction before running it as a public commercial service.
