import { Constants } from "../constants/Constants.js";
import { SETTINGS_KEYS } from "../constants/SettingsKeys.js";
import { ACTIVITY_GROUP_BY } from "./ActivityToggleList.js";

export const SETTING_FIELD_TYPES = Object.freeze({
  CHECKBOX: "checkbox",
  NUMBER: "number"
});

export const SECTION_KINDS = Object.freeze({
  FIELDS: "fields",
  ACTIVITIES: "activities"
});

export const SETTING_SCOPES = Object.freeze({
  WORLD: "world",
  CLIENT: "client"
});

/**
 * Every setting the module shows in its own settings window, grouped the way
 * the window renders them.
 *
 * This is the single source of truth for the two consumers that would
 * otherwise drift apart: the registrar, which turns each entry into a Foundry
 * setting registration, and the window, which renders and writes them back.
 */
const SECTIONS = Object.freeze([
  Object.freeze({
    id: "gameplay",
    scope: SETTING_SCOPES.WORLD,
    icon: "fa-solid fa-dice-d20",
    titleKey: "SCMOREACTIVITIES.Settings.Window.Sections.Gameplay.Title",
    titleFallback: "Gameplay",
    hintKey: "SCMOREACTIVITIES.Settings.Window.Sections.Gameplay.Hint",
    hintFallback: "How activities behave at the table, for every user in this world.",
    fields: Object.freeze([
      Object.freeze({
        key: SETTINGS_KEYS.ALLOW_PLAYER_TOKEN_MOVEMENT,
        type: SETTING_FIELD_TYPES.CHECKBOX,
        scope: SETTING_SCOPES.WORLD,
        default: true,
        nameKey: "SCMOREACTIVITIES.Settings.AllowPlayerTokenMovement.Name",
        nameFallback: "Players may move tokens they do not own",
        hintKey: "SCMOREACTIVITIES.Settings.AllowPlayerTokenMovement.Hint",
        hintFallback: "Let players push, pull, and teleport tokens they do not own with movement and teleport activities. The activity's own range, distance, and target limits still apply, and the GM client still executes every move. Turn this off to require token ownership."
      }),
      Object.freeze({
        key: SETTINGS_KEYS.CANVAS_RESULT_CARDS,
        type: SETTING_FIELD_TYPES.CHECKBOX,
        scope: SETTING_SCOPES.WORLD,
        default: true,
        nameKey: "SCMOREACTIVITIES.Settings.CanvasResultCards.Name",
        nameFallback: "Result chat cards",
        hintKey: "SCMOREACTIVITIES.Settings.CanvasResultCards.Hint",
        hintFallback: "Post a chat card summarizing who was moved or teleported, who resisted, and who was out of range."
      })
    ])
  }),
  Object.freeze({
    id: "activities",
    scope: SETTING_SCOPES.WORLD,
    kind: SECTION_KINDS.ACTIVITIES,
    icon: "fa-solid fa-wand-sparkles",
    titleKey: "SCMOREACTIVITIES.Settings.Window.Sections.Activities.Title",
    titleFallback: "Activities",
    hintKey: "SCMOREACTIVITIES.Settings.Window.Sections.Activities.Hint",
    hintFallback: "Turn activity types on or off for this world. A disabled type cannot be created or used until it is turned back on.",
    fields: Object.freeze([])
  }),
  Object.freeze({
    id: "migration",
    scope: SETTING_SCOPES.WORLD,
    icon: "fa-solid fa-arrows-rotate",
    titleKey: "SCMOREACTIVITIES.Settings.Window.Sections.Migration.Title",
    titleFallback: "Migration",
    hintKey: "SCMOREACTIVITIES.Settings.Window.Sections.Migration.Hint",
    hintFallback: "Scope and safety net for the legacy more-activities migration tools.",
    fields: Object.freeze([
      Object.freeze({
        key: SETTINGS_KEYS.MIGRATION_INCLUDE_COMPENDIUMS,
        type: SETTING_FIELD_TYPES.CHECKBOX,
        scope: SETTING_SCOPES.WORLD,
        default: true,
        nameKey: "SCMOREACTIVITIES.Settings.MigrationIncludeCompendiums.Name",
        nameFallback: "Scan compendiums during migration",
        hintKey: "SCMOREACTIVITIES.Settings.MigrationIncludeCompendiums.Hint",
        hintFallback: "Include world compendium packs when previewing and applying the legacy more-activities migration."
      }),
      Object.freeze({
        key: SETTINGS_KEYS.MIGRATION_INCLUDE_EXTERNAL_PACKS,
        type: SETTING_FIELD_TYPES.CHECKBOX,
        scope: SETTING_SCOPES.WORLD,
        default: false,
        nameKey: "SCMOREACTIVITIES.Settings.MigrationIncludeExternalPacks.Name",
        nameFallback: "Include system and module compendiums",
        hintKey: "SCMOREACTIVITIES.Settings.MigrationIncludeExternalPacks.Hint",
        hintFallback: "Also scan compendiums owned by the system or by other modules. Those packs are usually overwritten on update, so keep this off unless you know you need it."
      }),
      Object.freeze({
        key: SETTINGS_KEYS.MIGRATION_UNLOCK_PACKS,
        type: SETTING_FIELD_TYPES.CHECKBOX,
        scope: SETTING_SCOPES.WORLD,
        default: true,
        nameKey: "SCMOREACTIVITIES.Settings.MigrationUnlockPacks.Name",
        nameFallback: "Unlock locked compendiums during migration",
        hintKey: "SCMOREACTIVITIES.Settings.MigrationUnlockPacks.Hint",
        hintFallback: "Temporarily unlock locked compendiums while applying or restoring a migration, then re-lock them afterwards."
      }),
      Object.freeze({
        key: SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION,
        type: SETTING_FIELD_TYPES.NUMBER,
        scope: SETTING_SCOPES.WORLD,
        default: 3,
        min: 1,
        max: 10,
        step: 1,
        nameKey: "SCMOREACTIVITIES.Settings.MigrationBackupRetention.Name",
        nameFallback: "Migration backup retention",
        hintKey: "SCMOREACTIVITIES.Settings.MigrationBackupRetention.Hint",
        hintFallback: "How many more-activities migration backups to keep in world settings."
      })
    ])
  }),
  Object.freeze({
    id: "diagnostics",
    scope: SETTING_SCOPES.CLIENT,
    icon: "fa-solid fa-bug",
    titleKey: "SCMOREACTIVITIES.Settings.Window.Sections.Diagnostics.Title",
    titleFallback: "Diagnostics",
    hintKey: "SCMOREACTIVITIES.Settings.Window.Sections.Diagnostics.Hint",
    hintFallback: "Applies to this browser only. Every user can change it, including players.",
    fields: Object.freeze([
      Object.freeze({
        key: SETTINGS_KEYS.DEBUG_LOGGING,
        type: SETTING_FIELD_TYPES.CHECKBOX,
        scope: SETTING_SCOPES.CLIENT,
        default: false,
        nameKey: "SCMOREACTIVITIES.Settings.DebugLogging.Name",
        nameFallback: "Debug logging",
        hintKey: "SCMOREACTIVITIES.Settings.DebugLogging.Hint",
        hintFallback: "Log SC - More Activities lifecycle and diagnostic messages to the browser console."
      })
    ])
  })
]);

