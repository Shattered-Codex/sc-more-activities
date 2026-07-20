import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";
import { ScWallConfig } from "../wall/ScWallConfig.js";
import { ScWallGeometry } from "../wall/ScWallGeometry.js";
import {
  CANVAS_TARGET_SOURCES,
  MOVEMENT_TYPES,
  TELEPORT_DESTINATION_SOURCES,
  WALL_TARGET_SOURCES
} from "./ScCanvasActivityConstants.js";

const QUERY_ID = "sc-more-activities.canvasOperation";
const QUERY_TIMEOUT = 30000;

export class ScCanvasActivityService {
  static registerQueries() {
    if (!globalThis.CONFIG?.queries) {
      return false;
    }
    CONFIG.queries[QUERY_ID] = ScCanvasActivityService.handleCanvasQuery;
    return true;
  }

  static async handleCanvasQuery(payload = {}) {
    if (!game?.user?.isGM) {
      return ScCanvasActivityService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.GmRequired",
        "A GM must execute this canvas operation."
      );
    }
    return ScCanvasActivityService.#executeValidated(payload);
  }

  static async executeTeleport(activity) {
    try {
      const request = ScCanvasActivityService.#buildTeleportRequest(activity);
      const result = await ScCanvasActivityService.#dispatchRequest(request);
      ScCanvasActivityService.#notifyResult(
        result,
        "SCMOREACTIVITIES.Activities.ScTeleport.Info.Completed",
        "Teleported {count} token(s)."
      );
      return result;
    } catch (error) {
      return ScCanvasActivityService.#handleExecutionError("teleport", error);
    }
  }

  static async executeMovement(
    activity,
    { tokenIds = null, originTokenId = null, selfDirectionPoint = null, movementType = null } = {}
  ) {
    try {
      const request = ScCanvasActivityService.#buildMovementRequest(activity, {
        originTokenId,
        selfDirectionPoint,
        movementType,
        tokenIds,
        useExplicitTokenIds: Array.isArray(tokenIds)
      });
      const result = await ScCanvasActivityService.#dispatchRequest(request);
      ScCanvasActivityService.#notifyResult(
        result,
        "SCMOREACTIVITIES.Activities.ScMovement.Info.Completed",
        "Moved {count} token(s)."
      );
      return result;
    } catch (error) {
      return ScCanvasActivityService.#handleExecutionError("movement", error);
    }
  }

  static getMovementPreviewData(
    activity,
    {
      tokenIds = null,
      originTokenId = null,
      selfDirectionPoint = null,
      movementType = null,
      useExplicitTokenIds = false
    } = {}
  ) {
    return ScCanvasActivityService.#movementOperationData(activity, {
      originTokenId,
      selfDirectionPoint,
      movementType,
      tokenIds,
      useExplicitTokenIds,
      requireTargets: false
    });
  }

  static async executeWall(activity) {
    try {
      const request = ScCanvasActivityService.#buildWallRequest(activity);
      const result = await ScCanvasActivityService.#dispatchRequest(request);
      ScCanvasActivityService.#notifyResult(
        result,
        "SCMOREACTIVITIES.Activities.ScWall.Info.Completed",
        "Created {count} wall(s)."
      );
      return result;
    } catch (error) {
      return ScCanvasActivityService.#handleExecutionError("wall", error);
    }
  }

  static async executeTeleportPlacement(activity, { tokenIds = [], destination = null } = {}) {
    try {
      const scene = ScCanvasActivityService.#activeScene();
      const origin = ScCanvasActivityService.#originTokenDocument(activity);
      if (!origin) {
        throw new Error(Constants.localize(
          "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin",
          "Select or place the activity actor token on the scene first."
        ));
      }

      const targetIds = ScCanvasActivityService.#uniqueIds(tokenIds);
      if (!targetIds.length) {
        throw new Error(Constants.localize(
          "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingTargets",
          "Select at least one target token."
        ));
      }

      const point = ScCanvasActivityService.#validPoint(destination);
      if (!point) {
        throw new Error(Constants.localize(
          "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidPosition",
          "The requested canvas position is invalid."
        ));
      }

      const request = ScCanvasActivityService.#request("teleport", activity, scene, {
        destination: point,
        originTokenId: origin.id,
        tokenIds: targetIds
      });
      const result = await ScCanvasActivityService.#dispatchRequest(request);
      ScCanvasActivityService.#notifyResult(
        result,
        "SCMOREACTIVITIES.Activities.ScTeleport.Info.Completed",
        "Teleported {count} token(s)."
      );
      return result;
    } catch (error) {
      return ScCanvasActivityService.#handleExecutionError("teleport", error);
    }
  }

  static async executeWallPlacement(activity, { walls = [], facing = null, originTokenId = null } = {}) {
    try {
      const scene = ScCanvasActivityService.#activeScene();
      const origin = ScCanvasActivityService.getOriginTokenDocument(activity, { originTokenId });
      if (!origin) {
        throw new Error(Constants.localize(
          "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin",
          "Select or place the activity actor token on the scene first."
        ));
      }

      const config = ScWallConfig.fromActivity(activity);
      if (!game?.user?.isGM && config.allowPlayerRequests !== true) {
        throw new Error(Constants.localize(
          "SCMOREACTIVITIES.Activities.ScWall.Warning.PlayerRequestsDisabled",
          "Only a GM can create walls with this activity."
        ));
      }

      const placements = ScCanvasActivityService.#validWallPlacements(walls);
      if (!placements.length) {
        throw new Error(Constants.localize(
          "SCMOREACTIVITIES.Activities.ScWall.Warning.NoWalls",
          "No walls to create."
        ));
      }

      const request = ScCanvasActivityService.#request("wall", activity, scene, {
        allowPlayerRequests: config.allowPlayerRequests === true,
        facing: ScCanvasActivityService.#wallFacingForRequest(facing, config),
        originTokenId: origin.id,
        walls: placements
      });
      const result = await ScCanvasActivityService.#dispatchRequest(request);
      ScCanvasActivityService.#notifyResult(
        result,
        "SCMOREACTIVITIES.Activities.ScWall.Info.Completed",
        "Created {count} wall(s)."
      );
      return result;
    } catch (error) {
      return ScCanvasActivityService.#handleExecutionError("wall", error);
    }
  }

  static getOriginTokenDocument(activity, { originTokenId = null } = {}) {
    return ScCanvasActivityService.#originTokenDocument(activity, { originTokenId });
  }

  static getOriginTokenObject(activity, { originTokenId = null } = {}) {
    const document = ScCanvasActivityService.#originTokenDocument(activity, { originTokenId });
    return document?.object ?? canvas?.tokens?.get?.(document?.id) ?? null;
  }

  static canMoveToken(token, user = game?.user) {
    const document = token?.document ?? token;
    return ScCanvasActivityService.#canMoveToken(document, user);
  }

  static getTokenCenter(token, scene = canvas?.scene) {
    const document = token?.document ?? token;
    return ScCanvasActivityService.#tokenCenter(document, scene);
  }

  static sceneDistanceBetweenPoints(pointA, pointB, scene = canvas?.scene) {
    const measuredDistance = ScCanvasActivityService.#measureSceneDistance(pointA, pointB, scene);
    if (Number.isFinite(measuredDistance)) {
      return measuredDistance;
    }

    const pixelDistance = Math.hypot(Number(pointB?.x) - Number(pointA?.x), Number(pointB?.y) - Number(pointA?.y));
    const gridSize = Number(scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
    const gridDistance = Number(scene?.grid?.distance ?? canvas?.grid?.distance ?? 5) || 5;
    return pixelDistance / gridSize * gridDistance;
  }

  static sceneDistanceBetweenTokens(tokenA, tokenB, scene = canvas?.scene) {
    return ScCanvasActivityService.#sceneDistanceBetween(tokenA?.document ?? tokenA, tokenB?.document ?? tokenB, scene);
  }

  static snapCenterPoint(point, scene = canvas?.scene) {
    const rounded = {
      x: Math.round(Number(point?.x) * 10) / 10,
      y: Math.round(Number(point?.y) * 10) / 10
    };
    if (!Number.isFinite(rounded.x) || !Number.isFinite(rounded.y)) {
      return null;
    }

    if (typeof canvas?.grid?.getCenterPoint === "function") {
      return canvas.grid.getCenterPoint(rounded);
    }
    return ScCanvasActivityService.#snapPoint(rounded, scene);
  }

  static snapTopLeftPoint(point, scene = canvas?.scene) {
    const rounded = {
      x: Math.round(Number(point?.x) * 10) / 10,
      y: Math.round(Number(point?.y) * 10) / 10
    };
    if (!Number.isFinite(rounded.x) || !Number.isFinite(rounded.y)) {
      return null;
    }

    if (typeof canvas?.grid?.getTopLeftPoint === "function") {
      return canvas.grid.getTopLeftPoint(rounded);
    }
    return ScCanvasActivityService.#snapPoint(rounded, scene);
  }

  static getSceneTokens(scene = canvas?.scene) {
    const tokenDocuments = scene?.tokens?.contents ?? Array.from(scene?.tokens ?? []);
    return tokenDocuments
      .map((entry) => Array.isArray(entry) ? entry[1] : entry)
      .map((entry) => entry?.document ?? entry)
      .filter(Boolean)
      .map((document) => document.object ?? canvas?.tokens?.get?.(document.id) ?? document)
      .filter(Boolean);
  }

  static async createPreviewTemplate(data = {}) {
    try {
      const scene = ScCanvasActivityService.#activeScene();
      const [template] = await scene.createEmbeddedDocuments("MeasuredTemplate", [{
        t: data.type ?? "circle",
        x: Number(data.x) || 0,
        y: Number(data.y) || 0,
        direction: Number(data.direction) || 0,
        distance: Number(data.distance) || 0,
        fillColor: data.fillColor ?? "#39f08c",
        borderColor: data.borderColor ?? "#24b86a",
        user: game?.user?.id ?? null,
        flags: {
          [Constants.MODULE_ID]: {
            preview: true
          }
        }
      }]);
      return template ?? null;
    } catch (error) {
      Logger.debug("Could not create canvas preview template.", error);
      return null;
    }
  }

  static async removePreviewTemplate(template) {
    try {
      const scene = template?.parent ?? canvas?.scene;
      const id = template?.id;
      if (scene && id) {
        const existingTemplate = scene?.templates?.get?.(id);
        if (!existingTemplate) {
          return;
        }
        await scene.deleteEmbeddedDocuments("MeasuredTemplate", [id]);
      }
    } catch (error) {
      Logger.debug("Could not remove canvas preview template.", error);
    }
  }

  static #buildTeleportRequest(activity) {
    const scene = ScCanvasActivityService.#activeScene();
    const origin = ScCanvasActivityService.#originTokenDocument(activity);
    if (!origin) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin",
        "Select or place the activity actor token on the scene first."
      ));
    }

    const config = activity?.teleport ?? {};
    const targets = ScCanvasActivityService.#limitedTargets(
      ScCanvasActivityService.#resolveTargetDocuments(config.targetSource, origin, {
        allowSelf: true,
        allowedSources: Object.values(CANVAS_TARGET_SOURCES)
      }),
      config.maxTargets
    );
    if (!targets.length) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingTargets",
        "Select at least one target token."
      ));
    }

    const destination = ScCanvasActivityService.#teleportDestination(config, origin);
    const updates = targets.map((token) => {
      const point = ScCanvasActivityService.#topLeftForCenter(destination.center, token, config.snapToGrid !== false);
      return {
        id: token.id,
        x: point.x,
        y: point.y
      };
    });

    return ScCanvasActivityService.#request("teleport", activity, scene, {
      destinationTokenId: destination.token?.id ?? null,
      tokenIds: targets.map((token) => token.id),
      updates
    });
  }

  static #buildMovementRequest(
    activity,
    {
      tokenIds = null,
      originTokenId = null,
      selfDirectionPoint = null,
      movementType = null,
      useExplicitTokenIds = false
    } = {}
  ) {
    if (activity?.movement?.type === MOVEMENT_TYPES.EITHER
      && ![MOVEMENT_TYPES.PUSH, MOVEMENT_TYPES.PULL].includes(movementType)) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScMovement.Warning.MissingMovementType",
        "Choose whether to push or pull the targets."
      ));
    }

    const operation = ScCanvasActivityService.#movementOperationData(activity, {
      originTokenId,
      selfDirectionPoint,
      movementType,
      tokenIds,
      useExplicitTokenIds,
      requireTargets: true
    });

    if (!operation.updates.length) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScMovement.Warning.NoTargetsInRange",
        "No selected tokens are within this movement range."
      ));
    }

    return ScCanvasActivityService.#request("movement", activity, operation.scene, {
      originTokenId: operation.origin.id,
      movementType: operation.config.type,
      selfDirectionPoint: operation.selfDirectionPoint,
      skipped: operation.skipped,
      tokenIds: operation.targets.map((entry) => entry.token.id),
      updates: operation.updates
    });
  }

  static #movementOperationData(activity, {
    tokenIds = null,
    originTokenId = null,
    selfDirectionPoint = null,
    movementType = null,
    useExplicitTokenIds = false,
    requireTargets = true
  } = {}) {
    const scene = ScCanvasActivityService.#activeScene();
    const origin = ScCanvasActivityService.#originTokenDocument(activity, { originTokenId });
    if (!origin) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin",
        "Select or place the activity actor token on the scene first."
      ));
    }

    const config = activity?.movement ?? {};
    const normalizedConfig = {
      distance: Math.max(0, Number(config.distance ?? 10) || 0),
      maxRange: Math.max(0, Number(config.maxRange ?? 0) || 0),
      maxTargets: Math.max(1, Number(config.maxTargets ?? 1) || 1),
      snapToGrid: config.snapToGrid !== false,
      targetSource: config.targetSource ?? CANVAS_TARGET_SOURCES.TARGETS,
      type: ScCanvasActivityService.#movementType(config.type, movementType)
    };

    const targets = useExplicitTokenIds
      ? ScCanvasActivityService.#limitedTargets(
        ScCanvasActivityService.#tokenDocumentsFromIds(scene, ScCanvasActivityService.#uniqueIds(tokenIds)),
        normalizedConfig.maxTargets
      )
      : ScCanvasActivityService.#limitedTargets(
        ScCanvasActivityService.#resolveTargetDocuments(normalizedConfig.targetSource, origin, {
          allowSelf: true,
          allowedSources: Object.values(CANVAS_TARGET_SOURCES)
        }),
        normalizedConfig.maxTargets
      );

    if (!targets.length && requireTargets) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingTargets",
        "Select at least one target token."
      ));
    }

    const originCenter = ScCanvasActivityService.#tokenCenter(origin, scene);
    const selectedSelfDirectionPoint = ScCanvasActivityService.#validPoint(selfDirectionPoint);
    const selectedSelfDirection = ScCanvasActivityService.#directionBetweenPoints(
      originCenter,
      selectedSelfDirectionPoint
    );
    const movementPixels = ScCanvasActivityService.#distanceToPixels(normalizedConfig.distance, scene);
    const direction = normalizedConfig.type === MOVEMENT_TYPES.PULL ? -1 : 1;
    const previewTargets = [];
    const updates = [];
    const skipped = [];

    for (const token of targets) {
      const distance = ScCanvasActivityService.#sceneDistanceBetween(origin, token, scene);
      const currentCenter = ScCanvasActivityService.#tokenCenter(token, scene);
      const inRange = normalizedConfig.maxRange <= 0 || distance <= normalizedConfig.maxRange;

      let destinationCenter = null;
      let destinationPoint = null;

      if (inRange) {
        let dx = currentCenter.x - originCenter.x;
        let dy = currentCenter.y - originCenter.y;
        let length = Math.hypot(dx, dy);
        let movementDirection = direction;
        if (!length) {
          if (token.id !== origin.id || !selectedSelfDirection) {
            previewTargets.push({
              token,
              distance,
              inRange,
              currentCenter,
              destinationCenter,
              destinationPoint
            });
            continue;
          }

          dx = selectedSelfDirection.x;
          dy = selectedSelfDirection.y;
          length = 1;
          movementDirection = 1;
        }

        const projectedCenter = {
          x: currentCenter.x + ((dx / length) * movementPixels * movementDirection),
          y: currentCenter.y + ((dy / length) * movementPixels * movementDirection)
        };
        destinationPoint = ScCanvasActivityService.#topLeftForCenter(projectedCenter, token, normalizedConfig.snapToGrid, scene);
        destinationCenter = ScCanvasActivityService.#tokenCenter({
          ...token,
          x: destinationPoint.x,
          y: destinationPoint.y
        }, scene);

        updates.push({
          id: token.id,
          x: destinationPoint.x,
          y: destinationPoint.y
        });
      } else {
        skipped.push(token.name);
      }

      previewTargets.push({
        token,
        distance,
        inRange,
        currentCenter,
        destinationCenter,
        destinationPoint
      });
    }

    return {
      scene,
      origin,
      config: normalizedConfig,
      selfDirectionPoint: selectedSelfDirectionPoint,
      skipped,
      targets: previewTargets,
      updates
    };
  }

  static #buildWallRequest(activity) {
    const scene = ScCanvasActivityService.#activeScene();
    const origin = ScCanvasActivityService.#originTokenDocument(activity);
    if (!origin) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingOrigin",
        "Select or place the activity actor token on the scene first."
      ));
    }

    const config = ScWallConfig.fromActivity(activity);
    if (!game?.user?.isGM && config.allowPlayerRequests !== true) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScWall.Warning.PlayerRequestsDisabled",
        "Only a GM can create walls with this activity."
      ));
    }

    const targets = ScCanvasActivityService.#limitedTargets(
      ScCanvasActivityService.#resolveTargetDocuments(config.targetSource, origin, {
        allowSelf: false,
        allowedSources: Object.values(WALL_TARGET_SOURCES)
      }),
      config.maxWalls
    );
    if (!targets.length) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingTargets",
        "Select at least one target token."
      ));
    }

    const originCenter = ScCanvasActivityService.#tokenCenter(origin);
    const walls = [];
    const skipped = [];

    for (const target of targets) {
      const range = ScCanvasActivityService.#sceneDistanceBetween(origin, target);
      if (config.maxLength > 0 && range > config.maxLength) {
        skipped.push(target.name);
        continue;
      }

      const targetCenter = ScCanvasActivityService.#tokenCenter(target);
      walls.push({
        c: [
          Math.round(originCenter.x),
          Math.round(originCenter.y),
          Math.round(targetCenter.x),
          Math.round(targetCenter.y)
        ],
        dir: ScCanvasActivityService.#wallBothDirection(),
        door: globalThis.CONST?.WALL_DOOR_TYPES?.NONE ?? 0,
        ds: globalThis.CONST?.WALL_DOOR_STATES?.CLOSED ?? 0,
        move: ScCanvasActivityService.#wallMovementValue(config.blocksMovement),
        sight: ScCanvasActivityService.#wallSenseValue(config.blocksSight),
        sound: ScCanvasActivityService.#wallSenseValue(config.blocksSound),
        flags: {
          [Constants.MODULE_ID]: {
            activityUuid: activity?.uuid ?? null,
            source: "sc-wall"
          }
        }
      });
    }

    if (!walls.length) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScWall.Warning.NoTargetsInRange",
        "No selected tokens are within this wall range."
      ));
    }

    return ScCanvasActivityService.#request("wall", activity, scene, {
      allowPlayerRequests: config.allowPlayerRequests === true,
      originTokenId: origin.id,
      skipped,
      targetTokenIds: targets.map((token) => token.id)
    });
  }

  static #request(operation, activity, scene, data = {}) {
    return {
      ...data,
      activityUuid: activity?.uuid ?? null,
      operation,
      requestUserId: game?.user?.id ?? null,
      sceneId: scene?.id ?? null
    };
  }

  static async #dispatchRequest(request) {
    if (game?.user?.isGM) {
      return ScCanvasActivityService.#executeValidated(request);
    }

    const gm = ScCanvasActivityService.#activeGmUser();
    if (!gm || typeof gm.query !== "function" || !globalThis.CONFIG?.queries?.[QUERY_ID]) {
      return ScCanvasActivityService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.NoActiveGm",
        "An active GM is required for this canvas operation."
      );
    }

    try {
      return await gm.query(QUERY_ID, request, { timeout: QUERY_TIMEOUT });
    } catch (error) {
      Logger.error("Could not request GM canvas operation.", error);
      return ScCanvasActivityService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.GmRequestFailed",
        "Could not request GM canvas operation: {error}",
        { error: error?.message ?? String(error) }
      );
    }
  }

  static async #executeValidated(payload = {}) {
    const scene = game?.scenes?.get(payload.sceneId);
    const user = game?.users?.get(payload.requestUserId);
    const activity = payload.activityUuid ? await ScCanvasActivityService.#fromUuid(payload.activityUuid) : null;

    if (!scene || !user || !activity) {
      return ScCanvasActivityService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
        "The canvas operation request is no longer valid."
      );
    }

    if (!ScCanvasActivityService.#canUseActivity(activity, user)) {
      return ScCanvasActivityService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.ActivityPermission",
        "You do not have permission to use this activity."
      );
    }

    if (payload.operation === "teleport" || payload.operation === "movement") {
      return ScCanvasActivityService.#executeTokenUpdates(scene, user, activity, payload);
    }
    if (payload.operation === "wall") {
      return ScCanvasActivityService.#executeWallCreation(scene, user, activity, payload);
    }

    return ScCanvasActivityService.#failure(
      "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
      "The canvas operation request is no longer valid."
    );
  }

  static async #executeTokenUpdates(scene, user, activity, payload) {
    const operation = payload.operation === "teleport"
      ? ScCanvasActivityService.#serverTeleportUpdates(scene, activity, payload)
      : ScCanvasActivityService.#serverMovementUpdates(scene, activity, payload);
    if (!operation.ok) {
      return operation;
    }

    const updates = [];
    for (const update of operation.updates) {
      const token = scene.tokens?.get(update.id);
      if (!token || !ScCanvasActivityService.#canMoveToken(token, user)) {
        return ScCanvasActivityService.#failure(
          "SCMOREACTIVITIES.Activities.Canvas.Warning.TokenPermission",
          "You do not have permission to move one or more selected tokens."
        );
      }

      const point = ScCanvasActivityService.#boundedPoint(scene, {
        x: Number(update.x),
        y: Number(update.y)
      }, token);
      if (!point) {
        return ScCanvasActivityService.#failure(
          "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidPosition",
          "The requested canvas position is invalid."
        );
      }

      updates.push({
        _id: token.id,
        x: point.x,
        y: point.y
      });
    }

    if (!updates.length) {
      return ScCanvasActivityService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingTargets",
        "Select at least one target token."
      );
    }

    await scene.updateEmbeddedDocuments("Token", updates, { animate: false });
    return {
      ok: true,
      count: updates.length,
      skipped: operation.skipped ?? []
    };
  }

  static async #executeWallCreation(scene, user, activity, payload) {
    if (!user?.isGM) {
      const config = activity?.wall ?? {};
      if (config.allowPlayerRequests !== true || payload.allowPlayerRequests !== true) {
        return ScCanvasActivityService.#failure(
          "SCMOREACTIVITIES.Activities.ScWall.Warning.PlayerRequestsDisabled",
          "Only a GM can create walls with this activity."
        );
      }
    }

    const operation = ScCanvasActivityService.#serverWallDocuments(scene, activity, payload);
    if (!operation.ok) {
      return operation;
    }

    await scene.createEmbeddedDocuments("Wall", operation.walls, { isUndo: true });
    return {
      ok: true,
      count: operation.requestedWallCount ?? operation.walls.length,
      skipped: operation.skipped ?? []
    };
  }

  static #serverTeleportUpdates(scene, activity, payload) {
    const config = activity?.teleport ?? {};
    const origin = scene.tokens?.get(payload.originTokenId);
    const targets = ScCanvasActivityService.#tokenDocumentsFromIds(scene, payload.tokenIds);
    const limitedTargets = ScCanvasActivityService.#limitedTargets(targets, config.maxTargets);
    if (!limitedTargets.length) {
      return ScCanvasActivityService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
        "The canvas operation request is no longer valid."
      );
    }

    const explicitDestination = ScCanvasActivityService.#validPoint(payload.destination);
    let destination = explicitDestination;
    if (!destination) {
      const destinationToken = scene.tokens?.get(payload.destinationTokenId);
      const destinationIsOrigin = config.destinationSource !== TELEPORT_DESTINATION_SOURCES.TARGET;
      if (
        !destinationToken
        || (destinationIsOrigin && !ScCanvasActivityService.#tokenMatchesActivityActor(destinationToken, activity))
      ) {
        return ScCanvasActivityService.#failure(
          "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
          "The canvas operation request is no longer valid."
        );
      }

      destination = ScCanvasActivityService.#tokenCenter(destinationToken, scene);
      destination.x += ScCanvasActivityService.#distanceToPixels(config.offsetX ?? 0, scene);
      destination.y += ScCanvasActivityService.#distanceToPixels(config.offsetY ?? 0, scene);
    } else if (!origin || !ScCanvasActivityService.#tokenMatchesActivityActor(origin, activity)) {
      return ScCanvasActivityService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
        "The canvas operation request is no longer valid."
      );
    }

    const teleportDistance = Number(config.teleportDistance ?? 0);
    if (explicitDestination && teleportDistance > 0) {
      const originCenter = ScCanvasActivityService.#tokenCenter(origin, scene);
      const distance = ScCanvasActivityService.sceneDistanceBetweenPoints(originCenter, destination, scene);
      if (distance > teleportDistance) {
        return ScCanvasActivityService.#failure(
          "SCMOREACTIVITIES.Activities.ScTeleport.Warning.DestinationOutOfRange",
          "Destination is outside the teleport range."
        );
      }
    }

    return {
      ok: true,
      skipped: [],
      updates: explicitDestination
        ? ScCanvasActivityService.#placementTeleportUpdates(limitedTargets, destination, config, scene)
        : limitedTargets.map((token) => {
          const point = ScCanvasActivityService.#topLeftForCenter(destination, token, config.snapToGrid !== false, scene);
          return {
            id: token.id,
            x: point.x,
            y: point.y
          };
        })
    };
  }

  static #placementTeleportUpdates(tokens, destination, config, scene) {
    if (tokens.length <= 1) {
      const token = tokens[0];
      const point = ScCanvasActivityService.#topLeftForCenter(destination, token, config.snapToGrid !== false, scene);
      return [{
        id: token.id,
        x: point.x,
        y: point.y
      }];
    }

    if (config.keepArrangement !== false) {
      const center = tokens.reduce((accumulator, token) => {
        const tokenCenter = ScCanvasActivityService.#tokenCenter(token, scene);
        accumulator.x += tokenCenter.x;
        accumulator.y += tokenCenter.y;
        return accumulator;
      }, { x: 0, y: 0 });
      center.x /= tokens.length;
      center.y /= tokens.length;

      return tokens.map((token) => {
        const tokenCenter = ScCanvasActivityService.#tokenCenter(token, scene);
        const point = ScCanvasActivityService.#topLeftForCenter({
          x: destination.x + (tokenCenter.x - center.x),
          y: destination.y + (tokenCenter.y - center.y)
        }, token, config.snapToGrid !== false, scene);
        return {
          id: token.id,
          x: point.x,
          y: point.y
        };
      });
    }

    const radius = ScCanvasActivityService.#distanceToPixels(config.clusterRadius ?? 5, scene);
    return tokens.map((token, index) => {
      const angle = (index / tokens.length) * 2 * Math.PI;
      const point = ScCanvasActivityService.#topLeftForCenter({
        x: destination.x + (Math.cos(angle) * radius),
        y: destination.y + (Math.sin(angle) * radius)
      }, token, config.snapToGrid !== false, scene);
      return {
        id: token.id,
        x: point.x,
        y: point.y
      };
    });
  }

  static #serverMovementUpdates(scene, activity, payload) {
    const config = activity?.movement ?? {};
    if (config.type === MOVEMENT_TYPES.EITHER
      && ![MOVEMENT_TYPES.PUSH, MOVEMENT_TYPES.PULL].includes(payload.movementType)) {
      return ScCanvasActivityService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
        "The canvas operation request is no longer valid."
      );
    }
    const origin = scene.tokens?.get(payload.originTokenId);
    const targets = ScCanvasActivityService.#limitedTargets(
      ScCanvasActivityService.#tokenDocumentsFromIds(scene, payload.tokenIds),
      config.maxTargets
    );
    if (!origin || !ScCanvasActivityService.#tokenMatchesActivityActor(origin, activity) || !targets.length) {
      return ScCanvasActivityService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
        "The canvas operation request is no longer valid."
      );
    }

    const originCenter = ScCanvasActivityService.#tokenCenter(origin, scene);
    const selectedSelfDirection = ScCanvasActivityService.#directionBetweenPoints(
      originCenter,
      ScCanvasActivityService.#validPoint(payload.selfDirectionPoint)
    );
    const movementPixels = ScCanvasActivityService.#distanceToPixels(config.distance ?? 5, scene);
    const movementType = ScCanvasActivityService.#movementType(config.type, payload.movementType);
    const maxRange = Number(config.maxRange ?? 0);
    const updates = [];
    const skipped = [];

    for (const token of targets) {
      const range = ScCanvasActivityService.#sceneDistanceBetween(origin, token, scene);
      if (maxRange > 0 && range > maxRange) {
        skipped.push(token.name);
        continue;
      }

      const center = ScCanvasActivityService.#tokenCenter(token, scene);
      let dx = center.x - originCenter.x;
      let dy = center.y - originCenter.y;
      let length = Math.hypot(dx, dy);
      let direction = movementType === MOVEMENT_TYPES.PULL ? -1 : 1;
      if (!length) {
        if (token.id !== origin.id || !selectedSelfDirection) {
          continue;
        }

        dx = selectedSelfDirection.x;
        dy = selectedSelfDirection.y;
        length = 1;
        direction = 1;
      }

      const destination = {
        x: center.x + ((dx / length) * movementPixels * direction),
        y: center.y + ((dy / length) * movementPixels * direction)
      };
      const point = ScCanvasActivityService.#topLeftForCenter(destination, token, config.snapToGrid !== false, scene);
      updates.push({
        id: token.id,
        x: point.x,
        y: point.y
      });
    }

    if (!updates.length) {
      return ScCanvasActivityService.#failure(
        "SCMOREACTIVITIES.Activities.ScMovement.Warning.NoTargetsInRange",
        "No selected tokens are within this movement range."
      );
    }

    return {
      ok: true,
      skipped,
      updates
    };
  }

  static #serverWallDocuments(scene, activity, payload) {
    const config = ScWallConfig.fromActivity(activity);
    const origin = scene.tokens?.get(payload.originTokenId);
    if (Array.isArray(payload.walls)) {
      if (!origin || !ScCanvasActivityService.#tokenMatchesActivityActor(origin, activity)) {
        return ScCanvasActivityService.#failure(
          "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
          "The canvas operation request is no longer valid."
        );
      }

      const placements = ScCanvasActivityService.#validWallPlacements(payload.walls);
      if (!placements.length) {
        return ScCanvasActivityService.#failure(
          "SCMOREACTIVITIES.Activities.ScWall.Warning.NoWalls",
          "No walls to create."
        );
      }

      const originCenter = ScCanvasActivityService.#tokenCenter(origin, scene);
      const allSegments = [];
      let requestedWalls = 0;
      let requestedLength = 0;

      for (const placement of placements) {
        if (!ScCanvasActivityService.#pointsWithinWallPlacementRange(
          placement.points,
          originCenter,
          config.referenceRange,
          scene
        )) {
          return ScCanvasActivityService.#failure(
            "SCMOREACTIVITIES.Activities.ScWall.Warning.PointOutOfRange",
            "Wall point must be within {range}.",
            { range: config.referenceRange }
          );
        }

        requestedWalls += ScCanvasActivityService.#wallPlacementCount(placement.points, config.wallType);
        if (requestedWalls > config.maxWalls) {
          return ScCanvasActivityService.#failure(
            "SCMOREACTIVITIES.Activities.ScWall.Warning.MaxWallsExceeded",
            "You can place at most {count} wall(s).",
            { count: config.maxWalls }
          );
        }

        requestedLength += ScCanvasActivityService.#wallPlacementPointsLength(placement.points, config.wallType, scene);
        const segments = ScWallGeometry.calculateSegments(placement.points, config.wallType, {
          panelSize: config.panelSize,
          panelSpacing: config.panelSpacing,
          maxPanels: config.maxPanels,
          scene
        }).filter((segment) => ScCanvasActivityService.#segmentPixelLength(segment) > 0);
        if (!segments.length) {
          return ScCanvasActivityService.#failure(
            "SCMOREACTIVITIES.Activities.ScWall.Warning.NoSegments",
            "No valid wall segments could be created."
          );
        }
        if (!ScCanvasActivityService.#segmentsWithinWallPlacementRange(
          segments,
          originCenter,
          config.referenceRange,
          scene
        )) {
          return ScCanvasActivityService.#failure(
            "SCMOREACTIVITIES.Activities.ScWall.Warning.PointOutOfRange",
            "Wall point must be within {range}.",
            { range: config.referenceRange }
          );
        }

        const facing = ScCanvasActivityService.#wallFacingForRequest(placement.facing ?? payload.facing, config);
        allSegments.push(...segments.map((segment) => ({
          ...segment,
          facing
        })));
      }

      if (config.maxLength > 0 && requestedLength > config.maxLength) {
        return ScCanvasActivityService.#failure(
          "SCMOREACTIVITIES.Activities.ScWall.Warning.MaxLengthExceeded",
          "Adding this point would exceed the maximum wall length of {length}.",
          { length: config.maxLength }
        );
      }

      const walls = ScWallGeometry.buildDocuments(allSegments, {
        activity,
        blocksMovement: config.blocksMovement,
        blocksSight: config.blocksSight,
        blocksSound: config.blocksSound,
        facing: ScCanvasActivityService.#wallFacingForRequest(payload.facing, config),
        referencePoint: originCenter
      });
      if (!walls.length) {
        return ScCanvasActivityService.#failure(
          "SCMOREACTIVITIES.Activities.ScWall.Warning.NoWalls",
          "No walls to create."
        );
      }

      for (const wall of walls) {
        if (!ScCanvasActivityService.#validWallCoordinates(wall.c, scene)) {
          return ScCanvasActivityService.#failure(
            "SCMOREACTIVITIES.Activities.ScWall.Warning.InvalidWall",
            "The requested wall coordinates are invalid."
          );
        }
      }

      return {
        ok: true,
        skipped: [],
        requestedWallCount: requestedWalls,
        walls
      };
    }

    const targets = ScCanvasActivityService.#limitedTargets(
      ScCanvasActivityService.#tokenDocumentsFromIds(scene, payload.targetTokenIds),
      config.maxWalls
    );
    if (!origin || !ScCanvasActivityService.#tokenMatchesActivityActor(origin, activity) || !targets.length) {
      return ScCanvasActivityService.#failure(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.InvalidRequest",
        "The canvas operation request is no longer valid."
      );
    }

    const originCenter = ScCanvasActivityService.#tokenCenter(origin, scene);
    const walls = [];
    const skipped = [];

    for (const target of targets) {
      const range = ScCanvasActivityService.#sceneDistanceBetween(origin, target, scene);
      if (config.maxLength > 0 && range > config.maxLength) {
        skipped.push(target.name);
        continue;
      }

      const targetCenter = ScCanvasActivityService.#tokenCenter(target, scene);
      const wall = {
        c: [
          originCenter.x,
          originCenter.y,
          targetCenter.x,
          targetCenter.y
        ],
        dir: ScCanvasActivityService.#wallBothDirection(),
        door: globalThis.CONST?.WALL_DOOR_TYPES?.NONE ?? 0,
        ds: globalThis.CONST?.WALL_DOOR_STATES?.CLOSED ?? 0,
        move: ScCanvasActivityService.#wallMovementValue(config.blocksMovement),
        sight: ScCanvasActivityService.#wallSenseValue(config.blocksSight),
        sound: ScCanvasActivityService.#wallSenseValue(config.blocksSound),
        flags: {
          [Constants.MODULE_ID]: {
            activityUuid: activity?.uuid ?? null,
            source: "sc-wall"
          }
        }
      };
      if (!ScCanvasActivityService.#validWallCoordinates(wall.c, scene)) {
        return ScCanvasActivityService.#failure(
          "SCMOREACTIVITIES.Activities.ScWall.Warning.InvalidWall",
          "The requested wall coordinates are invalid."
        );
      }
      walls.push(wall);
    }

    if (!walls.length) {
      return ScCanvasActivityService.#failure(
        "SCMOREACTIVITIES.Activities.ScWall.Warning.NoTargetsInRange",
        "No selected tokens are within this wall range."
      );
    }

    return {
      ok: true,
      requestedWallCount: walls.length,
      skipped,
      walls
    };
  }

  static #activeScene() {
    const scene = canvas?.scene;
    if (!scene) {
      throw new Error(Constants.localize(
        "SCMOREACTIVITIES.Activities.Canvas.Warning.MissingScene",
        "Open an active scene before using this activity."
      ));
    }
    return scene;
  }

  static #originTokenDocument(activity, { originTokenId = null } = {}) {
    if (originTokenId) {
      const scene = canvas?.scene;
      const explicit = scene?.tokens?.get?.(originTokenId) ?? null;
      if (explicit) {
        return explicit;
      }
    }

    const actor = ScCanvasActivityService.#activityActor(activity);
    if (!actor) {
      return null;
    }

    const controlled = Array.from(canvas?.tokens?.controlled ?? [])
      .find((token) => token?.actor === actor || token?.actor?.uuid === actor?.uuid);
    const active = actor.getActiveTokens?.(false, true)?.[0] ?? null;
    return (controlled ?? active)?.document ?? null;
  }

  static #activityActor(activity) {
    return activity?.actor ?? activity?.item?.actor ?? null;
  }

  static #tokenMatchesActivityActor(token, activity) {
    const actor = ScCanvasActivityService.#activityActor(activity);
    if (!actor || !token?.actor) {
      return false;
    }
    return token.actor === actor
      || token.actor.uuid === actor.uuid
      || token.actor.id === actor.id;
  }

  static #resolveTargetDocuments(source, origin, { allowSelf, allowedSources }) {
    const normalizedSource = allowedSources.includes(source) ? source : allowedSources[0];
    if (normalizedSource === CANVAS_TARGET_SOURCES.SELF) {
      return allowSelf && origin ? [origin] : [];
    }
    if (normalizedSource === CANVAS_TARGET_SOURCES.CONTROLLED || normalizedSource === WALL_TARGET_SOURCES.CONTROLLED) {
      return ScCanvasActivityService.#uniqueTokenDocuments(Array.from(canvas?.tokens?.controlled ?? [])
        .map((token) => token?.document)
        .filter((token) => allowSelf || token?.id !== origin?.id));
    }

    return ScCanvasActivityService.#uniqueTokenDocuments(Array.from(game?.user?.targets ?? [])
      .map((token) => token?.document)
      .filter((token) => allowSelf || token?.id !== origin?.id));
  }

  static #limitedTargets(tokens, maxTargets) {
    const limit = Math.max(1, Number(maxTargets ?? tokens.length) || tokens.length);
    return tokens.slice(0, limit);
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

  static #validPoint(point) {
    const validPoint = {
      x: Number(point?.x),
      y: Number(point?.y)
    };
    return Number.isFinite(validPoint.x) && Number.isFinite(validPoint.y) ? validPoint : null;
  }

  static #directionBetweenPoints(origin, point) {
    const originPoint = ScCanvasActivityService.#validPoint(origin);
    const targetPoint = ScCanvasActivityService.#validPoint(point);
    if (!originPoint || !targetPoint) {
      return null;
    }

    const x = targetPoint.x - originPoint.x;
    const y = targetPoint.y - originPoint.y;
    const length = Math.hypot(x, y);
    return length > 0 ? { x: x / length, y: y / length } : null;
  }

  static #movementType(configuredType, requestedType) {
    if (configuredType === MOVEMENT_TYPES.PULL) {
      return MOVEMENT_TYPES.PULL;
    }
    if (configuredType === MOVEMENT_TYPES.EITHER && requestedType === MOVEMENT_TYPES.PULL) {
      return MOVEMENT_TYPES.PULL;
    }
    return MOVEMENT_TYPES.PUSH;
  }

  static #validSegments(segments) {
    return Array.isArray(segments)
      ? segments
        .map((segment) => ({
          x1: Number(segment?.x1),
          y1: Number(segment?.y1),
          x2: Number(segment?.x2),
          y2: Number(segment?.y2),
          facing: ["both", "towards", "away"].includes(segment?.facing) ? segment.facing : null,
          referencePoint: ScCanvasActivityService.#validPoint(segment?.referencePoint)
        }))
        .filter((segment) => [segment.x1, segment.y1, segment.x2, segment.y2].every((value) => Number.isFinite(value)))
      : [];
  }

  static #validWallPlacements(walls) {
    return Array.isArray(walls)
      ? walls
        .map((wall) => ({
          points: ScCanvasActivityService.#validPoints(wall?.points),
          facing: ["both", "towards", "away"].includes(wall?.facing) ? wall.facing : null
        }))
        .filter((wall) => wall.points.length >= 2)
      : [];
  }

  static #validPoints(points) {
    return Array.isArray(points)
      ? points
        .map((point) => ScCanvasActivityService.#validPoint(point))
        .filter(Boolean)
      : [];
  }

  static #wallFacingForRequest(facing, config) {
    if (config?.facing === "any") {
      return ["towards", "away"].includes(facing) ? facing : "away";
    }
    return ["both", "towards", "away"].includes(config?.facing) ? config.facing : "both";
  }

  static #wallPlacementCount(points, wallType) {
    const count = Array.isArray(points) ? points.length : 0;
    if (count < 2) {
      return 0;
    }
    if (wallType === "circular") {
      return 1;
    }
    return Math.max(0, count - 1);
  }

  static #pointsWithinWallPlacementRange(points, originCenter, range, scene) {
    if (range <= 0) {
      return true;
    }
    if (!originCenter) {
      return false;
    }

    return points.every((point) => ScCanvasActivityService.sceneDistanceBetweenPoints(originCenter, point, scene) <= range);
  }

  static #segmentsWithinWallPlacementRange(segments, originCenter, range, scene) {
    if (range <= 0) {
      return true;
    }
    if (!originCenter) {
      return false;
    }

    return segments.every((segment) => ScCanvasActivityService.#pointsWithinWallPlacementRange([
      { x: segment?.x1, y: segment?.y1 },
      { x: segment?.x2, y: segment?.y2 }
    ], originCenter, range, scene));
  }

  static #teleportDestination(config, origin) {
    let destinationToken = origin;
    if (config.destinationSource === TELEPORT_DESTINATION_SOURCES.TARGET) {
      destinationToken = Array.from(game?.user?.targets ?? [])?.[0]?.document ?? null;
      if (!destinationToken) {
        throw new Error(Constants.localize(
          "SCMOREACTIVITIES.Activities.ScTeleport.Warning.MissingDestination",
          "Target one token to use as the teleport destination."
        ));
      }
    }

    const destination = ScCanvasActivityService.#tokenCenter(destinationToken);
    return {
      token: destinationToken,
      center: {
        x: destination.x + ScCanvasActivityService.#distanceToPixels(config.offsetX ?? 0),
        y: destination.y + ScCanvasActivityService.#distanceToPixels(config.offsetY ?? 0)
      }
    };
  }

  static #uniqueTokenDocuments(tokens) {
    const seen = new Set();
    return tokens.filter((token) => {
      if (!token?.id || seen.has(token.id)) {
        return false;
      }
      seen.add(token.id);
      return true;
    });
  }

  static #tokenDocumentsFromIds(scene, ids = []) {
    const seen = new Set();
    return ids
      .map((id) => String(id ?? ""))
      .filter((id) => {
        if (!id || seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      })
      .map((id) => scene.tokens?.get(id))
      .filter(Boolean);
  }

  static #tokenCenter(token, scene = canvas?.scene) {
    const size = ScCanvasActivityService.#tokenPixelSize(token, scene);
    return {
      x: Number(token?.x ?? 0) + (size.width / 2),
      y: Number(token?.y ?? 0) + (size.height / 2)
    };
  }

  static #topLeftForCenter(center, token, snapToGrid, scene = canvas?.scene) {
    const size = ScCanvasActivityService.#tokenPixelSize(token, scene);
    const point = {
      x: Number(center.x) - (size.width / 2),
      y: Number(center.y) - (size.height / 2)
    };
    return snapToGrid ? ScCanvasActivityService.#snapPoint(point, scene) : point;
  }

  static #tokenPixelSize(token, scene = canvas?.scene) {
    const gridSize = Number(scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
    const objectWidth = Number(token?.object?.w);
    const objectHeight = Number(token?.object?.h);
    const documentWidth = Number(token?.width);
    const documentHeight = Number(token?.height);
    return {
      width: Number.isFinite(objectWidth) && objectWidth > 0
        ? objectWidth
        : (Number.isFinite(documentWidth) && documentWidth > 0 ? documentWidth * gridSize : gridSize),
      height: Number.isFinite(objectHeight) && objectHeight > 0
        ? objectHeight
        : (Number.isFinite(documentHeight) && documentHeight > 0 ? documentHeight * gridSize : gridSize)
    };
  }

  static #snapPoint(point, scene = canvas?.scene) {
    const gridSize = Number(scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
    return {
      x: Math.round(Number(point.x) / gridSize) * gridSize,
      y: Math.round(Number(point.y) / gridSize) * gridSize
    };
  }

  static #distanceToPixels(distance, scene = canvas?.scene) {
    const gridSize = Number(scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
    const gridDistance = Number(scene?.grid?.distance ?? 5) || 5;
    return (Number(distance) || 0) * (gridSize / gridDistance);
  }

  static #sceneDistanceBetween(origin, target, scene = canvas?.scene) {
    const originCenter = ScCanvasActivityService.#tokenCenter(origin, scene);
    const targetCenter = ScCanvasActivityService.#tokenCenter(target, scene);
    return ScCanvasActivityService.sceneDistanceBetweenPoints(originCenter, targetCenter, scene);
  }

  static #measureSceneDistance(pointA, pointB, scene = canvas?.scene) {
    if (scene?.id !== canvas?.scene?.id || typeof canvas?.grid?.measurePath !== "function") {
      return null;
    }

    try {
      const measurement = canvas.grid.measurePath([
        { x: Number(pointA?.x), y: Number(pointA?.y) },
        { x: Number(pointB?.x), y: Number(pointB?.y) }
      ]);
      const distance = Number(measurement?.cost ?? measurement?.distance);
      return Number.isFinite(distance) ? distance : null;
    } catch (error) {
      Logger.debug("Could not measure canvas path distance.", error);
      return null;
    }
  }

  static #wallPlacementPointsLength(points, wallType, scene = canvas?.scene) {
    if (!Array.isArray(points) || points.length < 2) {
      return 0;
    }

    if (wallType === "circular") {
      return ScCanvasActivityService.sceneDistanceBetweenPoints(points[0], points[1], scene);
    }

    let total = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      total += ScCanvasActivityService.sceneDistanceBetweenPoints(points[index], points[index + 1], scene);
    }
    return total;
  }

  static #segmentPixelLength(segment) {
    return Math.hypot(
      Number(segment?.x2) - Number(segment?.x1),
      Number(segment?.y2) - Number(segment?.y1)
    );
  }

  static #wallPlacementLength(segments, wallType, scene = canvas?.scene) {
    if (wallType === "circular") {
      const points = segments.flatMap((segment) => [
        { x: segment.x1, y: segment.y1 },
        { x: segment.x2, y: segment.y2 }
      ]);
      const center = points.reduce((accumulator, point) => {
        accumulator.x += point.x;
        accumulator.y += point.y;
        return accumulator;
      }, { x: 0, y: 0 });
      center.x /= points.length;
      center.y /= points.length;
      return points.reduce((radius, point) => {
        return Math.max(radius, ScCanvasActivityService.sceneDistanceBetweenPoints(center, point, scene));
      }, 0);
    }

    return segments.reduce((total, segment) => {
      return total + ScCanvasActivityService.sceneDistanceBetweenPoints(
        { x: segment.x1, y: segment.y1 },
        { x: segment.x2, y: segment.y2 },
        scene
      );
    }, 0);
  }

  static #boundedPoint(scene, point, token = null) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return null;
    }

    const width = Number(scene?.dimensions?.width ?? scene?.width ?? 0);
    const height = Number(scene?.dimensions?.height ?? scene?.height ?? 0);
    const size = token ? ScCanvasActivityService.#tokenPixelSize(token, scene) : { width: 0, height: 0 };
    if (width > 0 && (point.x < 0 || point.x + size.width > width)) {
      return null;
    }
    if (height > 0 && (point.y < 0 || point.y + size.height > height)) {
      return null;
    }
    return {
      x: Math.round(point.x),
      y: Math.round(point.y)
    };
  }

  static #validWallCoordinates(coordinates, scene) {
    if (!Array.isArray(coordinates) || coordinates.length !== 4) {
      return false;
    }
    if (!coordinates.every((coordinate) => Number.isFinite(Number(coordinate)))) {
      return false;
    }

    const width = Number(scene?.dimensions?.width ?? scene?.width ?? 0);
    const height = Number(scene?.dimensions?.height ?? scene?.height ?? 0);
    if (width <= 0 || height <= 0) {
      return true;
    }

    const [x1, y1, x2, y2] = coordinates.map(Number);
    return x1 >= 0 && x1 <= width
      && x2 >= 0 && x2 <= width
      && y1 >= 0 && y1 <= height
      && y2 >= 0 && y2 <= height;
  }

  static #wallMovementValue(blocksMovement) {
    const types = globalThis.CONST?.WALL_MOVEMENT_TYPES;
    return blocksMovement ? (types?.NORMAL ?? 20) : (types?.NONE ?? 0);
  }

  static #wallSenseValue(blocksSense) {
    const types = globalThis.CONST?.WALL_SENSE_TYPES;
    return blocksSense ? (types?.NORMAL ?? 20) : (types?.NONE ?? 0);
  }

  static #wallBothDirection() {
    return globalThis.CONST?.WALL_DIRECTIONS?.BOTH
      ?? globalThis.CONST?.EDGE_DIRECTIONS?.BOTH
      ?? 0;
  }

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

  static #canMoveToken(token, user) {
    if (user?.isGM) {
      return true;
    }

    return Boolean(
      token?.actor?.testUserPermission?.(user, "OWNER")
      || token?.testUserPermission?.(user, "OWNER")
    );
  }

  static #activeGmUser() {
    return game?.users?.find((user) => user.active && user.isGM) ?? null;
  }

  static async #fromUuid(uuid) {
    if (!uuid || typeof globalThis.fromUuid !== "function") {
      return null;
    }
    try {
      return await globalThis.fromUuid(uuid);
    } catch (error) {
      Logger.warn("Could not resolve canvas activity UUID.", error);
      return null;
    }
  }

  static #notifyResult(result, key, fallback) {
    if (result?.ok) {
      ui.notifications?.info?.(Constants.format(key, { count: result.count ?? 0 }, fallback));
      if (Array.isArray(result.skipped) && result.skipped.length) {
        ui.notifications?.warn?.(Constants.format(
          "SCMOREACTIVITIES.Activities.Canvas.Warning.SkippedTargets",
          { targets: result.skipped.join(", ") },
          `Some targets were skipped: ${result.skipped.join(", ")}`
        ));
      }
      return;
    }

    if (result?.message) {
      ui.notifications?.warn?.(result.message);
    }
  }

  static #handleExecutionError(operation, error) {
    Logger.error(`Could not execute sc-${operation} activity.`, error);
    ui.notifications?.error?.(error?.message ?? String(error));
    return {
      ok: false,
      error: error?.message ?? String(error)
    };
  }

  static #failure(key, fallback, data = {}) {
    return {
      ok: false,
      message: Constants.format(key, data, fallback)
    };
  }
}
