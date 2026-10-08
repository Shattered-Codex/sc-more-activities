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
- Preview color settings for teleport, movement, wall, and portal overlays
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
- `sc-movement`: push or pull tokens, with an optional direction choice at use time and preview support
- `sc-wall`: create wall previews and GM-mediated wall placement
- `sc-portal`: open a linked pair of portals and ask tokens whether they want to cross

## Asset Credits

Some bundled activity icons are sourced from [game-icons.net](https://game-icons.net/),
currently using artwork by Delapouite and Lorc.
The portal activity uses [Magic Portal by Lorc](https://game-icons.net/1x1/lorc/magic-portal.html),
recolored to match the module palette.
Game-icons.net states that its icons are provided under the
[Creative Commons Attribution 3.0 license](https://creativecommons.org/licenses/by/3.0/),
which requires attribution to the original authors. See the
[Game-icons.net About page](https://game-icons.net/about.html) for license and author details.

## Main Features

- Supports **Foundry VTT v13 and v14**
- Supports **`dnd5e` 5.x and 6.0.x**
- Uses a module-owned registry instead of ad hoc activity injection
- Flushes accepted registrations into `dnd5e` during module initialization
- Exposes registration diagnostics so GMs can see what loaded, what failed, and why
- Lets GMs switch activity types on and off from a grouped list in module settings
- Lets players move and teleport tokens they do not own, under a world setting
- Opens a dedicated **Activity Catalog** from module settings
- Opens a dedicated **More Activities Migration** tool from module settings
- Gathers every module option into a dedicated **Module Settings** window
- Keeps wiki, Patreon, and Discord links in one row at the bottom of module settings
- Includes English and Brazilian Portuguese localization

## Requirements

- **Foundry VTT / System:** a supported pair:

  - Foundry v13 or v14 with `dnd5e` 5.x
  - Foundry v14.367+ with `dnd5e` 6.0.x
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

## Module Settings

Every option lives in one window instead of a flat list. Open
**Configure Settings → Module Settings → SC - More Activities → Open settings**.

The window uses a sidebar rail, one tab per area:

| Tab | Scope | Who can change it |
| --- | --- | --- |
| **Gameplay** | World | GM only |
| **Activities** | World | GM only |
| **Migration** | World | GM only |
| **Diagnostics** | Client | Every user, including players |

The **Activities** tab lists registered activity types with a switch per type.
A filter box narrows the list, and the rows group by **category** or by
**module** — the choice is stored per user. Types in the `legacy` category are
left out: they exist only so items saved before a rewrite keep working, and
listing them buries the types a GM actually sets a world up with. They stay
registered and keep whatever state they had, with a note giving the count; the
Activity Catalog still lists and toggles them.

Registration problems surface here too: a banner counts warnings and rejected
registrations with a shortcut to the catalog, and a warned type carries a badge
on its row. A type that never reached `dnd5e`, or that the
registry reports as unavailable, is shown read-only with a badge instead of a
switch — disabling it would record a preference for something that cannot run.
Saving writes the whole tab as a single world-settings update, and a preference
stored for a type that no installed module registers is preserved rather than
dropped.

A player who opens the window sees only **Diagnostics** — the world tabs are the
GM's, and a player's save never writes one.

An edited tab shows a dot on its rail entry and the footer shows **Unsaved
changes** until you press **Save Changes**; saving keeps the window open and the
pill turns to **Saved**. **Reset defaults** restores only the visible tab, and
since nothing is written until you save, it stays cancellable. The tabs are
keyboard navigable with the arrow keys, Home, and End.

The activity catalog, migration tools, and preview colors keep their own buttons
in the settings list. All four windows share the same shell — an icon rail, one
panel per section, and a fixed footer — so they read as one tool.

The **Preview colors** window puts the four scopes (teleport, movement, wall,
portal) on the rail, with the live sample overlay above the two color fields.
Editing a color updates the sample immediately; nothing is stored until you
save, and switching scopes keeps unsaved edits. The wiki, Patreon, and Discord links sit together in one
row at the bottom of the module's section.

### Players may move tokens they do not own

**Default: enabled.**

Push, pull, and teleport are normally aimed at enemies, and a player never owns
an enemy token. With this setting on, a player using a movement or teleport
activity can move a target regardless of who owns it, instead of being stopped
by *"You do not have permission to move one or more selected tokens."*

Turning it off restores the stricter rule: a player may only move tokens they
own, and anything else has to go through the GM.

The setting only lifts the ownership requirement on the *moved* token. Every
other guard stays in place, on the GM's client, where the move actually runs:

- the player must own the actor or item that carries the activity
- the origin token must belong to that activity's actor
- the activity's own range, distance, target count, and shape are re-validated
  at execution time, not trusted from the request
- destinations are clamped to the scene bounds

Portals are not covered: a portal still moves only tokens the traveller owns.

### Other options in the window

- **Result chat cards** — post a summary card of who moved, resisted, or fell out of range
- **Migration** — compendium scope, external pack scanning, pack unlocking, and backup retention
- **Debug logging** — per-browser console logging, available to players too

## Activity Catalog

The Activity Catalog is the GM's diagnostic tool, available from module
settings. It is where you look when a registration went wrong: what loaded, what
was rejected, and why.

The everyday job of switching activity types on and off is easier from the
settings window's **Activities** tab, which groups them by category. The
catalog's table keeps its own inline switch, writing the same world setting, for
when you are already looking at a row's module, scope, and warning count.

It shares the settings window's shell — the same rail, panels, and footer — with
one tab per concern:

| Tab | What it answers |
| --- | --- |
| **Registered** | Every type that reached the registry, with its module, status, and availability switch |
| **Rejected** | What the registry refused, and why |
| **Warnings** | Registrations that went through with something worth knowing |
| **Diagnostics** | Lifecycle state, API version, capabilities, and registry counters |

The filter strip (search, category, status, availability) applies to the three
table tabs and hides itself on Diagnostics. The footer carries **Copy report**,
which puts the full registration report on the clipboard for a bug thread.

## Template Origin In A Chain

A chain step whose activity has an area can borrow the landing point of an
earlier step instead of asking for a second click. Pick that step under
**Template origin**; leaving it on *Place it as usual* keeps the system's own
interactive placement.

The field only appears where it can do something. The step's own area must be
**orientation free** — a circle, sphere or cylinder, or a cube while square
templates are grid aligned. A cone, a line, or a rotatable cube keeps the
system's interactive placement, because skipping it would take the aiming away
from the player and pin the shape to a default direction.

Some earlier step must also run an activity that produces a landing point.
Today that means a teleport — the list of providers is one constant, so a
future activity that lands somewhere joins it there. Only steps declared
*before* the one being configured are offered: a later step cannot have run
when the point is needed.

If the placement fails, the step says so, since the interactive placement it
replaced is already gone.

Any earlier step can be referenced, not only the one immediately before, so a
flow can teleport, branch through several steps, and still drop an area on the
original landing point.

The point comes from the step's result — today the teleport publishes one as
`activity.destination`, which is also readable from a step condition. When the
referenced step produced no point (it was cancelled, or it was a damage roll),
the step falls back to the usual placement rather than dropping the template.

The shape itself is still built by the system, so every rule about sizes and
dimensions is the system's; only the centre is supplied.

## Canvas Activities In A Chain

The canvas activities — teleport, movement, wall, portal — finish in a placement
window that opens after `use()` has already returned. In a chain that used to
mean the next step ran while the window was still on screen, and ran even if the
placement was cancelled.

They now hold their usage open until the window ends the flow:

- placing confirms the step, and the chain resumes with the result
- closing or cancelling the window reports a cancellation, which a chain with
  **stop on cancel** honours
- bailing out before the window opens at all — no token on the scene — also
  reports a cancellation rather than leaving the chain waiting forever

Teleport hands off between two windows (targets, then destination); the hand-off
transfers the responsibility, so closing the first window on the way to the
second is not read as a cancellation.

This only applies to a tracked usage, which is what a chain creates. Clicking an
activity directly is unaffected.

## Target Size Rule

`sc-movement` can restrict which token sizes it may move. The rule sits on the
activity, under **Target size rule**, in one of three modes:

| Mode | What it does |
| --- | --- |
| **Any size** | No restriction (the default) |
| **Specific sizes** | Only the checked sizes — tiny, small, medium, large, huge, gargantuan |
| **Relative to the origin** | A span of size steps from the activity's own token: `-1` to `+1` allows one step smaller through one step larger, `-5` to `-1` allows only smaller targets |

A target outside the rule is marked **Wrong size** in the movement preview and
is not moved. If no selected token passes, the activity cannot be used and says
why. Like range, the rule is re-checked on the GM's client at execution time, so
it holds even against a forged request.

Two deliberately permissive edges, matching how `0` means unlimited elsewhere in
this module: a token whose size cannot be read (no actor) always passes, and
**Specific sizes** with nothing checked is treated as unconfigured rather than
as a ban on everything.

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
| Roll | Rolls an ability check, saving throw, skill check, or custom formula; routes by success/failure or by the rolled total | On success / failure or first matching value / fallback |
| Manual choice | Opens a dialog and lets the user pick the route | One per option |

Canceling a roll or a manual choice always ends the flow.

For a random multi-route outcome, configure **Roll** with a custom formula such as `1d3`, choose routing by
**Rolled total**, then add `= 1`, `= 2`, and `= 3` value paths. The same roll selects the first matching
path, so no helper macro is required. Existing roll steps continue to use **Success / failure** by default
and retain their DC-based behavior.

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
- **Suppress child activity cards** — skip usage cards for activities executed by the flow while preserving
  roll messages and the conditional chain's own card. The same option is available on `sc-chain`.

Limitations:

- An `attack` activity only reports its **attack roll**. Damage rolled later from the attack's chat card
  happens after the flow has already routed, so it is never captured — put the damage in a separate
  `damage` activity step and read `roll.sum` there.
- Results only flow between steps of the same execution. Once the flow ends, the result is gone — a later
  use starts fresh.

## SC Portal Guide

`sc-portal` opens a linked pair of portals on the scene. Clicking a side with a controlled token standing
on it, or next to it, asks whether that token wants to cross to the other side.

### Placing A Portal

Using the activity opens the placement application. The first click places the entry side, the second
places the exit side, and right click stops placing. Both sides are validated against **Placement
range** measured from the acting token, and optionally against **Maximum distance between sides**.
Both fields accept roll formulas.

While you place, the window minimizes out of the way and comes back once both sides are down or you stop
placing. The canvas preview names each side *Entry* or *Exit*, colors the side under the cursor the way
the next click will place it, and draws an arrow from the entry to the exit.

**Area** sets each side's footprint in grid squares, from 1×1 to 4×4. An even footprint snaps to a grid
corner rather than a cell center, so a 2×2 portal covers four whole cells instead of straddling eight.

Each side becomes a scene `Region`, so the portal is visible on the canvas, respects the **Visible to**
setting, and can be deleted by the GM from the Regions layer at any time. Setting **Visible to** to
*Hidden (art only)* draws nothing during play, which is what you want once the portal has its own art;
clicks still find the portal, and the GM can still see and delete it on the Regions layer. Deleting one
side closes the other. When entry or exit art is configured, a matching `Tile` is placed over the side
and removed with it. The art can be an image or a video (`webm`, `mp4`, `ogv`); video plays looped and
muted, which is what an animated portal usually wants.

### Crossing

A token travels by clicking: click a portal while controlling a token standing on it, or next to
it, and a dialog asks whether the token steps through. With nothing selected, the character you
play is used, and failing that the single token you own that is standing in the portal.

The token itself is always moved by the GM client, like every other canvas activity in this module; a
player's click sends the request to the active GM. A question still open when the same token is asked
again is closed and asked afresh, so a stale answer can never send a token through a portal it has since
walked away from.

Walking across a portal asks nothing and never interrupts the movement: the portal is a place to click,
not a trap.

### Grid, Snapping, And Occupied Spaces

**Snap to grid** aligns both sides and the arriving token to the grid. On a scene without a grid there
is nothing to snap to, so the setting is ignored and the portal is placed exactly where you click; the
placement application says so when that happens.

**Avoid occupied spaces** looks for a free space near the destination instead of dropping the token on
top of another one, searching outwards a few cells at a time. When everything nearby is taken the
crossing is refused rather than stacking tokens.

### Closing A Portal

A portal closes when any of these happens:

- the configured number of crossings is spent;
- the duration runs out;
- the GM presses **Close portal** on the whispered chat card;
- the GM deletes either side from the Regions layer.

**Duration in rounds** is counted in combat rounds while the combat that opened the portal is running,
and as the same amount of world time outside combat, so a portal opened out of initiative still
expires. A duration of `0` keeps the portal open until it is closed.

## Migration From `more-activities`

The migration window shares the settings shell — rail, panels, footer — with one
tab per stage: **Overview** (latest backup, preview warnings, backups on file),
**Preview** (what a migration would change, before anything is written),
**Apply** (what the last run changed), and **Backups** (snapshots and the last
restore). The action buttons moved to the footer, and the progress bar sits
above the panels so it stays visible whichever tab is open.


This module includes explicit migration tools for the legacy `more-activities` module.

- Run a **preview** first to see what can be converted
- Apply the migration only after reviewing the results
- Restore the latest backup if needed
- Export preview and report data for review

### What Gets Scanned

The preview walks, in this order:

1. world items in the Items sidebar
2. items owned by world actors
3. world compendium packs (`Item` and `Actor` packs)

System and module compendiums are **not** scanned by default, because those packs are
usually overwritten when the system or module updates. The preview reports how many were
skipped so an empty result is never ambiguous.

Three world settings control the scope:

| Setting | Default | Effect |
| --- | --- | --- |
| Scan compendiums during migration | on | Include world compendium packs in preview and apply |
| Include system and module compendiums | off | Also scan packs owned by the system or other modules |
| Unlock locked compendiums during migration | on | Temporarily unlock locked packs while applying or restoring, then re-lock them |

If automatic unlocking is disabled, entries inside locked packs are reported as
`pack-locked` failures instead of being written. Only packs that hold at least one
**convertible** activity are unlocked, so a locked pack whose legacy activities are all
blocked is left untouched and is not reported as a failure.

### Incomplete Scope And Lock Failures

Two things can leave a run partially done, and both are reported instead of only logged:

- **a pack that cannot be read.** `getDocuments()` failures are collected into
  `preview.failedPacks` and `preview.completeScope` becomes `false`. The preview adds a
  visible warning, the tool shows a "Packs unreadable" chip, and **Apply migration** asks
  for confirmation before migrating a scope that may be missing entries. The API refuses
  the apply unless `allowIncompleteScope: true` is passed.
- **a pack that cannot be re-locked.** Packs unlocked for the run are re-locked in a
  `finally` block; anything that stays editable lands in `report.failedRelocks` and raises
  a permanent error notification listing the packs that need a manual re-lock.

### How Legacy Chains Are Converted

The legacy `chain` activity is not always linear. Whenever a step carries entries in
`chainTriggers`, the legacy runtime stops after that step, posts the trigger buttons on the
chat card, and resumes on the steps whose `chainListeners` match — a branching graph.

The migration picks the target type from the data:

| Legacy chain | Target | Why |
| --- | --- | --- |
| no activity ids | blocked (`empty-legacy-chain`) | Nothing to run and nothing to branch on |
| only blank labels on a trigger that could fire | blocked (`blank-legacy-trigger`) | The chain waited on a button, so `sc-chain` would run the steps behind it on its own, and there is no label to put on a prompt |
| no triggers that could fire | `sc-chain` | A plain sequence; the simpler activity and sheet fit it |
| any trigger that could fire | `sc-conditional-chain` | `sc-chain` is strictly linear and cannot represent branches |

"A trigger that could fire" is the legacy runtime's own rule. `executeChainedActivity` looked
the step's activity up first and returned when it did not resolve, and the trigger buttons
were guarded on `index < chainedActivityIds.length - 1`. So a trigger only ever appeared when
its step had an activity id **and** was not the last one. Triggers anywhere else — on a blank
step, on the last step, or past the end of the chain — never fired, do not make a chain
branch, and are preserved under migration flags instead of becoming a choice step. This
matters beyond tidiness: turning a dead trigger into a choice would make the steps behind it
executable for the first time.

**A chain without triggers gains steps it never ran.** The legacy runtime executed
`executeChainedActivity(0)` and returned — a chain with no triggers only ever fired its
**first** step, whatever the sheet listed, and fired nothing at all when that first step had
no activity id. `sc-chain` runs the whole sequence, which is what the legacy sheet always
implied but never did. The migration keeps every step (dropping them would look like data
loss) and reports the change: the conversion is marked lossy, the preview warns that damage,
consumption, and effects on the later steps will now fire, and the skipped ids are recorded
under `unexecutedLegacySteps` in the migration flags. Review those steps before applying.

For a branching chain, each legacy step becomes a flow node (`node-0`, `node-1`, …) and a
step whose triggers could fire becomes a `choice` node whose choices route to the steps that
listened to that trigger. Only steps the chain actually declares get a node, so a listener
recorded past the end of the chain is never routed to — a route to a node that does not exist
would fail `validateFlow` with `unknown-route` and block the whole chain at runtime.

A step **without** triggers ends the flow. The legacy runtime never advanced on its own: it
ran one step and returned, and only a trigger button resumed the chain. Routing such a step
to `node-index + 1` would run the opposite branch — picking "Hit" on a `Hit / Miss` chain
would fire the "On miss" step right after it.

These stay lossy and are reported as preview warnings, with the legacy data kept under
`flags.sc-more-activities.migration.unmapped`:

| What | Flag key |
| --- | --- |
| branch buttons rendered **on the chat card**; `sc-conditional-chain` asks in a **dialog** | — |
| several steps listened to the same trigger, so the legacy module opened a branch picker; a choice route resolves to exactly one node, so the first wins | `droppedBranches` |
| steps no branch can reach, kept as flow steps so nothing is lost | `unreachableSteps` |
| triggers on a step with no activity id, which the runtime never got past | `ignoredEmptyStepTriggers` |
| triggers on the last step, which the runtime never offered | `ignoredLastStepTriggers` |
| triggers stored past the end of the chain | `trailingTriggers` |
| a trigger label repeated on one step: `continueChainFrom` resolved every button with that label to the first occurrence, so the repeats never fired | `duplicateTriggers` |
| a trigger whose label was cleared, which cannot become a choice the player picks | `blankTriggers` |
| listeners pointing past the end of the chain | `outOfRangeListeners` |
| listeners keyed to a trigger no choice offers — an ignored trigger, a repeated label, or a key no trigger ever had | `unconsumedListeners` |

On the `sc-chain` path the equivalents are `unexecutedLegacySteps` plus the raw
`chainTriggers` and `chainListeners` matrices.

### Migration API

`api.migration` is part of the public v1 API.

```js
const migration = game.modules.get("sc-more-activities")?.api?.migration;
```

| Method | Signature | Returns | GM only |
| --- | --- | --- | --- |
| `previewMoreActivitiesMigration` | `({ onProgress } = {})` | frozen preview report | yes |
| `migrateMoreActivities` | `({ preview, onProgress, allowIncompleteScope } = {})` | frozen apply report | yes |
| `restoreMoreActivitiesMigrationBackup` | `({ backupId, onProgress } = {})` | frozen restore report | yes |
| `listMoreActivitiesMigrationBackups` | `()` | frozen array of stored backups | yes |
| `exportMoreActivitiesMigrationReport` | `(report)` | filename it saved or copied | no |

Everything that reads world data or writes to it throws for non-GM users.
`exportMoreActivitiesMigrationReport` is the exception: it only serializes the object it is
handed, so it reads nothing and needs no permission check.

`onProgress` is optional on all three long-running calls. It is called synchronously with a
plain payload and a throwing callback is caught and logged, never propagated:

```js
const preview = await migration.previewMoreActivitiesMigration({
  onProgress: ({ phase, current, total, detail }) => {
    console.log(`${phase}: ${current}/${total} ${detail}`);
  }
});
```

| Field | Type | Meaning |
| --- | --- | --- |
| `phase` | string | `world-items`, `actor-items`, `compendiums`, `done`, `apply`, `restore` |
| `current` | number | items, actors, or packs finished in this phase |
| `total` | number | total for this phase; `0` when nothing is in scope |
| `detail` | string | current item, actor, or pack label; `""` when there is none |

Phases differ in when they emit:

- `world-items` and `actor-items` emit **once per unit, after** it is inspected
  (`current: index + 1`)
- `compendiums`, `apply`, and `restore` emit **before** the unit (`current: index`) and again
  **after** it (`current: index + 1`), so a slow pack or item is visible while it is worked
  on; `compendiums` also emits progress inside a large pack, with `detail` carrying a
  `pack (i/N)` item counter while `current` stays on the pack
- `done` is emitted once as `1/1`, and only by the preview — apply and restore end on their
  last `apply`/`restore` payload and emit no terminal phase

Preview fields relevant to compendium scope:

| Field | Type | Meaning |
| --- | --- | --- |
| `includeCompendiums` / `includeExternalPacks` | boolean | the scope the run actually used |
| `scannedPacks` | number | packs read successfully |
| `scannedCompendiumItems` | number | items inspected inside packs |
| `compendiumItems` | number | pack items that carry legacy activities |
| `lockedPacks` | array | descriptors of locked packs holding legacy entries |
| `skippedExternalPacks` | array | system/module packs left out of scope |
| `failedPacks` | array | `{ id, label, documentName, locked, world, reason }` per unreadable pack |
| `completeScope` | boolean | `false` when any pack in scope failed to load |

Apply and restore reports add `unlockedPacks`, `failedUnlocks`, and `failedRelocks`; apply
also carries `incompleteScope` and `failedPacks`, copied from the preview it ran on.

`previewMoreActivitiesMigration` accepts no scope arguments — the compendium settings above
decide what is scanned. `MoreActivitiesMigrationAnalyzer#analyze` takes explicit
`includeCompendiums` / `includeExternalPacks` overrides, but that class is internal.

All of this is an additive change to the v1 API: existing calls that pass only `preview`, or
that ignore the new report fields, keep working.

Important:

- migration is **GM only**
- migration does **not** auto-run — nothing is scanned until the GM presses **Run preview**
- blocked or partially compatible legacy activities may require manual cleanup after conversion
- if the legacy module is still enabled, keep it active only while reviewing or migrating
- legacy activities remain readable while the legacy module is disabled: they stop rendering
  on the sheet because the type is no longer registered, but the stored data is intact and
  the preview still finds it
- enable **Debug logging** for a per-item, per-pack breakdown in the console; a one-line
  summary of every preview, apply, and restore is always logged

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
      dnd5e: ">=5.0.0 <7.0.0",
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
- `migration` (see [Migration API](#migration-api))

### Decorating SC Wall Documents

External modules can decorate the raw Wall creation data produced by an `sc-wall` activity with the
public `sc-more-activities.prepareWallDocuments` hook. The hook runs on the executing GM after SC More
Activities validates the request and immediately before `Scene#createEmbeddedDocuments("Wall", ...)`.
It covers both target-based wall creation and walls drawn through the placement application.

```js
Hooks.on("sc-more-activities.prepareWallDocuments", ({ activity, scene, user, walls }) => {
  for (const wall of walls) {
    wall.flags ??= {};
    wall.flags["my-module"] = { decorated: true };
  }
});
```

The listener must be synchronous. Decorate only module-owned metadata such as `flags` on the existing
objects in `walls`; do not add or remove entries, change coordinates or other structural Wall fields,
replace the array, create Wall documents yourself, or rely on a returned value. Structural fields have
already passed GM-side validation when this hook runs. The payload also exposes the validated activity,
target scene, and requesting user for context. The hook name is available from
`game.modules.get("sc-more-activities")?.api?.hooks?.PREPARE_WALL_DOCUMENTS` after API publication.

When the activity's **Appearance** settings ask for a visible line or a wall image, the style is stored
on each wall as `flags["sc-more-activities"].visual` (`group`, `index`, `line`, `tile`) before this hook
runs. The visuals are Drawings and Tiles flagged
`{ source: "sc-wall-companion", group, wallIds, activityUuid }`, and they are always rebuilt from the
walls of their group that still exist: creating, moving or deleting part of a wall, or undoing that
deletion, redraws them to match. Pasted copies of those walls move to a group of their own. Manual edits to those Drawings and Tiles are replaced on the next
redraw.

The registry is collected during `init`, then locked before normal play. Late registrations are rejected with a structured failure result instead of silently patching `dnd5e`.

Real example:

- `sc-simple-sockets` registers `sc-socket-slot` and `sc-socket-extraction` through this hook with `ui.scope: "external"` and `ui.groupId: "sc-simple-sockets"`
