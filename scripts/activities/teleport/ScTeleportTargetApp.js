import { Constants } from "../../constants/Constants.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
import { ScTeleportDestinationApp } from "./ScTeleportDestinationApp.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ScTeleportTargetApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sc-more-activities", "sc-ma-teleport-target-app"],
    tag: "form",
    position: {
      width: 360,
      height: "auto"
    }
  };

  static PARTS = {
    form: {
      template: "modules/sc-more-activities/templates/applications/sc-teleport-target.hbs"
    }
  };

  constructor(activity, options = {}) {
    super({
      window: {
        title: Constants.localize("SCMOREACTIVITIES.Activities.ScTeleport.App.Targets.Title", "Teleport Targets")
      },
      ...options
    });
    this.activity = activity;
    this.selectedTargets = [];
    this.#prepopulateTargets();
  }

  async _prepareContext() {
    const config = this.#config();
    const origin = ScCanvasActivityService.getOriginTokenObject(this.activity);
    return {
      config,
      originName: origin?.name ?? origin?.document?.name ?? "",
      selectedTargets: this.selectedTargets.map((target, index) => ({
        ...target,
        index
      })),
      tokenGroups: this.#availableTokens(origin, config)
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const origin = ScCanvasActivityService.getOriginTokenObject(this.activity);
    if (!origin) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin",
        "Select or place the activity actor token on the scene first."
      ));
      await this.close();
      return;
    }

    const config = this.#config();
    if (origin && config.onlyTargetSelf) {
      this.selectedTargets = [this.#targetData(origin, 0)];
      this.#openDestination();
      return;
    }

    this.element.querySelector("select[name='targetId']")?.addEventListener("change", (event) => {
      const tokenId = event.currentTarget.value;
      if (!tokenId) {
        return;
      }

      const token = ScCanvasActivityService.getSceneTokens().find((candidate) => this.#tokenId(candidate) === tokenId);
      if (token) {
        this.#addTarget(token);
      }
      event.currentTarget.value = "";
    });

    this.element.querySelectorAll(".sc-ma-target-delete").forEach((button) => {
      button.addEventListener("click", (event) => {
        const index = Number(event.currentTarget.dataset.index);
        if (Number.isInteger(index)) {
          this.selectedTargets.splice(index, 1);
          this.render();
        }
      });
    });

    this.element.querySelector(".sc-ma-teleport-start")?.addEventListener("click", () => {
      this.#openDestination();
    });
  }

  #addTarget(token) {
    const config = this.#config();
    if (this.selectedTargets.length >= config.maxTargets) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScTeleport.Warning.MaximumTargets",
        "Maximum teleport targets reached."
      ));
      return;
    }

    const tokenId = this.#tokenId(token);
    if (!tokenId || this.selectedTargets.some((target) => target.id === tokenId)) {
      return;
    }

    const origin = ScCanvasActivityService.getOriginTokenObject(this.activity);
    const distance = origin ? ScCanvasActivityService.sceneDistanceBetweenTokens(origin, token) : 0;
    if (config.targetRadius > 0 && distance > config.targetRadius) {
      ui.notifications?.warn?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScTeleport.Warning.TargetOutOfRange",
        { range: config.targetRadius },
        `Target must be within ${config.targetRadius} ft.`
      ));
      return;
    }

    this.selectedTargets.push(this.#targetData(token, distance));
    this.render();
  }

  #openDestination() {
    if (!this.selectedTargets.length) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingTargets",
        "Select at least one target token."
      ));
      return;
    }

    new ScTeleportDestinationApp(this.activity, this.selectedTargets).render(true);
    this.close();
  }

  #availableTokens(origin, config) {
    const selected = new Set(this.selectedTargets.map((target) => target.id));
    const selfTokens = [];
    const otherTokens = [];

    for (const token of ScCanvasActivityService.getSceneTokens()) {
      const tokenId = this.#tokenId(token);
      if (!tokenId || selected.has(tokenId)) {
        continue;
      }
      if (!ScCanvasActivityService.canMoveToken(token)) {
        continue;
      }

      const isOrigin = origin && this.#tokenId(origin) === tokenId;
      if (isOrigin && !config.targetSelf) {
        continue;
      }

      const distance = origin ? ScCanvasActivityService.sceneDistanceBetweenTokens(origin, token) : 0;
      if (config.targetRadius > 0 && distance > config.targetRadius) {
        continue;
      }

      const data = this.#targetData(token, distance);
      if (isOrigin) {
        selfTokens.push(data);
      } else {
        otherTokens.push(data);
      }
    }

    return { selfTokens, otherTokens };
  }

  #prepopulateTargets() {
    const config = this.#config();
    const origin = ScCanvasActivityService.getOriginTokenObject(this.activity);
    for (const target of Array.from(game?.user?.targets ?? [])) {
      const token = target?.document?.object ?? target;
      if (!token) {
        continue;
      }
      if (!ScCanvasActivityService.canMoveToken(token)) {
        continue;
      }

      const distance = origin ? ScCanvasActivityService.sceneDistanceBetweenTokens(origin, token) : 0;
      const tokenId = this.#tokenId(token);
      const isOrigin = origin && this.#tokenId(origin) === tokenId;
      if (isOrigin && !config.targetSelf) {
        continue;
      }
      if (config.targetRadius > 0 && distance > config.targetRadius) {
        continue;
      }

      if (tokenId && !this.selectedTargets.some((selected) => selected.id === tokenId)) {
        this.selectedTargets.push(this.#targetData(token, distance));
      }
      if (this.selectedTargets.length >= config.maxTargets) {
        break;
      }
    }
  }

  #targetData(token, distance) {
    return {
      id: this.#tokenId(token),
      name: token?.name ?? token?.document?.name ?? "",
      distance: Math.round(Number(distance) || 0)
    };
  }

  #tokenId(token) {
    return token?.document?.id ?? token?.id ?? "";
  }

  #config() {
    const config = this.activity?.teleport ?? {};
    const onlyTargetSelf = Boolean(config.onlyTargetSelf);
    return {
      // "Only self" always teleports a single token (the actor), regardless of
      // any previously configured maximum.
      maxTargets: onlyTargetSelf ? 1 : Math.max(1, Number(config.maxTargets ?? 1) || 1),
      targetSelf: Boolean(config.targetSelf) || onlyTargetSelf,
      onlyTargetSelf,
      targetRadius: Math.max(0, Number(config.targetRadius ?? 15) || 0)
    };
  }
}
