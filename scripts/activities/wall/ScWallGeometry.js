import { Constants } from "../../constants/Constants.js";

export class ScWallGeometry {
  static calculateSegments(points, wallType, {
    panelSize = 5,
    panelSpacing = 0,
    maxPanels = "",
    scene = canvas?.scene
  } = {}) {
    const normalizedPoints = ScWallGeometry.#validPoints(points);
    if (normalizedPoints.length < 2) {
      return [];
    }

    if (wallType === "circular") {
      return ScWallGeometry.#circularSegments(normalizedPoints, scene);
    }
    if (wallType === "panels") {
      return ScWallGeometry.#panelSegments(normalizedPoints, panelSize, panelSpacing, maxPanels, scene);
    }
    return ScWallGeometry.#continuousSegments(normalizedPoints);
  }

  static buildDocuments(segments, {
    activity,
    blocksMovement = true,
    blocksSight = true,
    blocksSound = false,
    facing = "both",
    referencePoint = null
  } = {}) {
    return ScWallGeometry.#validSegments(segments).map((segment) => {
      const segmentFacing = ["both", "towards", "away"].includes(segment.facing) ? segment.facing : facing;
      const segmentReference = segment.referencePoint ?? referencePoint;
      return {
        c: [
          Number(segment.x1),
          Number(segment.y1),
          Number(segment.x2),
          Number(segment.y2)
        ],
        dir: segmentReference && segmentFacing !== "both"
          ? ScWallGeometry.calculateDirection(segment, segmentReference, segmentFacing)
          : ScWallGeometry.wallDirections.BOTH,
        door: globalThis.CONST?.WALL_DOOR_TYPES?.NONE ?? 0,
        ds: globalThis.CONST?.WALL_DOOR_STATES?.CLOSED ?? 0,
        move: ScWallGeometry.#wallMovementValue(blocksMovement),
        sight: ScWallGeometry.#wallSenseValue(blocksSight),
        sound: ScWallGeometry.#wallSenseValue(blocksSound),
        flags: {
          [Constants.MODULE_ID]: {
            activityUuid: activity?.uuid ?? null,
            source: "sc-wall"
          }
        }
      };
    });
  }

  static calculateDirection(segment, referencePoint, facing) {
    const midpoint = {
      x: (Number(segment.x1) + Number(segment.x2)) / 2,
      y: (Number(segment.y1) + Number(segment.y2)) / 2
    };
    const segmentVector = {
      x: Number(segment.x2) - Number(segment.x1),
      y: Number(segment.y2) - Number(segment.y1)
    };
    const referenceVector = {
      x: Number(referencePoint?.x) - midpoint.x,
      y: Number(referencePoint?.y) - midpoint.y
    };
    const cross = (segmentVector.x * referenceVector.y) - (segmentVector.y * referenceVector.x);
    if (facing === "towards") {
      return cross > 0 ? ScWallGeometry.wallDirections.LEFT : ScWallGeometry.wallDirections.RIGHT;
    }
    if (facing === "away") {
      return cross > 0 ? ScWallGeometry.wallDirections.RIGHT : ScWallGeometry.wallDirections.LEFT;
    }
    return ScWallGeometry.wallDirections.BOTH;
  }

  static get wallDirections() {
    return globalThis.CONST?.EDGE_DIRECTIONS ?? globalThis.CONST?.WALL_DIRECTIONS ?? {
      BOTH: 0,
      LEFT: 1,
      RIGHT: 2
    };
  }

  static #continuousSegments(points) {
    const segments = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      segments.push({
        x1: points[index].x,
        y1: points[index].y,
        x2: points[index + 1].x,
        y2: points[index + 1].y
      });
    }
    return segments;
  }

  static #circularSegments(points, scene) {
    const [center, edge] = points;
    const radiusPixels = ScWallGeometry.#pixelDistance(center, edge, scene);
    if (radiusPixels <= 0) {
      return [];
    }

    const gridSize = ScWallGeometry.#gridSize(scene);
    const segmentCount = Math.max(32, Math.floor((2 * Math.PI * radiusPixels) / (gridSize * 2)));
    const segments = [];
    for (let index = 0; index < segmentCount; index += 1) {
      const angle1 = (index / segmentCount) * 2 * Math.PI;
      const angle2 = ((index + 1) / segmentCount) * 2 * Math.PI;
      segments.push({
        x1: center.x + (Math.cos(angle1) * radiusPixels),
        y1: center.y + (Math.sin(angle1) * radiusPixels),
        x2: center.x + (Math.cos(angle2) * radiusPixels),
        y2: center.y + (Math.sin(angle2) * radiusPixels)
      });
    }
    return segments;
  }

  static #panelSegments(points, panelSize, panelSpacing, maxPanels, scene) {
    const panelSizePixels = ScWallGeometry.#distanceToPixels(panelSize, scene);
    if (panelSizePixels <= 0) {
      return [];
    }

    const spacingPixels = ScWallGeometry.#distanceToPixels(panelSpacing, scene);
    const step = panelSizePixels + Math.max(0, spacingPixels);
    const limit = ScWallGeometry.#panelLimit(maxPanels);
    const segments = [];

    for (const baseSegment of ScWallGeometry.#continuousSegments(points)) {
      const length = Math.hypot(baseSegment.x2 - baseSegment.x1, baseSegment.y2 - baseSegment.y1);
      if (length <= 0) {
        continue;
      }

      const unitX = (baseSegment.x2 - baseSegment.x1) / length;
      const unitY = (baseSegment.y2 - baseSegment.y1) / length;
      let current = 0;
      while (current + panelSizePixels <= length && segments.length < limit) {
        segments.push({
          x1: baseSegment.x1 + (unitX * current),
          y1: baseSegment.y1 + (unitY * current),
          x2: baseSegment.x1 + (unitX * (current + panelSizePixels)),
          y2: baseSegment.y1 + (unitY * (current + panelSizePixels))
        });
        current += step;
      }

      if (segments.length >= limit) {
        break;
      }
    }

    return segments;
  }

  static #validPoints(points) {
    return Array.isArray(points)
      ? points
        .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      : [];
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
          referencePoint: ScWallGeometry.#validPoint(segment?.referencePoint)
        }))
        .filter((segment) => [segment.x1, segment.y1, segment.x2, segment.y2].every((value) => Number.isFinite(value)))
      : [];
  }

  static #validPoint(point) {
    const validPoint = {
      x: Number(point?.x),
      y: Number(point?.y)
    };
    return Number.isFinite(validPoint.x) && Number.isFinite(validPoint.y) ? validPoint : null;
  }

  static #panelLimit(maxPanels) {
    if (maxPanels === "" || maxPanels === null || maxPanels === undefined || maxPanels === "unlimited") {
      return Infinity;
    }
    const limit = Math.floor(Number(maxPanels));
    return Number.isFinite(limit) && limit >= 0 ? limit : Infinity;
  }

  static #pixelDistance(pointA, pointB, scene) {
    const sceneDistance = ScWallGeometry.#sceneDistanceBetweenPoints(pointA, pointB, scene);
    return ScWallGeometry.#distanceToPixels(sceneDistance, scene);
  }

  static #sceneDistanceBetweenPoints(pointA, pointB, scene) {
    if (scene?.id === canvas?.scene?.id && typeof canvas?.grid?.measurePath === "function") {
      try {
        const measurement = canvas.grid.measurePath([
          { x: Number(pointA?.x), y: Number(pointA?.y) },
          { x: Number(pointB?.x), y: Number(pointB?.y) }
        ]);
        const distance = Number(measurement?.cost ?? measurement?.distance);
        if (Number.isFinite(distance)) {
          return distance;
        }
      } catch (error) {
        // Fall back to Euclidean distance below.
      }
    }

    const pixelDistance = Math.hypot(Number(pointB?.x) - Number(pointA?.x), Number(pointB?.y) - Number(pointA?.y));
    const gridSize = ScWallGeometry.#gridSize(scene);
    const gridDistance = Number(scene?.grid?.distance ?? canvas?.grid?.distance ?? 5) || 5;
    return pixelDistance / gridSize * gridDistance;
  }

  static #distanceToPixels(distance, scene) {
    const gridSize = ScWallGeometry.#gridSize(scene);
    const gridDistance = Number(scene?.grid?.distance ?? canvas?.grid?.distance ?? 5) || 5;
    return (Number(distance) || 0) * (gridSize / gridDistance);
  }

  static #gridSize(scene) {
    return Number(scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
  }

  static #wallMovementValue(blocksMovement) {
    const types = globalThis.CONST?.WALL_MOVEMENT_TYPES;
    return blocksMovement ? (types?.NORMAL ?? 20) : (types?.NONE ?? 0);
  }

  static #wallSenseValue(blocksSense) {
    const types = globalThis.CONST?.WALL_SENSE_TYPES;
    return blocksSense ? (types?.NORMAL ?? 20) : (types?.NONE ?? 0);
  }
}
