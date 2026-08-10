export class ScDocumentWindowMinimizer {
  static minimizeOpenWindows(excludedApp = null) {
    const minimized = [];
    const consider = (app) => {
      if (!app || app === excludedApp || app.minimized || app.rendered === false) {
        return;
      }
      if (typeof app.minimize !== "function") {
        return;
      }
      minimized.push(app);
    };

    for (const app of Object.values(globalThis.ui?.windows ?? {})) {
      consider(app);
    }

    const DocumentSheetV2 = foundry.applications?.api?.DocumentSheetV2;
    const instances = foundry.applications?.instances;
    if (DocumentSheetV2 && instances?.values) {
      for (const app of instances.values()) {
        if (app instanceof DocumentSheetV2) {
          consider(app);
        }
      }
    }

    for (const app of minimized) {
      try {
        app.minimize?.();
      } catch (error) {
        // Ignore windows that refuse to minimize.
      }
    }
    return minimized;
  }

  static restoreWindows(windows = []) {
    for (const app of windows) {
      try {
        app.maximize?.();
      } catch (error) {
        // Ignore windows that refuse to restore.
      }
    }
  }
}
