import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScCanvasActivityService } from "./ScCanvasActivityService.js";
import { ScCanvasResultCard } from "./ScCanvasResultCard.js";
import { ScTargetSaveService } from "./ScTargetSaveService.js";

const FLAG_KEY = "saveRequest";
const EXECUTE_ACTION = "sc-ma-execute-canvas";
const ROLL_ACTION = "sc-ma-roll-save";

/**
 * Posts the native-style saving-throw request card to chat and executes the
 * movement or teleport from the card once targets have rolled. Nothing waits
 * in the background: each target rolls the embedded dnd5e save link at their
 * own pace, and the execute button moves whoever has failed so far.
 */
export class ScSaveRequestCard {
  static #registered = false;

  static registerHooks() {
    if (ScSaveRequestCard.#registered || typeof Hooks?.on !== "function") {
      return;
    }
    ScSaveRequestCard.#registered = true;
    Hooks.on("renderChatMessageHTML", (message, html) => {
      ScSaveRequestCard.#onRenderChatMessage(message, html);
    });
    // Save roll messages replicate to every client, so each new roll refreshes
    // the per-target statuses and the rolled-so-far counter on any request
    // card visible in the chat log. The update hook covers rolls flipped after
    // the fact, such as Legendary Resistance forcing a success.
    Hooks.on("createChatMessage", (message) => {
      if (String(message?.flags?.dnd5e?.roll?.type ?? "") !== "save") {
        return;
      }
      ScSaveRequestCard.#refreshVisibleCards();
    });
    Hooks.on("updateChatMessage", (message) => {
      if (String(message?.flags?.dnd5e?.roll?.type ?? "") !== "save") {
        return;
      }
      ScSaveRequestCard.#refreshVisibleCards();
    });
  }

