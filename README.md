<div align="center" style="max-width:920px;margin:0 auto;">

<!-- Spec plate header: banner + stamped pfp, not a centered stack -->
<div style="border:1.5px solid #22211e;border-radius:16px;overflow:hidden;background:#0c0c0d;line-height:0;">

<img src="assets/bolt_banner.png" alt="Bolt — stamped brass plate" width="920" style="display:block;width:100%;max-width:920px;height:auto;" />

<div style="display:flex;align-items:center;gap:16px;padding:16px 18px;background:#0c0c0d;text-align:left;line-height:1;">

<img src="assets/bolt_pfp.webp" alt="Bolt" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:12px;border:1px solid #2a2a2a;flex:0 0 auto;" />

<div style="min-width:0;flex:1 1 auto;text-align:left;">
<div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-weight:800;font-size:22px;letter-spacing:-0.03em;color:#faf8f3;line-height:1;">Bolt</div>
<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-weight:500;font-size:12.5px;color:#a8a9ad;line-height:1.4;margin-top:3px;">TypeScript · <a href="https://github.com/sapphiredev/framework" style="color:#a8a9ad;text-decoration:underline;text-underline-offset:3px;text-decoration-color:#3a3a3a;">Sapphire Framework</a> · MongoDB — moderation that rechecks at execution</div>
</div>

<div style="flex:0 0 auto;display:flex;gap:8px;align-items:center;">
<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:600;letter-spacing:0.04em;color:#0c0c0d;background:#f7b626;padding:7px 10px;border-radius:999px;">ELv2</span>
<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#e8e8e6;border:1px solid #2a2a2a;padding:6px 10px;border-radius:999px;">slash + prefix</span>
</div>

</div>
</div>

<p style="margin:14px 0 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#6b6b6b;">
44 commands · 4 modules · per-guild config · cases with evidence
</p>

</div>

---

### Two ways to grant power. You choose.

Bolt does not force you into one permission model. Both are checked live on every command.

<table>
<tr>
<td width="50%" valign="top" style="background:#161617;border:1px solid #2a2a2e;border-radius:12px;padding:16px;color:#d6d6d8;">

<div style="display:inline-flex;align-items:center;gap:8px;margin-bottom:8px;">
<span style="width:8px;height:8px;border-radius:999px;background:#6b7280;display:inline-block;"></span>
<span style="font-family:ui-sans-serif,system-ui,sans-serif;font-weight:700;font-size:13px;letter-spacing:-0.01em;color:#faf8f3;">Native — use Discord</span>
</div>

Role has real Discord perms. Other bots see it too.

`BanMembers` for ban, `KickMembers` for kick, `ModerateMembers` for timeout, `ManageMessages` for purge, etc.

<span style="color:#a8a9ad;">Use when the role should be powerful everywhere.</span>

_Owner → Administrator → real flag_

</td>
<td width="50%" valign="top" style="background:#0c0c0d;border:1px solid #ff482c;border-radius:12px;padding:16px;color:#e8e8e6;">

<div style="display:inline-flex;align-items:center;gap:8px;margin-bottom:8px;">
<span style="width:8px;height:8px;border-radius:999px;background:#ff482c;display:inline-block;box-shadow:0 0 8px rgba(255,72,44,0.6);"></span>
<span style="font-family:ui-sans-serif,system-ui,sans-serif;font-weight:700;font-size:13px;letter-spacing:-0.01em;color:#faf8f3;">Fake — Bolt only · more secure</span>
</div>

Role has **zero** Discord perms. Only Bolt enforces it. No stray Discord grants.

`/givepermission add @Role ban kick timeout`  
`!gp @Role chatmod` · `!gp @Role all`

`src/lib/fake-permissions.ts`

<span style="color:#a8a9ad;">Use when the owner wants least privilege.</span>

_Fake grant → checked as if the flag was held_

</td>
</tr>
</table>

> Check order is `src/lib/utils/moderation-permission-checker.ts:1` and every action rechecks `target.member.bannable` at execution. Full reference → [Bolt docs — permissions](https://bolt-docs.vercel.app/guides/fake-permissions)



<p align="center" style="margin:18px 0 0 0;">
<a href="#invite"><img alt="Invite" src="https://img.shields.io/badge/Invite-%23ff482c?style=for-the-badge&labelColor=%230c0c0d&color=%23ff482c" /></a>&nbsp;
<a href="#self-host"><img alt="Self-host" src="https://img.shields.io/badge/Self--host-%23faf8f3?style=for-the-badge&labelColor=%230c0c0d&color=%23e8e8e6" /></a>&nbsp;
<a href="https://bolt-docs.vercel.app"><img alt="Docs" src="https://img.shields.io/badge/Docs-bolt--docs.vercel.app-ff482c?style=for-the-badge" /></a>
</p>

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

Full guide: [bolt-docs.vercel.app/guides/fake-permissions](https://bolt-docs.vercel.app/guides/fake-permissions) — source `site/src/content/fake-permissions.md`

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

For slash, keep `applications.commands`. Enable the intents you use. Docs: [bolt-docs.vercel.app](https://bolt-docs.vercel.app) · [Invite guide](https://bolt-docs.vercel.app/guides/invite-permissions)

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

<p align="center" style="margin-top:28px;">
<sub style="color:#6b6b6b;">Bolt — TypeScript · <a href="https://github.com/sapphiredev/framework" style="color:#6b6b6b;">Sapphire Framework</a> · discord.js · MongoDB · ELv2</sub>
</p>
