import { Constants } from "../constants/Constants.js";
import { SETTINGS_KEYS } from "../constants/SettingsKeys.js";

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
    const registered = ActivityCatalogApp.#buildRegisteredEntries(activitiesApi?.listTypes?.() ?? [], report);
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
      filters: {
        categories: ActivityCatalogApp.#buildCategoryOptions(rows),
        statuses: ActivityCatalogApp.#buildStatusOptions()
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

    this.#bindFilters();
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
    if (search) {
      search.value = "";
    }
    if (category) {
      category.value = "all";
    }
    if (status) {
      status.value = "all";
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

  #applyFilters() {
    const root = this.element;
    if (!root) {
      return;
    }

    const search = String(root.querySelector('[name="sc-ma-catalog-search"]')?.value ?? "").trim().toLowerCase();
    const category = root.querySelector('[name="sc-ma-catalog-category"]')?.value ?? "all";
    const status = root.querySelector('[name="sc-ma-catalog-status"]')?.value ?? "all";

    for (const row of root.querySelectorAll("[data-catalog-row]")) {
      const rowSearch = row.dataset.search ?? row.textContent?.toLowerCase() ?? "";
      const rowCategory = row.dataset.category ?? "";
      const rowKind = row.dataset.kind ?? "";
      const rowStatus = row.dataset.status ?? "";
      const matchesSearch = !search || rowSearch.includes(search);
      const matchesCategory = category === "all" || rowCategory === category;
      const matchesStatus = status === "all"
        || rowStatus === status
        || (status === "registered" && rowKind === "registered");
      row.hidden = !(matchesSearch && matchesCategory && matchesStatus);
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

  static #buildRegisteredEntries(types, report) {
    const flushedTypes = new Set(report.flushed.map((entry) => entry.type).filter(Boolean));
    const warningCounts = ActivityCatalogApp.#countByType(report.warnings);
    return Array.from(types ?? [])
      .map((entry) => ActivityCatalogApp.#buildRegisteredEntry(entry, flushedTypes, warningCounts))
      .sort((left, right) => left.category.localeCompare(right.category, game.i18n.lang) || left.type.localeCompare(right.type, game.i18n.lang));
  }

  static #buildRegisteredEntry(entry, flushedTypes, warningCounts) {
    const ui = entry.ui ?? {};
    const category = entry.category ?? "uncategorized";
    const status = flushedTypes.has(entry.type) ? "flushed" : "registered";
    const label = ActivityCatalogApp.#resolveLabel(entry.label, entry.type);
    const hint = ActivityCatalogApp.#resolveLabel(entry.hint, "");
    const groupLabel = ActivityCatalogApp.#resolveLabel(ui.groupLabel, ui.groupId ?? ui.scope ?? "");
    const icon = entry.icon ?? "fa-solid fa-puzzle-piece";
    const warningCount = warningCounts.get(entry.type) ?? 0;

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
      icon,
      iconIsPath: ActivityCatalogApp.#isIconPath(icon),
      warningCount,
      searchText: ActivityCatalogApp.#searchText([entry.type, label, hint, entry.moduleId, category, ui.scope, groupLabel, entry.source])
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
      { value: "flushed", label: Constants.localize("SCMOREACTIVITIES.Catalog.Filters.Status.Flushed", "D&D ready") },
      { value: "rejected", label: Constants.localize("SCMOREACTIVITIES.Catalog.Filters.Status.Rejected", "Rejected") },
      { value: "warning", label: Constants.localize("SCMOREACTIVITIES.Catalog.Filters.Status.Warning", "Warning") }
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
