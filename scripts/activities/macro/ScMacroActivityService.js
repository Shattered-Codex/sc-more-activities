import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

export class ScMacroActivityService {
  static async execute(activity, usageContext = {}) {
    if (activity?.execution?.mode === "inline") {
      await ScMacroActivityService.#executeInlineMacro(activity, usageContext);
      return;
    }

    await ScMacroActivityService.#executeWorldMacro(activity, usageContext);
  }

  static async #executeWorldMacro(activity, usageContext) {
    const macroUuid = activity?.world?.macroUuid ?? "";
    const macro = ScMacroActivityService.#resolveWorldMacro(macroUuid);
    if (!macro) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScMacro.Warning.MissingWorldMacro",
        "Choose a world macro before using this activity."
      ));
      return;
    }

    const canExecute = macro.canExecute !== false
      && (typeof macro.canUserExecute !== "function" || macro.canUserExecute(game.user));
    if (!canExecute) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScMacro.Warning.WorldMacroPermission",
        "You do not have permission to execute the selected macro."
      ));
      return;
    }

    try {
      await macro.execute(ScMacroActivityService.#buildExecutionContext(activity, usageContext));
    } catch (error) {
      ScMacroActivityService.#notifyExecutionError(error, "world");
    }
  }

  static async #executeInlineMacro(activity, usageContext) {
    if (!game?.user?.isGM) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScMacro.Warning.InlineRequiresGm",
        "Only a GM can execute inline macro code."
      ));
      return;
    }

    const macroCode = activity?.inline?.code?.trim?.() ?? "";
    if (!macroCode) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScMacro.Warning.MissingInlineCode",
        "Add inline macro code before using this activity."
      ));
      return;
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
      await execute(
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
    } catch (error) {
      ScMacroActivityService.#notifyExecutionError(error, "inline");
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
}
