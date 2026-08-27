import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ScCanvasActivityService } from "../canvas/ScCanvasActivityService.js";
import { PORTAL_FLAG_KEY } from "./ScPortalConstants.js";
import { ScPortalConfig } from "./ScPortalConfig.js";
import { ScPortalGeometry } from "./ScPortalGeometry.js";
import { ScPortalPrompt } from "./ScPortalPrompt.js";

const QUERY_ID = "sc-more-activities.portalOperation";
const QUERY_TIMEOUT = 30000;
const FLAG_KEY = PORTAL_FLAG_KEY;
const CLOSE_ACTION = "sc-ma-close-portal";
const DEFAULT_ROUND_SECONDS = 6;

/**
 * Region behaviour subtype that pre-release builds attached to portal sides.
 * It is no longer declared, and Foundry keeps an undeclared behaviour as raw
 * data without the terrain hooks core calls on every enabled behaviour while
 * planning a move, so a scene still holding one cannot move any token at all.
 */
const LEGACY_BEHAVIOR_TYPE = `${Constants.MODULE_ID}.scPortal`;

/**
 * Owns the lifetime of a portal pair: creation, the prompt shown when a portal
 * is clicked, the travel itself, expiry, and closing.
 *
 * Every write to the scene runs on the active GM's client, either directly or
 * through the module query, the same way the other canvas activities work. A
 * created portal is self-contained: everything the travel needs lives in the
 * region flags, so it keeps working after the item or activity is gone.
 */
export class ScPortalService {
  /** Prompts on screen, keyed by scene and token. */
  static #pendingPrompts = new Map();

  /** Portals being torn down, so the paired delete does not recurse. */
  static #closingPortals = new Set();

  /** Tail of the travel queue for each portal, keyed by scene and portal. */
  static #travelQueues = new Map();

  static #hooksRegistered = false;

  static #clickHandler = null;

  static registerQueries() {
    if (!globalThis.CONFIG?.queries) {
      return false;
    }
    CONFIG.queries[QUERY_ID] = ScPortalService.handlePortalQuery;
    return true;
  }

  static registerHooks() {
    if (ScPortalService.#hooksRegistered || typeof Hooks?.on !== "function") {
      return;
    }
    ScPortalService.#hooksRegistered = true;

    Hooks.on("deleteRegion", (region) => {
      ScPortalService.#onRegionDeleted(region);
    });
    Hooks.on("updateCombat", () => ScPortalService.sweepExpiredPortals());
    Hooks.on("deleteCombat", () => ScPortalService.sweepExpiredPortals());
    Hooks.on("updateWorldTime", () => ScPortalService.sweepExpiredPortals());
    Hooks.on("canvasReady", () => {
      ScPortalService.#armClickListener();
      ScPortalService.sweepExpiredPortals();
      ScPortalService.removeLegacyBehaviors(canvas?.scene).catch((error) => {
        Logger.warn("Could not remove the legacy portal region behaviours.", error);
      });
    });
    Hooks.on("renderChatMessageHTML", (message, html) => {
      ScPortalService.#onRenderChatMessage(message, html);
    });

    ScPortalService.#armClickListener();
  }

