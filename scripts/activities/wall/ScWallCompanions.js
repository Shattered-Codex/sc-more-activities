import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

const COMPANION_SOURCE = "sc-wall-companion";
// Two segment ends closer than this are treated as the same point, which keeps
// the floating point seam of a circular wall from splitting its outline.
const JOIN_TOLERANCE = 0.5;

/**
 * Visible companions for activity walls: a colored line Drawing and image
 * Tiles. The style lives in each wall's flags, and the companions of a wall
 * group are always rebuilt from the walls that currently exist. Deleting part
 * of a wall, moving it, or undoing its deletion therefore redraws the visuals
 * to match what still blocks.
 */
export class ScWallCompanions {
  static #hooksRegistered = false;
  static #scheduled = new Map();
  static #queue = Promise.resolve();

  static registerHooks() {
    if (ScWallCompanions.#hooksRegistered || typeof Hooks?.on !== "function") {
      return;
    }
    ScWallCompanions.#hooksRegistered = true;

    Hooks.on("createWall", (wall, _options, userId) => {
      ScWallCompanions.#onWallChanged(wall, userId, { created: true });
    });
    Hooks.on("updateWall", (wall, changes, _options, userId) => {
      if (changes && "c" in changes) {
        ScWallCompanions.#onWallChanged(wall, userId);
      }
    });
    Hooks.on("deleteWall", (wall, _options, userId) => {
      ScWallCompanions.#onWallChanged(wall, userId);
    });
  }

