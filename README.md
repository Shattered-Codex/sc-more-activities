# SC - More Activities

SC - More Activities is a Shattered Codex activity platform for the `dnd5e`
system in Foundry VTT.

This module is currently in Phase 3 of implementation. The current build is an
installable module shell with localization, styles, settings, documentation and
support launchers, lifecycle logging, an early activity registration API, and a
`dnd5e` adapter that flushes accepted registry entries into
`CONFIG.DND5E.activityTypes`.

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

Built-in activity types, migration tools, and catalog UI are intentionally not
implemented in this phase.

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

The registry stores and validates definitions, then the Phase 3 `dnd5e` adapter
flushes accepted entries into `CONFIG.DND5E.activityTypes` during `init`.

Current capabilities:

- `registry: true`
- `dnd5eAdapter: true`
- `activityCreation: true`
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
- `lib-wrapper` is recommended for future integration patches, but not required
  by the Phase 3 adapter.

## Development Notes

Enable **Debug logging** in the module settings to see `init`, `setup`, and
`ready` lifecycle messages.
