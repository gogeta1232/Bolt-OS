# Bolt site (custom Vite build) — overrides MASTER.md

Subject: docs-as-tool for Discord mods/admins. Single job: from "what can Bolt
do" to "it's configured" as fast as possible.

## Tokens

- Ember `#FF482C` — brand action (buttons, active states, focus)
- Deep ember `#B8250E` — hover + text-on-light accent (AA)
- Gold `#F7B626` — attention only (warnings, admin markers), never decoration
- Paper `#FAFAF8` / Ink `#16161A` (light), Coal `#0E0E11` / Mist `#1A1A1F` (dark)
- Hairlines only, 12–16px radii, neutral shadow `0 1px 2px rgb(0 0 0 / .06)`.
  Zero glow, zero gradient. Both themes, persisted, system default.

## Type

- Display: Space Grotesk 700, tight tracking — hero, wordmark, numbers only.
- Body: Inter 400/500/600. Data: JetBrains Mono (usages, IDs, stats).

## Layout — app shell, not a marketing page

```
┌────┬──────────────────────────────┐
│rail│  topbar: search-trigger,     │
│ H  │  theme toggle                │
│ C  ├──────────────────────────────┤
│ G  │                              │
│ W  │  page content (720px)        │
│    │                              │
└────┴──────────────────────────────┘
```

Rail: Home, Commands, Guides, How Bolt Works. Icon + label, active = ember
soft pill. Collapses to bottom bar on mobile (≤5 items, thumb reach).

## Signature — command palette (Cmd+K)

Fuzzy search across commands + guides, keyboard-first (↑↓ navigate, Enter
open, ⌘C copy usage), recent items, footer hints. The one memorable element;
everything else stays quiet.

## Motion (subtle only)

160–200ms ease-out everywhere; card entrance stagger capped ~400ms; palette
fade+scale 120ms; `prefers-reduced-motion` renders final state, no animation.

## Data rules (unchanged)

- `src/data/commands.json` generated, never hand-edited. Prefix from
  `defaultPrefix`, always labeled per-server configurable.
- No live bot connection: "live" data = build-time export + relative
  timestamps. Never fake presence.
