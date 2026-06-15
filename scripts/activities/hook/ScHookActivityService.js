import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

const HOOK_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{2,127}$/;

export class ScHookActivityService {
  static async dispatch(activity, usageContext = {}) {
    const mode = activity?.dispatch?.mode ?? "hook";
    if (mode === "callback") {
      await ScHookActivityService.#runCallback(activity, usageContext);
      return;
    }

    ScHookActivityService.#emitHook(activity, usageContext);
  }

  static #emitHook(activity, usageContext) {
    const hookName = String(activity?.hook?.name ?? "").trim();
    if (!ScHookActivityService.#isValidHookName(hookName)) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScHook.Warning.InvalidHook",
        "Configure a valid hook name before using this activity."
      ));
      return;
    }

    Hooks.callAll(hookName, ScHookActivityService.#buildPayload(activity, usageContext));
  }

  static async #runCallback(activity, usageContext) {
    const moduleId = String(activity?.callback?.moduleId ?? "").trim();
    const callbackId = String(activity?.callback?.id ?? "").trim();
    const callback = ScHookActivityService.#resolveWhitelistedCallback(moduleId, callbackId);
    if (!callback) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScHook.Warning.MissingCallback",
        "Configure a module callback exposed through the SC - More Activities callback whitelist."
      ));
      return;
    }

    try {
      await callback(ScHookActivityService.#buildPayload(activity, usageContext));
    } catch (error) {
      Logger.error("Could not execute sc-hook callback.", error);
      ui.notifications?.error?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScHook.Error.CallbackFailed",
        { error: error?.message ?? String(error) },
        `Could not execute callback: ${error?.message ?? String(error)}`
      ));
    }
  }

  static #resolveWhitelistedCallback(moduleId, callbackId) {
    if (!moduleId || !callbackId) {
      return null;
    }

    const moduleApi = game.modules.get(moduleId)?.api;
    const callbacks = moduleApi?.scMoreActivities?.callbacks ?? moduleApi?.scMoreActivitiesCallbacks;
    if (callbacks instanceof Map) {
      const callback = callbacks.get(callbackId);
      return typeof callback === "function" ? callback : null;
    }

    const callback = callbacks?.[callbackId];
    return typeof callback === "function" ? callback : null;
  }

  static #buildPayload(activity, usageContext) {
    const actor = activity?.actor ?? activity?.item?.actor ?? null;
    return Object.freeze({
      activity,
      item: activity?.item ?? null,
      actor,
      usage: usageContext.usage ?? {},
      dialog: usageContext.dialog ?? {},
      message: usageContext.message ?? {},
      results: usageContext.results ?? null,
      speaker: ChatMessage.implementation?.getSpeaker?.({ actor }) ?? ChatMessage.getSpeaker({ actor }),
      targets: Array.from(game?.user?.targets ?? [])
    });
  }

  static #isValidHookName(hookName) {
    return HOOK_NAME_PATTERN.test(hookName);
  }
}
