import test from "node:test";
import assert from "node:assert/strict";

const hookHandlers = new Map();
globalThis.Hooks = {
  on(name, handler) {
    hookHandlers.set(name, handler);
  }
};
globalThis.game = { user: { id: "gm-1" } };

const { ScWallCompanions } = await import("../../scripts/activities/wall/ScWallCompanions.js");
ScWallCompanions.registerHooks();

const SCENE = { id: "scene-1", grid: { size: 100, distance: 5 } };
const CONFIG = {
  wallType: "continuous",
  lineVisibility: "all",
  lineColor: "#ff0000",
  lineWidth: 6,
  tileImage: "",
  tileThickness: 5
};

/** Wall documents as Foundry would hold them after a decorated creation. */
function decoratedWalls(coordinates, config = CONFIG) {
  const walls = coordinates.map((c) => ({
    c,
    flags: { "sc-more-activities": { activityUuid: "Activity.a", source: "sc-wall" } }
  }));
  ScWallCompanions.decorate(walls, config, SCENE);
  return walls.map((wall, index) => ({ ...wall, id: `w${index + 1}` }));
}

const CIRCLE = [[100, 0, 0, 100], [0, 100, -100, 0], [-100, 0, 0, -100], [0, -100, 100, -0.0000001]];

function geometry(tile) {
  return { x: tile.x, y: tile.y, width: tile.width, height: tile.height, rotation: tile.rotation };
}

test("leaves walls undecorated for activities without appearance settings", () => {
  const walls = [{ c: [0, 0, 100, 0], flags: { "sc-more-activities": { source: "sc-wall" } } }];
  ScWallCompanions.decorate(walls, { ...CONFIG, lineVisibility: "none" }, SCENE);
  assert.deepEqual(walls[0].flags["sc-more-activities"], { source: "sc-wall" });
});

test("draws one open polyline over a continuous wall", () => {
  const walls = decoratedWalls([[100, 100, 300, 100], [300, 100, 300, 400]]);
  const { drawings, tiles } = ScWallCompanions.build(walls);

  assert.equal(tiles.length, 0);
  assert.equal(drawings.length, 1);
  assert.equal(drawings[0].x, 100);
  assert.equal(drawings[0].y, 100);
  assert.deepEqual(drawings[0].shape, { type: "p", width: 200, height: 300, points: [0, 0, 200, 0, 200, 300] });
  assert.equal(drawings[0].strokeColor, "#ff0000");
  assert.equal(drawings[0].hidden, false);
  assert.deepEqual(drawings[0].flags["sc-more-activities"], {
    activityUuid: "Activity.a",
    group: walls[0].flags["sc-more-activities"].visual.group,
    source: "sc-wall-companion",
    wallIds: ["w1", "w2"]
  });
});

test("orders segments by their creation index, not by collection order", () => {
  // An undone deletion puts the restored wall at the end of the collection.
  const [first, second, third] = decoratedWalls([[0, 0, 100, 0], [100, 0, 200, 0], [200, 0, 300, 0]]);
  const { drawings } = ScWallCompanions.build([first, third, second]);
  assert.equal(drawings.length, 1);
  assert.deepEqual(drawings[0].shape.points, [0, 0, 100, 0, 200, 0, 300, 0]);
});

test("hides the line from players when it is GM only", () => {
  const { drawings } = ScWallCompanions.build(decoratedWalls([[0, 0, 100, 0]], { ...CONFIG, lineVisibility: "gm" }));
  assert.equal(drawings[0].hidden, true);
});

test("closes the outline of a circular wall despite the floating point seam", () => {
  const [path] = ScWallCompanions.paths(decoratedWalls(CIRCLE));
  assert.equal(path.closed, true);
  assert.deepEqual(path.points.at(-1), path.points[0]);
});

test("keeps separate panels as separate lines", () => {
  const { drawings } = ScWallCompanions.build(decoratedWalls([[0, 0, 100, 0], [150, 0, 250, 0]]));
  assert.equal(drawings.length, 2);
});

