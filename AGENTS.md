# SC More Activities Development Notes

This module follows the architecture plan in
`../plans/sc-more-activities-architecture`.

## Phase Discipline

- Phase 1 is only the Foundry module skeleton.
- Do not implement the activity registry, public API, `dnd5e` adapter, activity
  types, migration tools, or catalog UI in Phase 1.
- Keep `scripts/main.js` as lifecycle wiring only.
- Keep settings and support utilities small and module-scoped.
- Prefer the smallest working implementation. Do not add abstractions until they
  remove real complexity.
- Keep one exported class per file unless the file is a constants module.

## Foundry and DnD5e Boundaries

- Support Foundry v13 and v14.
- Target `dnd5e` 5.x.
- Exit early when `game.system.id !== "dnd5e"`.
- Future activity registration must go through the planned adapter; do not write
  directly to `CONFIG.DND5E.activityTypes` outside the adapter.
- Do not patch `Item5e.prototype.use` outside an explicit integration service.
- Use Application V2 for new module-owned applications.
- Public APIs must be intentional, documented, and versioned. Do not expose
  internal services as convenience globals.

## Shattered Codex Style

- Use the `SCMOREACTIVITIES.*` localization namespace.
- Use module-scoped CSS classes and variables under `.sc-more-activities`.
- Prefer Application V2 and Foundry-native settings patterns.
- Keep public UI compact, operational, and aligned with nearby SC modules.

## Validation

After each phase:

- validate `module.json`;
- validate language JSON files;
- run syntax checks for changed JavaScript files;
- confirm no direct `CONFIG.DND5E.activityTypes` writes exist outside the future
  adapter;
- note anything that still requires manual Foundry testing.
