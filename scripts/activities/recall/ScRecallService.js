import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ScChatRelay } from "../../support/ScChatRelay.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
import { ScRecallPickerApp } from "./ScRecallPickerApp.js";
import { ScRecallPortal } from "./ScRecallPortal.js";
import { ScRecallPortalPlacement } from "./ScRecallPortalPlacement.js";
import { ScRecallRange } from "./ScRecallRange.js";
import { ScRecallTravel } from "./ScRecallTravel.js";

const LANG = "SCMOREACTIVITIES.Activities.ScRecall";

/**
 * What happens on the user's client when a recall activity is used: who comes
 * along, binding a home when the user stands beside a recall point, and
 * whether the travel can run here or must go to the GM.
 */
export class ScRecallService {
  static async execute(activity) {
    const actor = activity?.actor ?? activity?.item?.actor ?? null;
    if (!actor) {
      ScRecallService.#warn("Warning.MissingActor", "This recall activity needs an actor.");
      return { canceled: true, reason: "missing-actor" };
    }

    const origin = ScCanvasActivityService.getOriginTokenObject(activity);
    if (!origin) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin",
        "Select or place the activity actor token on the scene first."
      ));
      return { canceled: true, reason: "missing-origin" };
    }

    const bindables = activity.recall?.mode === "home" ? ScRecallService.#bindables(activity, actor, origin) : [];
    const destination = await ScRecallService.#destination(activity, actor);
    if (destination.error && !bindables.length) {
      ScRecallService.#warnDestination(destination.error, actor);
      return { canceled: true, reason: destination.error };
    }

    // Through a portal everyone crosses on their own, so nobody is chosen up front.
    const portal = activity.recall?.delivery === "portal";
    const companions = portal ? [] : ScRecallService.#companions(activity, origin);
    // Always asked, even with nothing to choose: it confirms where the user is going before anyone moves.
    const choice = await ScRecallPickerApp.wait({
      destination,
      home: ScRecallTravel.homeOf(actor),
      companions,
      bindables,
      portal
    });
    if (!choice) {
      return { canceled: true, reason: "selection-canceled" };
    }

    if (choice.action === "bind") {
      return ScRecallService.#bind(actor, choice.token);
    }
    if (destination.error) {
      ScRecallService.#warnDestination(destination.error, actor);
      return { canceled: true, reason: destination.error };
    }
    return portal
      ? ScRecallService.#openPortal(activity, actor, origin, destination)
      : ScRecallService.#travel(activity, actor, origin, choice.companions ?? [], destination);
  }

  static async #openPortal(activity, actor, origin, destination) {
    const config = ScRecallPortal.config(activity);
    const entry = await ScRecallPortalPlacement.pick({
      origin,
      range: config.placementRange,
      rangeShape: config.rangeShape,
      squares: config.squares,
      shape: config.shape
    });
    if (!entry) {
      return { canceled: true, reason: "placement-canceled" };
    }
    const outcome = await ScRecallPortal.open(activity, actor, origin, destination.label, entry);
    if (outcome?.status === "opened") {
      return { canceled: false, action: "portal", travelled: 0, sceneUuid: outcome.sceneUuid };
    }
    if (outcome?.status === "no-gm") {
      ScRecallService.#warn("Warning.NoActiveGm", "An active GM is required to travel to another scene or with other players' tokens.");
      return { canceled: true, reason: "no-active-gm" };
    }
    if (!outcome) {
      ScRecallService.#warn("Warning.GmTimeout", "The GM did not answer the recall request in time.");
      return { canceled: true, reason: "gm-timeout" };
    }
    if (outcome.status === "blocked") {
      ScRecallService.#warn("Warning.PortalNoRoom", "There is no room for a portal at the destination.");
      return { canceled: false, action: "portal", travelled: 0, sceneUuid: outcome.sceneUuid, reason: "blocked" };
    }
    ScRecallService.#warn("Warning.Refused", "The recall was refused. The destination may no longer exist.");
    return { canceled: true, reason: "refused" };
  }

  /**
   * The destination as this client sees it. A player may be unable to load a
   * scene they have never been shown, so a destination that is configured but
   * out of reach here is still sent to the GM, who has the final say.
   */
  static async #destination(activity, actor) {
    const destination = await ScRecallTravel.resolveDestination(activity, actor);
    if (!destination.error || game?.user?.isGM) {
      return destination;
    }
    if (destination.error === "no-region" && activity.recall?.regionUuid) {
      return { kind: "region", scene: null, label: Constants.localize(`${LANG}.Picker.UnknownDestination`, "a distant place") };
    }
    if (destination.error === "home-lost") {
      const home = ScRecallTravel.homeOf(actor);
      return { kind: "home", scene: null, label: home.sceneName ? `${home.name} (${home.sceneName})` : home.name };
    }
    return destination;
  }

  /** Recall points close enough to bind, nearest first. */
  static #bindables(activity, actor, origin) {
    const range = Math.max(0, Number(activity.recall?.bindRange) || 0);
    const homeUuid = ScRecallTravel.homeOf(actor)?.tokenUuid ?? null;
    return ScRecallService.#nearbyTokens(origin, activity.recall?.rangeShape)
      .filter(({ token, distance }) => distance <= range && ScRecallTravel.isRecallPoint(token, activity))
      .map((entry) => ({ ...entry, isHome: entry.token.document?.uuid === homeUuid }));
  }

  /**
   * Creatures within the ally range, on the user's side unless the activity
   * takes anyone. Recall points stay behind; player characters start selected.
   */
  static #companions(activity, origin) {
    const range = Math.max(0, Number(activity.recall?.allyRange) || 0);
    if (range <= 0) {
      return [];
    }
    const alliesOnly = activity.recall?.allyFilter !== "any";
    const disposition = origin.document?.disposition;
    return ScRecallService.#nearbyTokens(origin, activity.recall?.rangeShape)
      .filter(({ token, distance }) => distance <= range
        && token.document?.hidden !== true
        && (!alliesOnly || token.document?.disposition === disposition)
        && !ScRecallTravel.isRecallPoint(token, activity))
      .map((entry) => ({ ...entry, selected: entry.token.actor?.hasPlayerOwner === true }));
  }

  static #nearbyTokens(origin, rangeShape) {
    return ScCanvasActivityService.getSceneTokens()
      .filter((token) => token !== origin && token.actor && ScCanvasActivityService.canPerceiveToken(token))
      .map((token) => ({ token, distance: ScRecallRange.between(origin, token, rangeShape) }))
      .sort((left, right) => left.distance - right.distance);
  }

  /** Binding only writes to the user's own character, so it never needs the GM. */
  static async #bind(actor, token) {
    const document = token.document ?? token;
    await actor.setFlag(Constants.MODULE_ID, "recallHome", {
      tokenUuid: document.uuid,
      name: document.name ?? token.name ?? "",
      sceneName: document.parent?.name ?? ""
    });
    ui.notifications?.info?.(Constants.format(
      `${LANG}.Info.HomeSet`,
      { actor: actor.name ?? "", name: document.name ?? "" },
      `${actor.name ?? "The actor"}'s home is now ${document.name ?? ""}.`
    ));
    return { canceled: false, action: "bind", homeUuid: document.uuid };
  }

  /**
   * Runs here when nothing needs a GM (the same scene and only the user's own
   * tokens, or the user is a GM); otherwise asks the GM.
   */
  static async #travel(activity, actor, origin, companions, destination) {
    const travellers = [origin, ...companions];
    const data = {
      activityUuid: activity.uuid,
      travellerUuids: travellers.map((token) => token.document?.uuid ?? token.uuid)
    };
    const local = game?.user?.isGM
      || (destination.scene && destination.scene === origin.document?.parent
        && travellers.every((token) => token.document?.isOwner ?? token.isOwner));

    if (local) {
      const outcome = await ScRecallTravel.execute(game.user, data);
      if (outcome.status !== "refused") {
        await ScRecallService.#postCard(actor, outcome);
      }
      return ScRecallService.#result(outcome.status, outcome);
    }

    if (!ScChatRelay.isAvailable()) {
      ScRecallService.#warn("Warning.NoActiveGm", "An active GM is required to travel to another scene or with other players' tokens.");
      return { canceled: true, reason: "no-active-gm" };
    }
    const answer = await ScRecallTravel.request({ actor, destinationLabel: destination.label, data });
    if (!answer) {
      ScRecallService.#warn("Warning.GmTimeout", "The GM did not answer the recall request in time.");
      return { canceled: true, reason: "gm-timeout" };
    }
    return ScRecallService.#result(answer.status, answer.answer ?? {});
  }

  static #result(status, { travelled = 0, sceneUuid = null } = {}) {
    if (status === "travelled") {
      return { canceled: false, action: "travel", travelled, sceneUuid };
    }
    if (status === "blocked") {
      ScRecallService.#warn("Warning.Blocked", "There was no room at the destination.");
      return { canceled: false, action: "travel", travelled: 0, sceneUuid, reason: "blocked" };
    }
    ScRecallService.#warn("Warning.Refused", "The recall was refused. The destination may no longer exist.");
    return { canceled: true, reason: "refused" };
  }

  static async #postCard(actor, outcome) {
    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: ScRecallTravel.chatCardContent(outcome)
      });
    } catch (error) {
      Logger.warn("Could not create sc-recall chat card.", error);
    }
  }

  static #warnDestination(error, actor) {
    if (error === "no-home") {
      ui.notifications?.warn?.(Constants.format(
        `${LANG}.Warning.NoHome`,
        { actor: actor.name ?? "" },
        `${actor.name ?? "The actor"} has no home yet. Use this next to a recall point to set one.`
      ));
    } else if (error === "home-lost") {
      ui.notifications?.warn?.(Constants.format(
        `${LANG}.Warning.HomeLost`,
        { actor: actor.name ?? "" },
        `${actor.name ?? "The actor"}'s home no longer exists.`
      ));
    } else {
      ScRecallService.#warn("Warning.NoRegion", "Choose a destination region for this activity.");
    }
  }

  static #warn(key, fallback) {
    ui.notifications?.warn?.(Constants.localize(`${LANG}.${key}`, fallback));
  }
}
