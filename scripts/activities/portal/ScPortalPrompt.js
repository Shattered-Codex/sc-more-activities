import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

/**
 * The "do you want to step through?" dialog, laid out like the module's other
 * windows. It takes plain data instead of documents, so it never has to
 * resolve anything itself.
 */
export class ScPortalPrompt {
  /**
   * Shows the dialog and hands back a way to withdraw it. A question that is
   * still open when the same token is asked again is stale: closing it answers
   * it as declined, the same as pressing Stay.
   */
  static open({ tokenName = "", portalName = "", usesLeft = null, oneWay = false } = {}) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2?.confirm) {
      return { promise: Promise.resolve(false), close: () => {} };
    }

    // The dialog only exists once Foundry has rendered it. A withdrawal that
    // arrives before then is remembered and applied as soon as it does.
    let dialog = null;
    let withdrawn = false;
    const dismiss = () => {
      Promise.resolve(dialog?.close?.()).catch(() => {});
    };
    const promise = Promise.resolve()
      .then(() => DialogV2.confirm({
        // Passing classes replaces the DialogV2 defaults rather than adding
        // to them, so the core dialog class has to come along.
        classes: ["dialog", "sc-more-activities", "sc-ma-portal-prompt-dialog"],
        window: {
          icon: "fa-solid fa-dungeon",
          title: Constants.localize("SCMOREACTIVITIES.Activities.ScPortal.Prompt.Title", "Portal")
        },
        position: { width: 400 },
        content: ScPortalPrompt.#content({ tokenName, portalName, usesLeft, oneWay }),
        yes: {
          icon: "fa-solid fa-dungeon",
          label: Constants.localize("SCMOREACTIVITIES.Activities.ScPortal.Prompt.Accept", "Step through")
        },
        no: {
          icon: "fa-solid fa-xmark",
          label: Constants.localize("SCMOREACTIVITIES.Activities.ScPortal.Prompt.Decline", "Stay")
        },
        rejectClose: false,
        render: (_event, application) => {
          dialog = application;
          if (withdrawn) {
            dismiss();
          }
        }
      }))
      .then((answer) => answer === true)
      .catch((error) => {
        Logger.warn("Could not show the portal prompt.", error);
        return false;
      });

    return {
      promise,
      close: () => {
        withdrawn = true;
        dismiss();
      }
    };
  }

  static #content({ tokenName, portalName, usesLeft, oneWay }) {
    const escape = ScPortalPrompt.#escape;
    const question = Constants.format(
      "SCMOREACTIVITIES.Activities.ScPortal.Prompt.Question",
      { token: tokenName, portal: portalName },
      `Send ${tokenName} through ${portalName}?`
    );

    const details = [`<span><i class="fa-solid fa-user"></i>${escape(tokenName)}</span>`];
    // A null counter means unlimited; Number(null) is 0, which would read as
    // no crossings left.
    if (usesLeft !== null && Number.isFinite(Number(usesLeft))) {
      details.push(`<span><i class="fa-solid fa-rotate"></i>${escape(Constants.format(
        "SCMOREACTIVITIES.Activities.ScPortal.Prompt.UsesLeft",
        { count: Number(usesLeft) },
        `Crossings left: ${Number(usesLeft)}`
      ))}</span>`);
    }
    if (oneWay) {
      details.push(`<span><i class="fa-solid fa-arrow-right-long"></i>${escape(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScPortal.Prompt.OneWay",
        "This portal only travels one way."
      ))}</span>`);
    }

    return `
      <div class="sc-more-activities sc-ma-portal-prompt">
        <div class="sc-ma-portal-prompt-header">
          <i class="fa-solid fa-dungeon"></i>
          <div>
            <strong>${escape(portalName)}</strong>
            <span>${escape(question)}</span>
          </div>
        </div>
        <div class="sc-ma-placement-summary">${details.join("")}</div>
      </div>
    `;
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
