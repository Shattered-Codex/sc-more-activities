import { Constants } from "../constants/Constants.js";
import { ModuleSettings } from "./ModuleSettings.js";

/** Preview scopes, in the order they appear in the picker. */
const SCOPES = ["teleport", "movement", "wall", "portal"];
const SCOPE_ICONS = Object.freeze({
  teleport: "fa-solid fa-bolt",
  movement: "fa-solid fa-arrows-up-down-left-right",
  wall: "fa-solid fa-block-brick",
  portal: "fa-solid fa-dungeon"
});
const DEFAULT_SCOPE = "teleport";

const api = foundry?.applications?.api ?? {};
const { ApplicationV2, HandlebarsApplicationMixin } = api;
if (!ApplicationV2 || !HandlebarsApplicationMixin) {
  throw new Error(`${Constants.MODULE_ID}: ApplicationV2 and HandlebarsApplicationMixin are required to render PreviewColorMenu.`);
}

export class PreviewColorMenu extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    // Shares the settings window's theme and shell, like the catalog and the
    // migration tools; the scopes become the rail.
    classes: ["sc-more-activities", "sc-ma-config-theme", "sc-ma-preview-colors-app"],
    tag: "form",
    position: {
      width: 820,
      height: 640
    },
    window: {
      contentClasses: ["sc-ma-config-theme"],
      icon: "fas fa-palette",
      resizable: true,
      title: Constants.localize("SCMOREACTIVITIES.Settings.PreviewColorsMenu.Name", "Preview colors")
    }
  };

  static PARTS = {
    form: {
      template: `modules/${Constants.MODULE_ID}/templates/applications/preview-colors-settings.hbs`
    }
  };

  constructor(options = {}) {
    super(options);
    this.draftColors = foundry.utils.deepClone(ModuleSettings.getPreviewColors());
    this.selectedScope = DEFAULT_SCOPE;
  }

  async _prepareContext() {
    const scope = this.selectedScope;
    return {
      selectedScope: scope,
      scopeLabel: PreviewColorMenu.#scopeLabel(scope),
      scopeHint: PreviewColorMenu.#scopeHint(scope),
      isTeleportScope: scope === "teleport",
      isMovementScope: scope === "movement",
      isWallScope: scope === "wall",
      isPortalScope: scope === "portal",
      colorFields: this.#colorFields(scope),
      scopeOptions: SCOPES.map((value) => ({
        value,
        label: PreviewColorMenu.#scopeLabel(value),
        icon: SCOPE_ICONS[value],
        selected: scope === value
      }))
    };
  }

  /**
   * The two colour inputs of the active scope. Every scope has the same pair,
   * so the template renders this list instead of repeating the markup per scope.
   */
  #colorFields(scope) {
    return [
      { key: `${scope}RangeFill`, suffix: "fill", labelKey: "Fill" },
      { key: `${scope}RangeBorder`, suffix: "border", labelKey: "Border" }
    ].map(({ key, suffix, labelKey }) => ({
      key,
      id: `sc-ma-${scope}-range-${suffix}`,
      label: Constants.localize(
        `SCMOREACTIVITIES.Settings.PreviewColorsMenu.Fields.${labelKey}.Label`,
        labelKey
      ),
      hint: Constants.localize(
        `SCMOREACTIVITIES.Settings.PreviewColorsMenu.Fields.${labelKey}.Hint`,
        labelKey
      ),
      value: this.draftColors[key]
    }));
  }

  static #scopeLabel(scope) {
    const name = scope.charAt(0).toUpperCase() + scope.slice(1);
    return Constants.localize(`SCMOREACTIVITIES.Settings.PreviewColorsMenu.Sections.${name}`, name);
  }

  static #scopeHint(scope) {
    const name = scope.charAt(0).toUpperCase() + scope.slice(1);
    return Constants.localize(
      `SCMOREACTIVITIES.Settings.PreviewColorsMenu.Hints.${name}`,
      "Colors used by this preview overlay, for your user only."
    );
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    this.#bindColorControls();
    this.#applyPreviewStyles();
    for (const button of this.element.querySelectorAll("[data-action='switchScope']")) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const scope = event.currentTarget.dataset.scope;
        if (!SCOPES.includes(scope) || scope === this.selectedScope) {
          return;
        }
        this.selectedScope = scope;
        this.render();
      });
    }

    this.element.querySelector("[data-action='save']")?.addEventListener("click", async (event) => {
      event.preventDefault();
      await this.#saveColors();
    });
    this.element.querySelector("[data-action='reset']")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.draftColors = foundry.utils.deepClone(ModuleSettings.DEFAULT_PREVIEW_COLORS);
      this.render();
    });
    this.element.querySelector("[data-action='cancel']")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.close();
    });
  }

  #bindColorControls() {
    const controls = this.element.querySelectorAll(".sc-ma-color-control");
    for (const control of controls) {
      const colorInput = control.querySelector('input[type="color"]');
      const hexInput = control.querySelector(".sc-ma-hex-input");
      if (!colorInput || !hexInput) {
        continue;
      }

      const syncHexFromColor = () => {
        const normalized = this.#normalizeHexColor(colorInput.value) ?? "#000000";
        hexInput.value = normalized;
        hexInput.classList.remove("is-invalid");
        this.draftColors[colorInput.name] = normalized;
      };

      const applyHexToColor = ({ commit = false } = {}) => {
        const normalized = this.#normalizeHexColor(hexInput.value);
        if (!normalized) {
          if (commit) {
            syncHexFromColor();
          } else {
            hexInput.classList.add("is-invalid");
          }
          return false;
        }

        hexInput.classList.remove("is-invalid");
        hexInput.value = normalized;
        colorInput.value = normalized.toLowerCase();
        this.draftColors[colorInput.name] = normalized;
        return true;
      };

      syncHexFromColor();

      colorInput.addEventListener("input", () => {
        syncHexFromColor();
        this.#applyPreviewStyles();
      });
      colorInput.addEventListener("change", () => {
        syncHexFromColor();
        this.#applyPreviewStyles();
      });
      hexInput.addEventListener("input", () => {
        if (applyHexToColor()) {
          this.#applyPreviewStyles();
        }
      });

      const commitHexInput = () => {
        applyHexToColor({ commit: true });
        this.#applyPreviewStyles();
      };
      hexInput.addEventListener("change", commitHexInput);
      hexInput.addEventListener("blur", commitHexInput);
    }
  }

  async #saveColors() {
    await game.settings.set(Constants.MODULE_ID, ModuleSettings.PREVIEW_COLORS, this.draftColors);
    ui.notifications?.info?.(Constants.localize(
      "SCMOREACTIVITIES.Settings.PreviewColorsMenu.Saved",
      "Preview colors updated."
    ));
    await this.close();
  }

  #applyPreviewStyles() {
    const root = this.element.querySelector(".sc-ma-preview-colors-shell");
    if (!root) {
      return;
    }

    const styles = {};
    for (const scope of SCOPES) {
      styles[`--sc-ma-preview-${scope}-border`] = this.draftColors[`${scope}RangeBorder`];
      styles[`--sc-ma-preview-${scope}-fill`] = this.draftColors[`${scope}RangeFill`];
    }

    for (const [name, value] of Object.entries(styles)) {
      root.style.setProperty(name, value);
    }
  }

  #normalizeHexColor(value) {
    const normalized = String(value ?? "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : null;
  }
}
