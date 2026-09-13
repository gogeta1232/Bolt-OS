<p align="center">
  <img src="assets/bolt_banner.png" width="920" alt="Bolt — stamped brass plate">
</p>

<p align="center">
  <img src="assets/bolt_pfp.webp" width="64" height="64" alt="Bolt"><br>
  <strong>Bolt</strong><br>
  TypeScript · <a href="https://github.com/sapphiredev/framework">Sapphire Framework</a> · MongoDB — moderation that rechecks at execution<br>
  <a href="#license"><img alt="ELv2" src="https://img.shields.io/badge/ELv2-f7b626?style=flat-square&labelColor=0c0c0d&color=f7b626"></a>
  <a href="#configure"><img alt="slash + prefix" src="https://img.shields.io/badge/slash%20%2B%20prefix-2a2a2a?style=flat-square&labelColor=0c0c0d&color=2a2a2a"></a><br>
  <sub>44 commands · 4 modules · per-guild config · cases with evidence</sub>
</p>

<p align="center">
  <a href="#invite"><img alt="Invite" src="https://img.shields.io/badge/Invite-%23ff482c?style=for-the-badge&labelColor=%230c0c0d&color=%23ff482c"></a>&nbsp;
  <a href="#self-host"><img alt="Self-host" src="https://img.shields.io/badge/Self--host-%23faf8f3?style=for-the-badge&labelColor=%230c0c0d&color=%23e8e8e6"></a>&nbsp;
  <a href="https://boltdoc.vercel.app"><img alt="Docs" src="https://img.shields.io/badge/Docs-boltdoc.vercel.app-ff482c?style=for-the-badge"></a>
</p>

---

### Two ways to grant power. You choose.

Bolt does not force you into one permission model. Both are checked live on every command.

| ⚫ Native — use Discord                                                                                                                                                                                                                                                                   | 🔴 Fake — Bolt only · more secure                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role has real Discord perms. Other bots see it too.<br><br>`BanMembers` for ban, `KickMembers` for kick, `ModerateMembers` for timeout, `ManageMessages` for purge, etc.<br><br><sub>Use when the role should be powerful everywhere.</sub><br><em>Owner → Administrator → real flag</em> | Role has **zero** Discord perms. Only Bolt enforces it. No stray Discord grants.<br><br>`/givepermission add @Role ban kick timeout`<br>`!gp @Role chatmod` · `!gp @Role all`<br>`src/lib/fake-permissions.ts`<br><br><sub>Use when the owner wants least privilege.</sub><br><em>Fake grant → checked as if the flag was held</em> |

