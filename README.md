# SC - More Activities

SC - More Activities is a Shattered Codex activity platform for the `dnd5e`
system in Foundry VTT.

This module is currently in Phase 5 of implementation. The current build is an
installable module shell with localization, styles, settings, documentation and
support launchers, lifecycle logging, an activity registration API, a `dnd5e`
adapter, the first built-in activity types, and a GM-facing activity catalog.
GMs can enable or disable registered activity types from the catalog without
removing their `dnd5e` registrations.

## Current Scope

- Foundry VTT v13 and v14 module shell.
- `dnd5e` 5.x relationship metadata.
- English and Brazilian Portuguese localization files.
- Shattered Codex scoped CSS tokens.
- Basic settings and external documentation/support launchers.
- Debug-only lifecycle logging.
- Early public API at `game.modules.get("sc-more-activities").api`.
- Synchronous registration hook:
  `sc-more-activities.registerActivities`.
- Activity registry lifecycle lock after registration collection.
- `dnd5e` adapter flush during `init`.
- Built-in `sc-sound` activity.
- Built-in `sc-macro` activity.
- Built-in `sc-hook` developer activity.
- Built-in `sc-chain` orchestration activity for explicit same-item activity
  lists with loop protection.
- Guarded activity create dialog grouping for D&D 5e, Shattered Codex, and
  registry/config metadata-provided external groups, replacing separate lists
  with group panels in a slightly top-offset icon rail.
- Activity catalog and diagnostics app available from module settings.
- GM activity availability controls for creation and use.

Migration tools, legacy type aliases, and richer activity creation catalog
workflows are intentionally not implemented in this phase.

## Public API

External modules can register activity definitions during the registration hook:

```js
Hooks.on("sc-more-activities.registerActivities", (activities) => {
  const result = activities.registerType({
    moduleId: "my-module",
    type: "my-module-ignite",
    label: "MYMODULE.Activity.Ignite.Label",
    hint: "MYMODULE.Activity.Ignite.Hint",
    icon: "modules/my-module/icons/ignite.svg",
    documentClass: MyIgniteActivity
  });

  if (!result.ok) {
    console.warn("[my-module] activity registration failed", result);
  }
});
```

Registration is synchronous. The registry locks immediately after the
registration hook completes. Late registrations return a structured failure with
reason `registry-locked`.

Duplicate registrations from another module are rejected. Duplicate
registrations from the same module are idempotent only when the public summary is
equivalent; conflicting definitions are rejected unless the module passes
`updateExisting: true` during the same collection window.

The public API separates module and API versioning:

- `moduleVersion`: the module manifest version.
- `apiVersion`: the public API contract version.

The registry stores and validates definitions, then the `dnd5e` adapter
flushes accepted entries into `CONFIG.DND5E.activityTypes` during `init`.

Current capabilities:

- `registry: true`
- `dnd5eAdapter: true`
- `activityCreation: true`
- `activityCatalog: true`
- `activityAvailability: true`
- `migration: false`

## Architecture Plan

The implementation roadmap lives in:

- `../plans/sc-more-activities-architecture/README.md`
- `../plans/sc-more-activities-architecture/06-sdd-implementation-roadmap.md`

Follow the plan phase by phase. Direct `CONFIG.DND5E.activityTypes` writes belong
only inside the `dnd5e` adapter.

## Compatibility

- Foundry VTT: minimum v13, verified v14.
- System: `dnd5e` minimum 5.0.0, locally verified against 5.3.0.
- `lib-wrapper` is recommended for integration patches, but not required by the
  adapter.

## Development Notes

Enable **Debug logging** in the module settings to see `init`, `setup`, and
`ready` lifecycle messages.

Phase 4 manual smoke checks:

- `CONFIG.DND5E.activityTypes["sc-sound"]` and `["sc-macro"]` exist after load.
- The registration report lists both types as registered and flushed.
- Create both activities on an actor-owned item, save their sheets, reload the
  world, and use the item.
- `sc-sound` handles a missing audio file cleanly and plays valid audio locally;
  GM broadcast uses the dnd5e/Foundry audio helper.
- `sc-macro` executes a permitted world macro, reports missing or unauthorized
  macros cleanly, and runs inline code stored on the activity only for GM users
  when selected.
- `sc-hook` emits a configured hook payload or calls a callback exposed through
  `game.modules.get(moduleId).api.scMoreActivities.callbacks`.
- `sc-chain` executes configured activity ids from the same item, stops on
  loops/depth limits, and should be used when the native `forward` activity does
  not express the desired sequence clearly.
- `sc-macro` shows the world macro selector only in world mode and the code
  editor only in inline mode.
- Activity creation groups D&D 5e (`fa-brands fa-d-and-d`), Shattered Codex
  (`fa-solid fa-book-sparkles`), and metadata-provided external activities into
  an icon-only `tabs-right` rail placed slightly below the dialog top.
- Activity catalog opens from module settings and shows registered, rejected,
  warning, lifecycle, and capability diagnostics with search and filters.
- Catalog availability switches hide disabled activity types from creation and
  item use choices, hide disabled existing activities from player sheets, and
  block direct creation/use with a localized warning.
- With `sc-conditional-activities` active, a false condition blocks both
  activities before sound or macro execution.