test("lays one rotated tile along each wall segment", () => {
  const walls = decoratedWalls([[0, 0, 200, 0], [200, 0, 200, 200]], {
    ...CONFIG,
    lineVisibility: "none",
    tileImage: "stone.webp"
  });
  const { drawings, tiles: [horizontal, vertical] } = ScWallCompanions.build(walls);

  assert.equal(drawings.length, 0);
  assert.deepEqual(geometry(horizontal), { x: 0, y: -50, width: 200, height: 100, rotation: 0 });
  // Rotated around its center, this box covers the vertical segment.
  assert.deepEqual(geometry(vertical), { x: 100, y: 50, width: 200, height: 100, rotation: 90 });
  assert.equal(horizontal.texture.src, "stone.webp");
  assert.deepEqual(vertical.flags["sc-more-activities"].wallIds, ["w2"]);
});

test("covers a whole circular wall with a single tile", () => {
  const walls = decoratedWalls(CIRCLE, { ...CONFIG, wallType: "circular", tileImage: "ring.webm" });
  const { tiles } = ScWallCompanions.build(walls);

  assert.equal(tiles.length, 1);
  assert.deepEqual(geometry(tiles[0]), { x: -150, y: -150, width: 300, height: 300, rotation: 0 });
  assert.deepEqual(tiles[0].flags["sc-more-activities"].wallIds, ["w1", "w2", "w3", "w4"]);
});

test("falls back to strips once a circular wall is broken", () => {
  const walls = decoratedWalls(CIRCLE, { ...CONFIG, wallType: "circular", tileImage: "ring.webm" });
  const { tiles } = ScWallCompanions.build(walls.filter((wall) => wall.id !== "w2"));
  assert.equal(tiles.length, 3);
  assert.deepEqual(tiles.map((tile) => tile.flags["sc-more-activities"].wallIds), [["w1"], ["w3"], ["w4"]]);
});

