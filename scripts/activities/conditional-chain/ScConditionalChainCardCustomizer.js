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
      this.#compactLegacyChildCard(activity, messageConfig);
    });
    // D&D 5e 6 usage cards are generated from ChatMessage `system` data after
    // preCreateUsageMessage. Keep the marker on those messages and compact
    // their rendered card instead of trying to modify nonexistent HTML here.
    Hooks.on("dnd5e.renderChatMessage", (message, html) => {
      this.#compactRenderedChildCard(message, html);
    });
  }

  /** Compact the HTML card format used by D&D 5e 5.3 usage messages. */
  static #compactLegacyChildCard(_activity, messageConfig) {
    const moduleFlags = messageConfig?.data?.flags?.[Constants.MODULE_ID];
    const options = moduleFlags?.[CARD_FLAG];
    if (options?.compact !== true) {
      return;
    }

    const content = String(messageConfig?.data?.content ?? "");
    if (!content || typeof document?.createElement !== "function") {
      // In D&D 5e 6 the usage card is rendered later from message.system. Do
      // not remove the marker: the render hook below needs it on every client.
      return;
    }

    const template = document.createElement("template");
    template.innerHTML = content;
    const card = template.content.querySelector(".chat-card.activation-card");
    if (!card) {
      return;
    }

    if (!this.#compactCardElement(card, options)) {
      return;
    }
    messageConfig.data.content = template.innerHTML;
    // A legacy card is fully serialized in content, so retaining this marker
    // would make a later render hook try to compact it a second time.
    delete moduleFlags[CARD_FLAG];
  }

  /** Compact the data-driven usage-card markup introduced by D&D 5e 6. */
  static #compactRenderedChildCard(message, html) {
    const options = message?.getFlag?.(Constants.MODULE_ID, CARD_FLAG)
      ?? message?.flags?.[Constants.MODULE_ID]?.[CARD_FLAG];
    if (options?.compact !== true) {
      return;
    }

    const element = html?.[0] ?? html;
    if (!element) {
      return;
    }
    const card = element.matches?.(".chat-card")
      ? element
      : element.querySelector?.(".chat-card") ?? element;
    if (!this.#compactCardElement(card, options)) {
      return;
    }

    // D&D 5e's compact chat-card styles are scoped to the message element.
    // `renderChatMessage` supplies that element in current Foundry versions,
    // but support a wrapped card as well for integrations that re-parent it.
    const messageElement = element.matches?.(".message")
      ? element
      : element.closest?.(".message") ?? element.querySelector?.(".message");
    messageElement?.classList?.add("compact");
  }

  static #compactCardElement(card, options) {
    if (!card?.querySelector || typeof document?.createElement !== "function") {
      return false;
    }

    const stackedName = card.querySelector(".card-header .name-stacked");
    if (!stackedName) {
      return false;
    }

    // 5.3 nests the description inside the legacy card header; 6.0 renders
    // it as a sibling card-description section toggled from the header.
    card.querySelector(".card-header.description .details, .card-description")?.remove();
    const header = stackedName.closest?.(".card-header");
    header?.querySelector?.(".chevron")?.remove();
    if (header?.dataset?.action === "toggleDescription") {
      delete header.dataset.action;
      header.classList?.add("no-description");
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
    return true;
  }
}
