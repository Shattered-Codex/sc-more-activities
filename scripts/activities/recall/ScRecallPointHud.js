import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

const FLAG = "recallPoint";

/**
 * A GM-only Token HUD button that marks a token (usually an innkeeper NPC) as
 * a recall point characters can bind as their home.
 */
export class ScRecallPointHud {
  static registerHooks() {
    Hooks.on("renderTokenHUD", ScRecallPointHud.#onRender);
  }

  static #onRender(hud, html) {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const column = root?.querySelector?.(".col.left");
    const token = hud?.document ?? hud?.object?.document ?? null;
    if (!game?.user?.isGM || !column || !token || column.querySelector("[data-sc-ma-recall-point]")) {
      return;
    }

    const marked = token.getFlag?.(Constants.MODULE_ID, FLAG) === true;
    const label = Constants.localize(
      `SCMOREACTIVITIES.Activities.ScRecall.Hud.${marked ? "Unmark" : "Mark"}`,
      marked ? "Remove recall point" : "Mark as recall point"
    );
    const button = document.createElement("button");
    button.type = "button";
    button.className = `control-icon sc-more-activities${marked ? " active" : ""}`;
    button.dataset.scMaRecallPoint = "";
    button.dataset.tooltip = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = '<i class="sc-ma-recall-icon sc-ma-recall-icon--bind" inert></i>';
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        if (marked) {
          await token.unsetFlag(Constants.MODULE_ID, FLAG);
        } else {
          await token.setFlag(Constants.MODULE_ID, FLAG, true);
        }
        hud.render?.();
      } catch (error) {
        Logger.error("Could not toggle the recall point.", error);
      }
    });
    column.append(button);
  }
}