/** A scene that applies document operations the way core does, firing the wall hooks. */
function fakeScene(walls) {
  const operations = [];
  const collections = { Wall: new Map(), Drawing: new Map(), Tile: new Map() };
  let nextId = 1;
  const scene = {
    ...SCENE,
    walls: collections.Wall,
    drawings: collections.Drawing,
    tiles: collections.Tile,
    async createEmbeddedDocuments(documentName, documents, options = {}) {
      operations.push({ action: "create", documentName, count: documents.length, options });
      const created = documents.map((data) => {
        const id = options.keepId && data.id ? data.id : `${documentName}-${nextId++}`;
        const document = { ...structuredClone(data), id, parent: scene };
        collections[documentName].set(id, document);
        return document;
      });
      if (documentName === "Wall") {
        created.forEach((document) => hookHandlers.get("createWall")(document, options, "gm-1"));
      }
      return created;
    },
    async deleteEmbeddedDocuments(documentName, ids, options = {}) {
      operations.push({ action: "delete", documentName, ids, options });
      const removed = ids.map((id) => collections[documentName].get(id)).filter(Boolean);
      // Core empties the collection before any delete hook runs.
      removed.forEach((document) => collections[documentName].delete(document.id));
      if (documentName === "Wall") {
        removed.forEach((document) => hookHandlers.get("deleteWall")(document, options, "gm-1"));
      }
      return removed;
    },
    async updateEmbeddedDocuments(documentName, updates, options = {}) {
      operations.push({ action: "update", documentName, count: updates.length, options });
      return updates.map(({ _id, ...changes }) => {
        const document = collections[documentName].get(_id);
        for (const [path, value] of Object.entries(changes)) {
          const keys = path.split(".");
          const target = keys.slice(0, -1).reduce((node, key) => node[key], document);
          target[keys.at(-1)] = value;
        }
        if (documentName === "Wall") {
          hookHandlers.get("updateWall")(document, changes, options, "gm-1");
        }
        return document;
      });
    }
  };
  return { scene, operations, walls };
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function lineIds(scene) {
  return [...scene.drawings.values()].map((drawing) => drawing.flags["sc-more-activities"].wallIds);
}

async function createWalls(config, coordinates) {
  const data = coordinates.map((c) => ({ c, flags: { "sc-more-activities": { source: "sc-wall" } } }));
  ScWallCompanions.decorate(data, config, SCENE);
  const fixture = fakeScene();
  const walls = await fixture.scene.createEmbeddedDocuments("Wall", data, { isUndo: true });
  await settle();
  return { ...fixture, walls };
}

const LINE = [[0, 0, 100, 0], [100, 0, 200, 0], [200, 0, 300, 0]];

test("draws the visuals once for a whole batch of new walls", async() => {
  const { scene, operations } = await createWalls({ ...CONFIG, tileImage: "stone.webp" }, LINE);

  assert.deepEqual(lineIds(scene), [["Wall-1", "Wall-2", "Wall-3"]]);
  assert.equal(scene.tiles.size, 3);
  const companionOperations = operations.filter((operation) => operation.documentName !== "Wall");
  assert.deepEqual(companionOperations.map((operation) => [operation.action, operation.documentName]), [
    ["create", "Drawing"],
    ["create", "Tile"]
  ]);
  // Kept out of the Drawing and Tile undo history.
  assert.ok(companionOperations.every((operation) => operation.options.isUndo === true));
});

test("splits the line around a destroyed middle segment", async() => {
  const { scene, walls } = await createWalls({ ...CONFIG, tileImage: "stone.webp" }, LINE);

  await scene.deleteEmbeddedDocuments("Wall", [walls[1].id]);
  await settle();

  assert.deepEqual(lineIds(scene), [["Wall-1"], ["Wall-3"]]);
  assert.deepEqual([...scene.tiles.values()].map((tile) => tile.flags["sc-more-activities"].wallIds), [
    ["Wall-1"],
    ["Wall-3"]
  ]);
});

test("removes every visual once the whole wall is deleted", async() => {
  const { scene, walls } = await createWalls({ ...CONFIG, tileImage: "stone.webp" }, LINE);

  await scene.deleteEmbeddedDocuments("Wall", walls.map((wall) => wall.id));
  await settle();

  assert.equal(scene.drawings.size, 0);
  assert.equal(scene.tiles.size, 0);
});

test("brings the visuals back when the deletion is undone", async() => {
  const { scene, walls } = await createWalls({ ...CONFIG, tileImage: "stone.webp" }, LINE);
  const deleted = walls.slice(1).map((wall) => structuredClone({ ...wall, parent: undefined }));

  await scene.deleteEmbeddedDocuments("Wall", deleted.map((wall) => wall.id));
  await settle();
  assert.deepEqual(lineIds(scene), [["Wall-1"]]);

  // What core's undo does: recreate the deleted data under the same ids.
  await scene.createEmbeddedDocuments("Wall", deleted, { isUndo: true, keepId: true });
  await settle();

  assert.deepEqual(lineIds(scene), [["Wall-1", "Wall-2", "Wall-3"]]);
  assert.equal(scene.tiles.size, 3);
});

test("redraws the visuals when a wall is moved", async() => {
  const { scene, walls } = await createWalls(CONFIG, [[0, 0, 100, 0]]);

  walls[0].c = [0, 0, 0, 100];
  hookHandlers.get("updateWall")(walls[0], { c: walls[0].c }, {}, "gm-1");
  await settle();

  assert.deepEqual([...scene.drawings.values()][0].shape, { type: "p", width: 0, height: 100, points: [0, 0, 0, 100] });
});

test("leaves the redraw to the user who changed the wall", async() => {
  const { scene, walls } = await createWalls(CONFIG, LINE);

  scene.walls.delete(walls[0].id);
  hookHandlers.get("deleteWall")(walls[0], {}, "other-user");
  await settle();

  assert.deepEqual(lineIds(scene), [["Wall-1", "Wall-2", "Wall-3"]]);
});

test("ignores walls without visual settings", async() => {
  const { scene } = fakeScene();
  await scene.createEmbeddedDocuments("Wall", [{ c: [0, 0, 100, 0], flags: {} }]);
  await settle();
  assert.equal(scene.drawings.size, 0);
});

/** What core's paste does: copy the source data, offset it, create without options. */
function pastedCopy(walls, offset) {
  return walls.map(({ id, parent, ...data }) => {
    const copy = structuredClone(data);
    copy.c = copy.c.map((value) => value + offset);
    return copy;
  });
}

function tileWallIds(scene) {
  return [...scene.tiles.values()].map((tile) => tile.flags["sc-more-activities"].wallIds);
}

test("gives pasted walls their own visual group and leaves the original intact", async() => {
  const { scene, walls, operations } = await createWalls(
    { ...CONFIG, lineVisibility: "none", wallType: "circular", tileImage: "ring.webm" },
    [[100, 0, 0, 100], [0, 100, -100, 0], [-100, 0, 0, -100], [0, -100, 100, 0]]
  );
  const originalGroup = walls[0].flags["sc-more-activities"].visual.group;

  const pasted = await scene.createEmbeddedDocuments("Wall", pastedCopy(walls, 1000));
  await settle();

  // Two whole rings, not eight strips.
  assert.deepEqual(tileWallIds(scene).sort(), [
    walls.map((wall) => wall.id),
    pasted.map((wall) => wall.id)
  ]);
  const pastedGroups = new Set(pasted.map((wall) => wall.flags["sc-more-activities"].visual.group));
  assert.equal(pastedGroups.size, 1);
  assert.ok(!pastedGroups.has(originalGroup));
  assert.deepEqual(pasted.map((wall) => wall.flags["sc-more-activities"].visual.index), [0, 1, 2, 3]);
  assert.ok(walls.every((wall) => wall.flags["sc-more-activities"].visual.group === originalGroup));
  // Regrouping must not become a step of its own in the wall undo history.
  assert.equal(operations.find((operation) => operation.action === "update").options.isUndo, true);
});

test("keeps the original group when an undo restores a wall", async() => {
  const { scene, walls, operations } = await createWalls(CONFIG, LINE);
  const restored = structuredClone({ ...walls[1], parent: undefined });

  await scene.deleteEmbeddedDocuments("Wall", [restored.id]);
  await scene.createEmbeddedDocuments("Wall", [restored], { isUndo: true, keepId: true });
  await settle();

  assert.equal(operations.some((operation) => operation.action === "update"), false);
  assert.deepEqual(lineIds(scene), [["Wall-1", "Wall-2", "Wall-3"]]);
});

test("moves a whole pasted circle to one group even where the original has a gap", async() => {
  const { scene, walls } = await createWalls(
    { ...CONFIG, lineVisibility: "none", wallType: "circular", tileImage: "ring.webm" },
    [[100, 0, 0, 100], [0, 100, -100, 0], [-100, 0, 0, -100], [0, -100, 100, 0]]
  );
  const copied = pastedCopy(walls, 1000);
  await scene.deleteEmbeddedDocuments("Wall", [walls[1].id]);
  await settle();

  const pasted = await scene.createEmbeddedDocuments("Wall", copied);
  await settle();

  // The copy of the deleted segment has a free slot but still belongs to the paste.
  const pastedGroups = new Set(pasted.map((wall) => wall.flags["sc-more-activities"].visual.group));
  assert.equal(pastedGroups.size, 1);
  const pastedIds = pasted.map((wall) => wall.id);
  const pastedTiles = tileWallIds(scene).filter((ids) => ids.some((id) => pastedIds.includes(id)));
  assert.deepEqual(pastedTiles, [pastedIds]);
  // The broken original is still drawn as strips for the three walls left.
  assert.equal(scene.tiles.size, 4);
});

test("extends each image past its segment so neighbouring panels overlap", async() => {
  const walls = decoratedWalls([[0, 0, 100, 0], [100, 0, 100, 100]], {
    ...CONFIG,
    lineVisibility: "none",
    tileImage: "beam.webm",
    tileExtension: 2
  });
  const { tiles: [horizontal, vertical] } = ScWallCompanions.build(walls);

  // 5 ft panel + 2 ft extension = 7 ft = 140 px, still centered on the segment.
  assert.deepEqual(geometry(horizontal), { x: -20, y: -50, width: 140, height: 100, rotation: 0 });
  assert.deepEqual(geometry(vertical), { x: 30, y: 0, width: 140, height: 100, rotation: 90 });
});
