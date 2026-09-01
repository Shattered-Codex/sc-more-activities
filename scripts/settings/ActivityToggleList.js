import { Constants } from "../constants/Constants.js";

const DEFAULT_ICON = "fa-solid fa-puzzle-piece";

export const ACTIVITY_GROUP_BY = Object.freeze({
  CATEGORY: "category",
  MODULE: "module"
});

const GROUP_BY_VALUES = Object.freeze(Object.values(ACTIVITY_GROUP_BY));

/**
 * Categories the settings list leaves out. `legacy` types exist only so items
 * saved before a rewrite keep working; they are not something a GM sets up a
 * world with, and listing them buries the types that are. They stay registered
 * and keep whatever state they had — hidden, not disabled — and the Activity
 * Catalog still shows and toggles them.
 */
const HIDDEN_CATEGORIES = Object.freeze(["legacy"]);

function defaultModuleTitle(moduleId) {
  return globalThis.game?.modules?.get?.(moduleId)?.title ?? moduleId;
}

/**
 * Turns the activity registry into the on/off rows the settings window shows,
 * grouped by category.
 *
 * The Activity Catalog stays the place to diagnose a registration that went
 * wrong; this is only the part a GM actually configures — which activity types
 * this world offers. Both read the same registry, so a type disabled here is
 * the one the catalog reports as disabled.
 */
export class ActivityToggleList {
  /**
   * A type can only be switched once it reached `dnd5e`. One that never
   * flushed, or that the registry reports unavailable, is shown read-only:
   * disabling it would write a preference for something that cannot run.
   */
  static canToggle(status, availabilityEntry, isGM) {
    return isGM === true
      && status === "flushed"
      && availabilityEntry?.unavailable !== true;
  }

