import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ScChatRelay } from "../../support/ScChatRelay.js";
import { ACTIVITY_TYPES } from "../ActivityTypes.js";
import { ScCanvasFormula } from "../canvas/ScCanvasFormula.js";
import { ScRangeShape } from "../canvas/ScRangeShape.js";
import { ScPortalGeometry } from "../portal/ScPortalGeometry.js";
import { ScPortalService } from "../portal/ScPortalService.js";
import { ScRecallArrivalCamera } from "./ScRecallArrivalCamera.js";
import { ScRecallPlacement } from "./ScRecallPlacement.js";
import { ScRecallPortalPlacement } from "./ScRecallPortalPlacement.js";
import { ScRecallTravel } from "./ScRecallTravel.js";

const FLAG = "recallPortal";
const OPEN = "recall-portal-open";
const CROSS = "recall-portal-cross";
const LANG = "SCMOREACTIVITIES.Activities.ScRecall";
const DEFAULT_ROUND_SECONDS = 6;
/** How many grid steps from the preferred spot a new portal may move to stay clear of others. */
const FREE_SPOT_REACH = 6;

/**
 * The portal form of a recall: one side opens where the user stands, the other
 * at the destination, usually on another scene, and anyone allowed crosses by
 * clicking a side while their token stands at it.
 *
 * Both sides are Regions carrying everything a crossing needs in their flags
 * (the partner side, uses left, who crossed which way, expiry), so a portal
 * keeps working after the item is gone. Opening one and crossing it write to
 * scenes and to other players' tokens, so a player's request goes to the GM
 * through `ScChatRelay`, where it is checked against those flags and the
 * token's actual position.
 *
 * It reuses the portal activity's geometry, but none of its portals: the two
 * never see each other's regions.
 */
export class ScRecallPortal {
  /** Tail of the crossing queue for each portal, so crossings never race on uses or squares. */
  static #queues = new Map();

  /** Portals being torn down, so deleting one side does not recurse through the other. */
  static #closing = new Set();

  static #clickHandler = null;

