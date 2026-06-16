import { Constants } from "../constants/Constants.js";
import { ModuleSettings } from "./ModuleSettings.js";

const api = foundry?.applications?.api ?? {};
const { ApplicationV2, HandlebarsApplicationMixin } = api;
if (!ApplicationV2 || !HandlebarsApplicationMixin) {
  throw new Error(`${Constants.MODULE_ID}: ApplicationV2 and HandlebarsApplicationMixin are required to render PreviewColorMenu.`);
}

export class PreviewColorMenu extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["sc-more-activities", "sc-ma-preview-colors-app"],
    tag: "form",
    position: {
      width: 1040,
      height: 760
    },
    window: {
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
    this.selectedScope = "teleport";
  }

  async _prepareContext() {
    const scope = this.selectedScope;
    return {
      colors: this.draftColors,
      selectedScope: scope,
      isTeleportScope: scope === "teleport",
      isMovementScope: scope === "movement",
      isWallScope: scope === "wall",
      scopeOptions: [
        {
          value: "teleport",
          label: Constants.localize("SCMOREACTIVITIES.Settings.PreviewColorsMenu.Sections.Teleport", "Teleport"),
          selected: scope === "teleport"
        },
        {
          value: "movement",
          label: Constants.localize("SCMOREACTIVITIES.Settings.PreviewColorsMenu.Sections.Movement", "Movement"),
          selected: scope === "movement"
        },
        {
          value: "wall",
          label: Constants.localize("SCMOREACTIVITIES.Settings.PreviewColorsMenu.Sections.Wall", "Wall"),
          selected: scope === "wall"
        }
      ]
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    this.#bindColorControls();
    this.#applyPreviewStyles();
    this.element.querySelector("[name='selectedScope']")?.addEventListener("change", (event) => {
      this.selectedScope = ["teleport", "movement", "wall"].includes(event.currentTarget.value)
        ? event.currentTarget.value
        : "teleport";
      this.render();
    });

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

    const styles = {
      "--sc-ma-preview-teleport-border": this.draftColors.teleportRangeBorder,
      "--sc-ma-preview-teleport-fill": this.draftColors.teleportRangeFill,
      "--sc-ma-preview-movement-border": this.draftColors.movementRangeBorder,
      "--sc-ma-preview-movement-fill": this.draftColors.movementRangeFill,
      "--sc-ma-preview-wall-border": this.draftColors.wallRangeBorder,
      "--sc-ma-preview-wall-fill": this.draftColors.wallRangeFill
    };

    for (const [name, value] of Object.entries(styles)) {
      root.style.setProperty(name, value);
    }
  }

  #normalizeHexColor(value) {
    const normalized = String(value ?? "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : null;
  }
}
