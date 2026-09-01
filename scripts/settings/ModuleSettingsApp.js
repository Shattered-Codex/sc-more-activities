import { Constants } from "../constants/Constants.js";
import { SETTINGS_KEYS } from "../constants/SettingsKeys.js";
import { ModuleSettingsCatalog, SETTING_FIELD_TYPES } from "./ModuleSettingsCatalog.js";

const api = foundry?.applications?.api ?? {};
const { ApplicationV2, HandlebarsApplicationMixin } = api;
if (!ApplicationV2 || !HandlebarsApplicationMixin) {
  throw new Error(`${Constants.MODULE_ID}: ApplicationV2 and HandlebarsApplicationMixin are required to render ModuleSettingsApp.`);
}

const MODULE_SETTINGS_MENU_KEY = `${Constants.MODULE_ID}.${SETTINGS_KEYS.MODULE_SETTINGS_MENU}`;
const FORM_ID = `${Constants.MODULE_ID}-module-settings`;

/**
 * The module's configuration window: an icon rail on the left, one scrollable
 * panel per section, and a footer carrying an unsaved-changes pill next to the
 * actions.
 *
 * Saving keeps the window open. A GM usually adjusts more than one tab in a
 * sitting, and closing on save would hide the confirmation it just earned.
 */
export class ModuleSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #root = null;
  #activeTab = null;
  #baselines = {};
  #saved = false;
  #inputListener;
  #keydownListener;

  static DEFAULT_OPTIONS = {
    id: FORM_ID,
    classes: ["sc-more-activities", "sc-ma-config-theme"],
    tag: "form",
    position: {
      width: 880,
      height: 620
    },
    window: {
      contentClasses: ["sc-ma-config-theme"],
      icon: "fa-solid fa-sliders",
      resizable: true,
      title: Constants.localize("SCMOREACTIVITIES.Settings.Window.Title", "More Activities — Configuration")
    }
  };

  static PARTS = {
    body: {
      template: `modules/${Constants.MODULE_ID}/templates/applications/module-settings.hbs`
    }
  };

  constructor(options = {}) {
    super(options);
    this.#inputListener = () => this.#refreshDirtyUI();
    this.#keydownListener = (event) => this.#handleTabKeydown(event);
  }

  static open(options = {}) {
    const app = new ModuleSettingsApp(options);
    app.render(true);
    return app;
  }

  /** Marks the settings-list button so it picks up the module's styling. */
  static bindSettingsButton(html) {
    const root = ModuleSettingsApp.#resolveRoot(html);
    if (!root) {
      return;
    }

    const candidates = root.querySelectorAll([
      `[data-setting-id="${MODULE_SETTINGS_MENU_KEY}"]`,
      `[data-menu-id="${MODULE_SETTINGS_MENU_KEY}"]`,
      `[data-key="${MODULE_SETTINGS_MENU_KEY}"]`,
      `[data-setting="${MODULE_SETTINGS_MENU_KEY}"]`
    ].join(","));

    for (const candidate of candidates) {
      const button = candidate instanceof HTMLButtonElement
        ? candidate
        : candidate.querySelector("button");
      if (button) {
        button.classList.add("sc-ma-module-settings-button");
      }
    }
  }

  async _prepareContext() {
    return ModuleSettingsCatalog.buildContext({
      isGM: this.#isGM(),
      readSetting: (key) => ModuleSettingsApp.#readSetting(key),
      activeTab: this.#activeTab,
      formId: FORM_ID
    });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    this.#unbindRoot();
    this.#root = this.element;
    this.#activeTab = context?.activeTab ?? this.#activeTab;

    this.#root.addEventListener("click", (event) => this.#handleClick(event));
    this.#root.addEventListener("input", this.#inputListener);
    this.#root.addEventListener("change", this.#inputListener);
    this.#root.addEventListener("keydown", this.#keydownListener);
    // A form tag without a submit handler would reload the page on Enter.
    this.#root.addEventListener("submit", (event) => event.preventDefault());

    this.#captureBaselines();
    this.#saved = false;
    this.#refreshDirtyUI();
  }

  _onClose(options) {
    this.#unbindRoot();
    this.#root = null;
    super._onClose?.(options);
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------

  selectTab(tabId) {
    const resolved = ModuleSettingsCatalog.resolveTab(tabId, this.#isGM());
    if (!resolved || resolved !== tabId) {
      return;
    }
    this.#activeTab = resolved;

    const root = this.#root;
    if (!root) {
      return;
    }

    for (const button of root.querySelectorAll("[data-tab-target]")) {
      const active = button.dataset.tabTarget === resolved;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.setAttribute("tabindex", active ? "0" : "-1");
    }
    for (const panel of root.querySelectorAll("[data-tab-panel]")) {
      panel.hidden = panel.dataset.tabPanel !== resolved;
    }
  }

  #handleTabKeydown(event) {
    const tab = event.target instanceof HTMLElement ? event.target.closest('[role="tab"]') : null;
    const tablist = tab?.closest?.('[role="tablist"]');
    if (!tab || !tablist) {
      return;
    }

    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]:not([disabled])'));
    const index = tabs.indexOf(tab);
    if (index < 0) {
      return;
    }

    let nextIndex = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (index + 1) % tabs.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (index - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const next = tabs[nextIndex];
    next?.focus?.();
    next?.click?.();
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  #handleClick(event) {
    const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    switch (target.dataset.action) {
      case "switchTab":
        event.preventDefault();
        this.selectTab(target.dataset.tabTarget);
        break;
      case "resetActiveTab":
        event.preventDefault();
        this.resetActiveTab();
        break;
      case "save":
        event.preventDefault();
        void this.#save();
        break;
      case "close":
        event.preventDefault();
        void this.close();
        break;
      default:
        break;
    }
  }

  /**
   * Restores the visible tab's controls to their declared defaults. Nothing is
   * written until the user saves, so a reset stays cancellable.
   */
  resetActiveTab() {
    const panel = this.#root?.querySelector?.(`[data-tab-panel="${this.#activeTab}"]`);
    if (!panel) {
      return;
    }

    for (const input of panel.querySelectorAll("input[type='number'][data-default-value]")) {
      input.value = input.dataset.defaultValue;
    }
    for (const input of panel.querySelectorAll("input[type='checkbox'][data-default-checked]")) {
      input.checked = input.dataset.defaultChecked === "true";
    }

    this.#refreshDirtyUI();
  }

  async #save() {
    const writes = ModuleSettingsCatalog.collectWrites(this.#readForm(), { isGM: this.#isGM() });

    try {
      for (const { key, value } of writes) {
        await game.settings.set(Constants.MODULE_ID, key, value);
      }
    } catch (error) {
      ui.notifications?.error?.(Constants.format(
        "SCMOREACTIVITIES.Settings.Window.SaveFailed",
        { error: error?.message ?? String(error) },
        `Could not save settings: ${error?.message ?? String(error)}`
      ));
      return;
    }

    this.#captureBaselines();
    this.#saved = true;
    this.#refreshDirtyUI();
  }

  // ---------------------------------------------------------------------------
  // Dirty tracking
  // ---------------------------------------------------------------------------

  /** Reads the controls back as raw values; the catalog does the normalizing. */
  #readForm() {
    const values = {};
    for (const field of ModuleSettingsCatalog.fields()) {
      const control = this.#root?.querySelector?.(`[name="${field.key}"]`);
      if (!control) {
        continue;
      }
      values[field.key] = field.type === SETTING_FIELD_TYPES.CHECKBOX ? control.checked : control.value;
    }
    return values;
  }

  #captureBaselines() {
    const values = this.#readForm();
    this.#baselines = {};
    for (const tabId of ModuleSettingsCatalog.tabIds(this.#isGM())) {
      this.#baselines[tabId] = ModuleSettingsCatalog.snapshot(tabId, values);
    }
  }

  #refreshDirtyUI() {
    const root = this.#root;
    if (!root) {
      return;
    }

    const values = this.#readForm();
    let anyDirty = false;
    for (const tabId of ModuleSettingsCatalog.tabIds(this.#isGM())) {
      const dirty = ModuleSettingsCatalog.snapshot(tabId, values) !== this.#baselines[tabId];
      anyDirty ||= dirty;
      const dot = root.querySelector(`[data-tab-dot="${tabId}"]`);
      if (dot) {
        dot.hidden = !dirty;
      }
    }
    if (anyDirty) {
      this.#saved = false;
    }

    const saveButton = root.querySelector("[data-save-button]");
    saveButton?.classList?.toggle("is-dirty", anyDirty);

    const pill = root.querySelector("[data-status-pill]");
    const label = root.querySelector("[data-status-pill-label]");
    if (!pill || !label) {
      return;
    }

    pill.classList.remove("sc-ma-config-pill--unsaved", "sc-ma-config-pill--saved");
    if (anyDirty) {
      pill.hidden = false;
      pill.classList.add("sc-ma-config-pill--unsaved");
      label.textContent = Constants.localize("SCMOREACTIVITIES.Settings.Window.Unsaved", "Unsaved changes");
    } else if (this.#saved) {
      pill.hidden = false;
      pill.classList.add("sc-ma-config-pill--saved");
      label.textContent = Constants.localize("SCMOREACTIVITIES.Settings.Window.SavedPill", "Saved");
    } else {
      pill.hidden = true;
      label.textContent = "";
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  #unbindRoot() {
    if (!this.#root) {
      return;
    }
    this.#root.removeEventListener("input", this.#inputListener);
    this.#root.removeEventListener("change", this.#inputListener);
    this.#root.removeEventListener("keydown", this.#keydownListener);
  }

  #isGM() {
    return game?.user?.isGM === true;
  }

  static #readSetting(key) {
    try {
      if (!game?.settings?.settings?.has?.(`${Constants.MODULE_ID}.${key}`)) {
        return undefined;
      }
      return game.settings.get(Constants.MODULE_ID, key);
    } catch {
      return undefined;
    }
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