  /**
   * A query carries no proof of who sent it: Foundry hands the handler only the
   * query data and a timeout, and drops the authenticated sender id it received
   * on the socket. So `requestUserId` is a claim, not an identity.
   *
   * What saves this is that a GM never gets here. `#dispatch` runs the operation
   * directly whenever the caller is a GM, so every query is by construction from
   * a player, and a claim of GM rights can only be a forgery. Refusing those
   * closes the escalation; a player claiming to be a different player is left,
   * and is bounded by that player's own permissions.
   */
  static async handlePortalQuery(payload = {}) {
    if (!game?.user?.isGM) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.GmRequired",
        "A GM must execute this canvas operation."
      );
    }
    return ScPortalService.executeOperation(payload, { trusted: false });
  }

  // ---------------------------------------------------------------------------
  // Requests
  // ---------------------------------------------------------------------------

  static async createPortal(activity, { entry = null, exit = null, originTokenId = null } = {}) {
    const scene = canvas?.scene ?? null;
    if (!scene) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
        "The canvas operation request is no longer valid."
      );
    }

    return ScPortalService.#dispatch({
      operation: "create",
      activityUuid: activity?.uuid ?? null,
      sceneId: scene.id,
      requestUserId: game?.user?.id ?? null,
      entry: ScPortalGeometry.validPoint(entry),
      exit: ScPortalGeometry.validPoint(exit),
      originTokenId
    });
  }

  static async requestTravel({ sceneId = null, portalId = null, side = null, tokenId = null } = {}) {
    return ScPortalService.#dispatch({
      operation: "travel",
      sceneId,
      requestUserId: game?.user?.id ?? null,
      portalId,
      side,
      tokenId
    });
  }

  static async closePortal({ sceneId = null, portalId = null } = {}) {
    return ScPortalService.#dispatch({
      operation: "close",
      sceneId,
      requestUserId: game?.user?.id ?? null,
      portalId
    });
  }

  /**
   * `trusted` is an argument rather than a payload field on purpose: it says
   * where the call came from, and a remote payload must never be able to set it.
   */
  static async executeOperation(payload = {}, { trusted = true } = {}) {
    const scene = game?.scenes?.get(payload.sceneId);
    const user = game?.users?.get(payload.requestUserId);
    if (!scene || !user) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
        "The canvas operation request is no longer valid."
      );
    }

    if (!trusted && user.isGM) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.ActivityPermission",
        "You do not have permission to use this activity."
      );
    }

    try {
      if (payload.operation === "create") {
        return await ScPortalService.#executeCreate(scene, user, payload);
      }
      if (payload.operation === "travel") {
        return await ScPortalService.#queueTravel(scene, user, payload);
      }
      if (payload.operation === "close") {
        return await ScPortalService.#executeClose(scene, user, payload);
      }
    } catch (error) {
      Logger.error("Could not execute the portal operation.", error);
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.ScPortal.Warning.Failed",
        "The portal operation failed: {error}",
        { error: error?.message ?? String(error) }
      );
    }

    return ScPortalService.#failure(
      "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
      "The canvas operation request is no longer valid."
    );
  }

  // ---------------------------------------------------------------------------
  // Portal lookup
  // ---------------------------------------------------------------------------

  /** Every portal side on a scene, as plain descriptors. */
  static getScenePortals(scene) {
    const regions = scene?.regions?.contents ?? Array.from(scene?.regions ?? []);
    return regions
      .map((entry) => (Array.isArray(entry) ? entry[1] : entry))
      .map((region) => ScPortalService.#describe(region))
      .filter(Boolean);
  }

  static findPortalAtPoint(scene, point) {
    return ScPortalService.getScenePortals(scene)
      .find((portal) => ScPortalGeometry.containsPoint(portal, point)) ?? null;
  }

  static findPortalSide(scene, portalId, side) {
    return ScPortalService.getScenePortals(scene)
      .find((portal) => portal.portalId === portalId && portal.side === side) ?? null;
  }

  static isExpired(portal) {
    if (!portal) {
      return true;
    }

    const round = ScPortalService.#finiteNumber(portal.expiresAtRound);
    if (portal.combatId && round !== null) {
      const combat = game?.combats?.get?.(portal.combatId);
      if (combat) {
        return Number(combat.round ?? 0) >= round;
      }
    }

    const worldTime = ScPortalService.#finiteNumber(portal.expiresAtWorldTime);
    if (worldTime !== null) {
      return Number(game?.time?.worldTime ?? 0) >= worldTime;
    }
    return false;
  }

  /** Strips the undeclared behaviour subtype from every region on the scene. */
  static async removeLegacyBehaviors(scene) {
    if (!scene || !ScPortalService.#isResponsibleGm()) {
      return 0;
    }

    let removed = 0;
    const regions = scene.regions?.contents ?? Array.from(scene.regions ?? []);
    for (const entry of regions) {
      const region = Array.isArray(entry) ? entry[1] : entry;
      const behaviors = region?.behaviors?.contents ?? Array.from(region?.behaviors ?? []);
      const ids = behaviors
        .filter((behavior) => behavior?.type === LEGACY_BEHAVIOR_TYPE && behavior.id)
        .map((behavior) => behavior.id);
      if (!ids.length) {
        continue;
      }

      try {
        await region.deleteEmbeddedDocuments("RegionBehavior", ids);
        removed += ids.length;
      } catch (error) {
        Logger.warn("Could not remove a legacy portal region behaviour.", error);
      }
    }
    return removed;
  }

  static async sweepExpiredPortals() {
    if (!ScPortalService.#isResponsibleGm()) {
      return;
    }

    for (const scene of game?.scenes ?? []) {
      if (!scene?.regions?.size) {
        continue;
      }

      const expired = new Set();
      for (const portal of ScPortalService.getScenePortals(scene)) {
        if (ScPortalService.isExpired(portal)) {
          expired.add(portal.portalId);
        }
      }
      for (const portalId of expired) {
        await ScPortalService.#closePortalDocuments(scene, portalId);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // GM-side execution
  // ---------------------------------------------------------------------------

  static async #executeCreate(scene, user, payload) {
    const activity = payload.activityUuid ? await ScPortalService.#fromUuid(payload.activityUuid) : null;
    if (!activity) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
        "The canvas operation request is no longer valid."
      );
    }

    const config = ScPortalConfig.fromActivity(activity);
    if (!user.isGM && !config.allowPlayerRequests) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.ScPortal.Warning.PlayerRequestsDisabled",
        "Only a GM can create portals with this activity."
      );
    }

    // Allowing player use says players may open this portal, not that any
    // player may open somebody else's. The request only carries a uuid, so
    // ownership of the item behind it is what has to be checked here.
    if (!ScPortalService.#canUseActivity(activity, user)) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.ActivityPermission",
        "You do not have permission to use this activity."
      );
    }

    const entry = ScPortalGeometry.validPoint(payload.entry);
    const exit = ScPortalGeometry.validPoint(payload.exit);
    if (!entry || !exit) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidPosition",
        "The requested canvas position is invalid."
      );
    }

    const rangeIssue = ScPortalService.#placementRangeIssue(scene, config, payload.originTokenId, entry, exit);
    if (rangeIssue) {
      return rangeIssue;
    }

    const radiusPixels = ScPortalGeometry.radiusPixels(config.squares, scene);
    const portalId = foundry.utils.randomID();
    const expiry = ScPortalService.#expiryFor(config.durationRounds);
    const label = ScPortalService.#portalLabel(activity);

    const regionData = ["entry", "exit"].map((side) => ScPortalService.#regionData({
      activity,
      config,
      portalId,
      side,
      center: side === "entry" ? entry : exit,
      radiusPixels,
      expiry,
      label,
      user,
      scene
    }));

    await scene.createEmbeddedDocuments("Region", regionData);
    await ScPortalService.#createTiles(scene, config, portalId, radiusPixels, { entry, exit });
    await ScPortalService.#postPortalCard(scene, activity, config, portalId, label, expiry);

    return { ok: true, count: 2, portalId };
  }

  /**
   * Travel through one portal runs one traveller at a time. Two tokens entering
   * together are otherwise resolved side by side: both read the same remaining
   * uses and both pick the same free cell, so a single-use portal sends two
   * travellers and drops them on top of each other.
   */
  static #queueTravel(scene, user, payload) {
    const key = `${scene.id}:${String(payload.portalId ?? "")}`;
    const previous = ScPortalService.#travelQueues.get(key) ?? Promise.resolve();
    const current = previous.then(() => ScPortalService.#executeTravel(scene, user, payload));

    // The queue keeps only the tail, and drops it once nothing is waiting, so
    // it does not grow one live promise per portal for the whole session.
    const tail = current.catch(() => {});
    ScPortalService.#travelQueues.set(key, tail);
    tail.then(() => {
      if (ScPortalService.#travelQueues.get(key) === tail) {
        ScPortalService.#travelQueues.delete(key);
      }
    });
    return current;
  }

  static async #executeTravel(scene, user, payload) {
    const portal = ScPortalService.findPortalSide(scene, payload.portalId, payload.side);
    if (!portal) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.ScPortal.Warning.PortalGone",
        "That portal is no longer open."
      );
    }

    if (ScPortalService.isExpired(portal)) {
      await ScPortalService.#closePortalDocuments(scene, portal.portalId);
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.ScPortal.Warning.PortalGone",
        "That portal is no longer open."
      );
    }

    if (portal.oneWay && portal.side !== "entry") {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.ScPortal.Warning.OneWay",
        "This portal only travels one way."
      );
    }

    // Reading the counter here rather than before the queue is the point of the
    // queue: the traveller ahead has already written what it spent.
    const remaining = ScPortalService.#finiteNumber(portal.usesLeft);
    if (remaining !== null && remaining <= 0) {
      await ScPortalService.#closePortalDocuments(scene, portal.portalId);
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.ScPortal.Warning.PortalGone",
        "That portal is no longer open."
      );
    }

    const destination = ScPortalService.findPortalSide(
      scene,
      portal.portalId,
      portal.side === "entry" ? "exit" : "entry"
    );
    if (!destination) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.ScPortal.Warning.PortalGone",
        "That portal is no longer open."
      );
    }

    const token = scene.tokens?.get?.(payload.tokenId);
    if (!token) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingTargets",
        "Select at least one target token."
      );
    }

    if (!user.isGM && token.testUserPermission?.(user, "OWNER") !== true) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.TokenPermission",
        "You do not have permission to move one or more selected tokens."
      );
    }

    // The prompt can sit open for minutes, and the request only names a token
    // id, so where the token stands right now is checked rather than trusted.
    if (!ScPortalGeometry.tokenReachesPortal(portal, token, scene)) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.ScPortal.Warning.TokenMoved",
        "That token is no longer standing at the portal."
      );
    }

    const freeCenter = ScPortalGeometry.findFreeCenter(scene, destination.center, token, {
      avoidOccupied: portal.avoidOccupied,
      snapToGrid: portal.snapToGrid
    });
    if (!freeCenter) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.ScPortal.Warning.DestinationOccupied",
        "There is no free space on the other side of the portal."
      );
    }

    const topLeft = ScPortalGeometry.topLeftForCenter(freeCenter, token, {
      snapToGrid: portal.snapToGrid,
      scene
    });
    const bounded = ScPortalService.#boundedPoint(scene, topLeft, token);
    if (!bounded) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidPosition",
        "The requested canvas position is invalid."
      );
    }

    await ScPortalService.#placeToken(scene, token, bounded);

    const usesLeft = await ScPortalService.#consumeUse(scene, portal);
    return {
      ok: true,
      count: 1,
      portalId: portal.portalId,
      usesLeft,
      closed: usesLeft === 0
    };
  }

  /**
   * Moves the token with a `displace` waypoint, the action core uses for its
   * own region teleport: the hop is neither wall-checked nor measured as a walk.
   */
  static async #placeToken(scene, token, position) {
    const waypoint = {
      x: position.x,
      y: position.y,
      elevation: token.elevation,
      action: "displace"
    };
    const options = {
      animate: false,
      [Constants.MODULE_ID]: { portalTravel: true }
    };

    if (typeof token.move === "function") {
      await token.move(waypoint, options);
      return;
    }

    await scene.updateEmbeddedDocuments("Token", [{
      _id: token.id,
      x: position.x,
      y: position.y
    }], options);
  }

  static async #executeClose(scene, user, payload) {
    if (!user.isGM) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.ScPortal.Warning.CloseGmOnly",
        "Only a GM can close a portal."
      );
    }

    const closed = await ScPortalService.#closePortalDocuments(scene, payload.portalId);
    return { ok: true, count: closed };
  }

  /** Deletes both sides plus any art tiles. Safe to call for a half-deleted pair. */
  static async #closePortalDocuments(scene, portalId) {
    const id = String(portalId ?? "");
    if (!id || !scene || ScPortalService.#closingPortals.has(`${scene.id}:${id}`)) {
      return 0;
    }

    ScPortalService.#closingPortals.add(`${scene.id}:${id}`);
    try {
      const regionIds = ScPortalService.getScenePortals(scene)
        .filter((portal) => portal.portalId === id)
        .map((portal) => portal.regionId);
      const tileIds = (scene.tiles?.contents ?? Array.from(scene.tiles ?? []))
        .map((entry) => (Array.isArray(entry) ? entry[1] : entry))
        .filter((tile) => tile?.flags?.[Constants.MODULE_ID]?.[FLAG_KEY]?.portalId === id)
        .map((tile) => tile.id);

      if (regionIds.length) {
        await scene.deleteEmbeddedDocuments("Region", regionIds);
      }
      if (tileIds.length) {
        await scene.deleteEmbeddedDocuments("Tile", tileIds);
      }
      return regionIds.length;
    } catch (error) {
      Logger.warn("Could not close the portal.", error);
      return 0;
    } finally {
      ScPortalService.#closingPortals.delete(`${scene.id}:${id}`);
    }
  }

  /** Returns the uses left after this crossing, or null when unlimited. */
  static async #consumeUse(scene, portal) {
    const remaining = ScPortalService.#finiteNumber(portal.usesLeft);
    if (remaining === null) {
      return null;
    }

    const usesLeft = Math.max(0, remaining - 1);
    if (usesLeft <= 0) {
      await ScPortalService.#closePortalDocuments(scene, portal.portalId);
      return 0;
    }

    const updates = ScPortalService.getScenePortals(scene)
      .filter((side) => side.portalId === portal.portalId)
      .map((side) => ({
        _id: side.regionId,
        [`flags.${Constants.MODULE_ID}.${FLAG_KEY}.usesLeft`]: usesLeft
      }));
    if (updates.length) {
      await scene.updateEmbeddedDocuments("Region", updates);
    }
    return usesLeft;
  }

  // ---------------------------------------------------------------------------
  // Document construction
  // ---------------------------------------------------------------------------

  static #regionData({ activity, config, portalId, side, center, radiusPixels, expiry, label, user, scene }) {
    const shape = ScPortalGeometry.regionShape(center, { shape: config.shape, radiusPixels });
    const sideLabel = Constants.localize(
      side === "entry"
        ? "SCMOREACTIVITIES.Activities.ScPortal.Side.Entry"
        : "SCMOREACTIVITIES.Activities.ScPortal.Side.Exit",
      side === "entry" ? "Entry" : "Exit"
    );

    return {
      name: `${label} (${sideLabel})`,
      color: config.color,
      shapes: shape ? [shape] : [],
      visibility: ScPortalService.#regionVisibility(config.visibility),
      flags: {
        [Constants.MODULE_ID]: {
          [FLAG_KEY]: {
            portalId,
            side,
            label,
            center: { x: Math.round(center.x), y: Math.round(center.y) },
            shape: config.shape,
            radiusPixels: Math.round(radiusPixels),
            oneWay: config.oneWay,
            snapToGrid: config.snapToGrid && !ScPortalGeometry.isGridless(scene),
            avoidOccupied: config.avoidOccupied,
            usesLeft: config.maxUses === "" ? null : Number(config.maxUses),
            expiresAtRound: expiry.expiresAtRound,
            expiresAtWorldTime: expiry.expiresAtWorldTime,
            combatId: expiry.combatId,
            activityUuid: activity?.uuid ?? null,
            createdBy: user?.id ?? null
          }
        }
      }
    };
  }

  static async #createTiles(scene, config, portalId, radiusPixels, { entry, exit }) {
    const tiles = [];
    for (const [side, center, image] of [["entry", entry, config.entryImage], ["exit", exit, config.exitImage]]) {
      if (!image) {
        continue;
      }
      const size = Math.round(radiusPixels * 2);
      tiles.push({
        texture: { src: image },
        x: Math.round(center.x - radiusPixels),
        y: Math.round(center.y - radiusPixels),
        width: size,
        height: size,
        // The region is what "hidden" hides, and it exists precisely so the art
        // can be the only visible part. A GM only portal has to hide both.
        hidden: config.visibility === "gm",
        flags: {
          [Constants.MODULE_ID]: {
            [FLAG_KEY]: { portalId, side }
          }
        }
      });
    }

    if (!tiles.length) {
      return;
    }

    try {
      await scene.createEmbeddedDocuments("Tile", tiles);
    } catch (error) {
      // The portal itself is already open; a missing art tile is cosmetic.
      Logger.warn("Could not create the portal art tiles.", error);
    }
  }

  /**
   * A portal keeps both a round deadline and a world-time deadline. In combat
   * the round count is what players expect; outside it there are no rounds to
   * count, so the same duration is measured as elapsed world time.
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

  /**
   * LAYER means the region only draws while the Regions layer is open, which is
   * how a portal shows nothing but its art and still stays reachable by the GM.
   * Visibility is render-only, so a hidden portal is still found under a click.
   */
  static #regionVisibility(visibility) {
    const values = globalThis.CONST?.REGION_VISIBILITY ?? { LAYER: 0, GAMEMASTER: 1, ALWAYS: 2 };
    if (visibility === "hidden") {
      return values.LAYER;
    }
    return visibility === "gm" ? values.GAMEMASTER : values.ALWAYS;
  }

  static #portalLabel(activity) {
    const name = String(activity?.item?.name ?? activity?.name ?? "").trim();
    return name || Constants.localize("SCMOREACTIVITIES.Activities.ScPortal.Title", "Portal");
  }

  static #placementRangeIssue(scene, config, originTokenId, entry, exit) {
    if (config.placementRange > 0) {
      const origin = scene.tokens?.get?.(originTokenId);
      const originCenter = origin ? ScPortalGeometry.tokenCenter(origin, scene) : null;
      if (!originCenter) {
        return ScPortalService.#failure(
          "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin",
          "Select or place the activity actor token on the scene first."
        );
      }

      for (const point of [entry, exit]) {
        if (ScCanvasActivityService.euclideanSceneDistance(originCenter, point, scene) > config.placementRange) {
          return ScPortalService.#failure(
            "SCMOREACTIVITIES.Activities.ScPortal.Warning.OutOfRange",
            "The portal must be placed within {range}.",
            { range: config.placementRange }
          );
        }
      }
    }

    if (config.linkRange !== "" && config.linkRange > 0
      && ScCanvasActivityService.euclideanSceneDistance(entry, exit, scene) > config.linkRange) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.ScPortal.Warning.LinkTooFar",
        "The two portal sides must be within {range} of each other.",
        { range: config.linkRange }
      );
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Prompting
  // ---------------------------------------------------------------------------

  /**
   * Registers a prompt for a token, taking over from one that is still open.
   * A stale dialog answered later would send the token through a portal it has
   * since walked away from, so it is closed and the question asked afresh.
   */
  static #claimPrompt(key) {
    ScPortalService.#pendingPrompts.get(key)?.close?.();
    const prompt = { close: null };
    ScPortalService.#pendingPrompts.set(key, prompt);
    return prompt;
  }

  /** Only the prompt that holds the key may release it; a replaced one must not. */
  static #releasePrompt(key, prompt) {
    if (ScPortalService.#pendingPrompts.get(key) === prompt) {
      ScPortalService.#pendingPrompts.delete(key);
    }
  }

  /** A player may only act through an activity on an item or actor they own. */
  static #canUseActivity(activity, user) {
    if (user?.isGM) {
      return true;
    }

    const actor = activity?.actor ?? activity?.item?.actor ?? null;
    const item = activity?.item ?? null;
    return Boolean(
      actor?.testUserPermission?.(user, "OWNER")
      || item?.testUserPermission?.(user, "OWNER")
    );
  }

  static #promptPayload(tokenDocument, portal) {
    return {
      tokenName: tokenDocument?.name ?? "",
      portalName: portal?.label ?? Constants.localize("SCMOREACTIVITIES.Activities.ScPortal.Title", "Portal"),
      usesLeft: ScPortalService.#finiteNumber(portal?.usesLeft),
      oneWay: Boolean(portal?.oneWay)
    };
  }

  static #armClickListener() {
    const stage = canvas?.stage;
    if (!stage?.on) {
      return;
    }

    if (ScPortalService.#clickHandler) {
      stage.off?.("pointerdown", ScPortalService.#clickHandler);
    }
    ScPortalService.#clickHandler = (event) => ScPortalService.#onStagePointerDown(event);
    stage.on("pointerdown", ScPortalService.#clickHandler);
  }

  /**
   * Portal clicks ride on the stage's PIXI event rather than a DOM listener, so
   * the placement applications, which consume the native event during the
   * capture phase, keep their clicks to themselves.
   */
  static #onStagePointerDown(event) {
    try {
      const originalEvent = event?.data?.originalEvent ?? event?.nativeEvent ?? event;
      if (Number(originalEvent?.button ?? 0) !== 0) {
        return;
      }

      // Every click on the canvas lands here; a scene without regions cannot
      // hold a portal, so it is dismissed before any geometry is touched.
      const scene = canvas?.scene;
      if (!scene?.regions?.size) {
        return;
      }
      const point = ScPortalService.#eventPoint(event, originalEvent);
      const portal = point ? ScPortalService.findPortalAtPoint(scene, point) : null;
      if (!portal) {
        return;
      }
      if (portal.oneWay && portal.side !== "entry") {
        return;
      }

      // The click landed inside the portal, so it is deliberate either way:
      // consume it, and say why nothing happened when no token qualifies.
      originalEvent?.preventDefault?.();
      event?.stopPropagation?.();

      const token = ScPortalService.findTravellerForClick(portal, scene);
      if (!token) {
        ui.notifications?.warn?.(Constants.localize(
          "SCMOREACTIVITIES.Activities.ScPortal.Warning.NoTraveller",
          "Select a token standing on or next to the portal to travel."
        ));
        return;
      }
      ScPortalService.askToTravel(scene, portal, token).catch((error) => {
        Logger.warn("Could not resolve the portal click prompt.", error);
      });
    } catch (error) {
      Logger.debug("Could not handle the portal click.", error);
    }
  }

  /**
   * Picks the token a portal click should move, escalating from the most
   * explicit signal to the least: what the user selected, then the character
   * they play, then a token of theirs standing in the portal itself.
   *
   * Requiring a selection made the portal look dead whenever nothing was
   * selected, which is the normal state after moving a token and clicking away.
   */
  static findTravellerForClick(portal, scene) {
    const controlled = (canvas?.tokens?.controlled ?? [])
      .map((token) => token?.document ?? token)
      .filter((document) => document?.isOwner);
    const selected = controlled.find((document) => ScPortalGeometry.tokenReachesPortal(portal, document, scene));
    if (selected) {
      return selected;
    }

    const assigned = ScPortalService.#assignedCharacterTokens(scene)
      .find((document) => ScPortalGeometry.tokenReachesPortal(portal, document, scene));
    if (assigned) {
      return assigned;
    }

    // Last resort, and only when it cannot be mistaken: exactly one token this
    // user owns is standing inside the portal. A GM owns everything, so two
    // candidates mean the click is ambiguous and nobody moves.
    const inside = ScPortalService.#ownedTokensInside(portal, scene);
    return inside.length === 1 ? inside[0] : null;
  }

  /** Tokens on this scene belonging to the character the user plays. */
  static #assignedCharacterTokens(scene) {
    const actor = game?.user?.character ?? null;
    const tokens = actor?.getActiveTokens?.(false, true) ?? [];
    return Array.from(tokens)
      .map((token) => token?.document ?? token)
      .filter((document) => document && (document.parent?.id ?? scene?.id) === scene?.id);
  }

  static #ownedTokensInside(portal, scene) {
    const documents = scene?.tokens?.contents ?? Array.from(scene?.tokens ?? []);
    return documents
      .map((entry) => (Array.isArray(entry) ? entry[1] : entry))
      .filter((document) => document?.isOwner)
      .filter((document) => ScPortalGeometry.containsPoint(
        portal,
        ScPortalGeometry.tokenCenter(document, scene)
      ));
  }

  /** Asks whether the token steps through, then has the GM client move it. */
  static async askToTravel(scene, portal, tokenDocument) {
    const key = `${scene.id}:${tokenDocument.id}`;
    const prompt = ScPortalService.#claimPrompt(key);

    try {
      const dialog = ScPortalPrompt.open(ScPortalService.#promptPayload(tokenDocument, portal));
      prompt.close = dialog.close;
      const confirmed = await dialog.promise;
      if (!confirmed) {
        return;
      }

      const result = await ScPortalService.requestTravel({
        sceneId: scene.id,
        portalId: portal.portalId,
        side: portal.side,
        tokenId: tokenDocument.id
      });
      ScPortalService.#notifyResult(result);
    } finally {
      ScPortalService.#releasePrompt(key, prompt);
    }
  }

  static #eventPoint(event, originalEvent) {
    const fromClient = canvas?.canvasCoordinatesFromClient?.(originalEvent);
    const point = ScPortalGeometry.validPoint(fromClient);
    if (point) {
      return point;
    }
    if (event?.global && typeof canvas?.stage?.toLocal === "function") {
      return ScPortalGeometry.validPoint(canvas.stage.toLocal(event.global));
    }
    return null;
  }

  static #onRegionDeleted(region) {
    if (!ScPortalService.#isResponsibleGm()) {
      return;
    }

    const portal = region?.flags?.[Constants.MODULE_ID]?.[FLAG_KEY];
    if (!portal?.portalId || !region?.parent) {
      return;
    }

    ScPortalService.#closePortalDocuments(region.parent, portal.portalId).catch((error) => {
      Logger.warn("Could not close the paired portal side.", error);
    });
  }

  // ---------------------------------------------------------------------------
  // GM chat card
  // ---------------------------------------------------------------------------

  static async #postPortalCard(scene, activity, config, portalId, label, expiry) {
    try {
      const details = [];
      if (config.maxUses !== "") {
        details.push(Constants.format(
          "SCMOREACTIVITIES.Activities.ScPortal.Card.Uses",
          { count: config.maxUses },
          `Uses: ${config.maxUses}`
        ));
      }
      if (config.durationRounds > 0) {
        details.push(Constants.format(
          "SCMOREACTIVITIES.Activities.ScPortal.Card.Duration",
          { rounds: config.durationRounds },
          `Duration: ${config.durationRounds} round(s)`
        ));
      }
      if (config.oneWay) {
        details.push(Constants.localize(
          "SCMOREACTIVITIES.Activities.ScPortal.Card.OneWay",
          "One way"
        ));
      }

      const openedLine = Constants.format(
        "SCMOREACTIVITIES.Activities.ScPortal.Card.Opened",
        { portal: label },
        `${label} is open.`
      );
      const content = `
        <div class="chat-card sc-ma-portal-card">
          <p><strong>${ScPortalService.#escape(openedLine)}</strong></p>
          ${details.length ? `<p class="supplement">${ScPortalService.#escape(details.join(" · "))}</p>` : ""}
          <button type="button" data-action="${CLOSE_ACTION}"
            data-portal-id="${ScPortalService.#escape(portalId)}"
            data-scene-id="${ScPortalService.#escape(scene.id)}">
            ${ScPortalService.#escape(Constants.localize(
              "SCMOREACTIVITIES.Activities.ScPortal.Card.CloseButton",
              "Close portal"
            ))}
          </button>
        </div>
      `;

      const actor = activity?.actor ?? activity?.item?.actor ?? null;
      const ChatMessageClass = globalThis.ChatMessage;
      await ChatMessage.create({
        speaker: ChatMessageClass?.implementation?.getSpeaker?.({ actor })
          ?? ChatMessageClass?.getSpeaker?.({ actor })
          ?? {},
        content,
        whisper: (game?.users?.filter?.((user) => user.isGM) ?? []).map((user) => user.id),
        flags: {
          [Constants.MODULE_ID]: {
            activityType: "sc-portal",
            [FLAG_KEY]: { portalId, sceneId: scene.id, expiresAtRound: expiry.expiresAtRound }
          }
        }
      });
    } catch (error) {
      Logger.warn("Could not post the portal chat card.", error);
    }
  }

  static #onRenderChatMessage(message, html) {
    const button = html?.querySelector?.(`[data-action="${CLOSE_ACTION}"]`);
    if (!button) {
      return;
    }

    if (!game?.user?.isGM) {
      button.remove();
      return;
    }

    button.addEventListener("click", async () => {
      button.disabled = true;
      const result = await ScPortalService.closePortal({
        sceneId: button.dataset.sceneId,
        portalId: button.dataset.portalId
      });
      if (result?.ok) {
        ui.notifications?.info?.(Constants.localize(
          "SCMOREACTIVITIES.Activities.ScPortal.Info.Closed",
          "The portal was closed."
        ));
      } else {
        button.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Plumbing
  // ---------------------------------------------------------------------------

  static async #dispatch(request) {
    if (game?.user?.isGM) {
      return ScPortalService.executeOperation(request);
    }

    const gm = ScPortalService.#activeGmUser();
    if (!gm || typeof gm.query !== "function" || !globalThis.CONFIG?.queries?.[QUERY_ID]) {
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.NoActiveGm",
        "An active GM is required for this canvas operation."
      );
    }

    try {
      return await gm.query(QUERY_ID, request, { timeout: QUERY_TIMEOUT });
    } catch (error) {
      Logger.error("Could not request the GM portal operation.", error);
      return ScPortalService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.GmRequestFailed",
        "Could not request GM canvas operation: {error}",
        { error: error?.message ?? String(error) }
      );
    }
  }

  static #describe(region) {
    const portal = region?.flags?.[Constants.MODULE_ID]?.[FLAG_KEY];
    if (!portal?.portalId || !portal?.side) {
      return null;
    }

    return {
      ...portal,
      usesLeft: ScPortalService.#finiteNumber(portal.usesLeft),
      regionId: region.id,
      sceneId: region.parent?.id ?? null
    };
  }

  static #boundedPoint(scene, point, tokenDocument) {
    const target = ScPortalGeometry.validPoint(point);
    if (!target || !ScPortalGeometry.isWithinScene(scene, target, tokenDocument)) {
      return null;
    }
    return { x: Math.round(target.x), y: Math.round(target.y) };
  }

  /** Null for an absent value; Number() alone would read null and "" as zero. */
  static #finiteNumber(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  static #isResponsibleGm() {
    const activeGm = game?.users?.activeGM;
    if (activeGm) {
      return activeGm.id === game?.user?.id;
    }
    return game?.user?.isGM === true;
  }

  static #activeGmUser() {
    return game?.users?.activeGM
      ?? game?.users?.find?.((user) => user.isGM && user.active)
      ?? null;
  }

  static async #fromUuid(uuid) {
    try {
      const resolve = foundry?.utils?.fromUuid ?? globalThis.fromUuid;
      return await resolve(uuid);
    } catch (error) {
      Logger.debug(`Could not resolve the activity uuid "${uuid}".`, error);
      return null;
    }
  }

  static #notifyResult(result) {
    if (result?.ok) {
      return;
    }
    if (result?.message) {
      ui.notifications?.warn?.(result.message);
    }
  }

  static #failure(key, fallback, data = {}) {
    return {
      ok: false,
      count: 0,
      message: Constants.format(key, data, fallback.replace(/\{(\w+)\}/g, (_match, name) => String(data[name] ?? "")))
    };
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