  static registerHooks() {
    ScChatRelay.registerHandler(OPEN, ScRecallPortal.#handleOpen);
    ScChatRelay.registerHandler(CROSS, ScRecallPortal.#handleCross);
    Hooks.on("deleteRegion", (region) => ScRecallPortal.#onRegionDeleted(region));
    Hooks.on("updateCombat", () => ScRecallPortal.sweepExpired());
    Hooks.on("deleteCombat", () => ScRecallPortal.sweepExpired());
    Hooks.on("updateWorldTime", () => ScRecallPortal.sweepExpired());
    Hooks.on("canvasReady", () => {
      ScRecallPortal.#armClickListener();
      ScRecallPortal.sweepExpired();
    });
    ScRecallPortal.#armClickListener();
  }

  // ---------------------------------------------------------------------------
  // Opening
  // ---------------------------------------------------------------------------

  /**
   * Opens a portal from the point the user picked near their token (`entry`;
   * their token's square when omitted) to the activity's destination.
   * Resolves with `{ status, sceneUuid }` where status is "opened", "blocked"
   * (no room at the destination), "refused", or "no-gm"; `null` when the GM
   * did not answer.
   */
  static async open(activity, actor, origin, destinationLabel, entry = null) {
    const data = { activityUuid: activity.uuid, originUuid: origin.document?.uuid ?? origin.uuid, entry };
    if (game?.user?.isGM) {
      const outcome = await ScRecallPortal.#executeOpen(game.user, data);
      if (outcome.status !== "refused") {
        await ScRecallPortal.#postCard(actor, ScRecallPortal.#openCard(outcome));
      }
      return { status: outcome.status, sceneUuid: outcome.sceneUuid ?? null };
    }

    if (!ScChatRelay.isAvailable()) {
      return { status: "no-gm" };
    }
    const answer = await ScChatRelay.request(OPEN, {
      speaker: ChatMessage.getSpeaker({ actor }),
      content: ScRecallPortal.#openCard({ status: "pending", actor, destinationLabel }),
      data
    });
    return answer ? { status: answer.status, sceneUuid: answer.answer?.sceneUuid ?? null } : null;
  }

  static async #handleOpen({ user, data }) {
    const outcome = await ScRecallPortal.#executeOpen(user, data);
    return {
      status: outcome.status,
      content: ScRecallPortal.#openCard(outcome),
      answer: { sceneUuid: outcome.sceneUuid ?? null }
    };
  }

  static async #executeOpen(user, data = {}) {
    const refused = { status: "refused" };
    const activity = await ScRecallPortal.#fromUuid(data.activityUuid);
    if (String(activity?.type ?? "") !== ACTIVITY_TYPES.RECALL
      || activity.recall?.delivery !== "portal"
      || !ScRecallTravel.canUseActivity(activity, user)) {
      return refused;
    }

    const actor = activity.actor ?? activity.item?.actor ?? null;
    const origin = await ScRecallPortal.#fromUuid(data.originUuid);
    if (!ScRecallPortal.#is(origin, "Token") || !origin.parent || !ScRecallTravel.isActorToken(origin, actor)) {
      return refused;
    }
    const destination = await ScRecallTravel.resolveDestination(activity, actor);
    if (destination.error) {
      return refused;
    }

    const config = ScRecallPortal.config(activity);
    const entryScene = origin.parent;
    const exitScene = destination.scene;
    // The picked point is checked again here: the request only carries a claim of where it is.
    const originCenter = ScPortalGeometry.tokenCenter(origin, entryScene);
    const entryCenter = ScPortalGeometry.snapCenter(data.entry ?? originCenter, {
      scene: entryScene,
      squares: config.squares
    });
    if (data.entry && ScRecallPortalPlacement.issueFor({
      point: entryCenter,
      originCenter,
      range: config.placementRange,
      rangeShape: config.rangeShape,
      scene: entryScene
    })) {
      return refused;
    }
    const exitCenter = destination.kind === "region"
      ? ScRecallPortal.#centerInRegion(destination.region, exitScene, config.squares)
      : ScRecallPortal.#centerBeside(destination.anchor, exitScene, config.squares);
    const outcome = { actor, destinationLabel: destination.label, sceneUuid: exitScene.uuid ?? null, config };
    if (!entryCenter || !exitCenter) {
      return { status: "blocked", ...outcome };
    }

    const portalId = foundry.utils.randomID();
    const ids = { entry: foundry.utils.randomID(), exit: foundry.utils.randomID() };
    const label = String(activity.item?.name ?? activity.name ?? "").trim()
      || Constants.localize(`${LANG}.Portal.Name`, "Recall portal");
    const shared = {
      portalId,
      label,
      shape: config.shape,
      oneWay: config.oneWay,
      roundTrip: config.roundTrip,
      closeOnReturn: config.closeOnReturn,
      // Who opened it: their token keeps its id when it changes scene, and a
      // linked actor is the same actor wherever its token stands.
      openerTokenId: origin.id ?? null,
      openerActorId: origin.actorLink ? (origin.actorId ?? origin.actor?.id ?? null) : null,
      usesLeft: config.maxUses === "" ? null : config.maxUses,
      ...ScRecallPortal.#expiryFor(config.durationRounds),
      alliesOnly: activity.recall?.allyFilter !== "any",
      disposition: origin.disposition ?? null,
      crossings: {},
      activityUuid: activity.uuid ?? null,
      createdBy: user?.id ?? null
    };
    // Each side names where it leads, which is what a traveller is asked to confirm.
    const sides = [
      { side: "entry", scene: entryScene, center: entryCenter, partner: { scene: exitScene, id: ids.exit }, leadsTo: destination.label },
      { side: "exit", scene: exitScene, center: exitCenter, partner: { scene: entryScene, id: ids.entry }, leadsTo: entryScene.name ?? "" }
    ];
    for (const { side, scene, center, partner, leadsTo } of sides) {
      const radiusPixels = ScPortalGeometry.radiusPixels(config.squares, scene);
      await scene.createEmbeddedDocuments("Region", [ScRecallPortal.#regionData({
        id: ids[side],
        side,
        center,
        radiusPixels,
        config,
        flags: { ...shared, side, leadsTo, center, radiusPixels, partnerUuid: `Scene.${partner.scene.id}.Region.${partner.id}` }
      })], { keepId: true });
      await ScRecallPortal.#createTile(scene, config, portalId, side, center, radiusPixels);
    }
    return { status: "opened", ...outcome };
  }

  /** Portal settings with formulas resolved against the item. */
  static config(activity) {
    const portal = activity?.portal ?? {};
    const item = activity?.item ?? null;
    const maxUses = ScCanvasFormula.resolveLimit(portal.maxUses, item);
    const oneWay = portal.direction === "oneWay";
    return {
      oneWay,
      roundTrip: !oneWay && portal.roundTrip === true,
      closeOnReturn: !oneWay && portal.closeOnReturn !== false,
      maxUses: maxUses === "" || maxUses <= 0 ? "" : maxUses,
      durationRounds: ScCanvasFormula.resolveNumber(portal.durationRounds, item, 0, { min: 0 }),
      placementRange: ScCanvasFormula.resolveNumber(portal.placementRange, item, 30, { min: 0 }),
      rangeShape: ScRangeShape.normalize(activity?.recall?.rangeShape),
      squares: ScPortalGeometry.squareCount(portal.size),
      shape: portal.shape === "square" ? "square" : "circle",
      visibility: ["gm", "hidden"].includes(portal.visibility) ? portal.visibility : "all",
      color: /^#[0-9a-fA-F]{6}$/.test(String(portal.color ?? "")) ? portal.color : "#ffb3a7",
      image: String(portal.image ?? "").trim()
    };
  }

  // ---------------------------------------------------------------------------
  // Crossing
  // ---------------------------------------------------------------------------

  /**
   * Sends `tokenUuid` through the portal side `regionUuid`. Resolves with
   * `{ status, reason }`: status "crossed" or "refused", with the reason a
   * crossing was refused.
   */
  static async cross({ regionUuid, tokenUuid, tokenName = "", portalLabel = "" }) {
    const data = { regionUuid, tokenUuid };
    if (game?.user?.isGM) {
      return ScRecallPortal.#queueCross(game.user, data);
    }
    if (!ScChatRelay.isAvailable()) {
      return { status: "refused", reason: "no-gm" };
    }
    const answer = await ScChatRelay.request(CROSS, {
      speaker: { alias: tokenName },
      content: ScRecallPortal.#crossCard({ status: "pending", tokenName, portalLabel }),
      data,
      whisper: true
    });
    return answer
      ? { status: answer.status, reason: answer.answer?.reason ?? null }
      : { status: "refused", reason: "timeout" };
  }

  static async #handleCross({ user, data }) {
    const outcome = await ScRecallPortal.#queueCross(user, data);
    return {
      status: outcome.status,
      content: ScRecallPortal.#crossCard(outcome),
      answer: { reason: outcome.reason ?? null }
    };
  }

  /**
   * One crossing at a time per portal: two tokens stepping in together would
   * otherwise both read the same uses left and land on the same square. The
   * queue is keyed by the portal, not the side, because both sides share one
   * count: two crossings in opposite directions must wait for each other too.
   */
  static async #queueCross(user, data) {
    const region = await ScRecallPortal.#fromUuid(data?.regionUuid);
    const key = ScRecallPortal.#describe(region)?.portalId ?? String(data?.regionUuid ?? "");
    const previous = ScRecallPortal.#queues.get(key) ?? Promise.resolve();
    const current = previous.then(() => ScRecallPortal.#executeCross(user, data));
    const tail = current.catch(() => {});
    ScRecallPortal.#queues.set(key, tail);
    tail.then(() => {
      if (ScRecallPortal.#queues.get(key) === tail) {
        ScRecallPortal.#queues.delete(key);
      }
    });
    return current;
  }

  static async #executeCross(user, data = {}) {
    const region = await ScRecallPortal.#fromUuid(data.regionUuid);
    const portal = ScRecallPortal.#describe(region);
    const refuse = (reason) => ({ status: "refused", reason, portalLabel: portal?.label ?? "" });
    if (!portal) {
      return refuse("gone");
    }

    const scene = region.parent;
    const usesLeft = ScRecallPortal.#finite(portal.usesLeft);
    const partner = await ScRecallPortal.#fromUuid(portal.partnerUuid);
    const partnerPortal = ScRecallPortal.#describe(partner);
    if (ScPortalService.isExpired(portal) || (usesLeft !== null && usesLeft <= 0) || !partnerPortal) {
      await ScRecallPortal.#close(portal.portalId, [region.uuid, portal.partnerUuid]);
      return refuse("gone");
    }
    if (portal.oneWay && portal.side !== "entry") {
      return refuse("one-way");
    }

    const token = await ScRecallPortal.#fromUuid(data.tokenUuid);
    if (!ScRecallPortal.#is(token, "Token") || token.parent !== scene) {
      return refuse("moved");
    }
    if (!user?.isGM && token.testUserPermission?.(user, "OWNER") !== true) {
      return refuse("refused");
    }
    if (portal.alliesOnly && token.disposition !== portal.disposition) {
      return refuse("not-allowed");
    }
    // The prompt can stay open a while, so where the token stands is checked now.
    if (!ScPortalGeometry.tokenReachesPortal(portal, token, scene)) {
      return refuse("moved");
    }

    const direction = portal.side === "entry" ? "out" : "back";
    const record = portal.crossings?.[token.id] ?? {};
    if (portal.roundTrip && (record[direction] || (direction === "back" && !record.out))) {
      return refuse("used");
    }

    const targetScene = partner.parent;
    const [spot] = ScRecallPlacement.findSpots(targetScene, ScRecallPortal.#footprint(partnerPortal, targetScene), [token], {
      ignoreIds: targetScene === scene ? new Set([token.id]) : new Set()
    });
    if (!spot) {
      return refuse("occupied");
    }

    const arrived = await ScRecallTravel.placeToken(token, targetScene, spot);
    await ScRecallArrivalCamera.mark(arrived, user);
    const crossings = { ...(portal.crossings ?? {}), [arrived.id]: { ...record, [direction]: true } };
    const remaining = usesLeft === null ? null : usesLeft - 1;
    // The opener coming home ends the trip for everyone, as a Diablo II town portal does.
    const openerReturned = direction === "back" && portal.closeOnReturn && ScRecallPortal.#isOpener(portal, arrived);
    if (remaining === 0 || openerReturned) {
      await ScRecallPortal.#close(portal.portalId, [region.uuid, portal.partnerUuid]);
    } else {
      for (const side of [region, partner]) {
        await side.update({
          [`flags.${Constants.MODULE_ID}.${FLAG}.usesLeft`]: remaining,
          [`flags.${Constants.MODULE_ID}.${FLAG}.crossings`]: crossings
        });
      }
    }

    // The token that crossed is the one the user chose to send, so they follow it.
    ScRecallTravel.bringViewers([arrived], scene, targetScene, user, { follow: true });
    return {
      status: "crossed",
      tokenName: token.name ?? "",
      portalLabel: portal.label,
      usesLeft: remaining,
      closed: remaining === 0 || openerReturned
    };
  }

  static #isOpener(portal, token) {
    if (portal.openerTokenId && token?.id === portal.openerTokenId) {
      return true;
    }
    return Boolean(portal.openerActorId) && token?.actorLink === true
      && (token.actorId ?? token.actor?.id) === portal.openerActorId;
  }

  // ---------------------------------------------------------------------------
  // Clicking a portal
  // ---------------------------------------------------------------------------

  static #armClickListener() {
    const stage = globalThis.canvas?.stage;
    if (!stage?.on) {
      return;
    }
    if (ScRecallPortal.#clickHandler) {
      stage.off?.("pointerdown", ScRecallPortal.#clickHandler);
    }
    ScRecallPortal.#clickHandler = (event) => ScRecallPortal.#onStagePointerDown(event);
    stage.on("pointerdown", ScRecallPortal.#clickHandler);
  }

  static #onStagePointerDown(event) {
    try {
      const originalEvent = event?.data?.originalEvent ?? event?.nativeEvent ?? event;
      const scene = canvas?.scene;
      if (Number(originalEvent?.button ?? 0) !== 0 || !scene?.regions?.size) {
        return;
      }
      const point = ScPortalGeometry.validPoint(canvas.canvasCoordinatesFromClient?.(originalEvent))
        ?? (event?.global && canvas.stage?.toLocal ? ScPortalGeometry.validPoint(canvas.stage.toLocal(event.global)) : null);
      const portal = point ? ScRecallPortal.portalAt(scene, point) : null;
      if (!portal || (portal.oneWay && portal.side !== "entry")) {
        return;
      }

      originalEvent?.preventDefault?.();
      event?.stopPropagation?.();
      const token = ScRecallPortal.travellerFor(portal, scene);
      if (!token) {
        ScRecallPortal.#warn("Warning.NoTraveller", "Select a token standing on or next to the portal to cross.");
        return;
      }
      ScRecallPortal.#askToCross(portal, token).catch((error) => {
        Logger.warn("Could not resolve the recall portal click.", error);
      });
    } catch (error) {
      Logger.debug("Could not handle the recall portal click.", error);
    }
  }

  static portalAt(scene, point) {
    return ScRecallPortal.#portals(scene).find((portal) => ScPortalGeometry.containsPoint(portal, point)) ?? null;
  }

  /**
   * The token a click on `portal` should send: a selected token of the user's
   * standing at it, else their character's token there, else the single token
   * of theirs inside it.
   */
  static travellerFor(portal, scene) {
    const reaches = (document) => ScPortalGeometry.tokenReachesPortal(portal, document, scene);
    const controlled = (canvas?.tokens?.controlled ?? [])
      .map((token) => token?.document ?? token)
      .find((document) => document?.isOwner && reaches(document));
    if (controlled) {
      return controlled;
    }

    const character = Array.from(game?.user?.character?.getActiveTokens?.(false, true) ?? [])
      .map((token) => token?.document ?? token)
      .find((document) => document?.parent === scene && reaches(document));
    if (character) {
      return character;
    }

    const inside = ScRecallPortal.#contents(scene.tokens)
      .filter((document) => document?.isOwner)
      .filter((document) => ScPortalGeometry.containsPoint(portal, ScPortalGeometry.tokenCenter(document, scene)));
    return inside.length === 1 ? inside[0] : null;
  }

  static async #askToCross(portal, token) {
    if (!await ScRecallPortal.#confirmCrossing(portal, token)) {
      return;
    }

    const result = await ScRecallPortal.cross({
      regionUuid: portal.regionUuid,
      tokenUuid: token.uuid,
      tokenName: token.name ?? "",
      portalLabel: portal.label
    });
    if (result.status !== "crossed") {
      ScRecallPortal.#warnRefusal(result.reason);
    }
  }

  /** Asks whether the token steps through, naming where this side leads. */
  static async #confirmCrossing(portal, token) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (typeof DialogV2?.confirm !== "function") {
      return false;
    }
    const escape = ScRecallPortal.#escape;
    const destination = portal.leadsTo || portal.label;
    const details = [`<span><i class="fa-solid fa-user" inert></i>${escape(token.name ?? "")}</span>`];
    const usesLeft = ScRecallPortal.#finite(portal.usesLeft);
    if (usesLeft !== null) {
      details.push(`<span>${escape(Constants.format(`${LANG}.Prompt.UsesLeft`, { count: usesLeft }, `Crossings left: ${usesLeft}`))}</span>`);
    }
    if (portal.roundTrip) {
      details.push(`<span>${escape(Constants.localize(`${LANG}.Card.PortalRoundTrip`, "Each creature may go and return once"))}</span>`);
    }
    try {
      return await DialogV2.confirm({
        // Passing classes replaces the DialogV2 defaults, so the core class comes along.
        classes: ["dialog", "sc-more-activities", "sc-ma-portal-prompt-dialog"],
        window: { title: Constants.localize(`${LANG}.Prompt.Title`, "Portal") },
        position: { width: 400 },
        content: `
          <div class="sc-more-activities sc-ma-portal-prompt">
            <div class="sc-ma-portal-prompt-header">
              <i class="sc-ma-recall-icon sc-ma-recall-icon--portal" inert></i>
              <div>
                <strong>${escape(destination)}</strong>
                <span>${escape(Constants.format(`${LANG}.Prompt.Question`, { token: token.name ?? "", destination },
                  `Send ${token.name ?? ""} to ${destination}?`))}</span>
              </div>
            </div>
            <div class="sc-ma-placement-summary">${details.join("")}</div>
          </div>`,
        yes: { label: Constants.localize(`${LANG}.Prompt.Accept`, "Step through") },
        no: { label: Constants.localize(`${LANG}.Prompt.Decline`, "Stay") },
        rejectClose: false
      }) === true;
    } catch (error) {
      Logger.warn("Could not show the recall portal prompt.", error);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Closing and expiry
  // ---------------------------------------------------------------------------

  static async sweepExpired() {
    if (!ScRecallPortal.#isResponsibleGm()) {
      return;
    }
    for (const scene of game?.scenes ?? []) {
      for (const portal of ScRecallPortal.#portals(scene)) {
        if (ScPortalService.isExpired(portal)) {
          await ScRecallPortal.#close(portal.portalId, [portal.regionUuid, portal.partnerUuid]);
        }
      }
    }
  }

  static #onRegionDeleted(region) {
    const portal = region?.flags?.[Constants.MODULE_ID]?.[FLAG];
    if (!portal?.portalId || !ScRecallPortal.#isResponsibleGm()) {
      return;
    }
    ScRecallPortal.#close(portal.portalId, [portal.partnerUuid], [region.parent]).catch((error) => {
      Logger.warn("Could not close the other side of the recall portal.", error);
    });
  }

  /** Deletes the given sides and every art tile of the portal. Safe on a half-closed portal. */
  static async #close(portalId, regionUuids, extraScenes = []) {
    if (!portalId || ScRecallPortal.#closing.has(portalId)) {
      return;
    }
    ScRecallPortal.#closing.add(portalId);
    try {
      const scenes = new Set(extraScenes.filter(Boolean));
      for (const uuid of regionUuids) {
        const region = await ScRecallPortal.#fromUuid(uuid);
        if (region?.parent) {
          scenes.add(region.parent);
          await region.parent.deleteEmbeddedDocuments("Region", [region.id]);
        }
      }
      for (const scene of scenes) {
        const tileIds = ScRecallPortal.#contents(scene.tiles)
          .filter((tile) => tile?.flags?.[Constants.MODULE_ID]?.[FLAG]?.portalId === portalId)
          .map((tile) => tile.id);
        if (tileIds.length) {
          await scene.deleteEmbeddedDocuments("Tile", tileIds);
        }
      }
    } catch (error) {
      Logger.warn("Could not close the recall portal.", error);
    } finally {
      ScRecallPortal.#closing.delete(portalId);
    }
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  static #regionData({ id, side, center, radiusPixels, config, flags }) {
    const shape = ScPortalGeometry.regionShape(center, { shape: config.shape, radiusPixels });
    const visibility = globalThis.CONST?.REGION_VISIBILITY ?? { LAYER: 0, GAMEMASTER: 1, ALWAYS: 2 };
    const sideName = Constants.localize(
      `${LANG}.Portal.${side === "entry" ? "Entry" : "Exit"}`,
      side === "entry" ? "Entry" : "Exit"
    );
    return {
      _id: id,
      name: flags.leadsTo ? `${flags.label} → ${flags.leadsTo}` : `${flags.label} (${sideName})`,
      color: config.color,
      shapes: shape ? [shape] : [],
      visibility: config.visibility === "hidden"
        ? visibility.LAYER
        : (config.visibility === "gm" ? visibility.GAMEMASTER : visibility.ALWAYS),
      flags: { [Constants.MODULE_ID]: { [FLAG]: flags } }
    };
  }

  static async #createTile(scene, config, portalId, side, center, radiusPixels) {
    if (!config.image) {
      return;
    }
    const size = Math.round(radiusPixels * 2);
    try {
      await scene.createEmbeddedDocuments("Tile", [{
        texture: { src: config.image },
        x: Math.round(center.x - radiusPixels),
        y: Math.round(center.y - radiusPixels),
        width: size,
        height: size,
        hidden: config.visibility === "gm",
        flags: { [Constants.MODULE_ID]: { [FLAG]: { portalId, side } } }
      }]);
    } catch (error) {
      // The portal is already open; missing art is cosmetic.
      Logger.warn("Could not create the recall portal art.", error);
    }
  }

  /**
   * Where a new portal opens in the destination region: the free spot nearest
   * its center, inside it when possible. Every use opens its own pair, so a
   * busy destination gets portals side by side rather than stacked, each still
   * leading back to where it was opened, as town portals do in Diablo II.
   */
  static #centerInRegion(region, scene, squares) {
    const box = ScRecallPortal.#regionBox(region);
    if (!box) {
      return null;
    }
    const center = ScPortalGeometry.snapCenter({ x: box.x + (box.w / 2), y: box.y + (box.h / 2) }, { scene, squares });
    return center ? ScRecallPortal.#freeCenter(scene, center, squares, box) : null;
  }

  /** Bounding box of a region's shapes, holes left out. */
  static #regionBox(region) {
    const xs = [];
    const ys = [];
    for (const shape of region?.shapes ?? []) {
      if (shape?.hole) {
        continue;
      }
      if (Array.isArray(shape?.points) && shape.points.length >= 2) {
        for (let index = 0; index < shape.points.length - 1; index += 2) {
          xs.push(Number(shape.points[index]));
          ys.push(Number(shape.points[index + 1]));
        }
      } else if (Number.isFinite(Number(shape?.width)) && Number.isFinite(Number(shape?.height))) {
        xs.push(Number(shape.x), Number(shape.x) + Number(shape.width));
        ys.push(Number(shape.y), Number(shape.y) + Number(shape.height));
      } else {
        const rx = Number(shape?.radiusX ?? shape?.radius);
        const ry = Number(shape?.radiusY ?? shape?.radius);
        if (Number.isFinite(rx) && Number.isFinite(ry)) {
          xs.push(Number(shape.x) - rx, Number(shape.x) + rx);
          ys.push(Number(shape.y) - ry, Number(shape.y) + ry);
        }
      }
    }
    const fx = xs.filter(Number.isFinite);
    const fy = ys.filter(Number.isFinite);
    if (!fx.length || !fy.length) {
      return null;
    }
    const x = Math.min(...fx);
    const y = Math.min(...fy);
    return { x, y, w: Math.max(...fx) - x, h: Math.max(...fy) - y };
  }

  /**
   * The center nearest `preferred`, in whole grid steps, where a portal fits
   * on the scene without covering another recall portal or a token. Spots
   * whose footprint stays inside `within` come first.
   */
  static #freeCenter(scene, preferred, squares, within = null) {
    const size = ScPortalGeometry.gridSize(scene);
    const radius = ScPortalGeometry.radiusPixels(squares, scene);
    const bounds = scene?.dimensions?.sceneRect ?? null;
    const taken = ScRecallPortal.#portalAreas(scene).concat(ScRecallPortal.#contents(scene?.tokens).map((token) => ({
      x: Number(token.x) || 0,
      y: Number(token.y) || 0,
      w: (Number(token.width) || 1) * size,
      h: (Number(token.height) || 1) * size
    })));
    const inside = (rect, area) => rect.x >= area.x && rect.y >= area.y
      && rect.x + rect.w <= area.x + (area.w ?? area.width) && rect.y + rect.h <= area.y + (area.h ?? area.height);
    const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

    const candidates = [];
    for (let dx = -FREE_SPOT_REACH; dx <= FREE_SPOT_REACH; dx += 1) {
      for (let dy = -FREE_SPOT_REACH; dy <= FREE_SPOT_REACH; dy += 1) {
        const center = { x: preferred.x + (dx * size), y: preferred.y + (dy * size) };
        const rect = { x: center.x - radius, y: center.y - radius, w: radius * 2, h: radius * 2 };
        candidates.push({ center, rect, outside: within && !inside(rect, within) ? 1 : 0, distance: Math.hypot(dx, dy) });
      }
    }
    return candidates
      .sort((left, right) => (left.outside - right.outside) || (left.distance - right.distance))
      .find(({ rect }) => (!bounds || inside(rect, bounds)) && !taken.some((area) => overlaps(rect, area)))
      ?.center ?? null;
  }

  /** The footprint of every recall portal side on the scene, as `{ x, y, w, h }`. */
  static #portalAreas(scene) {
    return ScRecallPortal.#portals(scene).map((portal) => {
      const radius = Number(portal.radiusPixels) || 0;
      return { x: portal.center.x - radius, y: portal.center.y - radius, w: radius * 2, h: radius * 2 };
    });
  }

  /** A free spot for the portal itself beside a home NPC, as its center. */
  static #centerBeside(anchor, scene, squares) {
    const [spot] = ScRecallPlacement.findSpots(scene, anchor, [{ id: null, width: squares, height: squares }], {
      obstacles: ScRecallPortal.#portalAreas(scene)
    });
    if (!spot) {
      return null;
    }
    const half = (squares * ScPortalGeometry.gridSize(scene)) / 2;
    return { x: spot.x + half, y: spot.y + half };
  }

  /** The portal side as a token-like footprint, so arrivals land beside it, not on it. */
  static #footprint(portal, scene) {
    const size = ScPortalGeometry.gridSize(scene);
    const radius = Number(portal.radiusPixels) || (size / 2);
    return {
      id: null,
      x: portal.center.x - radius,
      y: portal.center.y - radius,
      width: (radius * 2) / size,
      height: (radius * 2) / size
    };
  }

  /**
   * A portal keeps both a round deadline and a world-time deadline: rounds are
   * what count in combat, and outside it the same duration passes as time.
   */
  static #expiryFor(durationRounds) {
    const rounds = Number(durationRounds);
    if (!Number.isFinite(rounds) || rounds <= 0) {
      return { expiresAtRound: null, expiresAtWorldTime: null, combatId: null };
    }
    const combat = game?.combat?.started ? game.combat : null;
    const roundSeconds = Number(globalThis.CONFIG?.time?.roundTime ?? DEFAULT_ROUND_SECONDS) || DEFAULT_ROUND_SECONDS;
    return {
      expiresAtRound: combat ? Number(combat.round ?? 0) + rounds : null,
      expiresAtWorldTime: Number(game?.time?.worldTime ?? 0) + (rounds * roundSeconds),
      combatId: combat?.id ?? null
    };
  }

  // ---------------------------------------------------------------------------
  // Cards and notices
  // ---------------------------------------------------------------------------

  static #openCard({ status, actor = null, destinationLabel = "", config = null } = {}) {
    const name = actor?.name ?? "";
    let text = "";
    if (status === "pending") {
      text = Constants.format(`${LANG}.Card.PortalPending`, { actor: name, destination: destinationLabel },
        `${name} is opening a portal to ${destinationLabel}…`);
    } else if (status === "opened") {
      text = Constants.format(`${LANG}.Card.PortalOpened`, { actor: name, destination: destinationLabel },
        `${name} opened a portal to ${destinationLabel}.`);
    } else if (status === "blocked") {
      text = Constants.format(`${LANG}.Card.PortalBlocked`, { destination: destinationLabel },
        `There is no room for a portal at ${destinationLabel}.`);
    } else {
      text = Constants.localize(`${LANG}.Card.Refused`, "The recall was refused.");
    }

    const details = status === "opened" && config ? ScRecallPortal.#details(config) : [];
    return `<div class="sc-ma-recall-card"><p>${ScRecallPortal.#escape(text)}</p>`
      + `${details.length ? `<p class="supplement">${ScRecallPortal.#escape(details.join(" · "))}</p>` : ""}</div>`;
  }

  static #details(config) {
    const details = [];
    if (config.maxUses !== "") {
      details.push(Constants.format(`${LANG}.Card.PortalUses`, { count: config.maxUses }, `Crossings: ${config.maxUses}`));
    }
    if (config.durationRounds > 0) {
      details.push(Constants.format(`${LANG}.Card.PortalDuration`, { rounds: config.durationRounds },
        `Duration: ${config.durationRounds} round(s)`));
    }
    if (config.oneWay) {
      details.push(Constants.localize(`${LANG}.Card.PortalOneWay`, "One way"));
    } else if (config.roundTrip) {
      details.push(Constants.localize(`${LANG}.Card.PortalRoundTrip`, "Each creature may go and return once"));
    }
    if (config.closeOnReturn) {
      details.push(Constants.localize(`${LANG}.Card.PortalCloseOnReturn`, "Closes when its opener returns"));
    }
    return details;
  }

  static #crossCard({ status, tokenName = "", portalLabel = "", reason = null, closed = false } = {}) {
    let text = "";
    if (status === "pending") {
      text = Constants.format(`${LANG}.Card.CrossPending`, { token: tokenName, portal: portalLabel },
        `${tokenName} steps into ${portalLabel}…`);
    } else if (status === "crossed") {
      text = Constants.format(`${LANG}.Card.Crossed`, { token: tokenName, portal: portalLabel },
        `${tokenName} crossed ${portalLabel}.`);
      if (closed) {
        text += ` ${Constants.localize(`${LANG}.Card.PortalClosed`, "The portal closed.")}`;
      }
    } else {
      text = ScRecallPortal.#refusalText(reason);
    }
    return `<div class="sc-ma-recall-card"><p>${ScRecallPortal.#escape(text)}</p></div>`;
  }

  static #warnRefusal(reason) {
    ui.notifications?.warn?.(ScRecallPortal.#refusalText(reason));
  }

  static #refusalText(reason) {
    const keys = {
      gone: ["PortalGone", "That portal is no longer open."],
      "one-way": ["PortalOneWay", "This portal only leads one way."],
      used: ["PortalUsed", "This creature has already used its crossing that way."],
      "not-allowed": ["PortalNotAllowed", "Only the opener's allies may cross this portal."],
      moved: ["PortalMoved", "That token is no longer standing at the portal."],
      occupied: ["PortalOccupied", "There is no room on the other side of the portal."],
      "no-gm": ["NoActiveGm", "An active GM is required to travel to another scene or with other players' tokens."],
      timeout: ["GmTimeout", "The GM did not answer the recall request in time."]
    };
    const [key, fallback] = keys[reason] ?? ["PortalRefused", "The crossing was refused."];
    return Constants.localize(`${LANG}.Warning.${key}`, fallback);
  }

  static async #postCard(actor, content) {
    try {
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
    } catch (error) {
      Logger.warn("Could not create the recall portal card.", error);
    }
  }

  static #warn(key, fallback) {
    ui.notifications?.warn?.(Constants.localize(`${LANG}.${key}`, fallback));
  }

  // ---------------------------------------------------------------------------
  // Plumbing
  // ---------------------------------------------------------------------------

  static #portals(scene) {
    return ScRecallPortal.#contents(scene?.regions).map((region) => ScRecallPortal.#describe(region)).filter(Boolean);
  }

  static #describe(region) {
    const portal = region?.flags?.[Constants.MODULE_ID]?.[FLAG];
    if (!portal?.portalId || !portal.side || !region.parent) {
      return null;
    }
    return { ...portal, regionId: region.id, regionUuid: region.uuid ?? `Scene.${region.parent.id}.Region.${region.id}` };
  }

  static #isResponsibleGm() {
    const activeGm = game?.users?.activeGM;
    return activeGm ? activeGm.id === game?.user?.id : game?.user?.isGM === true;
  }

  static #finite(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  static #is(document, documentName) {
    return document?.documentName === documentName || document?.constructor?.documentName === documentName;
  }

  static #contents(collection) {
    return collection?.contents ?? Array.from(collection?.values?.() ?? collection ?? []);
  }

  static async #fromUuid(uuid) {
    if (!uuid || typeof globalThis.fromUuid !== "function") {
      return null;
    }
    try {
      return await globalThis.fromUuid(uuid);
    } catch (error) {
      Logger.warn("Could not resolve recall portal UUID.", error);
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