export class ModuleSettingsCatalog {
  static sections() {
    return SECTIONS;
  }

  static fields() {
    return SECTIONS.flatMap((section) => section.fields);
  }

  static kind(section) {
    return section?.kind ?? SECTION_KINDS.FIELDS;
  }

  static field(key) {
    return ModuleSettingsCatalog.fields().find((field) => field.key === key) ?? null;
  }

  /**
   * World settings are GM-only, so a player opening the window sees just the
   * client sections rather than a wall of controls they cannot save.
   */
  static visibleSections(isGM) {
    return SECTIONS.filter((section) => isGM === true || section.scope === SETTING_SCOPES.CLIENT);
  }

  /** The Foundry registration for a field, minus the module id and key. */
  static registration(field) {
    const registration = {
      name: Constants.localize(field.nameKey, field.nameFallback),
      hint: Constants.localize(field.hintKey, field.hintFallback),
      scope: field.scope,
      // Every field lives in the module's own window instead of the flat
      // Foundry settings list, so none of them declare `config: true`.
      config: false,
      restricted: field.scope === SETTING_SCOPES.WORLD,
      type: field.type === SETTING_FIELD_TYPES.NUMBER ? Number : Boolean,
      default: field.default
    };

    if (field.type === SETTING_FIELD_TYPES.NUMBER && Number.isFinite(field.min) && Number.isFinite(field.max)) {
      registration.range = {
        min: field.min,
        max: field.max,
        step: field.step ?? 1
      };
    }

    return registration;
  }

  /** The tab ids a given user can actually open, in rail order. */
  static tabIds(isGM) {
    return ModuleSettingsCatalog.visibleSections(isGM).map((section) => section.id);
  }