  /** Writes the visual style into the wall data before the walls are created. */
  static decorate(walls, config, scene) {
    const line = ["all", "gm"].includes(config?.lineVisibility)
      ? {
        color: config.lineColor,
        hidden: config.lineVisibility === "gm",
        width: Math.max(1, Math.round(Number(config.lineWidth) || 0))
      }
      : null;
    const src = String(config?.tileImage ?? "").trim();
    const tile = src
      ? {
        src,
        ring: config.wallType === "circular",
        thickness: Math.max(1, ScWallCompanions.#distanceToPixels(config.tileThickness, scene)),
        extension: Math.max(0, ScWallCompanions.#distanceToPixels(config.tileExtension, scene))
      }
      : null;
    if ((!line && !tile) || !Array.isArray(walls)) {
      return;
    }

    const group = ScWallCompanions.#newGroup();
    walls.forEach((wall, index) => {
      wall.flags ??= {};
      wall.flags[Constants.MODULE_ID] ??= {};
      wall.flags[Constants.MODULE_ID].visual = { group, index, line, tile };
    });
  }

  /** Builds the Drawing and Tile data that represent the given walls of one group. */
  static build(walls) {
    const groupWalls = (Array.isArray(walls) ? walls : [])
      .filter((wall) => wall?.id && Array.isArray(wall?.c) && wall.c.length === 4
        && ScWallCompanions.#visual(wall))
      .sort((a, b) => ScWallCompanions.#visual(a).index - ScWallCompanions.#visual(b).index);
    if (!groupWalls.length) {
      return { drawings: [], tiles: [] };
    }

    const { group, line, tile } = ScWallCompanions.#visual(groupWalls[0]);
    const activityUuid = groupWalls[0].flags?.[Constants.MODULE_ID]?.activityUuid ?? null;
    const flags = (pathWalls) => ({
      [Constants.MODULE_ID]: {
        activityUuid,
        group,
        source: COMPANION_SOURCE,
        wallIds: pathWalls.map((wall) => wall.id)
      }
    });

    const drawings = [];
    const tiles = [];
    for (const path of ScWallCompanions.paths(groupWalls)) {
      if (line) {
        drawings.push({ ...ScWallCompanions.#lineData(path, line), flags: flags(path.walls) });
      }
      if (!tile) {
        continue;
      }
      if (tile.ring && path.closed) {
        // One ring image reads far better than dozens of short rotated strips.
        // A broken ring has no circle left to cover, so it falls back to strips.
        tiles.push({ ...ScWallCompanions.#ringData(path, tile), flags: flags(path.walls) });
        continue;
      }
      for (const wall of path.walls) {
        tiles.push({ ...ScWallCompanions.#stripData(wall, tile), flags: flags([wall]) });
      }
    }
    return { drawings, tiles };
  }

  /** Chains consecutive walls that share an endpoint into one polyline. */
  static paths(walls) {
    const paths = [];
    let current = null;
    for (const wall of walls) {
      const [x1, y1, x2, y2] = wall.c.map(Number);
      const last = current?.points.at(-1);
      if (last && Math.hypot(last.x - x1, last.y - y1) <= JOIN_TOLERANCE) {
        current.points.push({ x: x2, y: y2 });
        current.walls.push(wall);
        continue;
      }
      current = { points: [{ x: x1, y: y1 }, { x: x2, y: y2 }], walls: [wall], closed: false };
      paths.push(current);
    }

    for (const path of paths) {
      const first = path.points[0];
      const last = path.points.at(-1);
      if (path.points.length > 2 && Math.hypot(last.x - first.x, last.y - first.y) <= JOIN_TOLERANCE) {
        // Matching the first point exactly is what makes Foundry close the outline.
        path.points[path.points.length - 1] = { ...first };
        path.closed = true;
      }
    }
    return paths;
  }

  static #lineData(path, line) {
    const xs = path.points.map((point) => point.x);
    const ys = path.points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
      x,
      y,
      shape: {
        type: "p",
        width: Math.ceil(Math.max(...xs) - x),
        height: Math.ceil(Math.max(...ys) - y),
        points: path.points.flatMap((point) => [point.x - x, point.y - y])
      },
      fillType: globalThis.CONST?.DRAWING_FILL_TYPES?.NONE ?? 0,
      strokeColor: line.color,
      strokeWidth: line.width,
      strokeAlpha: 1,
      bezierFactor: 0,
      hidden: line.hidden === true,
      locked: true
    };
  }

  static #ringData(path, tile) {
    const xs = path.points.map((point) => point.x);
    const ys = path.points.map((point) => point.y);
    const x = Math.min(...xs) - (tile.thickness / 2);
    const y = Math.min(...ys) - (tile.thickness / 2);
    return ScWallCompanions.#tileData(tile, {
      x,
      y,
      width: Math.max(...xs) + (tile.thickness / 2) - x,
      height: Math.max(...ys) + (tile.thickness / 2) - y,
      rotation: 0
    });
  }

  static #stripData(wall, tile) {
    const [x1, y1, x2, y2] = wall.c.map(Number);
    // Images usually carry transparent margins, so the extension lets each one
    // reach past its segment ends and overlap its neighbours.
    const length = Math.hypot(x2 - x1, y2 - y1) + (Number(tile.extension) || 0);
    // Tiles rotate around their center, so the unrotated box is laid out
    // centered on the segment midpoint.
    return ScWallCompanions.#tileData(tile, {
      x: ((x1 + x2) / 2) - (length / 2),
      y: ((y1 + y2) / 2) - (tile.thickness / 2),
      width: length,
      height: tile.thickness,
      rotation: (((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI) + 360) % 360
    });
  }

  static #tileData(tile, { x, y, width, height, rotation }) {
    return {
      texture: { src: tile.src },
      x: Math.round(x),
      y: Math.round(y),
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      rotation,
      locked: true
    };
  }

  static #onWallChanged(wall, userId, { created = false } = {}) {
    // Every client sees the hook; only the user who changed the wall redraws,
    // and that user was allowed to change scene documents in the first place.
    const group = ScWallCompanions.#visual(wall)?.group;
    const scene = wall?.parent;
    if (userId !== game?.user?.id || !group || !scene) {
      return;
    }

    // A batch create or delete fires one hook per wall, all in the same tick,
    // so the scene is handled once after the last of them.
    let batch = ScWallCompanions.#scheduled.get(scene.id);
    if (!batch) {
      batch = { scene, groups: new Set(), createdIds: new Set() };
      ScWallCompanions.#scheduled.set(scene.id, batch);
      queueMicrotask(() => {
        ScWallCompanions.#scheduled.delete(scene.id);
        // Batches run one at a time so two redraws never race on the same group.
        ScWallCompanions.#queue = ScWallCompanions.#queue
          .then(() => ScWallCompanions.#processBatch(batch))
          .catch((error) => Logger.warn("Could not update the wall visuals.", error));
      });
    }
    batch.groups.add(group);
    if (created) {
      batch.createdIds.add(wall.id);
    }
  }

  static async #processBatch({ scene, groups, createdIds }) {
    for (const group of await ScWallCompanions.#regroupCopies(scene, createdIds)) {
      groups.add(group);
    }
    for (const group of groups) {
      await ScWallCompanions.#sync(scene, group);
    }
  }

  /**
   * A pasted wall keeps the group and index of the wall it was copied from,
   * so it would be drawn as part of the original. When any new wall of a
   * group lands on a slot another wall already holds, the batch is a copy,
   * and every new wall from that group moves to one new group together so
   * the pasted shape stays whole even where the original has gaps. An undone
   * deletion brings walls back under their own ids into free slots, so they
   * rejoin their original group.
   */
  static async #regroupCopies(scene, createdIds) {
    if (!createdIds.size) {
      return [];
    }

    const walls = ScWallCompanions.#documents(scene.walls);
    const created = walls.filter((wall) => createdIds.has(wall.id));
    const heldSlots = new Set(walls
      .filter((wall) => !createdIds.has(wall.id))
      .map((wall) => ScWallCompanions.#slot(wall))
      .filter(Boolean));
    const newGroups = new Map();
    for (const wall of created) {
      const sourceGroup = ScWallCompanions.#visual(wall)?.group;
      if (sourceGroup && heldSlots.has(ScWallCompanions.#slot(wall)) && !newGroups.has(sourceGroup)) {
        newGroups.set(sourceGroup, ScWallCompanions.#newGroup());
      }
    }

    const updates = created
      .filter((wall) => newGroups.has(ScWallCompanions.#visual(wall)?.group))
      .map((wall) => ({
        _id: wall.id,
        [`flags.${Constants.MODULE_ID}.visual.group`]: newGroups.get(ScWallCompanions.#visual(wall).group)
      }));
    if (updates.length) {
      // Bookkeeping only: undoing the paste should remove the walls, not this.
      await scene.updateEmbeddedDocuments("Wall", updates, { isUndo: true });
    }
    return [...newGroups.values()];
  }

  static #slot(wall) {
    const visual = ScWallCompanions.#visual(wall);
    return visual ? `${visual.group}:${visual.index}` : null;
  }

  static #newGroup() {
    return globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2, 18);
  }

  static async #sync(scene, group) {
    const walls = ScWallCompanions.#documents(scene.walls)
      .filter((wall) => ScWallCompanions.#visual(wall)?.group === group);
    const { drawings, tiles } = ScWallCompanions.build(walls);

    // isUndo keeps these bookkeeping changes out of the Drawing and Tile undo history.
    for (const [documentName, collection, data] of [
      ["Drawing", scene.drawings, drawings],
      ["Tile", scene.tiles, tiles]
    ]) {
      const staleIds = ScWallCompanions.#documents(collection)
        .filter((document) => {
          const flags = document.flags?.[Constants.MODULE_ID];
          return flags?.source === COMPANION_SOURCE && flags.group === group;
        })
        .map((document) => document.id);
      if (staleIds.length) {
        await scene.deleteEmbeddedDocuments(documentName, staleIds, { isUndo: true });
      }
      if (data.length) {
        await scene.createEmbeddedDocuments(documentName, data, { isUndo: true });
      }
    }
  }

  static #visual(wall) {
    const visual = wall?.flags?.[Constants.MODULE_ID]?.visual;
    return visual?.group ? visual : null;
  }

  static #documents(collection) {
    return (collection?.contents ?? Array.from(collection?.values?.() ?? collection ?? []))
      .map((entry) => (Array.isArray(entry) ? entry[1] : entry))
      .filter(Boolean);
  }

  static #distanceToPixels(distance, scene) {
    const gridSize = Number(scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100;
    const gridDistance = Number(scene?.grid?.distance ?? canvas?.grid?.distance ?? 5) || 5;
    return (Number(distance) || 0) * (gridSize / gridDistance);
  }
}
