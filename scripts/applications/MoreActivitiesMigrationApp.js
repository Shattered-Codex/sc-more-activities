import { Constants } from "../constants/Constants.js";
import { Logger } from "../support/Logger.js";

const api = foundry?.applications?.api ?? {};
const { ApplicationV2, HandlebarsApplicationMixin } = api;
if (!ApplicationV2 || !HandlebarsApplicationMixin) {
  throw new Error(`${Constants.MODULE_ID}: ApplicationV2 and HandlebarsApplicationMixin are required to render MoreActivitiesMigrationApp.`);
}

export class MoreActivitiesMigrationApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #preview = null;
  #report = null;
  #restoreReport = null;
  #busy = false;
  #activeTab = "overview";
  #progressKey = null;

  static DEFAULT_OPTIONS = {
    id: `${Constants.MODULE_ID}-migration-app`,
    classes: ["sc-more-activities", "sc-ma-migration-app"],
    position: {
      width: 980,
      height: 760
    },
    tag: "section",
    window: {
      contentClasses: ["sc-more-activities"],
      icon: "fa-solid fa-arrows-rotate",
      resizable: true,
      title: Constants.localize("SCMOREACTIVITIES.Migration.Title", "More Activities Migration")
    }
  };

  static PARTS = {
    body: {
      template: `modules/${Constants.MODULE_ID}/templates/applications/more-activities-migration.hbs`
    }
  };

  static open(options = {}) {
    const app = new MoreActivitiesMigrationApp(options);
    app.render(true);
    return app;
  }

  _prepareContext() {
    const migrationApi = game?.modules?.get?.(Constants.MODULE_ID)?.api?.migration ?? {};
    const backups = game?.user?.isGM ? (migrationApi.listMoreActivitiesMigrationBackups?.() ?? []) : [];
    const preview = this.#preview;
    const report = this.#report;
    const restoreReport = this.#restoreReport;
    const previewItemCount = (preview?.worldItems ?? 0)
      + (preview?.actorItems ?? 0)
      + (preview?.compendiumItems ?? 0);

    return {
      isGm: game?.user?.isGM === true,
      busy: this.#busy,
      preview,
      report,
      restoreReport,
      hasPreview: Boolean(preview),
      hasReport: Boolean(report),
      hasRestoreReport: Boolean(restoreReport),
      canApply: Boolean(preview?.convertible),
      canExportPreview: Boolean(preview),
      canExportReport: Boolean(report || restoreReport),
      backupCount: backups.length,
      latestBackup: backups[0]
        ? {
          id: backups[0].id,
          createdAtLabel: MoreActivitiesMigrationApp.#dateTimeLabel(backups[0].createdAt),
          itemCount: Array.isArray(backups[0].items) ? backups[0].items.length : 0,
          previewId: backups[0].previewId ?? "-"
        }
        : null,
      previewItemCount,
      scopeChips: MoreActivitiesMigrationApp.#buildScopeChips(preview),
      tableTabs: MoreActivitiesMigrationApp.#buildTableTabs({
        overview: {
          icon: "fa-solid fa-house",
          label: Constants.localize("SCMOREACTIVITIES.Migration.Tabs.Overview", "Overview"),
          count: backups.length
        },
        preview: {
          icon: "fa-solid fa-magnifying-glass",
          label: Constants.localize("SCMOREACTIVITIES.Migration.Tabs.Preview", "Preview"),
          count: preview?.convertible ?? 0
        },
        apply: {
          icon: "fa-solid fa-wand-magic-sparkles",
          label: Constants.localize("SCMOREACTIVITIES.Migration.Tabs.Apply", "Apply"),
          count: report?.updatedItems ?? 0
        },
        backups: {
          icon: "fa-solid fa-box-archive",
          label: Constants.localize("SCMOREACTIVITIES.Migration.Tabs.Backups", "Backups"),
          count: backups.length
        }
      }, this.#activeTab),
      tabStates: {
        overview: this.#activeTab === "overview",
        preview: this.#activeTab === "preview",
        apply: this.#activeTab === "apply",
        backups: this.#activeTab === "backups"
      },
      backups: backups.map((backup) => ({
        id: backup.id,
        createdAtLabel: MoreActivitiesMigrationApp.#dateTimeLabel(backup.createdAt),
        itemCount: Array.isArray(backup.items) ? backup.items.length : 0,
        previewId: backup.previewId ?? "-"
      })),
      previewEntries: MoreActivitiesMigrationApp.#flattenPreviewEntries(preview),
      reportItems: MoreActivitiesMigrationApp.#mapReportItems(report?.items ?? []),
      restoreItems: MoreActivitiesMigrationApp.#mapRestoreItems(restoreReport?.items ?? [])
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    this.element.querySelector('[data-action="run-preview"]')?.addEventListener("click", async(event) => {
      event.preventDefault();
      await this.#runBusy(async() => {
        this.#restoreReport = null;
        this.#report = null;
        this.#preview = await this.#migrationApi().previewMoreActivitiesMigration({
          onProgress: (payload) => this.#updateProgress(payload)
        });
        this.#activeTab = "preview";
      });
    });

    this.element.querySelector('[data-action="apply-migration"]')?.addEventListener("click", async(event) => {
      event.preventDefault();
      if (!this.#preview) {
        ui.notifications?.warn?.(Constants.localize(
          "SCMOREACTIVITIES.Migration.Warning.PreviewRequired",
          "Run a preview before applying the migration."
        ));
        return;
      }

      await this.#runBusy(async() => {
        this.#restoreReport = null;
        this.#report = await this.#migrationApi().migrateMoreActivities({
          preview: this.#preview,
          onProgress: (payload) => this.#updateProgress(payload)
        });
        this.#activeTab = "apply";
        ui.notifications?.info?.(Constants.format(
          "SCMOREACTIVITIES.Migration.Info.ApplyComplete",
          { items: this.#report.updatedItems ?? 0, activities: this.#report.convertedActivities ?? 0 },
          `Updated ${this.#report.updatedItems ?? 0} item(s) and converted ${this.#report.convertedActivities ?? 0} activity entries.`
        ));
      });
    });

    this.element.querySelector('[data-action="restore-latest"]')?.addEventListener("click", async(event) => {
      event.preventDefault();
      await this.#runBusy(async() => {
        this.#report = null;
        this.#restoreReport = await this.#migrationApi().restoreMoreActivitiesMigrationBackup({
          onProgress: (payload) => this.#updateProgress(payload)
        });
        this.#activeTab = "backups";
        ui.notifications?.info?.(Constants.format(
          "SCMOREACTIVITIES.Migration.Info.RestoreComplete",
          { items: this.#restoreReport.restoredItems ?? 0 },
          `Restored ${this.#restoreReport.restoredItems ?? 0} item(s) from backup.`
        ));
      });
    });

    this.element.querySelector('[data-action="export-preview"]')?.addEventListener("click", async(event) => {
      event.preventDefault();
      if (!this.#preview) {
        return;
      }
      await this.#migrationApi().exportMoreActivitiesMigrationReport(this.#preview);
    });

    this.element.querySelector('[data-action="export-report"]')?.addEventListener("click", async(event) => {
      event.preventDefault();
      const payload = this.#report ?? this.#restoreReport;
      if (!payload) {
        return;
      }
      await this.#migrationApi().exportMoreActivitiesMigrationReport(payload);
    });

    this.#bindTabs();
  }

  #migrationApi() {
    return game?.modules?.get?.(Constants.MODULE_ID)?.api?.migration ?? {};
  }

  async #runBusy(task) {
    if (this.#busy) {
      return;
    }

    this.#busy = true;
    this.#progressKey = null;
    await this.render();
    this.#resetProgress();
    try {
      await task();
    } catch (error) {
      Logger.error("Migration action failed.", error);
      ui.notifications?.error?.(error?.message ?? String(error));
    } finally {
      this.#busy = false;
      this.#progressKey = null;
      this.render();
    }
  }

  #resetProgress() {
    const root = this.element;
    const bar = root?.querySelector("[data-progress-bar]");
    if (!bar) {
      return;
    }

    bar.style.width = "0%";
    root.querySelector("[data-progress-track]")?.setAttribute("aria-valuenow", "0");
    const label = root.querySelector("[data-progress-label]");
    if (label) {
      label.textContent = Constants.localize("SCMOREACTIVITIES.Migration.Progress.Starting", "Starting…");
    }
    const count = root.querySelector("[data-progress-count]");
    if (count) {
      count.textContent = "";
    }
  }

  #updateProgress(payload = {}) {
    const root = this.element;
    if (!root) {
      return;
    }

    const total = Math.max(0, Math.trunc(Number(payload.total ?? 0)));
    const current = Math.min(total, Math.max(0, Math.trunc(Number(payload.current ?? 0))));
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    const phase = String(payload.phase ?? "");
    const key = `${phase}:${percent}:${payload.detail ?? ""}`;
    if (key === this.#progressKey) {
      return;
    }
    this.#progressKey = key;

    const bar = root.querySelector("[data-progress-bar]");
    if (bar) {
      bar.style.width = `${percent}%`;
    }
    root.querySelector("[data-progress-track]")?.setAttribute("aria-valuenow", String(percent));

    const label = root.querySelector("[data-progress-label]");
    if (label) {
      const phaseLabel = MoreActivitiesMigrationApp.#phaseLabel(phase);
      label.textContent = payload.detail ? `${phaseLabel} — ${payload.detail}` : phaseLabel;
    }

    const count = root.querySelector("[data-progress-count]");
    if (count) {
      count.textContent = total > 0 ? `${current}/${total} (${percent}%)` : `${percent}%`;
    }
  }

  static #phaseLabel(phase) {
    switch (phase) {
      case "world-items":
        return Constants.localize("SCMOREACTIVITIES.Migration.Progress.WorldItems", "Scanning world items");
      case "actor-items":
        return Constants.localize("SCMOREACTIVITIES.Migration.Progress.ActorItems", "Scanning actors");
      case "compendiums":
        return Constants.localize("SCMOREACTIVITIES.Migration.Progress.Compendiums", "Scanning compendiums");
      case "apply":
        return Constants.localize("SCMOREACTIVITIES.Migration.Progress.Apply", "Applying migration");
      case "restore":
        return Constants.localize("SCMOREACTIVITIES.Migration.Progress.Restore", "Restoring backup");
      case "done":
        return Constants.localize("SCMOREACTIVITIES.Migration.Progress.Done", "Finishing");
      default:
        return Constants.localize("SCMOREACTIVITIES.Migration.Progress.Working", "Working");
    }
  }

  static #buildScopeChips(preview) {
    if (!preview) {
      return [];
    }

    return [
      {
        icon: "fa-solid fa-box-open",
        label: Constants.localize("SCMOREACTIVITIES.Migration.Scope.WorldItems", "World items"),
        value: preview.scannedWorldItems ?? 0
      },
      {
        icon: "fa-solid fa-users",
        label: Constants.localize("SCMOREACTIVITIES.Migration.Scope.ActorItems", "Actor items"),
        value: preview.scannedActorItems ?? 0
      },
      {
        icon: "fa-solid fa-book-atlas",
        label: Constants.localize("SCMOREACTIVITIES.Migration.Scope.CompendiumItems", "Compendium items"),
        value: preview.scannedCompendiumItems ?? 0
      },
      {
        icon: "fa-solid fa-boxes-stacked",
        label: Constants.localize("SCMOREACTIVITIES.Migration.Scope.Packs", "Packs scanned"),
        value: preview.scannedPacks ?? 0
      },
      {
        icon: "fa-solid fa-stopwatch",
        label: Constants.localize("SCMOREACTIVITIES.Migration.Scope.Duration", "Duration"),
        value: `${preview.durationMs ?? 0}ms`
      }
    ];
  }

  static #flattenPreviewEntries(preview) {
    return (preview?.entries ?? []).flatMap((entry) => {
      return (entry.activities ?? []).map((activity) => ({
        itemName: entry.itemName,
        sourceLabel: MoreActivitiesMigrationApp.#sourceLabel(entry),
        sourceIcon: MoreActivitiesMigrationApp.#sourceIcon(entry),
        sourceLocked: entry.packLocked === true,
        activityName: activity.activityName,
        legacyType: activity.legacyType,
        targetType: activity.targetType ?? "-",
        statusLabel: activity.convertible
          ? Constants.localize("SCMOREACTIVITIES.Migration.Status.Convertible", "Convertible")
          : Constants.localize("SCMOREACTIVITIES.Migration.Status.Blocked", "Blocked"),
        statusClass: activity.convertible ? "is-success" : "is-danger",
        warnings: (activity.warnings ?? []).join(" "),
        reason: activity.reason ?? ""
      }));
    });
  }

  static #sourceLabel(entry) {
    if (entry?.source === "compendium") {
      const packLabel = entry.packLabel ?? entry.packId ?? "-";
      return entry.actorName ? `${packLabel} › ${entry.actorName}` : packLabel;
    }

    if (entry?.source === "actor") {
      return entry.actorName ?? "-";
    }

    return Constants.localize("SCMOREACTIVITIES.Migration.Fields.WorldItem", "World item");
  }

  static #sourceIcon(entry) {
    if (entry?.source === "compendium") {
      return "fa-solid fa-book-atlas";
    }
    return entry?.source === "actor" ? "fa-solid fa-user" : "fa-solid fa-box-open";
  }

  static #dateTimeLabel(value) {
    if (!value) {
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      return String(value);
    }
    return date.toLocaleString();
  }

  static #mapReportItems(items) {
    return items.map((entry) => ({
      ...entry,
      statusClass: entry.status === "updated"
        ? "is-success"
        : entry.status === "failed"
          ? "is-danger"
          : "is-warning"
    }));
  }

  static #mapRestoreItems(items) {
    return items.map((entry) => ({
      ...entry,
      statusClass: entry.status === "restored" ? "is-success" : "is-danger"
    }));
  }

  #bindTabs() {
    const root = this.element;
    const tabs = Array.from(root?.querySelectorAll("[data-migration-tab]") ?? []);
    for (const [index, tab] of tabs.entries()) {
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        this.#activateTab(tab.dataset.migrationTab);
      });
      tab.addEventListener("keydown", (event) => {
        let nextIndex = null;
        if (event.key === "ArrowRight") {
          nextIndex = (index + 1) % tabs.length;
        } else if (event.key === "ArrowLeft") {
          nextIndex = (index - 1 + tabs.length) % tabs.length;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = tabs.length - 1;
        }

        if (nextIndex === null) {
          return;
        }

        event.preventDefault();
        tabs[nextIndex].focus();
        this.#activateTab(tabs[nextIndex].dataset.migrationTab);
      });
    }
  }

  #activateTab(tabKey) {
    const root = this.element;
    if (!root || !tabKey) {
      return;
    }

    this.#activeTab = tabKey;
    for (const tab of root.querySelectorAll("[data-migration-tab]")) {
      const active = tab.dataset.migrationTab === tabKey;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }

    for (const panel of root.querySelectorAll("[data-migration-panel]")) {
      const active = panel.dataset.migrationPanel === tabKey;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
      panel.setAttribute("aria-hidden", String(!active));
    }
  }

  static #buildTableTabs(tabs, activeKey) {
    return Object.entries(tabs).map(([key, data]) => ({
      key,
      icon: data.icon,
      label: data.label,
      count: data.count ?? 0,
      active: key === activeKey,
      tabId: `sc-ma-migration-tab-${key}`,
      panelId: `sc-ma-migration-panel-${key}`
    }));
  }
}
