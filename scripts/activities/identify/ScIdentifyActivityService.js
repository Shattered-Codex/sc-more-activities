import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
import { ScIdentifyCard } from "./ScIdentifyCard.js";
import { ScIdentifyPickerApp } from "./ScIdentifyPickerApp.js";
import { ScChatRelay } from "../../support/ScChatRelay.js";
import { ScIdentifyRelay } from "./ScIdentifyRelay.js";

const LANG = "SCMOREACTIVITIES.Activities.ScIdentify";

export class ScIdentifyActivityService {
  static async execute(activity) {
    const sourceActor = activity?.actor ?? activity?.item?.actor ?? null;
    if (!sourceActor) {
      ScIdentifyActivityService.#warn("Warning.MissingActor", "This identify activity needs an actor.");
      return { canceled: true, reason: "missing-actor" };
    }

    const resolved = ScIdentifyActivityService.#resolveCandidates(activity, sourceActor);
    if (!resolved) {
      return { canceled: true, reason: "missing-recipient" };
    }

    const candidates = resolved.candidates
      .map((candidate) => ({ ...candidate, items: ScIdentifyActivityService.unidentifiedItems(candidate.actor) }))
      .filter((candidate) => candidate.items.length);
    if (!candidates.length) {
      ScIdentifyActivityService.#notifyNothingToIdentify(activity, resolved.candidates);
      return { canceled: true, reason: "no-items" };
    }

    // Another player's actor can only be written by the GM, so without one
    // online those creatures are dropped before anything is shown.
    const reachable = ScChatRelay.isAvailable()
      ? candidates
      : candidates.filter((candidate) => !ScIdentifyActivityService.#needsRelay(candidate.actor));
    if (!reachable.length) {
      ScIdentifyActivityService.#warn("Warning.NoActiveGm", "An active GM is required to identify this actor's items.");
      return { canceled: true, reason: "no-active-gm" };
    }

    const choice = await ScIdentifyPickerApp.wait({
      candidates: reachable,
      checkLabel: ScIdentifyActivityService.#checkLabel(activity?.check)
    });
    if (!choice) {
      return { canceled: true, reason: "selection-canceled" };
    }

    const { candidate, item } = choice;
    try {
      return ScIdentifyActivityService.#needsRelay(candidate.actor)
        ? await ScIdentifyActivityService.#identifyThroughGm(activity, sourceActor, candidate, resolved.origin, item)
        : await ScIdentifyActivityService.#identifyLocally(activity, sourceActor, candidate.actor, item);
    } catch (error) {
      Logger.error("Could not execute sc-identify activity.", error);
      ui.notifications?.error?.(Constants.format(
        `${LANG}.Error.ExecutionFailed`,
        { error: error?.message ?? String(error) },
        `Could not identify the item: ${error?.message ?? String(error)}`
      ));
      return { canceled: true, reason: "error", actor: candidate.actor, item, error };
    }
  }

  static unidentifiedItems(actor) {
    return Array.from(actor?.items ?? []).filter((item) => item?.system?.identified === false);
  }

  static isCheckEnabled(check) {
    return Boolean(String(check?.ability ?? "").trim() || String(check?.skill ?? "").trim());
  }

  /** Reach of the "target" and "choose" modes in scene units; 0 means unlimited. */
  static rangeOf(activity) {
    return Math.max(0, Number(activity?.identify?.range) || 0);
  }

  /**
   * The check DC for `item`. With a custom formula every item shares it; by
   * rarity, the DC of the item's rarity applies, and an item whose rarity
   * varies (dnd5e 6.0 `system.rarities`) uses the hardest one. The default DC
   * covers items without a rarity, rarities left blank, and formulas that do
   * not resolve.
   */
  static dcForItem(activity, item) {
    const identify = activity?.identify ?? {};
    const defaultDc = ScIdentifyActivityService.#toDc(identify.defaultDc) ?? 10;
    if (identify.dcMode === "formula") {
      return ScIdentifyActivityService.#formulaDc(activity) ?? defaultDc;
    }

    const dcs = identify.rarityDcs ?? {};
    const rarityDcs = ScIdentifyActivityService.#itemRarities(item)
      .map((rarity) => ScIdentifyActivityService.#toDc(dcs[rarity]) ?? defaultDc);
    return rarityDcs.length ? Math.max(...rarityDcs) : defaultDc;
  }

  /**
   * Rolls the configured check against `dc` and returns the roll, or `null`
   * when it was canceled or cannot be rolled. `configure: false` skips the
   * roll dialog, for a check the GM rolls on the user's behalf.
   */
  static async rollCheck(actor, check, dc, { configure = true } = {}) {
    const skill = String(check?.skill ?? "").trim();
    const ability = String(check?.ability ?? "").trim();
    const dialog = configure ? {} : { configure: false };
    let rolls = null;
    if (skill && typeof actor?.rollSkill === "function") {
      rolls = await actor.rollSkill({ skill, ability: ability || undefined, target: dc }, dialog, {});
    } else if (ability && typeof actor?.rollAbilityCheck === "function") {
      rolls = await actor.rollAbilityCheck({ ability, target: dc }, dialog, {});
    } else {
      ScIdentifyActivityService.#warn("Warning.CheckUnavailable", "Could not roll the configured identify check.");
      return null;
    }

    if (Array.isArray(rolls)) {
      return rolls.find((roll) => Number.isFinite(Number(roll?.total))) ?? null;
    }
    return Number.isFinite(Number(rolls?.total)) ? rolls : null;
  }

  /** The chat card for an identification; see `ScIdentifyCard.content`. */
  static chatCardContent(outcome = {}) {
    return ScIdentifyCard.content(outcome);
  }

  /** The configured check's skill or ability, such as "Arcana", for cards and labels. */
  static checkName(check) {
    const abilities = globalThis.CONFIG?.DND5E?.abilities ?? {};
    const skills = globalThis.CONFIG?.DND5E?.skills ?? {};
    const ability = String(check?.ability ?? "").trim();
    const skill = String(check?.skill ?? "").trim();
    return skill ? (skills[skill]?.label ?? skill) : (abilities[ability]?.label ?? ability);
  }

  static async #identifyLocally(activity, identifier, owner, item) {
    let check = null;
    if (ScIdentifyActivityService.isCheckEnabled(activity?.check)) {
      const dc = ScIdentifyActivityService.dcForItem(activity, item);
      const roll = await ScIdentifyActivityService.rollCheck(identifier, activity.check, dc);
      if (!roll) {
        return { canceled: true, reason: "check-canceled", actor: owner, item };
      }
      check = { dc, total: Number(roll.total) || 0 };
      if (check.total < dc) {
        ScIdentifyActivityService.#notifyCheckFailed(identifier, item);
        return { canceled: false, identified: false, actor: owner, item, check };
      }
    }

    // Read before identifying: once identified, the item shows its true name.
    const formerName = item.name ?? "";
    await item.update({ "system.identified": true });
    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: identifier }),
        content: ScIdentifyActivityService.chatCardContent({
          status: "identified",
          identifier,
          owner,
          item,
          formerName,
          check,
          checkName: ScIdentifyActivityService.checkName(activity?.check)
        })
      });
    } catch (error) {
      Logger.warn("Could not create sc-identify chat card.", error);
    }
    return { canceled: false, identified: true, actor: owner, item, check };
  }

  /** The GM validates the request and rolls the check, so no total is sent. */
  static async #identifyThroughGm(activity, identifier, candidate, origin, item) {
    const owner = candidate.actor;
    const answer = await ScIdentifyRelay.request({ activity, identifier, candidate, origin, item });
    if (!answer) {
      ScIdentifyActivityService.#warn("Warning.GmTimeout", "The GM did not answer the identify request in time.");
      return { canceled: true, reason: "gm-timeout", actor: owner, item };
    }

    const check = answer.check ?? null;
    if (answer.status === "identified") {
      return { canceled: false, identified: true, actor: owner, item, check };
    }
    if (answer.status === "failed") {
      ScIdentifyActivityService.#notifyCheckFailed(identifier, item);
      return { canceled: false, identified: false, actor: owner, item, check };
    }
    ScIdentifyActivityService.#warn("Warning.InvalidRequest", "The identify request is no longer valid.");
    return { canceled: true, reason: "gm-refused", actor: owner, item };
  }

  static #needsRelay(actor) {
    return !game?.user?.isGM && !actor?.isOwner;
  }

  static #resolveCandidates(activity, sourceActor) {
    const mode = activity?.recipient;
    if (mode === "target") {
      const targets = Array.from(game?.user?.targets ?? []);
      if (targets.length !== 1) {
        ScIdentifyActivityService.#warn("Warning.TargetRequired", "Target exactly one token whose item will be identified.");
        return null;
      }
      const token = targets[0];
      if (!token?.actor) {
        ScIdentifyActivityService.#warn("Warning.TargetActorMissing", "The selected target token does not have a valid actor.");
        return null;
      }
      return ScIdentifyActivityService.#resolveTarget(activity, sourceActor, token);
    }

    if (mode !== "choose") {
      return { origin: null, candidates: [{ actor: sourceActor, token: null, isSelf: true }] };
    }

    // Without a token on the scene there is nothing to measure from, so the
    // user can still search their own inventory.
    const origin = ScCanvasActivityService.getOriginTokenObject(activity);
    if (!origin) {
      return { origin: null, candidates: [{ actor: sourceActor, token: null, isSelf: true }] };
    }

    const range = ScIdentifyActivityService.rangeOf(activity);
    const rangeShape = activity.identify?.rangeShape;
    const others = ScCanvasActivityService.getSceneTokens()
      .filter((token) => token !== origin && token.actor && token.actor !== sourceActor)
      .filter((token) => ScCanvasActivityService.canPerceiveToken(token))
      .map((token) => ({
        actor: token.actor,
        token,
        isSelf: false,
        distance: ScCanvasActivityService.rangeDistanceBetweenTokens(origin, token, rangeShape)
      }))
      .filter((candidate) => range <= 0 || candidate.distance <= range)
      .sort((left, right) => left.distance - right.distance);
    return {
      origin,
      candidates: [{ actor: sourceActor, token: origin, isSelf: true, distance: 0 }, ...others]
    };
  }

  /** A targeted token, measured from the user's token unless the range is unlimited. */
  static #resolveTarget(activity, sourceActor, token) {
    const isSelf = token.actor === sourceActor;
    const range = ScIdentifyActivityService.rangeOf(activity);
    if (range <= 0) {
      return { origin: null, candidates: [{ actor: token.actor, token, isSelf }] };
    }

    const origin = ScCanvasActivityService.getOriginTokenObject(activity);
    if (!origin) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin",
        "Select or place the activity actor token on the scene first."
      ));
      return null;
    }

    const distance = ScCanvasActivityService.rangeDistanceBetweenTokens(origin, token, activity.identify?.rangeShape);
    if (distance > range) {
      const units = globalThis.canvas?.scene?.grid?.units || "ft";
      ui.notifications?.warn?.(Constants.format(
        `${LANG}.Warning.TargetOutOfRange`,
        { name: token.name ?? token.actor.name ?? "", range, units },
        `${token.name ?? token.actor.name ?? "The target"} is out of range (${range} ${units}).`
      ));
      return null;
    }
    return { origin, candidates: [{ actor: token.actor, token, isSelf, distance }] };
  }

  static #notifyNothingToIdentify(activity, candidates) {
    if (activity?.recipient === "choose") {
      ui.notifications?.info?.(Constants.localize(
        `${LANG}.Info.NothingInRange`,
        "No creature in range has unidentified items."
      ));
      return;
    }
    const actor = candidates[0]?.actor;
    ui.notifications?.info?.(Constants.format(
      `${LANG}.Info.NothingToIdentify`,
      { actor: actor?.name ?? "" },
      `${actor?.name ?? "The actor"} has no unidentified items.`
    ));
  }

  static #notifyCheckFailed(identifier, item) {
    ui.notifications?.info?.(Constants.format(
      `${LANG}.Info.CheckFailed`,
      { actor: identifier.name ?? "", item: item.name ?? "" },
      `${identifier.name ?? "The actor"} could not identify ${item.name ?? "the item"}.`
    ));
  }

  static #checkLabel(check) {
    if (!ScIdentifyActivityService.isCheckEnabled(check)) {
      return Constants.localize(`${LANG}.Picker.NoCheck`, "Identified without a roll");
    }
    const abilities = globalThis.CONFIG?.DND5E?.abilities ?? {};
    const skills = globalThis.CONFIG?.DND5E?.skills ?? {};
    const ability = String(check.ability ?? "").trim();
    const skill = String(check.skill ?? "").trim();
    const abilityLabel = abilities[ability]?.label ?? ability;
    const label = skill ? `${skills[skill]?.label ?? skill} (${abilityLabel})` : abilityLabel;
    return Constants.format(`${LANG}.Picker.Check`, { check: label }, `${label} check`);
  }

  static #formulaDc(activity) {
    const formula = String(activity?.identify?.dcFormula ?? "").trim();
    if (!formula) {
      return null;
    }
    const rollData = activity?.getRollData?.({ deterministic: true }) ?? {};
    const simplify = globalThis.dnd5e?.utils?.simplifyBonus;
    try {
      const value = typeof simplify === "function" ? simplify(formula, rollData) : Number(formula);
      return ScIdentifyActivityService.#toDc(value);
    } catch (error) {
      Logger.debug("Could not simplify sc-identify DC formula.", error);
      return null;
    }
  }

  static #itemRarities(item) {
    const rarities = item?.system?.rarities;
    const list = rarities instanceof Set || Array.isArray(rarities)
      ? Array.from(rarities)
      : [item?.system?.rarity];
    return list.map((rarity) => String(rarity ?? "").trim()).filter(Boolean);
  }

  static #toDc(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : null;
  }

  static #warn(key, fallback) {
    ui.notifications?.warn?.(Constants.localize(`${LANG}.${key}`, fallback));
  }

  static #escape(value) {
    const text = String(value ?? "");
    const foundryUtils = globalThis.foundry?.utils;
    if (typeof foundryUtils?.escapeHTML === "function") {
      return foundryUtils.escapeHTML(text);
    }
    return text.replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    }[char]));
  }
}
