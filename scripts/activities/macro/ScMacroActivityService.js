import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

export class ScMacroActivityService {
  static async execute(activity, usageContext = {}) {
    if (activity?.execution?.mode === "inline") {
      return ScMacroActivityService.#executeInlineMacro(activity, usageContext);
    }

    return ScMacroActivityService.#executeWorldMacro(activity, usageContext);
  }

  static async #executeWorldMacro(activity, usageContext) {
    const macroUuid = activity?.world?.macroUuid ?? "";
    const macro = ScMacroActivityService.#resolveWorldMacro(macroUuid);
    if (!macro) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScMacro.Warning.MissingWorldMacro",
        "Choose a world macro before using this activity."
      ));
      return { executed: false };
    }

    const canExecute = macro.canExecute !== false
      && (typeof macro.canUserExecute !== "function" || macro.canUserExecute(game.user));
    if (!canExecute) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScMacro.Warning.WorldMacroPermission",
        "You do not have permission to execute the selected macro."
      ));
      return { executed: false };
    }

    try {
      return { executed: true, value: ScMacroActivityService.#cloneSafe(await macro.execute(
        ScMacroActivityService.#buildExecutionContext(activity, usageContext)
      )) };
    } catch (error) {
      ScMacroActivityService.#notifyExecutionError(error, "world");
      return { executed: false };
    }
  }

  static async #executeInlineMacro(activity, usageContext) {
    if (!game?.user?.isGM) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScMacro.Warning.InlineRequiresGm",
        "Only a GM can execute inline macro code."
      ));
      return { executed: false };
    }

    const macroCode = activity?.inline?.code?.trim?.() ?? "";
    if (!macroCode) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScMacro.Warning.MissingInlineCode",
        "Add inline macro code before using this activity."
      ));
      return { executed: false };
    }

    try {
      const context = ScMacroActivityService.#buildExecutionContext(activity, usageContext);
      const execute = new Function(
        "activity",
        "item",
        "actor",
        "usage",
        "dialog",
        "message",
        "results",
        "speaker",
        "targets",
        "game",
        "canvas",
        "ui",
        `"use strict"; return (async () => {\n${macroCode}\n})();`
      );
      const value = await execute(
        context.activity,
        context.item,
        context.actor,
        context.usage,
        context.dialog,
        context.message,
        context.results,
        context.speaker,
        context.targets,
        globalThis.game,
        globalThis.canvas,
        globalThis.ui
      );
      return { executed: true, value: ScMacroActivityService.#cloneSafe(value) };
    } catch (error) {
      ScMacroActivityService.#notifyExecutionError(error, "inline");
      return { executed: false };
    }
  }

  static #resolveWorldMacro(macroUuid) {
    if (!macroUuid) {
      return null;
    }
    const macro = globalThis.fromUuidSync?.(macroUuid);
    if (macro?.documentName === "Macro" || macro?.constructor?.documentName === "Macro") {
      return macro;
    }
    const id = macroUuid.startsWith("Macro.") ? macroUuid.slice(6) : macroUuid;
    return game?.macros?.get?.(id) ?? null;
  }

  static #buildExecutionContext(activity, usageContext) {
    const actor = activity?.actor ?? activity?.item?.actor ?? null;
    return {
      activity,
      item: activity?.item ?? null,
      actor,
      usage: usageContext.usage ?? {},
      dialog: usageContext.dialog ?? {},
      message: usageContext.message ?? {},
      results: usageContext.results ?? null,
      speaker: ChatMessage.implementation?.getSpeaker?.({ actor }) ?? ChatMessage.getSpeaker({ actor }),
      targets: Array.from(game?.user?.targets ?? [])
    };
  }

  static #notifyExecutionError(error, source) {
    Logger.error(`Could not execute ${source} sc-macro activity.`, error);
    ui.notifications?.error?.(Constants.format(
      "SCMOREACTIVITIES.Activities.ScMacro.Error.ExecutionFailed",
      { error: error?.message ?? String(error) },
      `Could not execute macro: ${error?.message ?? String(error)}`
    ));
  }

  static #cloneSafe(value) {
    if (value === undefined) {
      return undefined;
    }
    try {
      return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return String(value);
    }
  }
}
