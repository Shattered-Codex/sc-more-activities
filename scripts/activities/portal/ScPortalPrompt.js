import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

/**
 * The "do you want to step through?" dialog. It runs on the client of the user
 * responsible for the token, which is not necessarily the client that detected
 * the portal entry, so it takes plain data instead of documents.
 */
export class ScPortalPrompt {
  static async confirm({ tokenName = "", portalName = "", usesLeft = null, oneWay = false } = {}) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2?.confirm) {
      return false;
    }

    try {
      const answer = await DialogV2.confirm({
        window: {
          title: Constants.localize("SCMOREACTIVITIES.Activities.ScPortal.Prompt.Title", "Portal")
        },
        content: ScPortalPrompt.#content({ tokenName, portalName, usesLeft, oneWay }),
        yes: {
          label: Constants.localize("SCMOREACTIVITIES.Activities.ScPortal.Prompt.Accept", "Step through")
        },
        no: {
          label: Constants.localize("SCMOREACTIVITIES.Activities.ScPortal.Prompt.Decline", "Stay")
        },
        rejectClose: false
      });
      return answer === true;
    } catch (error) {
      Logger.warn("Could not show the portal prompt.", error);
      return false;
    }
  }

  static #content({ tokenName, portalName, usesLeft, oneWay }) {
    const question = Constants.format(
      "SCMOREACTIVITIES.Activities.ScPortal.Prompt.Question",
      { token: tokenName, portal: portalName },
      `Send ${tokenName} through ${portalName}?`
    );

    const notes = [];
    if (Number.isFinite(Number(usesLeft))) {
      notes.push(Constants.format(
        "SCMOREACTIVITIES.Activities.ScPortal.Prompt.UsesLeft",
        { count: Number(usesLeft) },
        `Uses left: ${Number(usesLeft)}`
      ));
    }
    if (oneWay) {
      notes.push(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScPortal.Prompt.OneWay",
        "This portal only travels one way."
      ));
    }

    const note = notes.length
      ? `<p class="hint">${ScPortalPrompt.#escape(notes.join(" · "))}</p>`
      : "";
    return `<p>${ScPortalPrompt.#escape(question)}</p>${note}`;
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