> Check order is `src/lib/utils/moderation-permission-checker.ts:1` and every action rechecks `target.member.bannable` at execution. Full reference → [Bolt docs — permissions](https://boltdoc.vercel.app/guides/fake-permissions)

---

## What it does

A moderation bot that stays calm when things get messy. Every action writes a numbered case with reason, evidence and DM status, and routes it to your log channels.

**Ladder** warn → mute / timeout → kick → ban / softban → jail (single-channel restrict)  
**Cases** auto-numbered, editable, `!cases @user` / `/cases view #12`  
**Cleanup** purge (user filter), slowmode, hide / unhide · **Identity** nick, role, voice · **Recovery** snipe / editsnipe · **Utility** afk, user/server/role info, steal emoji, greet

Works the same over slash and prefix. Per-guild prefix via `/setprefix`, slash always works.

<details>
<summary><strong>Permission grants at a glance</strong> — 20 choices + presets</summary>

| Choice                          | Unlocks                                                 | Flag                                                               |
| ------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| `admin`                         | **fake Administrator** — full + grant mods (owner only) | `Administrator`                                                    |
| `ban` `unban` `softban`         | ban, unban, softban                                     | `BanMembers`                                                       |
| `kick`                          | kick                                                    | `KickMembers`                                                      |
| `timeout` `untimeout` `warn`    | timeout, remove timeout, warn                           | `ModerateMembers`                                                  |
| `mute` `unmute` `jail` `unjail` | mute, jail                                              | `ManageRoles` + `ModerateMembers`                                  |
| `purge`                         | purge / clear                                           | `ManageMessages`                                                   |
| `slowmode` `hide` `unhide`      | slowmode, hide channel                                  | `ManageChannels`                                                   |
| `nick` `role` `voice` `cases`   | nick, role toggle, voice, view cases                    | `ManageNicknames` / `ManageRoles` / `MoveMembers` / `ViewAuditLog` |

Presets: `chatmod` → purge, slowmode, timeout, warn · `mod` → kick, timeout, warn, mute, purge, slowmode, nick · `seniormod` / `full` / `all` → everything (add `admin` via owner: `!gp @Role admin`)

```
# slash
/givepermission add role:@Trial permissions:kick, timeout, warn
/givepermission add role:@Trial permissions:chatmod

# prefix — shorthand is an add
!gp @Trial kick timeout warn
!gp @Trial ban unban
!gp list @Trial
!gp clear @Trial
/permissions @User   # see Key I vs Key II
```

Full guide: [boltdoc.vercel.app/guides/fake-permissions](https://boltdoc.vercel.app/guides/fake-permissions) — source `site/src/content/fake-permissions.md`

</details>

## Invite

Self-hosted only — no hosted dashboard.

1. Create the application in the Discord Developer Portal.
2. Invite with `bot` + `applications.commands`. Minimum bot perms:

```
SendMessages  EmbedLinks  ReadMessageHistory  ViewChannel
+ BanMembers  KickMembers  ModerateMembers  ManageMessages
  ManageRoles  ManageChannels  ManageNicknames  MoveMembers / MuteMembers
```

**Quick invite (full perms `1101017476118`):**

```
https://discord.com/api/oauth2/authorize?client_id=1424440972758220800&permissions=1101017476118&scope=bot%20applications.commands
```

For slash, keep `applications.commands`. Enable the intents you use. Docs: [boltdoc.vercel.app](https://boltdoc.vercel.app) · [Invite guide](https://boltdoc.vercel.app/guides/invite-permissions)

## Self-host

Requires Node 20.19+, MongoDB, a Discord app.

```bash
git clone https://github.com/gogeta1232/Bolt-OS.git
cd Bolt-OS
npm ci
cp .env.example .env
# set DISCORD_TOKEN, DISCORD_CLIENT_ID, MONGO_URI
npm run dev
```

Production:

```bash
npm run validate   # format:check + check + lint + test + build
npm run db:indexes # sync Mongo indexes on deploy
npm run build
npm start          # or clustered
npm run start:cluster
```

Env is validated on boot (`src/config/env.ts`). `.env` stays ignored. Health check at `EXPRESS_PORT`. See `docs/SHARDING.md` for clusters.

## Configure

All per-guild settings are `GuildConfig` (`src/database/models/guild/GuildConfig.ts`) via `src/services/core/config-service.ts` — 5 min cache, atomic upserts.

```
/setprefix !                 # per-server, slash unaffected
/fadmin @Role                # Bolt admin — owner only, full access
/givepermission add @Role ban kick   # granular fake — admin+
/fmod @Role                  # blanket mod — legacy, admin+
/setjailrole @Role  /setjailchannel #channel
/setwelcome #general Hello {user}
/setup                       # route audit / moderation / message / member / voice / case logs
/autoresponder add hi hello
```

Run `/permissions` or `!permissions @User` to see Key I (Discord) vs Key II (Bolt/fake) for anyone.

## Commands

| Module          | Commands                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Moderation**  | ban, unban, softban, kick, timeout, warn, mute, jail, unjail, purge, slowmode, hide, unhide, voice, nick, role, cases                      |
| **Permissions** | fadmin, fmod, givepermission (`gp` / `fakeperm`), permissions                                                                              |
| **Admin**       | setup, setprefix, setjailrole, setjailchannel, setwelcome, setgreetchannel, autoresponder, clearsnipe                                      |
| **Utility**     | help, ping, snipe, editsnipe, afk, avatar, userinfo, userbanner, serverinfo, serverbanner, roleinfo, membercount, boostcount, steal, greet |

Registry is generated: `site/src/data/commands.json` via `npm run docs:export` (synced to [bolt-docs](https://github.com/gogeta1232/bolt-docs)). Docs source: `site/src/content`.

## Stack & structure

```
src/
  commands/              slash + prefix, by capability
  interaction-handlers/  buttons, menus, modals
  listeners/             gateway events, thin only
  services/              state, schedulers, db
  database/models/       schemas, validation, indexes
  lib/                   pure helpers, embeds, permission checks
  setup/                 container wiring, boot order
  scripts/               sync-indexes, export-commands
site/                    docs site (Vite, searchable guides)
tests/unit/              pure logic, no Discord connection
```

Strict TypeScript, no `any`, [`Sapphire Framework`](https://github.com/sapphiredev/framework) pieces, `zod` env, HTTPS-only media with host allowlist and byte cap. See `docs/ARCHITECTURE.md` / `DATABASE.md` / `TESTING.md`.

## Develop

```bash
npm run dev          # watch one process
npm run check        # tsc --noEmit
npm run lint         # eslint
npm test             # vitest
npm run build        # tsc → dist/
npm run validate     # the pre-merge gate
npm run docs:export  # refresh site data
```

## Security

Do not open a public issue for an unpatched vulnerability — see `SECURITY.md`. No secrets in logs or the health endpoint. Remote media is host-allowlisted and size-limited.

## Contributing

PRs welcome. Read `CONTRIBUTING.md`, add tests for behavior changes, run `npm run validate`.

## License

Elastic License 2.0 — `LICENSE.md`. Source-available, not open-source. Do not offer Bolt as a hosted service.

<p align="center">
<sub>Bolt — TypeScript · <a href="https://github.com/sapphiredev/framework">Sapphire Framework</a> · discord.js · MongoDB · ELv2</sub>
</p>
