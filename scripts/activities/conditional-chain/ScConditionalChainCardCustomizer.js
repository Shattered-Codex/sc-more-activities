import { Constants } from "../../constants/Constants.js";

const CARD_FLAG = "conditionalChainCard";

export class ScConditionalChainCardCustomizer {
  static #registered = false;

  static registerHook() {
    if (this.#registered || typeof Hooks?.on !== "function") {
      return;
    }

    this.#registered = true;
    Hooks.on("dnd5e.preCreateUsageMessage", (activity, messageConfig) => {
      this.#compactChildCard(activity, messageConfig);
    });
  }

  static #compactChildCard(_activity, messageConfig) {
    const moduleFlags = messageConfig?.data?.flags?.[Constants.MODULE_ID];
    const options = moduleFlags?.[CARD_FLAG];
    if (options?.compact !== true) {
      return;
    }

    delete moduleFlags[CARD_FLAG];
    const content = String(messageConfig?.data?.content ?? "");
    if (!content || typeof document?.createElement !== "function") {
      return;
    }

    const template = document.createElement("template");
    template.innerHTML = content;
    const card = template.content.querySelector(".chat-card.activation-card");
    if (!card) {
      return;
    }

    card.querySelector(".card-header.description .details")?.remove();
    const stackedName = card.querySelector(".card-header .name-stacked");
    if (!stackedName) {
      return;
    }

    let subtitle = stackedName.querySelector(".subtitle");
    if (!subtitle) {
      subtitle = document.createElement("span");
      subtitle.classList.add("subtitle");
      stackedName.append(subtitle);
    }
    subtitle.textContent = Constants.format(
      "SCMOREACTIVITIES.Activities.ScConditionalChain.Chat.ChildActivity",
      { activity: String(options.activityName ?? "").trim() },
      `Activity: ${String(options.activityName ?? "").trim()}`
    );
    messageConfig.data.content = template.innerHTML;
  }
}
