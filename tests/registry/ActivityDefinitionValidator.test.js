import test from "node:test";
import assert from "node:assert/strict";

import { ActivityDefinitionValidator } from "../../scripts/registry/ActivityDefinitionValidator.js";

test("reserves dnd5e 6's native teleport type even when CONFIG is unavailable", () => {
  assert.ok(ActivityDefinitionValidator.nativeTypes().includes("teleport"));
});
