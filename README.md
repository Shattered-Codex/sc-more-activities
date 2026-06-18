<p align="center">
  <a href="https://www.patreon.com/c/shatteredcodex?utm_source=sc-more-activities&utm_medium=github&utm_campaign=support_readme">
    <img src="https://i.imgur.com/9kf3oWy.png" alt="Shattered Codex" width="200" height="200" />
  </a>
</p>

# SC - More Activities

[![Wiki](https://img.shields.io/badge/Wiki-SC%20More%20Activities-1f6feb?logo=bookstack&logoColor=white&style=for-the-badge)](https://wiki.shattered-codex.com/modules/sc-more-activities)
[![Support on Patreon](https://img.shields.io/badge/Patreon-Shattered%20Codex-FF424D?logo=patreon&logoColor=white&style=for-the-badge)](https://www.patreon.com/c/shatteredcodex?utm_source=sc-more-activities&utm_medium=github&utm_campaign=support_readme)
![Foundry VTT 13-14](https://img.shields.io/badge/Foundry%20VTT-v13%20%7C%20v14-orange?logo=foundry-vtt&logoColor=white&style=for-the-badge)
![System: dnd5e](https://img.shields.io/badge/System-dnd5e-blue?style=for-the-badge)
[![libWrapper Recommended](https://img.shields.io/badge/libWrapper-Recommended-8A2BE2?style=for-the-badge)](https://github.com/ruipin/fvtt-lib-wrapper)
![Downloads](https://img.shields.io/github/downloads/Shattered-Codex/sc-more-activities/total?style=for-the-badge)
![Forks](https://img.shields.io/github/forks/Shattered-Codex/sc-more-activities.svg?style=for-the-badge)

A free Shattered Codex module for **D&D 5e** in **Foundry VTT** that adds new activity types, a public activity registry, GM-facing diagnostics, and migration tools for worlds moving away from the legacy `more-activities` module.

It is built for two use cases:

- GMs who want more item activities without maintaining custom patches
- module authors who want to register their own `dnd5e` activity types through a stable SC-owned registry

[Report an issue or request a feature](https://github.com/Shattered-Codex/sc-more-activities/issues)  
[Official Wiki](https://wiki.shattered-codex.com/modules/sc-more-activities)

---

## What This Module Adds

- Built-in Shattered Codex activity types for automation, support, progression, inventory, and canvas workflows
- A public registration hook and API for SC modules and third-party modules
- A grouped activity creation dialog that separates native D&D 5e activities from Shattered Codex activities
- A GM activity catalog with diagnostics, filters, and enable/disable controls
- Preview color settings for teleport, movement, and wall overlays
- Explicit preview/apply/restore migration tools for legacy `more-activities` data

## Included Activity Types

- `sc-sound`: play audio from an activity
- `sc-macro`: run a world macro or GM-controlled inline code
- `sc-hook`: fire a hook or module callback for developer workflows
- `sc-chain`: trigger other activities from the same item in sequence
- `sc-contest`: resolve a contested roll workflow between participants
- `sc-grant`: grant item-related rewards or support item flows
- `sc-advancement`: drive item-linked advancement or progression flows
- `sc-teleport`: move tokens through a guided teleport workflow
- `sc-movement`: push, pull, or reposition tokens with preview support
- `sc-wall`: create wall previews and GM-mediated wall placement

## Asset Credits

Some bundled activity icons are sourced from [game-icons.net](https://game-icons.net/).
Game-icons.net states that its icons are provided under the
[Creative Commons Attribution 3.0 license](https://creativecommons.org/licenses/by/3.0/),
which requires attribution to the original author(s). See the
[Game-icons.net About page](https://game-icons.net/about.html) for license and author details.

## Main Features

- Supports **Foundry VTT v13 and v14**
- Supports **`dnd5e` 5.x**
- Uses a module-owned registry instead of ad hoc activity injection
- Flushes accepted registrations into `dnd5e` during module initialization
- Exposes registration diagnostics so GMs can see what loaded, what failed, and why
- Lets GMs disable registered activity types without removing their definitions
- Opens a dedicated **Activity Catalog** from module settings
- Opens a dedicated **More Activities Migration** tool from module settings
- Keeps wiki and Patreon actions available directly from module settings
- Includes English and Brazilian Portuguese localization

## Requirements

- **Foundry VTT:** v13 or v14
- **System:** `dnd5e`
- **Recommended:** `libWrapper`

The module exits early outside `dnd5e` worlds.

## Installation

1. In Foundry, open **Add-on Modules > Install Module**.
2. Paste this manifest URL:

```text
https://github.com/Shattered-Codex/sc-more-activities/releases/latest/download/module.json
```

3. Install the module.
4. Enable **SC - More Activities** in your world.
5. For better compatibility with other modules, also install and enable `libWrapper`.

## How It Fits Into D&D 5e

SC - More Activities does not replace the native D&D 5e activity system. It extends it.

- Native `dnd5e` activities stay available in their own group
- Shattered Codex activities appear in a separate group in the creation dialog
- registered third-party activities can join the same registry flow and provide their own metadata

This keeps the familiar D&D 5e workflow while making SC and external activity types easier to manage.

## Activity Catalog

The Activity Catalog is a GM tool available from module settings.

It lets you:

- inspect registered activity types
- review rejected registrations and warnings
- filter entries by status, category, and availability
- enable or disable registered types for the world
- open migration tools from the same workflow

## Migration From `more-activities`

This module includes explicit migration tools for the legacy `more-activities` module.

- Run a **preview** first to see what can be converted
- Apply the migration only after reviewing the results
- Restore the latest backup if needed
- Export preview and report data for review

Important:

- migration is **GM only**
- migration does **not** auto-run
- blocked or partially compatible legacy activities may require manual cleanup after conversion
- if the legacy module is still enabled, keep it active only while reviewing or migrating

## Building Activities In Other Modules

SC - More Activities is intended to be the registration layer for Shattered Codex and third-party activity types.

If your module integrates with it, register through the public hook, or call `api.activities.registerType(...)` during the same collection window, instead of writing directly to `CONFIG.DND5E.activityTypes`.

### Registration Lifecycle

- Register during `Hooks.on("sc-more-activities.registerActivities", ...)`
- That hook runs during `init` while the registry is collecting definitions
- Direct calls to `api.activities.registerType(...)` follow the same timing rules
- After the registry flushes into `dnd5e`, the registry locks and late registrations are rejected
- If you need the published API object after setup, listen to `Hooks.on("sc-more-activities.apiReady", ...)`

### Minimum Registration Contract

Your activity definition should include:

- `moduleId`
- `type`
- `label`
- `hint`
- `icon`
- `documentClass`

Your `documentClass` must provide:

- `static metadata.type` matching the registered type
- `static availableForItem(...)`
- `static localize(...)`

Recommended fields:

- `dataModel`
- `sheetClass`
- `ui`
- `compatibility`
- `tags`
- `templates`
- `ownership`

Type rules:

- use lowercase ASCII with letters, numbers, and hyphens
- do not reuse native `dnd5e` activity ids such as `attack`, `cast`, `save`, or `utility`
- do not reuse legacy `more-activities` ids such as `macro`, `hook`, `teleport`, `movement`, or `wall`

### Example Registration

External modules can register activity types during the synchronous registration hook:

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

  if (!result.ok) console.warn(result);
});
```

To place your activity in its own group inside the create dialog, include `ui` metadata.

Important:

- `ui.scope` is a bucket used by SC More Activities: `native`, `shattered-codex`, `legacy`, or `external`
- third-party modules should usually keep `ui.scope: "external"`
- use `ui.groupId` for the module-specific group id, for example `sc-simple-sockets`

Real example from `sc-simple-sockets`:

```js
Hooks.on("sc-more-activities.registerActivities", (activities) => {
  activities.registerType({
    moduleId: "sc-simple-sockets",
    type: "sc-socket-slot",
    label: "SCSockets.Integrations.ScMoreActivities.SocketSlot.Title",
    hint: "SCSockets.Integrations.ScMoreActivities.SocketSlot.Hint",
    icon: "modules/sc-simple-sockets/assets/imgs/socket-slot.webp",
    documentClass: ScMoreActivitiesSocketSlotActivity,
    dataModel: ScMoreActivitiesSocketSlotActivityData,
    sheetClass: ScMoreActivitiesSocketSlotActivitySheet,
    configurable: true,
    category: "sockets",
    ui: {
      scope: "external",
      group: "sockets",
      groupId: "sc-simple-sockets",
      groupLabel: "SCSockets.Integrations.ScMoreActivities.GroupLabel",
      groupIcon: "fa-solid fa-gem",
      groupOrder: 120,
      order: 140
    },
    tags: ["sockets", "slot", "inventory"],
    compatibility: {
      dnd5e: "5.x",
      scMoreActivities: {
        moduleId: "sc-more-activities",
        required: true
      },
      scSimpleSockets: {
        moduleId: "sc-simple-sockets",
        required: true
      }
    },
    templates: [
      "modules/sc-simple-sockets/templates/integrations/sc-more-activities/socket-slot-effect.hbs"
    ],
    ownership: {
      execute: "item-owner",
      hostItem: "activity-item",
      mutation: "gm-mediated"
    },
    source: "external"
  });
});
```

That registration is paired with a real activity class, data model, and sheet.

Activity class:

```js
export class ScMoreActivitiesSocketSlotActivity extends dnd5e.documents.activity.ActivityMixin(
  ScMoreActivitiesSocketSlotActivityData
) {
  static LOCALIZATION_PREFIXES = [
    ...super.LOCALIZATION_PREFIXES,
    "SCSockets.Integrations.ScMoreActivities.SocketSlot"
  ];

  static metadata = Object.freeze(
    foundry.utils.mergeObject(super.metadata, {
      type: "sc-socket-slot",
      img: "modules/sc-simple-sockets/assets/imgs/socket-slot.webp",
      title: "SCSockets.Integrations.ScMoreActivities.SocketSlot.Title",
      hint: "SCSockets.Integrations.ScMoreActivities.SocketSlot.Hint",
      sheetClass: ScMoreActivitiesSocketSlotActivitySheet
    }, { inplace: false })
  );

  static defineSchema() {
    return ScMoreActivitiesSocketSlotActivityData.defineSchema();
  }

  static availableForItem(item, ...args) {
    const base = typeof super.availableForItem === "function"
      ? super.availableForItem(item, ...args)
      : true;
    return base && ScMoreActivitiesIntegration.isTypeEnabled("sc-socket-slot");
  }

  async use(usage = {}, dialog = {}, message = {}) {
    const results = await super.use(usage, dialog, message);
    if (results === undefined) {
      return results;
    }

    return ScMoreActivitiesSocketSlotActivityService.execute(this, {
      usage,
      dialog,
      message,
      results
    });
  }
}
```

Data model:

```js
export class ScMoreActivitiesSocketSlotActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      ...super.defineSchema(),
      slot: new fields.SchemaField({
        color: new fields.StringField({ required: false, blank: true, initial: "" }),
        cursorImage: new fields.StringField({ required: false, blank: true, initial: "" }),
        condition: new fields.StringField({ required: false, blank: true, initial: "" }),
        targetCondition: new fields.StringField({ required: false, blank: true, initial: "" }),
        deleteGemOnRemoval: new fields.BooleanField({ required: false, initial: false }),
        ignoreMaxSockets: new fields.BooleanField({ required: false, initial: false }),
        description: new fields.StringField({ required: false, blank: true, initial: "" }),
        hidden: new fields.BooleanField({ required: false, initial: false }),
        name: new fields.StringField({ required: false, blank: true, initial: "" }),
        operation: new fields.StringField({
          required: false,
          initial: "add",
          choices: ["add", "remove-empty"]
        })
      })
    };
  }
}
```

Sheet wiring:

```js
const TEMPLATE_PATH = "modules/sc-simple-sockets/templates/integrations/sc-more-activities/socket-slot-effect.hbs";

export class ScMoreActivitiesSocketSlotActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: [
      "dnd5e2",
      "sheet",
      "activity-sheet",
      "sc-sockets",
      "sc-sockets-scma-activity--slot"
    ]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: TEMPLATE_PATH,
      templates: [...super.PARTS.effect.templates]
    }
  };
}
```

Template example:

```hbs
<section
  class="tab activity-{{ tab.id }} {{ tab.cssClass }}"
  data-tab="{{ tab.id }}"
  data-group="{{ tab.group }}"
>
  <div class="form-group">
    <label>Operation</label>
    <div class="form-fields">
      <select name="slot.operation">
        {{ selectOptions operationOptions selected=slot.operation valueAttr="value" labelAttr="label" }}
      </select>
    </div>
  </div>

  <div class="form-group">
    <label>Slot Name</label>
    <div class="form-fields">
      <input
        type="text"
        name="slot.name"
        value="{{ slot.name }}"
        placeholder="Ruby Socket"
      >
    </div>
  </div>

  <div class="form-group">
    <label>Color</label>
    <div class="form-fields">
      <input
        type="text"
        name="slot.color"
        value="{{ slot.color }}"
        placeholder="#C44D24"
      >
    </div>
  </div>

  <div class="form-group stacked">
    <label>Description</label>
    <div class="form-fields">
      <textarea
        name="slot.description"
        rows="4"
      >{{ slot.description }}</textarea>
    </div>
  </div>
</section>
```

This is intentionally shortened from the real `socket-slot-effect.hbs`, but it shows the important pattern: template field names such as `slot.operation`, `slot.name`, `slot.color`, and `slot.description` map directly to the nested schema defined in the activity data model.

### Creating Activities Programmatically

Public API entrypoint:

```js
const api = game.modules.get("sc-more-activities")?.api;
```

To create a registered activity on an item after registration:

```js
const result = await api?.activities?.createActivityOnItem(item, "sc-socket-slot", {
  name: "Add Socket",
  img: "modules/sc-simple-sockets/assets/imgs/socket-slot.webp",
  slot: {
    operation: "add",
    name: "Ruby Socket",
    color: "#C44D24",
    description: "<p>Adds a new socket to the host item.</p>"
  }
});

if (!result?.ok) console.warn(result);
```

This helper checks:

- the target item exists
- the activity type is registered
- the GM has not disabled the type
- the `dnd5e` adapter has already flushed the type

Current public capabilities:

- `registry`
- `dnd5eAdapter`
- `activityCreation`
- `activityCatalog`
- `activityAvailability`
- `migration`

The registry is collected during `init`, then locked before normal play. Late registrations are rejected with a structured failure result instead of silently patching `dnd5e`.

Real example:

- `sc-simple-sockets` registers `sc-socket-slot` and `sc-socket-extraction` through this hook with `ui.scope: "external"` and `ui.groupId: "sc-simple-sockets"`
