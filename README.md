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

## Project Positioning

SC - More Activities is inspired by the original `More Activities` module, and this project exists with a lot of respect for the work and ideas behind it.

Many thanks to TTimeGaming, creator of [`fvtt-more-activities`](https://github.com/TTimeGaming/fvtt-more-activities/), for helping show how valuable richer activity workflows can be inside `dnd5e` and Foundry VTT.

At the same time, this module is not a copy of `More Activities`. It is a Shattered Codex reinterpretation of that idea, built to give tighter control over the implementation, release flow, integrations, and long-term behavior needed by the growing SC module ecosystem, including Patreon-supported modules and module-to-module activity integrations.

The goal is to preserve the value of richer activity workflows while shaping them around the specific needs of the Shattered Codex ecosystem we are building.

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
- `sc-conditional-chain`: route between activities from the same item with conditions, rolls, and manual choices
- `sc-contest`: resolve a contested roll workflow between participants
- `sc-grant`: grant item-related rewards or support item flows
- `sc-advancement`: drive item-linked advancement or progression flows
- `sc-teleport`: move tokens through a guided teleport workflow
- `sc-movement`: push, pull, or reposition tokens with preview support
- `sc-wall`: create wall previews and GM-mediated wall placement

## Asset Credits

Some bundled activity icons are sourced from [game-icons.net](https://game-icons.net/),
currently using artwork by Delapouite and Lorc.
Game-icons.net states that its icons are provided under the
[Creative Commons Attribution 3.0 license](https://creativecommons.org/licenses/by/3.0/),
which requires attribution to the original authors. See the
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

## SC Conditional Chain Guide

The `sc-conditional-chain` activity routes between activities of the same item using **steps**. Each step
can optionally run one of the item's activities, then decides where the flow goes next.

### Anatomy Of A Step

- **Activity** — the item activity this step runs, or *Decision only (no activity)* to route without
  running anything. Decision-only steps still evaluate conditions against the most recent result.
- **Decide the next step by** — the condition type (see below).
- **Routes** — where to go for each outcome (*When true / When false*, *On success / On failure*, or
  *Next step*). Any route can point to another step or *End flow*.

The **First step** field at the top selects where the flow begins.

### Condition Types

| Type | What it does | Routes |
| --- | --- | --- |
| Always continue | No condition; always follows *Next step* | Next step |
| Actor property | Compares an actor data path (e.g. `system.attributes.hp.value`) against a value | When true / false |
| Last activity result | Compares the most recent child activity result against a value | When true / false |
| Last activity value (multiple paths) | Checks an ordered list of comparisons against one result path | First matching path / fallback |
| Roll | Rolls an ability check, saving throw, skill check, or custom formula against a DC | On success / failure |
| Manual choice | Opens a dialog and lets the user pick the route | One per option |

Canceling a roll or a manual choice always ends the flow.

### Branching On The Last Activity Result

When **Decide the next step by** is **Last activity result**, the condition row has three fields:

1. **Result** — a dropdown of results grouped by category (General, Rolls, Individual dice, Attack, Grant,
   Contest). Options show friendly labels; after you pick one, the hint below the row shows the underlying
   technical path and what it means (for example, picking *Roll total (all rolls)* shows `roll.sum`).
   Choosing an activity for the step narrows the list to results that activity can produce.
2. **Operator** — `=`, `≠`, `>`, `≥`, `<`, `≤`, or `includes`.
3. **Value** — a number, `true`/`false`, text, or a deterministic formula such as `@abilities.con.mod`
   (including `@scLast.*` references, see below).

Pick **Custom path…** at the bottom of the dropdown to type any path on the raw result object manually
(for example `roll.totals.1` for the second roll, or `roll.dice.values.2` for the third die).

"Last activity result" always means the result of the **most recent step that actually ran an activity**.
Decision-only steps inherit it unchanged, so several decision steps in a row can test different parts of
the same result.

Use **Last activity value (multiple paths)** when one result should choose among three or more routes.
Select the result path once, add non-overlapping value paths, and configure a fallback. For example:
`< 5` → Low, `between 5..10` → Medium, `> 10` → High. The editor reports overlapping numeric paths such
as `≤ 5` and `≥ 4` as a configuration error before execution.

Which activities produce detailed results:

- `attack` — attack outcome + attack roll details (**the attack roll only**, not the card damage)
- `damage`, `heal`, `save` — roll totals and individual dice (the flow waits for the roll to happen)
- `sc-grant` — gating check outcome and created/updated document counts
- `sc-contest` — winner, tie, and per-participant totals
- `sc-macro` — the explicit macro return at `value` or `macro.value`, plus `macro.returned`
- other types — general information only (source activity, chat message, effect/template counts)

### Result Path Reference

**General** — available for every activity:

| Label | Path | Meaning |
| --- | --- | --- |
| Result kind | `kind` | What the last activity produced: `"attack"`, `"damage"`, `"healing"`, `"grant"`, `"contest"`… |
| Was a success / failure | `success` / `failure` | `true` when the activity succeeded / failed (hit, check passed…) |
| Main total | `total` | Total of the activity's main roll |
| Was a critical / fumble | `critical` / `fumble` | `true` on a critical / fumble (natural 1) |
| Target number (DC/AC) | `target` | The DC or armor class the main roll was compared against |
| Was canceled | `canceled` | `true` when the activity was canceled before finishing |
| Source activity id / type / name | `sourceActivity.id` / `.type` / `.name` | Identity of the activity that produced the result |
| Source item id / UUID | `sourceActivity.itemId` / `.itemUuid` | The item that owns the source activity |
| Source actor UUID | `sourceActivity.actorUuid` | The actor that used the source activity |
| Chat message id | `use.messageId` | Chat message created by the activity (empty when none) |
| Updates / effects / templates | `use.updateCount` / `.effectCount` / `.templateCount` | How many updates, active effects, and measured templates the use produced |

**Rolls** — attack, damage, heal, and save activities:

| Label | Path | Meaning |
| --- | --- | --- |
| Roll total (first roll) | `roll.total` | Total of the first roll, modifiers included (first damage part) |
| Roll total (all rolls) | `roll.sum` | Sum of every roll — e.g. total damage across all damage parts |
| Total of roll #1 | `roll.totals.0` | Individual roll totals (`roll.totals.1`, `.2`… via custom path) |
| Number of rolls | `roll.count` | How many separate rolls were made |
| Roll succeeded / failed | `roll.success` / `roll.failure` | `true` when the roll met / missed its target number |
| Roll was a critical / fumble | `roll.critical` / `roll.fumble` | `true` on a critical / fumble |
| Roll target number | `roll.target` | The DC or AC the roll was compared against |
| Roll formula | `roll.formula` | The formula rolled (e.g. `1d20 + 5`) — compare with `=` or `includes` |
| Ability / skill / tool used | `roll.ability` / `roll.skill` / `roll.tool` | Keys such as `str`, `ath`… |

**Individual dice** — attack, damage, heal, and save activities. Discarded dice (advantage, rerolls) are
ignored:

| Label | Path | Meaning |
| --- | --- | --- |
| Dice total (no modifiers) | `roll.dice.total` | Sum of the dice only — the `2d6` part of `2d6 + 4` |
| Number of dice | `roll.dice.count` | How many dice were kept across all rolls |
| First die value | `roll.dice.values.0` | Face rolled on the first kept die (`values.1`, `.2`… via custom path) |
| Highest / lowest die | `roll.dice.max` / `roll.dice.min` | Highest / lowest face among the kept dice |

**Attack** — attack activities:

| Label | Path | Meaning |
| --- | --- | --- |
| Attack hit / missed | `attack.hit` / `attack.miss` | `true` when the attack hit / missed (single target or critical) |
| Attack roll total | `attack.total` | Total of the attack roll, modifiers included |
| Critical hit / attack fumble | `attack.critical` / `attack.fumble` | `true` on a natural critical / fumble |
| Target armor class | `attack.target` | AC the attack was compared against (single target only) |

**Grant** — `sc-grant` activities:

| Label | Path | Meaning |
| --- | --- | --- |
| Grant check passed | `activity.checkPassed` | `true` when the grant's gating check succeeded |
| Grant check DC / total | `activity.check.dc` / `activity.check.total` | DC and total of the gating check |
| Documents created / updated | `activity.createdCount` / `activity.updatedCount` | How many documents the grant created / updated |
| Target actor UUID | `activity.actorUuid` | The actor that received the grant |
| Activity canceled / cancel reason | `activity.canceled` / `activity.reason` | Whether and why the activity was canceled |

**Contest** — `sc-contest` activities:

| Label | Path | Meaning |
| --- | --- | --- |
| Contest winner | `activity.winner` / `contest.winner` | `"initiator"`, `"defender"`, or empty on a tie |
| Contest tied | `activity.tied` / `contest.tied` | `true` when the contest ended in a tie |
| Contest attempt number | `activity.attempt` | How many attempts were made (rerolls on ties) |
| Initiator / defender roll total | `contest.initiator.total` / `contest.defender.total` | Total rolled by each side |
| Initiator / defender actor UUID | `contest.initiator.actorUuid` / `contest.defender.actorUuid` | The actor on each side |
| Initiator / defender token UUID | `contest.initiator.tokenUuid` / `contest.defender.tokenUuid` | The token on each side |

**Macro return** — `sc-macro` activities:

| Label | Path | Meaning |
| --- | --- | --- |
| Macro returned value | `value` / `macro.value` | The JSON-compatible value explicitly returned by the macro |
| Macro returned a value | `macro.returned` | `true` when the macro used an explicit return value |

World and inline macros may return a number, boolean, string, array, or plain object. For example,
`return 3;` can be routed with `value = 1`, `value = 2`, and so on. Existing macros that return nothing
continue to work as before.

### Example: Branch On Whether An Attack Hits, Then On Damage Dealt

Item setup: an `attack` activity, a `damage` activity, and an `sc-conditional-chain` activity.

1. **Step 1** — Activity: the attack. Decide by **Last activity result**, condition `Attack hit` `=` `true`.
   *When true* → Step 2. *When false* → End flow.
2. **Step 2** — Activity: the damage. Decide by **Last activity result**, condition
   `Roll total (all rolls)` `≥` `10`. Route each outcome to further steps (extra effects, sounds, macros…).

Each step evaluates the result of **its own** child activity, so the damage comparison in Step 2 reads the
damage activity's rolls, not the attack roll.

### Reusing The Previous Result In Formulas (`@scLast`)

Activities started by a chain step can reference the **previous step's result** inside their own roll
formulas through the `@scLast` prefix. Every path from the result dropdown is available — for example
`@scLast.roll.sum`, `@scLast.total`, `@scLast.attack.total`, `@scLast.roll.dice.max`.

Example — *heal yourself for the damage you just dealt* (vampiric strike):

1. **Step 1** — Activity: the attack. Condition `Attack hit` `=` `true`. *When true* → Step 2.
2. **Step 2** — Activity: the damage. Condition: Always continue → Step 3.
3. **Step 3** — Activity: a `heal` activity whose healing formula is `@scLast.roll.sum`.
   It heals exactly the total rolled by the damage activity in Step 2.

`@scLast` also works in the chain's own formula fields: the condition **value** field, the roll check
**DC** field, and **custom roll formulas** (e.g. DC `10 + @scLast.roll.dice.count`).

#### Use The Previous Result As A Roll DC

A step configured with **Decide the next step by → Roll** can calculate its **DC** from the most recent
activity result. Enter the formula directly in the DC field even though the field initially displays a
number such as `15`.

Common DC formulas:

| Previous activity result | DC formula |
| --- | --- |
| First roll total | `@scLast.roll.total` |
| Sum of all rolls | `@scLast.roll.sum` |
| Value returned by an SC Macro | `@scLast.macro.value` |
| Previous result plus a fixed modifier | `@scLast.roll.sum + 5` |
| Macro return plus a fixed base | `10 + @scLast.macro.value` |

Example — *use a macro return as the next roll's DC*:

1. **Step 1** runs an `sc-macro` activity whose world or inline macro explicitly returns a number, such
   as `return 12;`. Route it to Step 2.
2. **Step 2** uses no child activity and selects **Roll** as its condition type.
3. Set Step 2's **DC** to `@scLast.macro.value`. The roll uses DC 12.
4. Configure the **On success** and **On failure** routes normally.

The macro must return a numeric value for a numeric DC. Use the explicit path
`@scLast.macro.value` rather than a bare `@scLast` so the source of the DC remains clear.

Notes:

- `@scLast` reflects the result of the **most recent step that ran an activity** — decision-only steps do
  not change it.
- For formula use, booleans become `1`/`0` and missing values become `0`, so `@scLast.success` can be used
  directly in arithmetic.
- A bare `@scLast` (no path) resolves to the main numeric value of the previous result (`roll.sum`,
  falling back to `roll.total`, `total`, then a macro return) — but prefer the explicit path for clarity.
- The first step of a flow has no previous result, so `@scLast` is not available there.
- It also works with plain `sc-chain` steps, and applies to attack, damage, and heal rolls of the child
  activity.

`@scLast` is a typed formula reference — it does not appear as a dropdown option. To find the right path,
pick the result in the **Last activity result** dropdown of any step: the hint shows the technical path
(e.g. `roll.sum`), and that is what you prefix with `@scLast.`.

### Rules, Policies, And Limitations

Execution rules:

- Each step runs **at most once** per flow execution; a route that revisits a step stops the flow with a
  loop warning. Pointing two *different* steps at the same activity is allowed (e.g. attacking again).
- Steps that run rolling activities (`damage`, `heal`, `attack`…) **wait for the roll** before routing —
  including rolls made from the chat card button. Roll the damage/healing from the flow's prompt, not a
  second time from the card, or you will apply it twice.
- Invalid configuration (missing routes, unknown steps…) blocks execution entirely; the sheet lists the
  issues to fix at the top of the Effect tab.

Flow policies (collapsible tray at the bottom of the sheet):

- **Depth limit** — maximum nested chain depth before execution is blocked (shared with `sc-chain`).
- **Stop when a child activity is canceled** — end the flow when a step's activity is closed without a
  result. When off, the flow keeps routing (the last result is not updated).
- **Continue after child errors** — keep routing when a step's activity is missing or throws.
- Each step can **suppress its activity card** while preserving roll messages and the conditional chain's
  own card. The plain `sc-chain` provides one global option for all of its child activities.

Limitations:

- An `attack` activity only reports its **attack roll**. Damage rolled later from the attack's chat card
  happens after the flow has already routed, so it is never captured — put the damage in a separate
  `damage` activity step and read `roll.sum` there.
- Results only flow between steps of the same execution. Once the flow ends, the result is gone — a later
  use starts fresh.

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