  /**
   * Falls back to the first tab the user can open, so a remembered tab that is
   * no longer visible (a player reopening a GM's tab) cannot render an empty
   * window.
   */
  static resolveTab(requestedTab, isGM) {
    const ids = ModuleSettingsCatalog.tabIds(isGM);
    return ids.includes(requestedTab) ? requestedTab : (ids[0] ?? null);
  }

  static buildContext({
    isGM = false,
    readSetting = () => undefined,
    activeTab = null,
    formId = "sc-ma-settings",
    activityGroups = [],
    activityGroupBy = ACTIVITY_GROUP_BY.CATEGORY,
    activityIssues = null,
    activityHiddenCount = 0
  } = {}) {
    const visible = ModuleSettingsCatalog.visibleSections(isGM);
    const currentTab = ModuleSettingsCatalog.resolveTab(activeTab, isGM);

    const sections = visible.map((section) => {
      const kind = ModuleSettingsCatalog.kind(section);
      const isActivityList = kind === SECTION_KINDS.ACTIVITIES;
      return {
        id: section.id,
        icon: section.icon,
        title: Constants.localize(section.titleKey, section.titleFallback),
        hint: Constants.localize(section.hintKey, section.hintFallback),
        active: section.id === currentTab,
        kind,
        isActivityList,
        // Activity rows come from the live registry, so the caller supplies
        // them; the catalog only decides where they belong.
        groups: isActivityList ? activityGroups : [],
        isEmpty: isActivityList && activityGroups.length === 0,
        groupByLabel: isActivityList
          ? Constants.localize("SCMOREACTIVITIES.Settings.Window.Sections.Activities.GroupBy", "Group by")
          : "",
        groupByOptions: isActivityList ? ModuleSettingsCatalog.#groupByOptions(activityGroupBy) : [],
        searchLabel: isActivityList
          ? Constants.localize("SCMOREACTIVITIES.Settings.Window.Sections.Activities.Search", "Filter activities")
          : "",
        noResultsLabel: isActivityList
          ? Constants.localize("SCMOREACTIVITIES.Settings.Window.Sections.Activities.NoResults", "No activity matches this filter.")
          : "",
        issues: isActivityList ? ModuleSettingsCatalog.#issuesContext(activityIssues) : null,
        hiddenLabel: isActivityList && activityHiddenCount > 0
          ? Constants.format(
            "SCMOREACTIVITIES.Settings.Window.Sections.Activities.Hidden",
            { count: activityHiddenCount },
            `${activityHiddenCount} legacy type(s) hidden.`
          )
          : "",
        emptyLabel: isActivityList
          ? Constants.localize("SCMOREACTIVITIES.Settings.Window.Sections.Activities.Empty", "No activity types are registered yet.")
          : "",
        fields: section.fields.map((field) => ModuleSettingsCatalog.#fieldContext(field, readSetting))
      };
    });

    return {
      isGM,
      formId,
      activeTab: currentTab,
      sections,
      tabs: sections.map((section) => ({
        id: section.id,
        icon: section.icon,
        label: section.title,
        active: section.active
      })),
      description: Constants.localize(
        "SCMOREACTIVITIES.Settings.Window.Description",
        "Every SC - More Activities option in one place."
      ),
      playerNotice: isGM
        ? ""
        : Constants.localize(
          "SCMOREACTIVITIES.Settings.Window.PlayerNotice",
          "World options are managed by the GM. Only the options below apply to you."
        ),
      strings: {
        tabsAria: Constants.localize("SCMOREACTIVITIES.Settings.Window.TabsAria", "Settings sections"),
        reset: Constants.localize("SCMOREACTIVITIES.Actions.ResetDefaults", "Reset defaults"),
        close: Constants.localize("SCMOREACTIVITIES.Actions.Close", "Close"),
        save: Constants.localize("SCMOREACTIVITIES.Actions.SaveChanges", "Save Changes")
      }
    };
  }

  /**
   * A stable string for one tab's submitted values, used to tell a dirty tab
   * from a clean one. Only the tab's own fields are included, so editing one
   * tab never marks another as dirty.
   */
  static snapshot(sectionId, values = {}, { activitySnapshot = null } = {}) {
    const section = SECTIONS.find((entry) => entry.id === sectionId);
    if (!section) {
      return "";
    }
    if (ModuleSettingsCatalog.kind(section) === SECTION_KINDS.ACTIVITIES) {
      // The rows are not static, so the activity list snapshots itself.
      return activitySnapshot ?? "";
    }
    return JSON.stringify(section.fields.map((field) => ModuleSettingsCatalog.normalize(field, values[field.key])));
  }

  /**
   * Registration problems are summarized here and detailed in the Activity
   * Catalog, so the GM sees the signal without the settings window growing a
   * diagnostics table of its own.
   */
  static #issuesContext(issues) {
    if (!issues?.hasIssues) {
      return null;
    }
    return {
      warningCount: issues.warningCount ?? 0,
      rejectedCount: issues.rejectedCount ?? 0,
      hasWarnings: (issues.warningCount ?? 0) > 0,
      hasRejected: (issues.rejectedCount ?? 0) > 0,
      warningLabel: Constants.format(
        "SCMOREACTIVITIES.Settings.Window.Sections.Activities.Warnings",
        { count: issues.warningCount ?? 0 },
        `${issues.warningCount ?? 0} warning(s)`
      ),
      rejectedLabel: Constants.format(
        "SCMOREACTIVITIES.Settings.Window.Sections.Activities.Rejected",
        { count: issues.rejectedCount ?? 0 },
        `${issues.rejectedCount ?? 0} rejected registration(s)`
      ),
      action: Constants.localize(
        "SCMOREACTIVITIES.Settings.Window.Sections.Activities.OpenCatalog",
        "Open the catalog"
      )
    };
  }

