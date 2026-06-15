import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import {
  CONTEST_ROLL_TYPES,
  CONTEST_TARGET_SOURCES,
  CONTEST_TIE_POLICIES
} from "./ScContestConstants.js";

const MAX_REROLLS = 1;
const QUERY_ID = "sc-more-activities.contestRoll";

export class ScContestActivityService {
  static registerQueries() {
    if (!globalThis.CONFIG?.queries) {
      return false;
    }
    CONFIG.queries[QUERY_ID] = ScContestActivityService.handleContestQuery;
    return true;
  }

  static async handleContestQuery(payload = {}) {
    const activity = await ScContestActivityService.#fromUuid(payload.activityUuid);
    const defenderDocument = await ScContestActivityService.#fromUuid(payload.defenderUuid);
    const defender = ScContestActivityService.#defenderFromDocument(defenderDocument);
    const initiatorActor = ScContestActivityService.#resolveInitiatorActor(activity);

    if (!activity || !initiatorActor || !defender.actor) {
      return { canceled: true, reason: "invalid-query-payload" };
    }

    try {
      const result = await ScContestActivityService.#resolveContest(activity, initiatorActor, defender, {
        activity,
        remote: true
      });
      if (result?.canceled) {
        return { canceled: true };
      }

      await ScContestActivityService.#createChatCard(activity, result);
      return ScContestActivityService.#serializeResult(result);
    } catch (error) {
      Logger.error("Could not resolve remote sc-contest activity.", error);
      return {
        canceled: true,
        error: error?.message ?? String(error)
      };
    }
  }

  static async execute(activity, usageContext = {}) {
    usageContext = { ...usageContext, activity };
    const initiatorActor = ScContestActivityService.#resolveInitiatorActor(activity);
    if (!initiatorActor) {
      return ScContestActivityService.#cancel("SCMOREACTIVITIES.Activities.ScContest.Warning.MissingInitiator", "This contest needs an initiating actor.");
    }

    const defender = ScContestActivityService.#resolveDefender(activity, initiatorActor);
    if (defender.canceled) {
      return defender;
    }

    if (!ScContestActivityService.#canRollActor(defender.actor)) {
      const remoteResult = await ScContestActivityService.#requestRemoteContest(activity, defender, usageContext);
      if (remoteResult) {
        return remoteResult;
      }

      return ScContestActivityService.#cancel(
        "SCMOREACTIVITIES.Activities.ScContest.Warning.DefenderPermission",
        "You do not have permission to roll for the defender."
      );
    }

    try {
      const result = await ScContestActivityService.#resolveContest(activity, initiatorActor, defender, usageContext);
      if (result?.canceled) {
        return result;
      }

      await ScContestActivityService.#createChatCard(activity, result);
      return result;
    } catch (error) {
      Logger.error("Could not execute sc-contest activity.", error);
      ui.notifications?.error?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScContest.Error.ExecutionFailed",
        { error: error?.message ?? String(error) },
        `Could not resolve contest: ${error?.message ?? String(error)}`
      ));
      return { canceled: true, error };
    }
  }

  static async #resolveContest(activity, initiatorActor, defender, usageContext) {
    const tiePolicy = activity?.contest?.tiePolicy ?? CONTEST_TIE_POLICIES.TIE;
    const initiatorSubject = ScContestActivityService.#resolveInitiatorSubject(initiatorActor);
    let attempt = 0;

    while (attempt <= MAX_REROLLS) {
      const initiator = await ScContestActivityService.#rollParticipant(
        "initiator",
        initiatorActor,
        activity?.contest?.initiator,
        initiatorSubject,
        usageContext
      );
      if (initiator.canceled) {
        return initiator;
      }

      const defenderRoll = await ScContestActivityService.#rollParticipant(
        "defender",
        defender.actor,
        activity?.contest?.defender,
        defender,
        usageContext
      );
      if (defenderRoll.canceled) {
        return defenderRoll;
      }

      const outcome = ScContestActivityService.#determineOutcome(initiator, defenderRoll, tiePolicy, attempt);
      if (outcome.shouldReroll) {
        attempt += 1;
        ui.notifications?.info?.(Constants.localize(
          "SCMOREACTIVITIES.Activities.ScContest.Info.RerollingTie",
          "Contest tied. Rerolling once."
        ));
        continue;
      }

      const initiatorIdentity = ScContestActivityService.#participantIdentity(initiatorSubject);
      const defenderIdentity = ScContestActivityService.#participantIdentity(defender);
      return {
        canceled: false,
        activity,
        initiator: {
          ...initiator,
          ...initiatorIdentity,
          rollLabel: ScContestActivityService.#rollDescription(initiator.config, initiator.roll)
        },
        defender: {
          ...defenderRoll,
          ...defenderIdentity,
          rollLabel: ScContestActivityService.#rollDescription(defenderRoll.config, defenderRoll.roll)
        },
        outcome,
        attempt
      };
    }

    return { canceled: true };
  }

  static #resolveInitiatorActor(activity) {
    return activity?.actor ?? activity?.item?.actor ?? null;
  }

  static #resolveInitiatorSubject(actor) {
    const controlledToken = Array.from(canvas?.tokens?.controlled ?? [])
      .find((token) => token?.actor === actor || token?.actor?.uuid === actor?.uuid);
    const activeToken = actor?.getActiveTokens?.(false, true)?.[0] ?? null;
    return {
      actor,
      token: controlledToken ?? activeToken ?? null
    };
  }

  static #resolveDefender(activity, initiatorActor) {
    const source = activity?.contest?.targetSource ?? CONTEST_TARGET_SOURCES.TARGET;
    if (source === CONTEST_TARGET_SOURCES.SELF) {
      return { actor: initiatorActor, token: null };
    }

    const targets = Array.from(game?.user?.targets ?? []);
    if (targets.length !== 1) {
      return ScContestActivityService.#cancel(
        "SCMOREACTIVITIES.Activities.ScContest.Warning.SelectOneTarget",
        "Select exactly one target for this contest."
      );
    }

    const token = targets[0];
    const actor = token?.actor ?? null;
    if (!actor) {
      return ScContestActivityService.#cancel(
        "SCMOREACTIVITIES.Activities.ScContest.Warning.MissingDefender",
        "The selected target has no actor."
      );
    }

    return { actor, token };
  }

  static #defenderFromDocument(document) {
    if (!document) {
      return { actor: null, token: null };
    }
    if (document.actor) {
      return {
        actor: document.actor,
        token: document.object ?? document
      };
    }
    if (document.documentName === "Actor" || document.constructor?.documentName === "Actor") {
      return {
        actor: document,
        token: null
      };
    }
    return { actor: null, token: null };
  }

  static async #requestRemoteContest(activity, defender, usageContext) {
    const gm = ScContestActivityService.#activeGmUser();
    const activityUuid = activity?.uuid ?? null;
    const defenderUuid = defender?.token?.document?.uuid ?? defender?.token?.uuid ?? defender?.actor?.uuid ?? null;
    if (!gm || typeof gm.query !== "function" || !globalThis.CONFIG?.queries?.[QUERY_ID] || !activityUuid || !defenderUuid) {
      return null;
    }

    try {
      const result = await gm.query(QUERY_ID, {
        activityUuid,
        defenderUuid,
        usage: usageContext?.usage ?? {}
      }, { timeout: 120000 });
      if (result?.canceled && result.error) {
        ui.notifications?.warn?.(Constants.format(
          "SCMOREACTIVITIES.Activities.ScContest.Warning.RemoteFailed",
          { error: result.error },
          `Could not request the defender roll: ${result.error}`
        ));
      }
      return result ?? null;
    } catch (error) {
      Logger.error("Could not request remote sc-contest roll.", error);
      ui.notifications?.warn?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScContest.Warning.RemoteFailed",
        { error: error?.message ?? String(error) },
        `Could not request the defender roll: ${error?.message ?? String(error)}`
      ));
      return null;
    }
  }

  static async #rollParticipant(role, actor, participant = {}, subject = {}, usageContext = {}) {
    const config = ScContestActivityService.#normalizeParticipant(participant);
    const message = ScContestActivityService.#rollMessage(role, subject, usageContext);
    let rolls = null;

    if (config.rollType === CONTEST_ROLL_TYPES.SKILL && typeof actor?.rollSkill === "function") {
      rolls = await actor.rollSkill({ skill: config.skill }, {}, message);
    } else if (config.rollType === CONTEST_ROLL_TYPES.SAVING_THROW && typeof actor?.rollSavingThrow === "function") {
      rolls = await actor.rollSavingThrow({ ability: config.ability }, {}, message);
    } else if (config.rollType === CONTEST_ROLL_TYPES.ABILITY_CHECK && typeof actor?.rollAbilityCheck === "function") {
      rolls = await actor.rollAbilityCheck({ ability: config.ability }, {}, message);
    } else {
      const roll = await ScContestActivityService.#rollFormula(actor, config, role, message);
      rolls = roll ? [roll] : null;
    }

    const roll = ScContestActivityService.#extractRoll(rolls);
    if (!roll) {
      return ScContestActivityService.#cancel(
        "SCMOREACTIVITIES.Activities.ScContest.Warning.RollCanceled",
        "Contest roll canceled."
      );
    }

    const total = Number(roll.total);
    if (!Number.isFinite(total)) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScContest.Error.InvalidRollTotal",
        "Contest roll did not produce a valid total."
      ));
    }

    return {
      canceled: false,
      role,
      config,
      roll,
      total
    };
  }

  static #normalizeParticipant(participant = {}) {
    const rollType = Object.values(CONTEST_ROLL_TYPES).includes(participant?.rollType)
      ? participant.rollType
      : CONTEST_ROLL_TYPES.ABILITY_CHECK;
    return {
      rollType,
      ability: String(participant?.ability ?? "str").trim() || "str",
      skill: String(participant?.skill ?? "ath").trim() || "ath",
      formula: String(participant?.formula ?? "").trim()
    };
  }

  static async #rollFormula(actor, config, role, message = {}) {
    const formula = config.formula || (
      config.rollType === CONTEST_ROLL_TYPES.CUSTOM ? "" : ScContestActivityService.#fallbackFormula(config)
    );
    if (!formula) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScContest.Error.MissingFormula",
        "Custom contests need a formula."
      ));
    }

    if (config.rollType === CONTEST_ROLL_TYPES.CUSTOM) {
      const promptedRoll = await ScContestActivityService.#promptCustomFormulaRoll(actor, formula, role, message);
      if (promptedRoll !== undefined) {
        return promptedRoll;
      }
    }

    const roll = new Roll(formula, actor?.getRollData?.() ?? {});
    if (typeof roll.evaluate === "function") {
      try {
        await roll.evaluate({ async: true });
      } catch (error) {
        await roll.evaluate();
      }
    }
    return roll;
  }

  static async #promptCustomFormulaRoll(actor, formula, role, message = {}) {
    const diceConfig = globalThis.CONFIG?.Dice;
    const rollData = actor?.getRollData?.() ?? {};
    const d20Parts = ScContestActivityService.#customD20Parts(formula);
    const RollType = d20Parts ? (diceConfig?.D20Roll ?? diceConfig?.BasicRoll) : diceConfig?.BasicRoll;
    if (typeof RollType?.build !== "function") {
      const confirmed = await ScContestActivityService.#confirmCustomRoll(actor, formula, role);
      return confirmed ? undefined : null;
    }

    const rollConfig = {
      hookNames: ["scContestCustom"],
      rolls: [{
        parts: d20Parts ?? [formula],
        data: rollData,
        options: {}
      }],
      subject: actor
    };
    if (actor && typeof actor.getFlag === "function") {
      rollConfig.halflingLucky = actor.getFlag("dnd5e", "halflingLucky");
    }

    const messageConfig = ScContestActivityService.#customRollMessage(actor, formula, role, message);
    const dialogConfig = {
      configure: true,
      options: {
        window: {
          title: Constants.format(
            "SCMOREACTIVITIES.Activities.ScContest.Dialog.CustomRoll.Title",
            { actor: actor?.name ?? role, role },
            `Roll custom formula for ${actor?.name ?? role}`
          ),
          subtitle: actor?.name ?? ""
        }
      }
    };

    try {
      const rolls = await RollType.build(rollConfig, dialogConfig, messageConfig);
      return ScContestActivityService.#extractRoll(rolls);
    } catch (error) {
      Logger.warn("Could not render dnd5e custom contest roll dialog.", error);
      const confirmed = await ScContestActivityService.#confirmCustomRoll(actor, formula, role);
      if (!confirmed) {
        return null;
      }
      return undefined;
    }
  }

  static #customD20Parts(formula) {
    const match = String(formula ?? "").trim().match(/^(?:1\s*)?d20(?:\s*\+\s*)?(.*)$/i);
    if (!match) {
      return null;
    }
    const remainder = String(match[1] ?? "").trim();
    return remainder ? [remainder] : [];
  }

  static #customRollMessage(actor, formula, role, message = {}) {
    const roleLabel = Constants.localize(
      role === "defender"
        ? "SCMOREACTIVITIES.Activities.ScContest.Chat.Defender"
        : "SCMOREACTIVITIES.Activities.ScContest.Chat.Initiator",
      role
    );
    return {
      create: false,
      ...message,
      data: {
        ...(message.data ?? {}),
        flavor: Constants.format(
          "SCMOREACTIVITIES.Activities.ScContest.Dialog.CustomRoll.Title",
          { actor: actor?.name ?? roleLabel, formula, role: roleLabel },
          `Roll custom formula for ${actor?.name ?? roleLabel}`
        ),
        flags: {
          ...(message.data?.flags ?? {}),
          dnd5e: {
            ...(message.data?.flags?.dnd5e ?? {}),
            messageType: "roll",
            roll: {
              ...(message.data?.flags?.dnd5e?.roll ?? {}),
              type: "sc-contest-custom"
            }
          }
        },
        speaker: message.data?.speaker ?? message.speaker ?? ScContestActivityService.#speaker({ actor })
      }
    };
  }

  static async #confirmCustomRoll(actor, formula, role) {
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (typeof DialogV2?.confirm !== "function") {
      return true;
    }

    const roleLabel = Constants.localize(
      role === "defender"
        ? "SCMOREACTIVITIES.Activities.ScContest.Chat.Defender"
        : "SCMOREACTIVITIES.Activities.ScContest.Chat.Initiator",
      role
    );
    const actorName = actor?.name ?? roleLabel;
    const content = `
      <div class="sc-more-activities sc-ma-contest-roll-prompt">
        <p>${ScContestActivityService.#escape(Constants.format(
          "SCMOREACTIVITIES.Activities.ScContest.Dialog.CustomRoll.Content",
          { actor: actorName, formula },
          `${actorName} will roll ${formula}.`
        ))}</p>
        <code>${ScContestActivityService.#escape(formula)}</code>
      </div>
    `;

    try {
      return await DialogV2.confirm({
        content,
        modal: true,
        window: {
          icon: "fa-solid fa-dice-d20",
          title: Constants.format(
            "SCMOREACTIVITIES.Activities.ScContest.Dialog.CustomRoll.Title",
            { actor: actorName, role: roleLabel },
            `Roll custom formula for ${actorName}`
          )
        },
        yes: {
          icon: "fa-solid fa-dice-d20",
          label: Constants.localize("SCMOREACTIVITIES.Activities.ScContest.Dialog.CustomRoll.Roll", "Roll")
        },
        no: {
          icon: "fa-solid fa-xmark",
          label: Constants.localize("Cancel", "Cancel")
        }
      }, { rejectClose: false });
    } catch (error) {
      Logger.warn("Could not render custom contest roll confirmation dialog.", error);
    }

    if (typeof globalThis.Dialog?.confirm === "function") {
      try {
        return await globalThis.Dialog.confirm({
          title: Constants.format(
            "SCMOREACTIVITIES.Activities.ScContest.Dialog.CustomRoll.Title",
            { actor: actorName, role: roleLabel },
            `Roll custom formula for ${actorName}`
          ),
          content,
          yes: () => true,
          no: () => false,
          defaultYes: true
        });
      } catch (error) {
        Logger.warn("Could not render fallback custom contest roll confirmation dialog.", error);
      }
    }

    return true;
  }

  static #fallbackFormula(config) {
    if (config.rollType === CONTEST_ROLL_TYPES.SKILL) {
      return `1d20 + @skills.${config.skill}.total`;
    }
    if (config.rollType === CONTEST_ROLL_TYPES.SAVING_THROW) {
      return `1d20 + @abilities.${config.ability}.save`;
    }
    return `1d20 + @abilities.${config.ability}.mod`;
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

  static #determineOutcome(initiator, defender, tiePolicy, attempt) {
    const initiatorTotal = Number(initiator.total);
    const defenderTotal = Number(defender.total);
    if (initiatorTotal > defenderTotal) {
      return { result: "initiator", winner: "initiator", tied: false, shouldReroll: false };
    }
    if (defenderTotal > initiatorTotal) {
      return { result: "defender", winner: "defender", tied: false, shouldReroll: false };
    }

    if (tiePolicy === CONTEST_TIE_POLICIES.REROLL && attempt < MAX_REROLLS) {
      return { result: "tie", winner: null, tied: true, shouldReroll: true };
    }
    if (tiePolicy === CONTEST_TIE_POLICIES.INITIATOR) {
      return { result: "initiator", winner: "initiator", tied: true, shouldReroll: false };
    }
    if (tiePolicy === CONTEST_TIE_POLICIES.DEFENDER) {
      return { result: "defender", winner: "defender", tied: true, shouldReroll: false };
    }
    return { result: "tie", winner: null, tied: true, shouldReroll: false };
  }

  static async #createChatCard(activity, result) {
    const content = await ScContestActivityService.#renderChatContent(result);
    const speaker = ScContestActivityService.#speaker(result.initiator);
    await ChatMessage.create({
      speaker,
      content,
      type: CONST.CHAT_MESSAGE_TYPES?.OTHER ?? undefined,
      flags: {
        "sc-more-activities": {
          activityType: "sc-contest",
          activityId: activity?.id ?? activity?._id ?? null,
          result: result.outcome.result,
          tied: result.outcome.tied
        }
      }
    });
  }

  static async #renderChatContent(result) {
    const title = Constants.localize("SCMOREACTIVITIES.Activities.ScContest.Chat.Title", "Contest Result");
    const initiatorLabel = Constants.localize("SCMOREACTIVITIES.Activities.ScContest.Chat.Initiator", "Initiator");
    const defenderLabel = Constants.localize("SCMOREACTIVITIES.Activities.ScContest.Chat.Defender", "Defender");
    const winnerLabel = Constants.localize("SCMOREACTIVITIES.Activities.ScContest.Chat.Winner", "Winner");
    const tieLabel = Constants.localize("SCMOREACTIVITIES.Activities.ScContest.Chat.Tie", "Tie");
    const resultLabel = ScContestActivityService.#outcomeLabel(result);
    const initiator = await ScContestActivityService.#renderParticipant(initiatorLabel, result.initiator);
    const defender = await ScContestActivityService.#renderParticipant(defenderLabel, result.defender);

    return `
      <section class="sc-more-activities sc-ma-contest-card">
        <header>
          <i class="fa-solid fa-scale-balanced" inert></i>
          <h3>${ScContestActivityService.#escape(title)}</h3>
        </header>
        <div class="sc-ma-contest-participants">
          ${initiator}
          ${defender}
        </div>
        <div class="sc-ma-contest-outcome">
          <span>${ScContestActivityService.#escape(result.outcome.tied ? tieLabel : winnerLabel)}</span>
          <strong>${ScContestActivityService.#escape(resultLabel)}</strong>
        </div>
      </section>
    `;
  }

  static async #renderParticipant(roleLabel, participant) {
    const rollBreakdown = await ScContestActivityService.#renderRollBreakdown(participant.roll);
    return `
      <div class="sc-ma-contest-participant">
        <img src="${ScContestActivityService.#escape(participant.image)}" alt="${ScContestActivityService.#escape(participant.name)}">
        <div class="sc-ma-contest-participant-main">
          <span>${ScContestActivityService.#escape(roleLabel)}</span>
          <strong>${ScContestActivityService.#escape(participant.name)}</strong>
          <small>${ScContestActivityService.#escape(participant.rollLabel)}</small>
        </div>
        ${rollBreakdown}
      </div>
    `;
  }

  static #outcomeLabel(result) {
    if (result.outcome.result === "initiator") {
      return result.outcome.tied
        ? Constants.format(
          "SCMOREACTIVITIES.Activities.ScContest.Chat.TieWinner",
          { winner: result.initiator.name },
          `Tie resolved in favor of ${result.initiator.name}.`
        )
        : result.initiator.name;
    }
    if (result.outcome.result === "defender") {
      return result.outcome.tied
        ? Constants.format(
          "SCMOREACTIVITIES.Activities.ScContest.Chat.TieWinner",
          { winner: result.defender.name },
          `Tie resolved in favor of ${result.defender.name}.`
        )
        : result.defender.name;
    }
    return Constants.localize("SCMOREACTIVITIES.Activities.ScContest.Chat.NoWinner", "No winner.");
  }

  static #rollMessage(role, subject, usageContext) {
    return {
      create: false,
      data: {
        flags: {
          "sc-more-activities": {
            role,
            activityId: usageContext?.activity?.id ?? usageContext?.usage?.activityId ?? null
          }
        }
      },
      speaker: ScContestActivityService.#speaker(subject)
    };
  }

  static #participantIdentity({ actor, token } = {}) {
    const tokenDocument = token?.document ?? token ?? null;
    const name = tokenDocument?.name
      ?? actor?.name
      ?? Constants.localize("SCMOREACTIVITIES.Activities.ScContest.Chat.UnknownActor", "Unknown actor");
    const image = tokenDocument?.texture?.src
      ?? actor?.img
      ?? actor?.prototypeToken?.texture?.src
      ?? globalThis.CONST?.DEFAULT_TOKEN
      ?? "icons/svg/mystery-man.svg";
    return {
      actor,
      token: tokenDocument,
      image,
      name
    };
  }

  static #rollDescription(config = {}) {
    if (config.rollType === CONTEST_ROLL_TYPES.SKILL) {
      return Constants.format(
        "SCMOREACTIVITIES.Activities.ScContest.Chat.RollDescriptions.Skill",
        { skill: ScContestActivityService.#skillLabel(config.skill) },
        `Skill: ${ScContestActivityService.#skillLabel(config.skill)}`
      );
    }
    if (config.rollType === CONTEST_ROLL_TYPES.SAVING_THROW) {
      return Constants.format(
        "SCMOREACTIVITIES.Activities.ScContest.Chat.RollDescriptions.SavingThrow",
        { ability: ScContestActivityService.#abilityLabel(config.ability) },
        `Saving throw: ${ScContestActivityService.#abilityLabel(config.ability)}`
      );
    }
    if (config.rollType === CONTEST_ROLL_TYPES.CUSTOM) {
      return Constants.format(
        "SCMOREACTIVITIES.Activities.ScContest.Chat.RollDescriptions.Custom",
        { formula: config.formula },
        `Custom formula: ${config.formula}`
      );
    }

    return Constants.format(
      "SCMOREACTIVITIES.Activities.ScContest.Chat.RollDescriptions.AbilityCheck",
      { ability: ScContestActivityService.#abilityLabel(config.ability) },
      `Ability check: ${ScContestActivityService.#abilityLabel(config.ability)}`
    );
  }

  static async #renderRollBreakdown(roll) {
    if (!roll) {
      return "";
    }
    if (typeof roll.render === "function") {
      try {
        const rendered = await roll.render();
        const html = ScContestActivityService.#renderedRollHtml(rendered);
        if (html) {
          return ScContestActivityService.#decorateRenderedRoll(html);
        }
      } catch (error) {
        Logger.warn("Could not render native contest roll breakdown.", error);
      }
    }

    const rollTotal = Number(roll.total);
    const part = ScContestActivityService.#rollTooltipPart(roll);
    if (!part && !Number.isFinite(rollTotal)) {
      return "";
    }

    return `
      <div class="dice-roll sc-ma-contest-dice-roll expanded">
        <div class="dice-result">
          ${roll.formula ? `<div class="dice-formula">${ScContestActivityService.#escape(roll.formula)}</div>` : ""}
          <div class="dice-tooltip-collapser">
            <div class="dice-tooltip">
              ${part ?? ""}
            </div>
          </div>
          <h4 class="dice-total">${ScContestActivityService.#escape(Number.isFinite(rollTotal) ? rollTotal : "")}</h4>
        </div>
      </div>
    `;
  }

  static #renderedRollHtml(rendered) {
    if (typeof rendered === "string") {
      return rendered;
    }
    if (typeof rendered?.outerHTML === "string") {
      return rendered.outerHTML;
    }
    if (typeof rendered?.[0]?.outerHTML === "string") {
      return rendered[0].outerHTML;
    }
    return "";
  }

  static #decorateRenderedRoll(html) {
    const markup = String(html ?? "");
    const decorated = markup.replace(
      /<div\s+class=(["'])dice-roll([^"']*)\1([^>]*)>/,
      (_match, quote, classes, attributes) => {
        const classList = ScContestActivityService.#safeClassList(`dice-roll ${classes} sc-ma-contest-dice-roll expanded`);
        const action = /\sdata-action=/.test(attributes) ? "" : ' data-action="expandRoll"';
        return `<div class=${quote}${classList}${quote}${attributes}${action}>`;
      }
    );
    if (decorated !== markup) {
      return decorated;
    }
    return `<div class="dice-roll sc-ma-contest-dice-roll expanded" data-action="expandRoll">${markup}</div>`;
  }

  static #rollTooltipPart(roll) {
    const breakdown = ScContestActivityService.#rollBreakdownEntries(roll);
    const rolls = [...breakdown.rolls];
    const rollTotal = Number(roll.total);
    const constant = Number.isFinite(breakdown.constant) ? breakdown.constant : 0;

    if (constant) {
      const sign = constant < 0 ? "-" : "+";
      rolls.push({
        classes: "constant",
        result: `<span class="sign">${sign}</span>${ScContestActivityService.#escape(Math.abs(constant))}`
      });
    }
    if (!rolls.length && Number.isFinite(rollTotal)) {
      rolls.push({
        classes: "constant",
        result: ScContestActivityService.#escape(rollTotal)
      });
    }
    if (!rolls.length) {
      return "";
    }

    return `
      <section class="tooltip-part">
        <div class="dice">
          <ol class="dice-rolls">
            ${rolls.map(({ classes, result }) => `<li class="${ScContestActivityService.#escape(classes)}">${result}</li>`).join("")}
          </ol>
          <div class="total">
            <span class="value">${ScContestActivityService.#escape(Number.isFinite(rollTotal) ? rollTotal : "")}</span>
          </div>
        </div>
      </section>
    `;
  }

  static #rollBreakdownEntries(roll) {
    const terms = Array.isArray(roll?.terms) ? roll.terms : [];
    if (!terms.length) {
      return ScContestActivityService.#rollBreakdownFromDice(roll);
    }

    const entries = [];
    let signedDiceTotal = 0;
    let numericConstant = 0;
    let canResolveConstant = true;
    let operator = "+";

    for (const term of terms) {
      if (typeof term?.operator === "string") {
        if (term.operator === "+" || term.operator === "-") {
          operator = term.operator;
        } else {
          canResolveConstant = false;
        }
        continue;
      }

      const sign = operator === "-" ? -1 : 1;
      if (ScContestActivityService.#isDiceTerm(term)) {
        if (sign < 0) {
          entries.push({
            classes: "constant",
            result: '<span class="sign">-</span>'
          });
        }
        entries.push(...ScContestActivityService.#dieTooltipRolls(term));
        const dieTotal = ScContestActivityService.#dieTotal(term);
        if (Number.isFinite(dieTotal)) {
          signedDiceTotal += sign * dieTotal;
        } else {
          canResolveConstant = false;
        }
      } else if (ScContestActivityService.#isNumericTerm(term)) {
        const value = ScContestActivityService.#numericTermValue(term);
        if (Number.isFinite(value)) {
          numericConstant += sign * value;
        } else {
          canResolveConstant = false;
        }
      }
    }

    const rollTotal = Number(roll?.total);
    const constant = canResolveConstant ? numericConstant : NaN;
    if (!entries.length && Number.isFinite(rollTotal)) {
      return { rolls: [], constant: rollTotal };
    }
    return { rolls: entries, constant };
  }

  static #rollBreakdownFromDice(roll) {
    const dice = ScContestActivityService.#rollDiceTerms(roll);
    const rolls = dice.flatMap((die) => ScContestActivityService.#dieTooltipRolls(die));
    const diceTotal = dice
      .map((die) => ScContestActivityService.#dieTotal(die))
      .filter(Number.isFinite)
      .reduce((total, value) => total + value, 0);
    const rollTotal = Number(roll?.total);
    const constant = Number.isFinite(rollTotal) ? rollTotal - diceTotal : NaN;
    return { rolls, constant };
  }

  static #dieTooltipRolls(die) {
    if (typeof die?.getTooltipData === "function") {
      const tooltip = die.getTooltipData();
      if (Array.isArray(tooltip?.rolls)) {
        return tooltip.rolls.map((roll) => ({
          classes: ScContestActivityService.#safeClassList(`roll ${roll?.classes ?? ScContestActivityService.#dieClass(die)}`),
          result: ScContestActivityService.#escape(roll?.result ?? "")
        }));
      }
    }

    const results = Array.isArray(die?.results) ? die.results : [];
    return results.map((result) => ({
      classes: ScContestActivityService.#safeClassList([
        "roll",
        ScContestActivityService.#dieClass(die),
        result?.discarded || result?.active === false ? "discarded" : "",
        result?.rerolled ? "rerolled" : "",
        result?.exploded ? "exploded" : ""
      ].filter(Boolean).join(" ")),
      result: ScContestActivityService.#escape(result?.result ?? result?.value ?? "")
    }));
  }

  static #rollDiceTerms(roll) {
    const dice = Array.isArray(roll?.dice) ? roll.dice : [];
    const terms = Array.isArray(roll?.terms) ? roll.terms.filter((term) => Array.isArray(term?.results)) : [];
    return dice.length ? dice : terms;
  }

  static #isDiceTerm(term) {
    return Array.isArray(term?.results) || typeof term?.getTooltipData === "function";
  }

  static #isNumericTerm(term) {
    return Number.isFinite(Number(term?.number ?? term?.total));
  }

  static #numericTermValue(term) {
    return Number(term?.number ?? term?.total);
  }

  static #dieTotal(die) {
    const directTotal = Number(die?.total);
    if (Number.isFinite(directTotal)) {
      return directTotal;
    }
    const results = Array.isArray(die?.results) ? die.results : [];
    const active = results.filter((result) => result?.active !== false && !result?.discarded && !result?.rerolled);
    const values = active
      .map((result) => Number(result?.result ?? result?.value))
      .filter(Number.isFinite);
    return values.length ? values.reduce((total, value) => total + value, 0) : NaN;
  }

  static #dieClass(die) {
    const faces = Number(die?.faces);
    if (Number.isFinite(faces)) {
      return `basicdie d${faces}`;
    }
    return "basicdie";
  }

  static #abilityLabel(ability) {
    const label = globalThis.CONFIG?.DND5E?.abilities?.[ability]?.label;
    return label ? game.i18n.localize(label) : String(ability ?? "").toUpperCase();
  }

  static #skillLabel(skill) {
    const label = globalThis.CONFIG?.DND5E?.skills?.[skill]?.label;
    return label ? game.i18n.localize(label) : String(skill ?? "").toUpperCase();
  }

  static #canRollActor(actor) {
    if (game?.user?.isGM) {
      return true;
    }
    if (actor?.isOwner) {
      return true;
    }
    if (typeof actor?.testUserPermission === "function") {
      return actor.testUserPermission(game.user, "OWNER");
    }
    return false;
  }

  static #activeGmUser() {
    const activeGm = game?.users?.activeGM;
    if (activeGm?.active && activeGm?.isGM) {
      return activeGm;
    }
    const users = Array.from(game?.users ?? []);
    return users.find((user) => user?.active && user?.isGM) ?? null;
  }

  static async #fromUuid(uuid) {
    if (!uuid) {
      return null;
    }
    if (typeof globalThis.fromUuid === "function") {
      return globalThis.fromUuid(uuid);
    }
    if (typeof globalThis.fromUuidSync === "function") {
      return globalThis.fromUuidSync(uuid);
    }
    return null;
  }

  static #serializeResult(result) {
    return {
      canceled: false,
      outcome: {
        result: result?.outcome?.result ?? "tie",
        tied: result?.outcome?.tied === true
      },
      initiator: {
        name: result?.initiator?.name ?? "",
        total: result?.initiator?.total ?? null
      },
      defender: {
        name: result?.defender?.name ?? "",
        total: result?.defender?.total ?? null
      }
    };
  }

  static #speaker({ actor, token } = {}) {
    const tokenDocument = token?.document ?? token ?? null;
    const data = {
      actor,
      token: tokenDocument,
      scene: tokenDocument?.parent ?? canvas?.scene ?? null,
      alias: tokenDocument?.name ?? actor?.name ?? null
    };
    return ChatMessage.implementation?.getSpeaker?.(data) ?? ChatMessage.getSpeaker(data);
  }

  static #cancel(key, fallback) {
    ui.notifications?.warn?.(Constants.localize(key, fallback));
    return { canceled: true };
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

  static #safeClassList(value) {
    return String(value ?? "")
      .split(/\s+/)
      .map((part) => part.replace(/[^a-zA-Z0-9_-]/g, ""))
      .filter(Boolean)
      .join(" ");
  }
}
