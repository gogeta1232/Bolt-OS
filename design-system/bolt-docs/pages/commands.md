# Commands page — overrides MASTER.md

## Structure (information, not decoration)

- Default view groups by module, then docs-side subcategory (taxonomy lives in
  `src/features/commands/taxonomy.ts` — bot code has no subcategories).
- Any active filter (text, module pill, group) switches to a flat ranked grid.
- Sticky command bar: search, group select, module pills with live counts,
  result count (`aria-live`), reset affordance.

## Interaction

- Whole card header is the toggle (chevron rotates 180°). Deep links
  `#cmd-<name>` expand + scroll on load and sync on toggle via replaceState.
- `/` focuses search unless already typing. Copy buttons confirm for 1.5s.
- Entrance is a staggered fade-up capped at ~400ms total, off under
  `prefers-reduced-motion`. Hover is a 1px lift on cards only.

## Data rules

- `commands.json` is generated (`npm run docs:export`); never hand-edit.
- Prefix comes from `defaultPrefix` in JSON (parsed from `src/config/env.ts`);
  always label it per-server configurable.