  static #state(status, availabilityEntry) {
    if (status !== "flushed" || availabilityEntry?.unavailable === true) {
      return "unavailable";
    }
    return availabilityEntry?.enabled === false ? "disabled" : "active";
  }

  /** Normalizes a stored or submitted grouping to one this list can render. */
  static normalizeGroupBy(value) {
    return GROUP_BY_VALUES.includes(value) ? value : ACTIVITY_GROUP_BY.CATEGORY;
  }

  static groupByValues() {
    return GROUP_BY_VALUES;
  }

  /**
   * Pure: everything it needs is passed in, so the grouping and the toggle
   * rules can be tested without a live registry.
   */
  static groups({
    types = [],
    availability = [],
    flushed = [],
    warnings = [],
    isGM = false,
    groupBy = ACTIVITY_GROUP_BY.CATEGORY,
    overrides = {},
    moduleTitle = defaultModuleTitle,
    ownModuleId = Constants.MODULE_ID,
    hiddenCategories = HIDDEN_CATEGORIES
  } = {}) {
    const grouping = ActivityToggleList.normalizeGroupBy(groupBy);
    const flushedTypes = new Set(
      Array.from(flushed).map((entry) => entry?.type).filter(Boolean)
    );
    const availabilityByType = new Map(
      Array.from(availability).filter((entry) => entry?.type).map((entry) => [entry.type, entry])
    );
    const warningsByType = new Map();
    for (const warning of Array.from(warnings)) {
      if (warning?.type) {
        warningsByType.set(warning.type, (warningsByType.get(warning.type) ?? 0) + 1);
      }
    }

    const byCategory = new Map();
    for (const entry of Array.from(types)) {
      if (!entry?.type || ActivityToggleList.isHidden(entry, hiddenCategories)) {
        continue;
      }

      const status = flushedTypes.has(entry.type) ? "flushed" : "registered";
      const availabilityEntry = availabilityByType.get(entry.type);
      const state = ActivityToggleList.#state(status, availabilityEntry);
      const moduleId = entry.moduleId ?? "";
      const label = ActivityToggleList.#label(entry.label, entry.type);
      const icon = entry.icon ?? DEFAULT_ICON;
      // An override is an edit the user has made but not saved; it survives a
      // regroup, which re-renders the whole list.
      const enabled = Object.hasOwn(overrides, entry.type)
        ? ActivityToggleList.#truthy(overrides[entry.type])
        : state === "active";

      const warningCount = warningsByType.get(entry.type) ?? 0;
      const row = {
        type: entry.type,
        label,
        hint: ActivityToggleList.#label(entry.hint, ""),
        moduleId,
        icon,
        iconIsPath: ActivityToggleList.#isIconPath(icon),
        enabled,
        state,
        stateLabel: ActivityToggleList.#stateLabel(state),
        stateHint: ActivityToggleList.#stateHint(state),
        canToggle: ActivityToggleList.canToggle(status, availabilityEntry, isGM),
        warningCount,
        hasWarnings: warningCount > 0,
        // Lower-cased once here so filtering never re-derives it per keystroke.
        searchText: [entry.type, label, moduleId, entry.category ?? "", ActivityToggleList.#label(entry.hint, "")]
          .filter(Boolean).join(" ").toLowerCase(),
        actionLabel: enabled
          ? Constants.format("SCMOREACTIVITIES.Catalog.Availability.Disable", { label }, `Disable ${label}`)
          : Constants.format("SCMOREACTIVITIES.Catalog.Availability.Enable", { label }, `Enable ${label}`)
      };

      const key = grouping === ACTIVITY_GROUP_BY.MODULE
        ? (moduleId || ActivityToggleList.#unknownModuleKey())
        : (entry.category ?? "uncategorized");

      if (!byCategory.has(key)) {
        byCategory.set(key, []);
      }
      byCategory.get(key).push(row);
    }

    const language = globalThis.game?.i18n?.lang;
    return Array.from(byCategory.entries())
      .map(([key, rows]) => ({
        category: key,
        categoryLabel: grouping === ACTIVITY_GROUP_BY.MODULE
          ? ActivityToggleList.#moduleLabel(key, moduleTitle)
          : ActivityToggleList.#titleCase(key),
        isOwnModule: grouping === ACTIVITY_GROUP_BY.MODULE && key === ownModuleId,
        enabledCount: rows.filter((row) => row.enabled).length,
        total: rows.length,
        rows: rows.sort((left, right) => left.label.localeCompare(right.label, language))
      }))
      // Grouped by module, this module's own types lead: they are what a GM
      // came to change, and everything else is a third-party addition.
      .sort((left, right) => (Number(right.isOwnModule) - Number(left.isOwnModule))
        || left.categoryLabel.localeCompare(right.categoryLabel, language));
  }

  static hiddenCategories() {
    return HIDDEN_CATEGORIES;
  }

  static isHidden(entry, hiddenCategories = HIDDEN_CATEGORIES) {
    return hiddenCategories.includes(entry?.category ?? "");
  }

  /** How many registered types the list is leaving out, so it can say so. */
  static hiddenCount(types = [], hiddenCategories = HIDDEN_CATEGORIES) {
    return Array.from(types)
      .filter((entry) => entry?.type && ActivityToggleList.isHidden(entry, hiddenCategories))
      .length;
  }

  /** Flattens the grouped rows back into a single list. */
  static rows(groups = []) {
    return groups.flatMap((group) => group.rows ?? []);
  }

  /**
   * Reads the live registry once and returns everything the tab renders: the
   * grouped rows, how many types were hidden, and the registration problems.
   */
  static read({ isGM = globalThis.game?.user?.isGM === true, groupBy = ACTIVITY_GROUP_BY.CATEGORY, overrides = {} } = {}) {
    const activities = globalThis.game?.modules?.get?.(Constants.MODULE_ID)?.api?.activities ?? null;
    const report = activities?.getRegistrationReport?.() ?? {};
    const types = activities?.listTypes?.() ?? [];

    return {
      groups: ActivityToggleList.groups({
        types,
        availability: activities?.listTypeAvailability?.() ?? [],
        flushed: report?.flushed ?? [],
        warnings: report?.warnings ?? [],
        isGM,
        groupBy,
        overrides
      }),
      hiddenCount: ActivityToggleList.hiddenCount(types),
      issues: ActivityToggleList.issues({ warnings: report?.warnings ?? [], rejected: report?.rejected ?? [] })
    };
  }

  /**
   * The registration problems worth surfacing next to the toggles. The detail
   * stays in the Activity Catalog; this is only the signal that says to go look.
   */
  static issues({ warnings = [], rejected = [] } = {}) {
    const warningCount = Array.from(warnings).length;
    const rejectedCount = Array.from(rejected).length;
    return {
      warningCount,
      rejectedCount,
      hasIssues: warningCount > 0 || rejectedCount > 0
    };
  }


  /** A stable string for the toggles, so the tab can show a dirty marker. */
  static snapshot(groups = [], values = {}) {
    return JSON.stringify(
      ActivityToggleList.rows(groups)
        .map((row) => [row.type, ActivityToggleList.#submitted(row, values)])
        .sort(([left], [right]) => String(left).localeCompare(String(right)))
    );
  }

  /**
   * Merges the submitted toggles into the stored disabled map rather than
   * replacing it: a type belonging to a module that is currently off has no row
   * here, and its stored preference must survive a save.
   */
  static mergeDisabledMap(current = {}, groups = [], values = {}) {
    const next = { ...(current && typeof current === "object" ? current : {}) };
    for (const row of ActivityToggleList.rows(groups)) {
      if (!row.canToggle) {
        continue;
      }
      if (ActivityToggleList.#submitted(row, values)) {
        delete next[row.type];
      } else {
        next[row.type] = true;
      }
    }
    return next;
  }

  static #submitted(row, values) {
    const raw = values?.[row.type];
    if (raw === undefined || raw === null) {
      return row.enabled;
    }
    return ActivityToggleList.#truthy(raw);
  }

  static #truthy(raw) {
    return typeof raw === "string" ? (raw === "true" || raw === "on") : Boolean(raw);
  }

  static #unknownModuleKey() {
    return "__unknown__";
  }

  static #moduleLabel(key, moduleTitle) {
    if (key === ActivityToggleList.#unknownModuleKey()) {
      return Constants.localize("SCMOREACTIVITIES.Settings.Window.Sections.Activities.UnknownModule", "Unknown module");
    }
    return moduleTitle?.(key) ?? key;
  }

  static #label(keyOrText, fallback) {
    if (!keyOrText) {
      return fallback ?? "";
    }
    return Constants.localize(keyOrText, keyOrText);
  }

  static #stateLabel(state) {
    const labels = {
      active: Constants.localize("SCMOREACTIVITIES.Catalog.Availability.Active", "Active"),
      disabled: Constants.localize("SCMOREACTIVITIES.Catalog.Availability.Disabled", "Disabled"),
      unavailable: Constants.localize("SCMOREACTIVITIES.Catalog.Availability.Unavailable", "Unavailable")
    };
    return labels[state] ?? state;
  }

  static #stateHint(state) {
    const hints = {
      active: Constants.localize(
        "SCMOREACTIVITIES.Catalog.Availability.ActiveHint",
        "Available for activity creation and use."
      ),
      disabled: Constants.localize(
        "SCMOREACTIVITIES.Catalog.Availability.DisabledHint",
        "Blocked from activity creation and use."
      ),
      unavailable: Constants.localize(
        "SCMOREACTIVITIES.Catalog.Availability.UnavailableHint",
        "Only D&D-ready activity types can be enabled or disabled."
      )
    };
    return hints[state] ?? "";
  }

  static #titleCase(value) {
    return String(value ?? "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  static #isIconPath(icon) {
    const value = String(icon ?? "");
    return value.includes("/") || /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(value);
  }
}