  static #groupByOptions(current) {
    const active = Object.values(ACTIVITY_GROUP_BY).includes(current) ? current : ACTIVITY_GROUP_BY.CATEGORY;
    return [
      {
        value: ACTIVITY_GROUP_BY.CATEGORY,
        label: Constants.localize("SCMOREACTIVITIES.Settings.Window.Sections.Activities.GroupByCategory", "Category")
      },
      {
        value: ACTIVITY_GROUP_BY.MODULE,
        label: Constants.localize("SCMOREACTIVITIES.Settings.Window.Sections.Activities.GroupByModule", "Module")
      }
    ].map((option) => ({ ...option, active: option.value === active }));
  }

  static #fieldContext(field, readSetting) {
    const stored = ModuleSettingsCatalog.normalize(field, readSetting(field.key));
    return {
      key: field.key,
      name: Constants.localize(field.nameKey, field.nameFallback),
      hint: Constants.localize(field.hintKey, field.hintFallback),
      isCheckbox: field.type === SETTING_FIELD_TYPES.CHECKBOX,
      isNumber: field.type === SETTING_FIELD_TYPES.NUMBER,
      checked: field.type === SETTING_FIELD_TYPES.CHECKBOX ? stored : false,
      value: field.type === SETTING_FIELD_TYPES.NUMBER ? stored : "",
      default: field.default,
      // Mirrored onto the controls so "Reset defaults" can restore them
      // without a re-render, keeping the reset cancellable.
      defaultChecked: field.default === true ? "true" : "false",
      defaultValue: String(field.default),
      min: field.min ?? null,
      max: field.max ?? null,
      step: field.step ?? 1
    };
  }

  /**
   * Turns whatever a form control produced into the value the setting stores.
   * An unusable number falls back to the field default rather than to zero,
   * which is what a stray keystroke in a spinner would otherwise write.
   */
  static normalize(field, raw) {
    if (!field) {
      return undefined;
    }

    if (field.type === SETTING_FIELD_TYPES.CHECKBOX) {
      if (typeof raw === "string") {
        return raw === "true" || raw === "on";
      }
      return raw === undefined || raw === null ? field.default : Boolean(raw);
    }

    const parsed = Number.parseInt(String(raw ?? ""), 10);
    if (!Number.isFinite(parsed)) {
      return field.default;
    }

    const min = Number.isFinite(field.min) ? field.min : parsed;
    const max = Number.isFinite(field.max) ? field.max : parsed;
    return Math.min(Math.max(parsed, min), max);
  }

  /**
   * The normalized writes for a submitted form. World fields are dropped for a
   * player: Foundry would reject the write anyway, and failing quietly here
   * keeps a player's save from erroring halfway through the client fields.
   */
  static collectWrites(values = {}, { isGM = false } = {}) {
    const writes = [];
    for (const section of ModuleSettingsCatalog.visibleSections(isGM)) {
      for (const field of section.fields) {
        if (!Object.hasOwn(values, field.key)) {
          continue;
        }
        writes.push({ key: field.key, value: ModuleSettingsCatalog.normalize(field, values[field.key]) });
      }
    }
    return writes;
  }
}