  static async postMovementRequest(activity, {
    originTokenId = null,
    selfDirectionPoint = null,
    movementType = null,
    tokenIds = []
  } = {}) {
    return ScSaveRequestCard.#post(activity, activity?.movement?.save, {
      group: "movement",
      originTokenId,
      tokenIds,
      execution: { movementType, selfDirectionPoint },
      buttonKey: "SCMOREACTIVITIES.Activities.Canvas.Save.Request.MoveButton",
      buttonFallback: "Move failed targets"
    });
  }

  static async postTeleportRequest(activity, {
    originTokenId = null,
    destination = null,
    tokenIds = []
  } = {}) {
    return ScSaveRequestCard.#post(activity, activity?.teleport?.save, {
      group: "teleport",
      originTokenId,
      tokenIds,
      execution: { destination },
      buttonKey: "SCMOREACTIVITIES.Activities.Canvas.Save.Request.TeleportButton",
      buttonFallback: "Teleport failed targets"
    });
  }

  static async #post(activity, saveConfig, { group, originTokenId, tokenIds, execution, buttonKey, buttonFallback }) {
    const dc = ScTargetSaveService.resolveDc(saveConfig, activity);
    if (dc === null) {
      ui.notifications?.warn?.(Constants.format(
        "SCMOREACTIVITIES.Activities.Canvas.Save.Warning.InvalidDc",
        { dc: String(saveConfig?.dc ?? "") },
        `The saving throw DC "${String(saveConfig?.dc ?? "")}" is not valid. The saving throw was skipped.`
      ));
      return { posted: false, skipped: true, reason: "invalid-dc" };
    }

    const scene = canvas?.scene;
    const selfIds = [];
    const externalTargets = [];
    for (const id of ScSaveRequestCard.#uniqueIds(tokenIds)) {
      const token = scene?.tokens?.get?.(id);
      if (!token) {
        continue;
      }
      if ((originTokenId && id === originTokenId) || !token.actor) {
        // The origin never rolls; a token without an actor cannot resist.
        // Both move unconditionally when the card button executes.
        selfIds.push(id);
        continue;
      }
      externalTargets.push(ScCanvasResultCard.tokenEntry(token));
    }

    if (!externalTargets.length) {
      return { posted: false, skipped: true, reason: "no-targets" };
    }

    try {
      const ability = ScSaveRequestCard.#safeAbility(saveConfig?.ability);
      const actor = activity?.actor ?? activity?.item?.actor ?? null;
      const message = await ChatMessage.create({
        speaker: ScSaveRequestCard.#speaker(actor),
        content: ScSaveRequestCard.#content(activity, ability, dc, externalTargets, buttonKey, buttonFallback),
        flags: {
          [Constants.MODULE_ID]: {
            [FLAG_KEY]: {
              // Roll messages made from this card's buttons carry this id, so
              // two simultaneous requests never consume each other's saves.
              id: ScSaveRequestCard.#randomId(),
              group,
              activityUuid: activity?.uuid ?? null,
              sceneId: scene?.id ?? null,
              ability,
              dc,
              originTokenId,
              selfIds,
              externalTargets,
              execution,
              executed: false
            }
          }
        }
      });
      return { posted: Boolean(message), skipped: false, reason: null };
    } catch (error) {
      Logger.error("Could not post the saving throw request card.", error);
      ui.notifications?.error?.(error?.message ?? String(error));
      return { posted: false, skipped: false, reason: "failed" };
    }
  }

  static #content(activity, ability, dc, externalTargets, buttonKey, buttonFallback) {
    const title = Constants.localize("SCMOREACTIVITIES.Activities.Canvas.Save.Request.Title", "Saving Throw");
    const hint = Constants.localize(
      "SCMOREACTIVITIES.Activities.Canvas.Save.Request.Hint",
      "Select your token and roll below. Targets that fail are moved when the button is used."
    );
    const targetsLabel = Constants.localize("SCMOREACTIVITIES.Activities.Canvas.Save.Request.Targets", "Targets");
    const saveLabels = ScSaveRequestCard.#saveLabels(ability, dc);

    const itemName = String(activity?.item?.name ?? "").trim();
    const activityName = String(activity?.name ?? "").trim();
    const cardTitle = itemName || activityName || title;
    const subtitleParts = [];
    if (activityName && activityName !== cardTitle) {
      subtitleParts.push(ScSaveRequestCard.#escape(activityName));
    }
    // The save requirement lives in the subtitle; the visible/hidden spans let
    // dnd5e's DC-visibility rules decide who gets to read the number.
    subtitleParts.push(
      `<span class="visible-dc">${saveLabels.visible}</span><span class="hidden-dc">${saveLabels.hidden}</span>`
    );
    const subtitle = subtitleParts.join(" — ");
    const image = activity?.item?.img ?? activity?.actor?.img ?? "icons/svg/mystery-man.svg";

    return `
      <div class="chat-card sc-ma-canvas-card sc-ma-save-request-card">
        <section class="card-header">
          <header class="summary">
            <img class="gold-icon" src="${ScSaveRequestCard.#escape(image)}" alt="${ScSaveRequestCard.#escape(cardTitle)}">
            <div class="name-stacked border">
              <span class="title">${ScSaveRequestCard.#escape(cardTitle)}</span>
              <span class="subtitle">${subtitle}</span>
            </div>
          </header>
        </section>
        <div class="card-buttons">
          <button type="button" data-action="${EXECUTE_ACTION}">
            <i class="fa-solid fa-person-running" inert></i>
            <span>${ScSaveRequestCard.#escape(Constants.localize(buttonKey, buttonFallback))}</span>
          </button>
        </div>
        <section class="targets">
          <strong class="roboto-condensed-upper">${ScSaveRequestCard.#escape(targetsLabel)}</strong>
          ${ScSaveRequestCard.#targetRows(externalTargets)}
        </section>
        <p class="supplement">${ScSaveRequestCard.#escape(hint)}</p>
      </div>
    `;
  }

  /**
   * Target rows in dnd5e's native request-card shape: portrait, name, and a
   * per-target roll button in the status column. Rolling from the row needs no
   * token selection, and the status flips to the roll's success or failure.
   */
  static #targetRows(entries) {
    const rollLabel = Constants.localize(
      "SCMOREACTIVITIES.Activities.Canvas.Save.Request.RollFor",
      "Roll the saving throw"
    );
    const rows = (entries ?? []).map((entry) => `
      <li class="flexrow" data-token-id="${ScSaveRequestCard.#escape(entry.id)}">
        ${entry.img ? `<img class="gold-icon" src="${ScSaveRequestCard.#escape(entry.img)}" alt="${ScSaveRequestCard.#escape(entry.name)}">` : ""}
        <span class="name-stacked">
          <span class="title">${ScSaveRequestCard.#escape(entry.name)}</span>
        </span>
        <div class="status">
          <button type="button" class="gold-button" data-action="${ROLL_ACTION}"
                  data-tooltip aria-label="${ScSaveRequestCard.#escape(rollLabel)}">
            <i class="fa-solid fa-dice-d20" inert></i>
          </button>
        </div>
      </li>
    `);
    return `<ul class="action-list unlist">${rows.join("")}</ul>`;
  }

  /**
   * Builds the save requirement labels through dnd5e's native roll-label
   * helper so wording matches the system exactly, with a plain fallback when
   * the helper is unavailable.
   */
  static #saveLabels(ability, dc) {
    const create = globalThis.dnd5e?.enrichers?.createRollLabel;
    if (typeof create === "function") {
      try {
        const visible = create({ type: "save", ability, dc, format: "long" });
        const hidden = create({ type: "save", ability, dc, format: "long", hideDC: true });
        if (visible && hidden) {
          return { visible, hidden };
        }
      } catch (error) {
        Logger.debug("Could not build the native save requirement label.", error);
      }
    }

    const abilityLabel = ScSaveRequestCard.#escape(String(ability ?? "").toUpperCase());
    return {
      visible: `DC ${Number(dc)} ${abilityLabel}`,
      hidden: abilityLabel
    };
  }

  static #onRenderChatMessage(message, html) {
    const data = message?.flags?.[Constants.MODULE_ID]?.[FLAG_KEY];
    if (!data) {
      return;
    }

    const results = ScSaveRequestCard.#results(message, data);
    ScSaveRequestCard.#updateTargetRows(html, message, data, results);

    const button = html?.querySelector?.(`[data-action="${EXECUTE_ACTION}"]`);
    if (!button) {
      return;
    }

    if (data.executed) {
      button.disabled = true;
      button.textContent = Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Save.Request.ResolvedButton",
        "Resolved"
      );
      return;
    }

    const authorId = message?.author?.id ?? message?.user?.id ?? null;
    if (!game?.user?.isGM && game?.user?.id !== authorId) {
      button.remove();
      return;
    }

    if (!button.dataset.scMaBound) {
      button.dataset.scMaBound = "1";
      button.addEventListener("click", () => ScSaveRequestCard.#execute(message, button));
    }
    ScSaveRequestCard.#updateCounter(button, data, results);
  }

  static #results(message, data) {
    return ScTargetSaveService.collectSaveResults({
      externalTargets: data.externalTargets ?? [],
      ability: data.ability,
      dc: data.dc,
      sinceTimestamp: Number(message?.timestamp ?? 0),
      requestId: String(data.id ?? "")
    }, game?.messages?.contents ?? []);
  }

  /**
   * Flips each resolved target row to its roll total plus a success or failure
   * mark, and wires the per-target roll button for the rows still pending.
   */
  static #updateTargetRows(html, message, data, results) {
    const resolved = new Map(
      [...results.failed, ...results.succeeded].map((entry) => [entry.id, entry])
    );

    for (const row of html?.querySelectorAll?.("li[data-token-id]") ?? []) {
      const status = row.querySelector(".status");
      if (!status) {
        continue;
      }

      const outcome = resolved.get(row.dataset.tokenId);
      if (outcome) {
        // A row may need to flip after the fact: Legendary Resistance turns a
        // rolled failure into a success. Only rows already in the right state
        // are skipped.
        const desiredState = outcome.success ? "success" : "failure";
        if (status.classList.contains(desiredState)) {
          continue;
        }
        status.classList.remove(outcome.success ? "failure" : "success");
        const stateLabel = Constants.localize(
          outcome.success
            ? "SCMOREACTIVITIES.Activities.Canvas.Save.Request.Succeeded"
            : "SCMOREACTIVITIES.Activities.Canvas.Save.Request.Failed",
          outcome.success ? "Succeeded" : "Failed"
        );
        status.classList.add(desiredState);
        status.setAttribute("data-tooltip", "");
        status.setAttribute("aria-label", stateLabel);
        status.innerHTML = `
          ${Number.isFinite(outcome.total) ? `<span class="total">${outcome.total}</span>` : ""}
          <i class="fa-solid ${outcome.success ? "fa-check" : "fa-xmark"}" inert></i>
        `;
        continue;
      }

      const rollButton = row.querySelector(`[data-action="${ROLL_ACTION}"]`);
      if (!rollButton) {
        continue;
      }
      if (data.executed) {
        rollButton.remove();
        continue;
      }
      ScSaveRequestCard.#bindRollButton(rollButton, row.dataset.tokenId, message, data);
    }
  }

  static #bindRollButton(rollButton, tokenId, message, data) {
    const entry = (data.externalTargets ?? []).find((candidate) => candidate.id === tokenId);
    if (!entry) {
      rollButton.remove();
      return;
    }

    const actor = ScSaveRequestCard.#actorForEntry(data, entry);
    if (actor && !game?.user?.isGM && actor.isOwner !== true) {
      rollButton.remove();
      return;
    }

    if (!rollButton.dataset.scMaBound) {
      rollButton.dataset.scMaBound = "1";
      rollButton.addEventListener("click", () => ScSaveRequestCard.#rollTargetSave(entry, data, rollButton));
    }
  }

  static async #rollTargetSave(entry, data, rollButton) {
    rollButton.disabled = true;
    try {
      const actor = ScSaveRequestCard.#actorForEntry(data, entry)
        ?? await ScSaveRequestCard.#fromUuid(entry.actorUuid);
      if (!actor || typeof actor.rollSavingThrow !== "function") {
        ui.notifications?.warn?.(Constants.localize(
          "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
          "The canvas operation request is no longer valid."
        ));
        return;
      }
      if (!game?.user?.isGM && actor.isOwner !== true) {
        ui.notifications?.warn?.(Constants.format(
          "SCMOREACTIVITIES.Activities.Canvas.Save.Request.CannotRoll",
          { name: entry.name },
          `You cannot roll for ${entry.name}.`
        ));
        return;
      }

      const scene = game?.scenes?.get?.(data.sceneId) ?? null;
      const token = scene?.tokens?.get?.(entry.id) ?? null;
      await actor.rollSavingThrow(
        { ability: data.ability, target: data.dc },
        {},
        {
          data: {
            speaker: ScSaveRequestCard.#tokenSpeaker(actor, token, scene),
            flags: {
              // Ties the roll to this request, so a simultaneous card with the
              // same ability and DC never consumes it.
              [Constants.MODULE_ID]: { saveRequestId: String(data.id ?? "") }
            }
          }
        }
      );
    } catch (error) {
      Logger.error("Could not roll the requested target saving throw.", error);
      ui.notifications?.error?.(error?.message ?? String(error));
    } finally {
      rollButton.disabled = false;
    }
  }

  /**
   * Resolves the actor behind a target entry without awaiting: through the
   * request's scene token first, then the stored actor UUID.
   */
  static #actorForEntry(data, entry) {
    const scene = game?.scenes?.get?.(data.sceneId);
    const tokenActor = scene?.tokens?.get?.(entry?.id)?.actor;
    if (tokenActor) {
      return tokenActor;
    }
    if (entry?.actorUuid && typeof globalThis.fromUuidSync === "function") {
      try {
        return globalThis.fromUuidSync(entry.actorUuid);
      } catch (error) {
        Logger.debug("Could not resolve the target save actor synchronously.", error);
      }
    }
    return null;
  }

  static #tokenSpeaker(actor, token, scene) {
    const ChatMessageClass = globalThis.ChatMessage;
    const data = {
      actor,
      token,
      scene: token?.parent ?? scene ?? null,
      alias: token?.name ?? actor?.name ?? null
    };
    return ChatMessageClass?.implementation?.getSpeaker?.(data)
      ?? ChatMessageClass?.getSpeaker?.(data)
      ?? data;
  }

  /** Rewrites the execute button label as "{label} (rolled/total)". */
  static #updateCounter(button, data, results) {
    const span = button.querySelector?.("span");
    const total = (data.externalTargets ?? []).length;
    if (!span || !total) {
      return;
    }

    const rolled = total - results.pending.length;
    const label = data.group === "teleport"
      ? Constants.localize("SCMOREACTIVITIES.Activities.Canvas.Save.Request.TeleportButton", "Teleport failed targets")
      : Constants.localize("SCMOREACTIVITIES.Activities.Canvas.Save.Request.MoveButton", "Move failed targets");
    span.textContent = `${label} (${rolled}/${total})`;
  }

  static #refreshVisibleCards() {
    const cards = globalThis.document?.querySelectorAll?.(".sc-ma-save-request-card") ?? [];
    for (const card of cards) {
      const messageId = card.closest?.("[data-message-id]")?.dataset?.messageId;
      const chatMessage = game?.messages?.get?.(messageId);
      const data = chatMessage?.flags?.[Constants.MODULE_ID]?.[FLAG_KEY];
      if (!chatMessage || !data) {
        continue;
      }

      const results = ScSaveRequestCard.#results(chatMessage, data);
      ScSaveRequestCard.#updateTargetRows(card, chatMessage, data, results);
      const button = card.querySelector(`[data-action="${EXECUTE_ACTION}"]`);
      if (button && !data.executed) {
        ScSaveRequestCard.#updateCounter(button, data, results);
      }
    }
  }

  static async #execute(message, button) {
    button.disabled = true;
    try {
      // Always work from the freshest copy of the message: another client may
      // have resolved this card since it was rendered here.
      const current = game?.messages?.get?.(message.id) ?? message;
      const data = current?.flags?.[Constants.MODULE_ID]?.[FLAG_KEY];
      if (!data || data.executed) {
        return;
      }

      if (canvas?.scene?.id !== data.sceneId) {
        ui.notifications?.warn?.(Constants.localize(
          "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
          "The canvas operation request is no longer valid."
        ));
        return;
      }

      const activity = await ScSaveRequestCard.#fromUuid(data.activityUuid);
      if (!activity || !ScSaveRequestCard.#validateRequest(current, data, activity)) {
        ui.notifications?.warn?.(Constants.localize(
          "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
          "The canvas operation request is no longer valid."
        ));
        return;
      }

      const results = ScSaveRequestCard.#results(current, data);
      const moveIds = [...ScSaveRequestCard.#validSelfIds(data), ...results.failed.map((entry) => entry.id)];

      // A player author cannot move tokens they do not own; surface that up
      // front instead of failing the whole execution afterwards.
      const blocked = moveIds
        .map((id) => canvas?.scene?.tokens?.get?.(id))
        .filter((token) => token && !ScCanvasActivityService.canMoveToken(token, game?.user));
      if (blocked.length) {
        const targets = blocked.map((token) => token.name).filter(Boolean).join(", ");
        ui.notifications?.warn?.(Constants.format(
          "SCMOREACTIVITIES.Activities.Canvas.Save.Request.GmRequired",
          { targets },
          `Ask the GM to use this card button: you cannot move ${targets}.`
        ));
        return;
      }

      if (!moveIds.length) {
        if (results.pending.length) {
          ui.notifications?.warn?.(Constants.format(
            "SCMOREACTIVITIES.Activities.Canvas.Save.Request.Pending",
            { targets: results.pending.map((entry) => entry.name).filter(Boolean).join(", ") },
            `Still waiting for saving throws: ${results.pending.map((entry) => entry.name).join(", ")}`
          ));
          return;
        }

        if (!await ScSaveRequestCard.#claimExecution(current)) {
          return;
        }
        ui.notifications?.info?.(Constants.localize(
          "SCMOREACTIVITIES.Activities.Canvas.Save.Info.NoneAffected",
          "Every target resisted. No token was affected."
        ));
        await ScSaveRequestCard.#createResultCard(activity, data, { affected: [] }, results);
        return;
      }

      // Lock the card before touching the canvas so a concurrent click on
      // another client cannot run the same movement twice.
      if (!await ScSaveRequestCard.#claimExecution(current)) {
        return;
      }

      const sentEntries = moveIds
        .map((id) => canvas?.scene?.tokens?.get?.(id))
        .filter(Boolean)
        .map((token) => ScCanvasResultCard.tokenEntry(token));

      // The message id doubles as an idempotency key: the executing GM client
      // refuses to run the same card's token updates twice even if two
      // near-simultaneous clicks both pass the optimistic lock.
      const executionKey = String(current?.id ?? message?.id ?? "");
      const result = data.group === "teleport"
        ? await ScCanvasActivityService.executeTeleportPlacement(activity, {
          tokenIds: moveIds,
          destination: data.execution?.destination ?? null,
          executionKey
        })
        : await ScCanvasActivityService.executeMovement(activity, {
          originTokenId: data.originTokenId,
          selfDirectionPoint: data.execution?.selfDirectionPoint ?? null,
          movementType: data.execution?.movementType ?? null,
          tokenIds: moveIds,
          executionKey
        });
      if (!result?.ok) {
        await ScSaveRequestCard.#reopen(current);
        return;
      }

      await ScSaveRequestCard.#createResultCard(activity, data, {
        affected: ScCanvasResultCard.affectedEntries(sentEntries, result.skipped),
        skipped: result.skipped ?? []
      }, results);
    } catch (error) {
      Logger.error("Could not execute the saving throw request card.", error);
      ui.notifications?.error?.(error?.message ?? String(error));
    } finally {
      const latest = (game?.messages?.get?.(message.id) ?? message)?.flags?.[Constants.MODULE_ID]?.[FLAG_KEY];
      if (!latest?.executed) {
        button.disabled = false;
      }
    }
  }

  /**
   * Confirms the card's stored request still matches reality before anything
   * executes: the activity must be of the type the card claims, the card's
   * author must still be allowed to use it, and the ability and DC must match
   * what the activity resolves to right now. An edited chat message or a
   * reconfigured activity fails here instead of executing with stale data.
   */
  static #validateRequest(message, data, activity) {
    const expectedType = data.group === "teleport" ? ACTIVITY_TYPES.TELEPORT : ACTIVITY_TYPES.MOVEMENT;
    if (String(activity?.type ?? "") !== expectedType) {
      return false;
    }

    const author = message?.author ?? game?.users?.get?.(message?.user?.id) ?? null;
    if (!ScSaveRequestCard.#userCanUseActivity(activity, author)) {
      return false;
    }

    const saveConfig = data.group === "teleport" ? activity?.teleport?.save : activity?.movement?.save;
    if (!ScTargetSaveService.isEnabled(saveConfig)) {
      return false;
    }
    if (ScSaveRequestCard.#safeAbility(saveConfig?.ability) !== String(data.ability ?? "")) {
      return false;
    }
    const dc = ScTargetSaveService.resolveDc(saveConfig, activity);
    return dc !== null && dc === Number(data.dc);
  }

  static #userCanUseActivity(activity, user) {
    if (!user) {
      return false;
    }
    if (user.isGM) {
      return true;
    }

    const actor = activity?.actor ?? activity?.item?.actor ?? null;
    const item = activity?.item ?? null;
    return Boolean(
      actor?.testUserPermission?.(user, "OWNER")
      || item?.testUserPermission?.(user, "OWNER")
    );
  }

  /**
   * Re-derives the tokens that move without rolling. The stored list is only
   * trusted for ids that are still the origin token or an actor-less token,
   * so an edited chat message cannot smuggle extra targets past the save.
   */
  static #validSelfIds(data) {
    return (data.selfIds ?? []).filter((id) => {
      if (data.originTokenId && id === data.originTokenId) {
        return true;
      }
      const token = canvas?.scene?.tokens?.get?.(id);
      return Boolean(token) && !token.actor;
    });
  }

  /**
   * Optimistic lock: mark the card as executed with this client's claim, wait
   * for concurrent writes to land, and only proceed when the claim survived.
   * A failed update aborts the execution instead of running unlocked.
   */
  static async #claimExecution(message) {
    const claim = ScSaveRequestCard.#randomId();
    try {
      await message.update({
        [`flags.${Constants.MODULE_ID}.${FLAG_KEY}.executed`]: true,
        [`flags.${Constants.MODULE_ID}.${FLAG_KEY}.executionClaim`]: claim
      });
    } catch (error) {
      Logger.error("Could not lock the saving throw request card.", error);
      ui.notifications?.warn?.(error?.message ?? String(error));
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
    const fresh = game?.messages?.get?.(message.id)?.flags?.[Constants.MODULE_ID]?.[FLAG_KEY];
    // A missing message means the lock cannot be confirmed: never execute.
    return fresh?.executionClaim === claim;
  }

  static async #reopen(message) {
    try {
      await message.update({
        [`flags.${Constants.MODULE_ID}.${FLAG_KEY}.executed`]: false,
        [`flags.${Constants.MODULE_ID}.${FLAG_KEY}.executionClaim`]: null
      });
    } catch (error) {
      Logger.warn("Could not reopen the saving throw request card after a failed execution.", error);
    }
  }

  static async #createResultCard(activity, data, outcome, results) {
    const payload = {
      ...outcome,
      resisted: results.succeeded,
      unresolved: results.pending
    };
    if (data.group === "teleport") {
      await ScCanvasResultCard.createTeleportCard(activity, payload);
      return;
    }
    await ScCanvasResultCard.createMovementCard(activity, payload);
  }

  static #randomId() {
    const randomID = globalThis.foundry?.utils?.randomID;
    if (typeof randomID === "function") {
      return randomID(16);
    }
    return Math.random().toString(36).slice(2, 18);
  }

  static #safeAbility(ability) {
    const normalized = String(ability ?? "str").trim().toLowerCase().replace(/[^a-z]/g, "");
    return normalized || "str";
  }

  static #speaker(actor) {
    const ChatMessageClass = globalThis.ChatMessage;
    const data = { actor };
    return ChatMessageClass?.implementation?.getSpeaker?.(data)
      ?? ChatMessageClass?.getSpeaker?.(data)
      ?? data;
  }

  static #uniqueIds(ids = []) {
    const seen = new Set();
    return Array.isArray(ids)
      ? ids
        .map((id) => String(id ?? ""))
        .filter((id) => {
          if (!id || seen.has(id)) {
            return false;
          }
          seen.add(id);
          return true;
        })
      : [];
  }

  static async #fromUuid(uuid) {
    if (!uuid || typeof globalThis.fromUuid !== "function") {
      return null;
    }
    try {
      return await globalThis.fromUuid(uuid);
    } catch (error) {
      Logger.warn("Could not resolve the saving throw request activity UUID.", error);
      return null;
    }
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
