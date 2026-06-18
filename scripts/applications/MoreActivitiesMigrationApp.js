import { Constants } from "../constants/Constants.js";

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
    const previewItemCount = (preview?.worldItems ?? 0) + (preview?.actorItems ?? 0);

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
        this.#preview = await this.#migrationApi().previewMoreActivitiesMigration();
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
        this.#report = await this.#migrationApi().migrateMoreActivities({ preview: this.#preview });
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
        this.#restoreReport = await this.#migrationApi().restoreMoreActivitiesMigrationBackup({});
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
    this.render();
    try {
      await task();
    } catch (error) {
      console.error(`[${Constants.MODULE_ID}] Migration action failed.`, error);
      ui.notifications?.error?.(error?.message ?? String(error));
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  static #flattenPreviewEntries(preview) {
    return (preview?.entries ?? []).flatMap((entry) => {
      return (entry.activities ?? []).map((activity) => ({
        itemName: entry.itemName,
        sourceLabel: entry.source === "actor"
          ? `${entry.actorName ?? "-"}`
          : Constants.localize("SCMOREACTIVITIES.Migration.Fields.WorldItem", "World item"),
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
