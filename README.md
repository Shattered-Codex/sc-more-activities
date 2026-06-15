# SC - More Activities

SC - More Activities is a Shattered Codex activity platform for the `dnd5e`
system in Foundry VTT.

This module is currently in Phase 1 of implementation. The current build is an
installable module shell with localization, styles, settings, documentation and
support launchers, lifecycle logging, and Shattered Codex structure.

## Current Scope

- Foundry VTT v13 and v14 module shell.
- `dnd5e` 5.x relationship metadata.
- English and Brazilian Portuguese localization files.
- Shattered Codex scoped CSS tokens.
- Basic settings and external documentation/support launchers.
- Debug-only lifecycle logging.

The registry, public API, adapter, activity types, migration tools, and catalog
UI are intentionally not implemented in this phase.

## Architecture Plan

The implementation roadmap lives in:

- `../plans/sc-more-activities-architecture/README.md`
- `../plans/sc-more-activities-architecture/06-sdd-implementation-roadmap.md`

Follow the plan phase by phase. Do not add activity registration or direct
`CONFIG.DND5E.activityTypes` writes during the skeleton phase.

## Compatibility

- Foundry VTT: minimum v13, verified v14.
- System: `dnd5e` minimum 5.0.0, locally verified against 5.3.0.
- `lib-wrapper` is recommended for future integration patches, but not required
  by the Phase 1 skeleton.

## Development Notes

Enable **Debug logging** in the module settings to see `init`, `setup`, and
`ready` lifecycle messages.
