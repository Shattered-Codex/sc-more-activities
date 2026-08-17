import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

export class ScTargetSaveService {
  static isEnabled(saveConfig) {
    return saveConfig?.enabled === true;
  }

  static abilityOptions() {
    const abilities = globalThis.CONFIG?.DND5E?.abilities ?? {};
    const options = Object.entries(abilities).map(([value, config]) => ({
      value,
      label: ScTargetSaveService.#localizedLabel(config?.label, String(value).toUpperCase())
    }));
    if (options.length) {
      return options;
    }
    return ["str", "dex", "con", "int", "wis", "cha"].map((value) => ({
      value,
      label: value.toUpperCase()
    }));
  }

  /**
   * Resolves the configured DC once: a plain number directly, a deterministic
   * formula against the activity's roll data. Returns null when the value
   * cannot be resolved.
   */
  static resolveDc(saveConfig, activity) {
    const raw = String(saveConfig?.dc ?? "").trim();
    if (!raw) {
      return null;
    }

    const direct = Number(raw);
    if (Number.isFinite(direct)) {
      return Math.floor(direct);
    }

    const rollData = activity?.getRollData?.() ?? activity?.item?.getRollData?.() ?? {};
    const simplify = globalThis.dnd5e?.utils?.simplifyBonus;
    if (typeof simplify === "function") {
      try {
        const value = Number(simplify(raw, rollData));
        if (Number.isFinite(value)) {
          return Math.floor(value);
        }
      } catch (error) {
        Logger.debug("Could not simplify the target save DC formula.", error);
      }
    }

    try {
      const RollClass = globalThis.Roll;
      if (typeof RollClass === "function") {
        const roll = new RollClass(raw, rollData);
        if (roll.isDeterministic !== false && typeof roll.evaluateSync === "function") {
          const value = Number(roll.evaluateSync().total);
          if (Number.isFinite(value)) {
            return Math.floor(value);
          }
        }
      }
    } catch (error) {
      Logger.debug("Could not evaluate the target save DC formula.", error);
    }
    return null;
  }

  /**
   * Scans chat messages created after a save request and matches native
   * saving-throw rolls to the requested target tokens. Each target counts its
   * first matching roll only; targets with no roll yet come back as pending.
   * A roll made against a different explicit DC is ignored, since it answers
   * some other effect. When a request id is given, only rolls tagged with it
   * (made from that request card's own buttons) count at all — an untagged
   * sheet roll or another effect's save can never satisfy the request, and
   * two simultaneous requests can never consume each other's rolls. Without a
   * request id (legacy cards) the heuristics carry the matching. A save
   * flipped by Legendary Resistance (forceSuccess) counts as a success.
   */
  static collectSaveResults({
    externalTargets = [],
    ability = "",
    dc = null,
    sinceTimestamp = 0,
    requestId = ""
  } = {}, messages = []) {
    const pending = new Map();
    for (const target of externalTargets) {
      const id = String(target?.id ?? "");
      if (id && !pending.has(id)) {
        pending.set(id, target);
      }
    }

    const failed = [];
    const succeeded = [];
    const expectedAbility = String(ability ?? "").trim();
    const expectedDc = Number.isFinite(Number(dc)) ? Number(dc) : null;
    const expectedRequestId = String(requestId ?? "");

    for (const message of messages) {
      if (!pending.size) {
        break;
      }
      if (Number(message?.timestamp ?? 0) <= sinceTimestamp) {
        continue;
      }

      const taggedRequestId = String(message?.flags?.[Constants.MODULE_ID]?.saveRequestId ?? "");
      if (expectedRequestId ? taggedRequestId !== expectedRequestId : taggedRequestId !== "") {
        continue;
      }

      const flag = message?.flags?.dnd5e?.roll;
      if (String(flag?.type ?? "") !== "save") {
        continue;
      }
      const rolledAbility = String(flag?.ability ?? "").trim();
      if (expectedAbility && rolledAbility && rolledAbility !== expectedAbility) {
        continue;
      }

      const roll = ScTargetSaveService.#extractRoll(message?.rolls);
      if (!roll) {
        continue;
      }
      const rollTarget = Number(roll?.options?.target);
      if (Number.isFinite(rollTarget) && expectedDc !== null && rollTarget !== expectedDc) {
        continue;
      }

      const target = ScTargetSaveService.#matchTarget(pending, message?.speaker);
      if (!target) {
        continue;
      }

      const success = flag?.forceSuccess === true
        ? true
        : ScTargetSaveService.#rollSucceeded(roll, expectedDc);
      if (success === null) {
        continue;
      }

      pending.delete(target.id);
      (success ? succeeded : failed).push({ ...target, success, total: Number(roll.total) });
    }

    return {
      failed,
      succeeded,
      pending: Array.from(pending.values())
    };
  }

  static #matchTarget(pending, speaker) {
    const tokenId = String(speaker?.token ?? "");
    if (tokenId && pending.has(tokenId)) {
      return pending.get(tokenId);
    }
    if (tokenId) {
      return null;
    }

    // A roll made without a token on the scene (default character) only
    // carries the actor; accept it for the first pending token of that actor.
    const actorId = String(speaker?.actor ?? "");
    if (!actorId) {
      return null;
    }
    for (const target of pending.values()) {
      if (String(target?.actorId ?? "") === actorId) {
        return target;
      }
    }
    return null;
  }

  static #rollSucceeded(roll, dc) {
    if (!roll) {
      return null;
    }
    if (typeof roll.isSuccess === "boolean") {
      return roll.isSuccess;
    }
    const total = Number(roll.total);
    if (!Number.isFinite(total) || !Number.isFinite(Number(dc))) {
      return null;
    }
    return total >= Number(dc);
  }

  static #extractRoll(rolls) {
    if (!rolls) {
      return null;
    }
    if (Array.isArray(rolls)) {
      return rolls.find((roll) => Number.isFinite(Number(roll?.total))) ?? null;
    }
    return Number.isFinite(Number(rolls?.total)) ? rolls : null;
  }

  static #localizedLabel(key, fallback) {
    const i18n = globalThis.game?.i18n;
    const label = String(key ?? "");
    if (!label) {
      return fallback;
    }
    const localized = typeof i18n?.localize === "function" ? i18n.localize(label) : label;
    return localized && localized !== label ? localized : (label.includes(".") ? fallback : label);
  }
}
