import { Constants } from "../constants/Constants.js";
import { SETTINGS_KEYS } from "../constants/SettingsKeys.js";
import { MoreActivitiesMigrationApp } from "./MoreActivitiesMigrationApp.js";

const api = foundry?.applications?.api ?? {};
const { ApplicationV2, HandlebarsApplicationMixin } = api;
if (!ApplicationV2 || !HandlebarsApplicationMixin) {
  throw new Error(`${Constants.MODULE_ID}: ApplicationV2 and HandlebarsApplicationMixin are required to render ActivityCatalogApp.`);
}

const ACTIVITY_CATALOG_MENU_KEY = `${Constants.MODULE_ID}.${SETTINGS_KEYS.ACTIVITY_CATALOG_MENU}`;
const FALLBACK_REPORT = Object.freeze({
  registered: [],
  rejected: [],
  warnings: [],
  duplicates: [],
  lateRegistrations: [],
  flushed: [],
  nativeTypes: [],
  nativeTypeConflicts: [],
  legacyTypeConflicts: []
});

export class ActivityCatalogApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #activeCatalogTab = "registered";

  static DEFAULT_OPTIONS = {
    id: `${Constants.MODULE_ID}-activity-catalog`,
    classes: ["sc-more-activities", "sc-ma-activity-catalog"],
    position: {
      width: 920,
      height: 720
    },
    tag: "section",
    window: {
      contentClasses: ["sc-more-activities"],
      icon: "fa-solid fa-rectangle-list",
      resizable: true,
      title: Constants.localize("SCMOREACTIVITIES.Catalog.Title", "Activity Catalog")
    }
  };

  static PARTS = {
    body: {
      template: `modules/${Constants.MODULE_ID}/templates/applications/activity-catalog.hbs`
    }
  };

  static open(options = {}) {
    const app = new ActivityCatalogApp(options);
    app.render(true);
    return app;
  }

  static bindSettingsButton(html) {
    const root = ActivityCatalogApp.#resolveRoot(html);
    if (!root) {
      return;
    }

    const candidates = root.querySelectorAll([
      `[data-setting-id="${ACTIVITY_CATALOG_MENU_KEY}"]`,
      `[data-menu-id="${ACTIVITY_CATALOG_MENU_KEY}"]`,
      `[data-key="${ACTIVITY_CATALOG_MENU_KEY}"]`,
      `[data-setting="${ACTIVITY_CATALOG_MENU_KEY}"]`
    ].join(","));

    for (const candidate of candidates) {
      const button = candidate instanceof HTMLButtonElement
        ? candidate
        : candidate.querySelector("button");
      if (!button) {
        continue;
      }

      button.classList.add("sc-ma-catalog-button");
    }
  }

  _prepareContext() {
    const moduleApi = game.modules.get(Constants.MODULE_ID)?.api ?? null;
    const activitiesApi = moduleApi?.activities ?? null;
    const report = ActivityCatalogApp.#normalizeReport(activitiesApi?.getRegistrationReport?.());
    const availability = ActivityCatalogApp.#buildAvailabilityMap(activitiesApi?.listTypeAvailability?.());
    const registered = ActivityCatalogApp.#buildRegisteredEntries(activitiesApi?.listTypes?.() ?? [], report, availability);
    const rejected = ActivityCatalogApp.#buildDiagnosticEntries(report.rejected, "rejected");
    const warnings = ActivityCatalogApp.#buildDiagnosticEntries(report.warnings, "warning");
    const rows = [...registered, ...rejected, ...warnings];

    return {
      api: {
        moduleVersion: moduleApi?.moduleVersion ?? game.modules.get(Constants.MODULE_ID)?.version ?? "0.0.0",
        apiVersion: moduleApi?.apiVersion ?? "?",
        lifecycleState: activitiesApi?.getLifecycleState?.() ?? "unavailable",
        registryLocked: activitiesApi?.isRegistryLocked?.() === true,
        capabilities: ActivityCatalogApp.#buildCapabilityEntries(moduleApi?.capabilities)
      },
      summaries: ActivityCatalogApp.#buildSummaries(registered, rejected, warnings, report),
      registered,
      rejected,
      warnings,
      tableTabs: ActivityCatalogApp.#buildTableTabs({
        registered: registered.length,
        rejected: rejected.length,
        warnings: warnings.length
      }, this.#activeCatalogTab),
      tabStates: {
        registered: this.#activeCatalogTab === "registered",
        rejected: this.#activeCatalogTab === "rejected",
        warnings: this.#activeCatalogTab === "warnings"
      },
      filters: {
        categories: ActivityCatalogApp.#buildCategoryOptions(rows),
        statuses: ActivityCatalogApp.#buildStatusOptions(),
        availability: ActivityCatalogApp.#buildAvailabilityOptions()
      },
      diagnostics: {
        duplicates: report.duplicates.length,
        lateRegistrations: report.lateRegistrations.length,
        nativeTypeConflicts: report.nativeTypeConflicts.length,
        legacyTypeConflicts: report.legacyTypeConflicts.length,
        nativeTypes: report.nativeTypes.length
      }
    };
  }

  async _onRender(_context, _options) {
    const root = this.element;
    if (!root) {
      return;
    }

    const refreshButton = root.querySelector('[data-action="refresh"]');
    refreshButton?.addEventListener("click", (event) => {
      event.preventDefault();
      this.render(true);
    });

    const copyButton = root.querySelector('[data-action="copy-report"]');
    copyButton?.addEventListener("click", async (event) => {
      event.preventDefault();
      await this.#copyReport();
    });

    const clearButton = root.querySelector('[data-action="clear-filters"]');
    clearButton?.addEventListener("click", (event) => {
      event.preventDefault();
      this.#clearFilters();
    });

    const migrationButton = root.querySelector('[data-action="open-migration"]');
    migrationButton?.addEventListener("click", (event) => {
      event.preventDefault();
      MoreActivitiesMigrationApp.open();
    });

    this.#bindFilters();
    this.#bindCatalogTabs();
    this.#bindAvailabilityToggles();
  }

  async #copyReport() {
    const report = game.modules.get(Constants.MODULE_ID)?.api?.activities?.getRegistrationReport?.() ?? FALLBACK_REPORT;
    const payload = JSON.stringify(report, null, 2);
    try {
      if (game.clipboard?.copyPlainText) {
        await game.clipboard.copyPlainText(payload);
      } else {
        await navigator.clipboard.writeText(payload);
      }
      ui.notifications.info(Constants.localize("SCMOREACTIVITIES.Catalog.Notifications.ReportCopied", "Activity registration report copied."));
    } catch (error) {
      console.warn(`[${Constants.MODULE_ID}] Could not copy activity registration report.`, error);
      ui.notifications.warn(Constants.localize("SCMOREACTIVITIES.Catalog.Notifications.ReportCopyFailed", "Could not copy the activity registration report."));
    }
  }

  #clearFilters() {
    const root = this.element;
    const search = root?.querySelector('[name="sc-ma-catalog-search"]');
    const category = root?.querySelector('[name="sc-ma-catalog-category"]');
    const status = root?.querySelector('[name="sc-ma-catalog-status"]');
    const availability = root?.querySelector('[name="sc-ma-catalog-availability"]');
    if (search) {
      search.value = "";
    }
    if (category) {
      category.value = "all";
    }
    if (status) {
      status.value = "all";
    }
    if (availability) {
      availability.value = "all";
    }
    this.#applyFilters();
  }

  #bindFilters() {
    const root = this.element;
    const controls = root?.querySelectorAll('[data-catalog-filter]') ?? [];
    for (const control of controls) {
      control.addEventListener("input", () => this.#applyFilters());
      control.addEventListener("change", () => this.#applyFilters());
    }
    this.#applyFilters();
  }

  #bindCatalogTabs() {
    const root = this.element;
    const tabs = Array.from(root?.querySelectorAll("[data-catalog-tab]") ?? []);
    for (const [index, tab] of tabs.entries()) {
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        this.#activateCatalogTab(tab.dataset.catalogTab);
      });
      tab.addEventListener("keydown", (event) => {
        const nextIndex = ActivityCatalogApp.#getTabKeyboardTargetIndex(event, tabs, index);
        if (nextIndex === null) {
          return;
        }

        event.preventDefault();
        tabs[nextIndex].focus();
        this.#activateCatalogTab(tabs[nextIndex].dataset.catalogTab);
      });
    }
  }

  #activateCatalogTab(tabKey) {
    const root = this.element;
    if (!root || !tabKey) {
      return;
    }

    this.#activeCatalogTab = tabKey;
    for (const tab of root.querySelectorAll("[data-catalog-tab]")) {
      const active = tab.dataset.catalogTab === tabKey;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }

    for (const panel of root.querySelectorAll("[data-catalog-panel]")) {
      const active = panel.dataset.catalogPanel === tabKey;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
      panel.setAttribute("aria-hidden", String(!active));
    }
    this.#applyFilters();
  }

  #applyFilters() {
    const root = this.element;
    if (!root) {
      return;
    }

    const search = String(root.querySelector('[name="sc-ma-catalog-search"]')?.value ?? "").trim().toLowerCase();
    const category = root.querySelector('[name="sc-ma-catalog-category"]')?.value ?? "all";
    const status = root.querySelector('[name="sc-ma-catalog-status"]')?.value ?? "all";
    const availability = root.querySelector('[name="sc-ma-catalog-availability"]')?.value ?? "all";

    for (const row of root.querySelectorAll("[data-catalog-row]")) {
      const rowSearch = row.dataset.search ?? row.textContent?.toLowerCase() ?? "";
      const rowCategory = row.dataset.category ?? "";
      const rowKind = row.dataset.kind ?? "";
      const rowStatus = row.dataset.status ?? "";
      const rowAvailability = row.dataset.availability ?? "";
      const matchesSearch = !search || rowSearch.includes(search);
      const matchesCategory = category === "all" || rowCategory === category;
      const matchesStatus = status === "all"
        || rowKind !== "registered"
        || rowStatus === status
        || (status === "registered" && rowKind === "registered");
      const matchesAvailability = availability === "all"
        || rowKind !== "registered"
        || rowAvailability === availability;
      row.hidden = !(matchesSearch && matchesCategory && matchesStatus && matchesAvailability);
    }

    for (const table of root.querySelectorAll("[data-catalog-table]")) {
      const visibleRows = Array.from(table.querySelectorAll("[data-catalog-row]"))
        .filter((row) => !row.hidden);
      const emptyRow = table.querySelector("[data-empty-row]");
      if (emptyRow) {
        emptyRow.hidden = visibleRows.length > 0;
      }
    }
  }

  static #normalizeReport(report) {
    return {
      registered: ActivityCatalogApp.#cloneArray(report?.registered),
      rejected: ActivityCatalogApp.#cloneArray(report?.rejected),
      warnings: ActivityCatalogApp.#cloneArray(report?.warnings),
      duplicates: ActivityCatalogApp.#cloneArray(report?.duplicates),
      lateRegistrations: ActivityCatalogApp.#cloneArray(report?.lateRegistrations),
      flushed: ActivityCatalogApp.#cloneArray(report?.flushed),
      nativeTypes: ActivityCatalogApp.#cloneArray(report?.nativeTypes),
      nativeTypeConflicts: ActivityCatalogApp.#cloneArray(report?.nativeTypeConflicts),
      legacyTypeConflicts: ActivityCatalogApp.#cloneArray(report?.legacyTypeConflicts)
    };
  }

  #bindAvailabilityToggles() {
    const root = this.element;
    const controls = root?.querySelectorAll('[data-action="toggle-availability"]') ?? [];
    for (const control of controls) {
      control.addEventListener("change", async (event) => {
        await this.#toggleAvailability(event.currentTarget);
      });
    }
  }

  async #toggleAvailability(control) {
    const type = control?.dataset?.activityType;
    const label = control?.dataset?.activityLabel ?? type;
    const enabled = control?.checked === true;
    const activitiesApi = game.modules.get(Constants.MODULE_ID)?.api?.activities;
    if (!type || typeof activitiesApi?.setTypeEnabled !== "function") {
      ui.notifications.warn(Constants.localize(
        "SCMOREACTIVITIES.Catalog.Notifications.ActivityToggleFailed",
        "Could not update activity availability."
      ));
      this.render(true);
      return;
    }

    control.disabled = true;
    let result;
    try {
      result = await activitiesApi.setTypeEnabled(type, enabled);
    } catch (error) {
      console.warn(`[${Constants.MODULE_ID}] Could not update activity availability.`, error);
      ui.notifications.warn(Constants.localize(
        "SCMOREACTIVITIES.Catalog.Notifications.ActivityToggleFailed",
        "Could not update activity availability."
      ));
      this.render(true);
      return;
    }

    if (!result?.ok) {
      ui.notifications.warn(result?.message ?? Constants.localize(
        "SCMOREACTIVITIES.Catalog.Notifications.ActivityToggleFailed",
        "Could not update activity availability."
      ));
      this.render(true);
      return;
    }

    const messageKey = enabled
      ? "SCMOREACTIVITIES.Catalog.Notifications.ActivityEnabled"
      : "SCMOREACTIVITIES.Catalog.Notifications.ActivityDisabled";
    ui.notifications.info(Constants.format(messageKey, { label }, enabled
      ? `${label} enabled for activity creation and use.`
      : `${label} disabled for activity creation and use.`));
    this.render(true);
  }

  static #buildRegisteredEntries(types, report, availability) {
    const flushedTypes = new Set(report.flushed.map((entry) => entry.type).filter(Boolean));
    const warningCounts = ActivityCatalogApp.#countByType(report.warnings);
    return Array.from(types ?? [])
      .map((entry) => ActivityCatalogApp.#buildRegisteredEntry(entry, flushedTypes, warningCounts, availability))
      .sort((left, right) => left.category.localeCompare(right.category, game.i18n.lang) || left.type.localeCompare(right.type, game.i18n.lang));
  }

  static #buildRegisteredEntry(entry, flushedTypes, warningCounts, availability) {
    const ui = entry.ui ?? {};
    const category = entry.category ?? "uncategorized";
    const status = flushedTypes.has(entry.type) ? "flushed" : "registered";
    const label = ActivityCatalogApp.#resolveLabel(entry.label, entry.type);
    const hint = ActivityCatalogApp.#resolveLabel(entry.hint, "");
    const groupLabel = ActivityCatalogApp.#resolveLabel(ui.groupLabel, ui.groupId ?? ui.scope ?? "");
    const icon = entry.icon ?? "fa-solid fa-puzzle-piece";
    const warningCount = warningCounts.get(entry.type) ?? 0;
    const availabilityEntry = availability.get(entry.type);
    const availabilityState = ActivityCatalogApp.#availabilityState(status, availabilityEntry);
    const enabled = availabilityState === "active";
    const availabilityLabel = ActivityCatalogApp.#availabilityLabel(availabilityState);
    const availabilityHint = ActivityCatalogApp.#availabilityHint(availabilityState);

    return {
      type: entry.type,
      label,
      hint,
      moduleId: entry.moduleId ?? "",
      category,
      categoryLabel: ActivityCatalogApp.#titleCase(category),
      scope: ui.scope ?? "external",
      groupLabel,
      source: entry.source ?? "",
      status,
      statusLabel: ActivityCatalogApp.#statusLabel(status),
      statusClass: `sc-ma-status--${status}`,
      availability: availabilityState,
      availabilityLabel,
      availabilityHint,
      availabilityActionLabel: ActivityCatalogApp.#availabilityActionLabel(enabled, label),
      availabilityClass: `sc-ma-status--${availabilityState}`,
      canToggleAvailability: status === "flushed" && availabilityState !== "unavailable" && game.user?.isGM === true,
      enabled,
      icon,
      iconIsPath: ActivityCatalogApp.#isIconPath(icon),
      warningCount,
      searchText: ActivityCatalogApp.#searchText([entry.type, label, hint, entry.moduleId, category, ui.scope, groupLabel, entry.source, availabilityLabel])
    };
  }

  static #buildDiagnosticEntries(entries, kind) {
    return ActivityCatalogApp.#cloneArray(entries)
      .map((entry) => ({
        type: entry.type ?? "",
        moduleId: entry.moduleId ?? "",
        reason: entry.reason ?? "",
        message: entry.message ?? "",
        status: kind,
        statusLabel: ActivityCatalogApp.#statusLabel(kind),
        statusClass: `sc-ma-status--${kind}`,
        category: "diagnostic",
        categoryLabel: ActivityCatalogApp.#titleCase("diagnostic"),
        searchText: ActivityCatalogApp.#searchText([entry.type, entry.moduleId, entry.reason, entry.message])
      }))
      .sort((left, right) => left.type.localeCompare(right.type, game.i18n.lang) || left.reason.localeCompare(right.reason, game.i18n.lang));
  }

  static #buildSummaries(registered, rejected, warnings, report) {
    return [
      {
        key: "registered",
        icon: "fa-solid fa-list-check",
        label: Constants.localize("SCMOREACTIVITIES.Catalog.Summary.Registered", "Registered"),
        value: registered.length
      },
      {
        key: "flushed",
        icon: "fa-solid fa-share-from-square",
        label: Constants.localize("SCMOREACTIVITIES.Catalog.Summary.Flushed", "D&D Ready"),
        value: registered.filter((entry) => entry.status === "flushed").length
      },
      {
        key: "rejected",
        icon: "fa-solid fa-triangle-exclamation",
        label: Constants.localize("SCMOREACTIVITIES.Catalog.Summary.Rejected", "Rejected"),
        value: rejected.length
      },
      {
        key: "warnings",
        icon: "fa-solid fa-circle-exclamation",
        label: Constants.localize("SCMOREACTIVITIES.Catalog.Summary.Warnings", "Warnings"),
        value: warnings.length + report.nativeTypeConflicts.length + report.legacyTypeConflicts.length
      }
    ];
  }

  static #buildCapabilityEntries(capabilities) {
    return Object.entries(capabilities ?? {})
      .map(([key, enabled]) => ({
        key,
        label: ActivityCatalogApp.#capabilityLabel(key),
        enabled: enabled === true
      }))
      .sort((left, right) => left.label.localeCompare(right.label, game.i18n.lang));
  }

  static #capabilityLabel(key) {
    const labels = {
      activityCatalog: Constants.localize("SCMOREACTIVITIES.Catalog.Capabilities.ActivityCatalog", "Activity Catalog"),
      activityAvailability: Constants.localize("SCMOREACTIVITIES.Catalog.Capabilities.ActivityAvailability", "Activity Availability"),
      activityCreation: Constants.localize("SCMOREACTIVITIES.Catalog.Capabilities.ActivityCreation", "Activity Creation"),
      dnd5eAdapter: Constants.localize("SCMOREACTIVITIES.Catalog.Capabilities.Dnd5eAdapter", "D&D 5e Adapter"),
      migration: Constants.localize("SCMOREACTIVITIES.Catalog.Capabilities.Migration", "Migration"),
      registry: Constants.localize("SCMOREACTIVITIES.Catalog.Capabilities.Registry", "Registry")
    };
    return labels[key] ?? ActivityCatalogApp.#titleCase(key);
  }

  static #buildCategoryOptions(rows) {
    const categories = new Map();
    for (const row of rows) {
      categories.set(row.category, row.categoryLabel ?? ActivityCatalogApp.#titleCase(row.category));
    }
    return Array.from(categories.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, game.i18n.lang));
  }

  static #buildStatusOptions() {
    return [
      { value: "all", label: Constants.localize("SCMOREACTIVITIES.Catalog.Filters.Status.All", "All statuses") },
      { value: "registered", label: Constants.localize("SCMOREACTIVITIES.Catalog.Filters.Status.Registered", "Registered") },
      { value: "flushed", label: Constants.localize("SCMOREACTIVITIES.Catalog.Filters.Status.Flushed", "D&D ready") }
    ];
  }

  static #buildTableTabs(counts, activeTab) {
    return [
      {
        key: "registered",
        panelId: "sc-ma-catalog-panel-registered",
        tabId: "sc-ma-catalog-tab-registered",
        icon: "fa-solid fa-list-check",
        label: Constants.localize("SCMOREACTIVITIES.Catalog.Sections.Registered", "Registered Activities"),
        count: counts.registered,
        active: activeTab === "registered"
      },
      {
        key: "rejected",
        panelId: "sc-ma-catalog-panel-rejected",
        tabId: "sc-ma-catalog-tab-rejected",
        icon: "fa-solid fa-triangle-exclamation",
        label: Constants.localize("SCMOREACTIVITIES.Catalog.Sections.Rejected", "Rejected Registrations"),
        count: counts.rejected,
        active: activeTab === "rejected"
      },
      {
        key: "warnings",
        panelId: "sc-ma-catalog-panel-warnings",
        tabId: "sc-ma-catalog-tab-warnings",
        icon: "fa-solid fa-circle-exclamation",
        label: Constants.localize("SCMOREACTIVITIES.Catalog.Sections.Warnings", "Warnings"),
        count: counts.warnings,
        active: activeTab === "warnings"
      }
    ];
  }

  static #buildAvailabilityOptions() {
    return [
      { value: "all", label: Constants.localize("SCMOREACTIVITIES.Catalog.Filters.Availability.All", "All availability") },
      { value: "active", label: Constants.localize("SCMOREACTIVITIES.Catalog.Filters.Availability.Active", "Active") },
      { value: "disabled", label: Constants.localize("SCMOREACTIVITIES.Catalog.Filters.Availability.Disabled", "Disabled") },
      { value: "unavailable", label: Constants.localize("SCMOREACTIVITIES.Catalog.Filters.Availability.Unavailable", "Unavailable") }
    ];
  }

  static #statusLabel(status) {
    const labels = {
      registered: Constants.localize("SCMOREACTIVITIES.Catalog.Status.Registered", "Registered"),
      flushed: Constants.localize("SCMOREACTIVITIES.Catalog.Status.Flushed", "D&D ready"),
      rejected: Constants.localize("SCMOREACTIVITIES.Catalog.Status.Rejected", "Rejected"),
      warning: Constants.localize("SCMOREACTIVITIES.Catalog.Status.Warning", "Warning")
    };
    return labels[status] ?? status;
  }

  static #availabilityState(status, availabilityEntry) {
    if (status !== "flushed") {
      return "unavailable";
    }
    if (availabilityEntry?.unavailable === true) {
      return "unavailable";
    }
    return availabilityEntry?.enabled === false ? "disabled" : "active";
  }

  static #availabilityLabel(status) {
    const labels = {
      active: Constants.localize("SCMOREACTIVITIES.Catalog.Availability.Active", "Active"),
      disabled: Constants.localize("SCMOREACTIVITIES.Catalog.Availability.Disabled", "Disabled"),
      unavailable: Constants.localize("SCMOREACTIVITIES.Catalog.Availability.Unavailable", "Unavailable")
    };
    return labels[status] ?? status;
  }

  static #availabilityHint(status) {
    const labels = {
      active: Constants.localize("SCMOREACTIVITIES.Catalog.Availability.ActiveHint", "Available for activity creation and use."),
      disabled: Constants.localize("SCMOREACTIVITIES.Catalog.Availability.DisabledHint", "Blocked from activity creation and use."),
      unavailable: Constants.localize("SCMOREACTIVITIES.Catalog.Availability.UnavailableHint", "Only D&D-ready activity types can be enabled or disabled.")
    };
    return labels[status] ?? "";
  }

  static #availabilityActionLabel(enabled, label) {
    return enabled
      ? Constants.format("SCMOREACTIVITIES.Catalog.Availability.Disable", { label }, `Disable ${label}`)
      : Constants.format("SCMOREACTIVITIES.Catalog.Availability.Enable", { label }, `Enable ${label}`);
  }

  static #buildAvailabilityMap(entries) {
    return new Map(
      ActivityCatalogApp.#cloneArray(entries)
        .filter((entry) => entry.type)
        .map((entry) => [entry.type, entry])
    );
  }

  static #countByType(entries) {
    const counts = new Map();
    for (const entry of entries ?? []) {
      if (!entry?.type) {
        continue;
      }
      counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
    }
    return counts;
  }

  static #resolveLabel(keyOrText, fallback) {
    if (!keyOrText) {
      return fallback ?? "";
    }
    const localized = game.i18n.localize(keyOrText);
    return localized && localized !== keyOrText ? localized : keyOrText;
  }

  static #titleCase(value) {
    return String(value ?? "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  static #searchText(parts) {
    return parts
      .filter((part) => part !== undefined && part !== null)
      .join(" ")
      .toLowerCase();
  }

  static #isIconPath(icon) {
    return String(icon ?? "").includes("/") || /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(String(icon ?? ""));
  }

  static #getTabKeyboardTargetIndex(event, tabs, currentIndex) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        return (currentIndex + 1) % tabs.length;
      case "ArrowLeft":
      case "ArrowUp":
        return (currentIndex - 1 + tabs.length) % tabs.length;
      case "Home":
        return 0;
      case "End":
        return tabs.length - 1;
      default:
        return null;
    }
  }

  static #cloneArray(value) {
    return Array.isArray(value)
      ? value.map((entry) => (entry && typeof entry === "object" ? { ...entry } : entry))
      : [];
  }

  static #resolveRoot(html) {
    if (!html) {
      return null;
    }
    if (html.jquery || typeof html.get === "function") {
      return html[0] ?? html.get(0) ?? null;
    }
    if (html instanceof Element || html?.querySelector) {
      return html;
    }
    return null;
  }
}
