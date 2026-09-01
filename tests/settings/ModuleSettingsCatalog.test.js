import test from "node:test";
import assert from "node:assert/strict";

const { ModuleSettingsCatalog, SETTING_FIELD_TYPES, SETTING_SCOPES } = await import(
  "../../scripts/settings/ModuleSettingsCatalog.js"
);
const { SETTINGS_KEYS } = await import("../../scripts/constants/SettingsKeys.js");

// `Constants.localize` reads the bare `game` global, so the catalog needs one
// to build labels. Each test file runs in its own process, so this cannot leak.
globalThis.game = { i18n: { localize: (key) => key, format: (key) => key } };

function readDefaults(key) {
  return ModuleSettingsCatalog.field(key)?.default;
}

test("every catalog field carries what both the registrar and the window need", () => {
  const fields = ModuleSettingsCatalog.fields();
  assert.ok(fields.length > 0);

  for (const field of fields) {
    assert.ok(field.key, "field is missing a settings key");
    assert.ok(Object.values(SETTING_FIELD_TYPES).includes(field.type), `${field.key} has an unknown type`);
    assert.ok(Object.values(SETTING_SCOPES).includes(field.scope), `${field.key} has an unknown scope`);
    assert.notEqual(field.default, undefined, `${field.key} has no default`);
    assert.ok(field.nameKey?.startsWith("SCMOREACTIVITIES."), `${field.key} has no localization key`);
    assert.ok(field.hintKey?.startsWith("SCMOREACTIVITIES."), `${field.key} has no hint key`);
  }
});

test("catalog keys are unique and are real settings keys", () => {
  const keys = ModuleSettingsCatalog.fields().map((field) => field.key);
  assert.equal(new Set(keys).size, keys.length, "a settings key is listed twice");

  const known = new Set(Object.values(SETTINGS_KEYS));
  for (const key of keys) {
    assert.ok(known.has(key), `${key} is not declared in SETTINGS_KEYS`);
  }
});

test("registrations keep every field out of the flat Foundry list", () => {
  for (const field of ModuleSettingsCatalog.fields()) {
    const registration = ModuleSettingsCatalog.registration(field);
    assert.equal(registration.config, false, `${field.key} would still show in the flat settings list`);
    assert.equal(registration.scope, field.scope);
    assert.equal(registration.default, field.default);
    // World settings are GM-only; a client setting must stay open to players.
    assert.equal(registration.restricted, field.scope === SETTING_SCOPES.WORLD, field.key);
  }
});

test("a number field registers its range and a boolean field does not", () => {
  const retention = ModuleSettingsCatalog.field(SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION);
  const retentionRegistration = ModuleSettingsCatalog.registration(retention);
  assert.equal(retentionRegistration.type, Number);
  assert.deepEqual(retentionRegistration.range, { min: 1, max: 10, step: 1 });

  const toggle = ModuleSettingsCatalog.field(SETTINGS_KEYS.ALLOW_PLAYER_TOKEN_MOVEMENT);
  const toggleRegistration = ModuleSettingsCatalog.registration(toggle);
  assert.equal(toggleRegistration.type, Boolean);
  assert.equal(toggleRegistration.range, undefined);
});

test("a player only sees the client section, a GM sees every section", () => {
  const playerSections = ModuleSettingsCatalog.visibleSections(false);
  const gmSections = ModuleSettingsCatalog.visibleSections(true);

  assert.ok(gmSections.length > playerSections.length);
  assert.ok(playerSections.every((section) => section.scope === SETTING_SCOPES.CLIENT));
  assert.ok(
    playerSections.flatMap((section) => section.fields).every((field) => field.scope === SETTING_SCOPES.CLIENT),
    "a world setting leaked into the player view"
  );
  assert.ok(gmSections.some((section) => section.scope === SETTING_SCOPES.WORLD));
});

test("the GM context reflects stored values, not the defaults", () => {
  const stored = {
    [SETTINGS_KEYS.ALLOW_PLAYER_TOKEN_MOVEMENT]: false,
    [SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION]: 7
  };
  const context = ModuleSettingsCatalog.buildContext({
    isGM: true,
    readSetting: (key) => (Object.hasOwn(stored, key) ? stored[key] : readDefaults(key))
  });

  const fields = context.sections.flatMap((section) => section.fields);
  const movement = fields.find((field) => field.key === SETTINGS_KEYS.ALLOW_PLAYER_TOKEN_MOVEMENT);
  const retention = fields.find((field) => field.key === SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION);

  assert.equal(context.isGM, true);
  assert.equal(context.playerNotice, "");
  assert.equal(movement.isCheckbox, true);
  assert.equal(movement.checked, false);
  assert.equal(retention.isNumber, true);
  assert.equal(retention.value, 7);
});

test("an unreadable setting falls back to the field default instead of blanking the control", () => {
  const context = ModuleSettingsCatalog.buildContext({ isGM: true, readSetting: () => undefined });
  const fields = context.sections.flatMap((section) => section.fields);

  for (const field of fields) {
    const descriptor = ModuleSettingsCatalog.field(field.key);
    const rendered = field.isCheckbox ? field.checked : field.value;
    assert.equal(rendered, descriptor.default, `${field.key} did not fall back to its default`);
  }
});

test("a player context carries the notice and drops world fields", () => {
  const context = ModuleSettingsCatalog.buildContext({ isGM: false, readSetting: readDefaults });
  const keys = context.sections.flatMap((section) => section.fields).map((field) => field.key);

  assert.equal(context.isGM, false);
  assert.ok(context.playerNotice.length > 0);
  assert.ok(keys.includes(SETTINGS_KEYS.DEBUG_LOGGING));
  assert.ok(!keys.includes(SETTINGS_KEYS.ALLOW_PLAYER_TOKEN_MOVEMENT));
});

test("checkbox values normalize from booleans and from form strings", () => {
  const field = ModuleSettingsCatalog.field(SETTINGS_KEYS.ALLOW_PLAYER_TOKEN_MOVEMENT);

  assert.equal(ModuleSettingsCatalog.normalize(field, true), true);
  assert.equal(ModuleSettingsCatalog.normalize(field, false), false);
  assert.equal(ModuleSettingsCatalog.normalize(field, "on"), true);
  assert.equal(ModuleSettingsCatalog.normalize(field, "true"), true);
  assert.equal(ModuleSettingsCatalog.normalize(field, ""), false);
  // A control that never rendered must not silently flip the stored value.
  assert.equal(ModuleSettingsCatalog.normalize(field, undefined), field.default);
});

test("a number outside the declared range is clamped, and garbage falls back", () => {
  const field = ModuleSettingsCatalog.field(SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION);

  assert.equal(ModuleSettingsCatalog.normalize(field, "5"), 5);
  assert.equal(ModuleSettingsCatalog.normalize(field, 0), 1);
  assert.equal(ModuleSettingsCatalog.normalize(field, 99), 10);
  assert.equal(ModuleSettingsCatalog.normalize(field, ""), field.default);
  assert.equal(ModuleSettingsCatalog.normalize(field, "abc"), field.default);
});

test("a GM save writes every submitted field, normalized", () => {
  const writes = ModuleSettingsCatalog.collectWrites({
    [SETTINGS_KEYS.ALLOW_PLAYER_TOKEN_MOVEMENT]: false,
    [SETTINGS_KEYS.CANVAS_RESULT_CARDS]: true,
    [SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION]: "42",
    [SETTINGS_KEYS.DEBUG_LOGGING]: true
  }, { isGM: true });

  const byKey = Object.fromEntries(writes.map(({ key, value }) => [key, value]));
  assert.equal(byKey[SETTINGS_KEYS.ALLOW_PLAYER_TOKEN_MOVEMENT], false);
  assert.equal(byKey[SETTINGS_KEYS.CANVAS_RESULT_CARDS], true);
  assert.equal(byKey[SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION], 10);
  assert.equal(byKey[SETTINGS_KEYS.DEBUG_LOGGING], true);
});

test("a player save never writes a world setting, even if the form claims one", () => {
  const writes = ModuleSettingsCatalog.collectWrites({
    [SETTINGS_KEYS.ALLOW_PLAYER_TOKEN_MOVEMENT]: true,
    [SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION]: "9",
    [SETTINGS_KEYS.DEBUG_LOGGING]: true
  }, { isGM: false });

  assert.deepEqual(writes, [{ key: SETTINGS_KEYS.DEBUG_LOGGING, value: true }]);
});

test("fields missing from the submission are left untouched", () => {
  const writes = ModuleSettingsCatalog.collectWrites({
    [SETTINGS_KEYS.DEBUG_LOGGING]: true
  }, { isGM: true });

  assert.deepEqual(writes, [{ key: SETTINGS_KEYS.DEBUG_LOGGING, value: true }]);
});

test("the rail lists one tab per visible section, with the active one flagged", () => {
  const context = ModuleSettingsCatalog.buildContext({
    isGM: true,
    readSetting: readDefaults,
    activeTab: "migration"
  });

  assert.deepEqual(context.tabs.map((tab) => tab.id), ["gameplay", "migration", "diagnostics"]);
  assert.deepEqual(context.tabs.filter((tab) => tab.active).map((tab) => tab.id), ["migration"]);
  assert.deepEqual(context.sections.filter((section) => section.active).map((section) => section.id), ["migration"]);
  assert.ok(context.tabs.every((tab) => tab.icon && tab.label));
});

test("an unknown or GM-only tab falls back to the first tab the user can open", () => {
  assert.equal(ModuleSettingsCatalog.resolveTab("nope", true), "gameplay");
  assert.equal(ModuleSettingsCatalog.resolveTab(null, true), "gameplay");
  assert.equal(ModuleSettingsCatalog.resolveTab("migration", true), "migration");
  // A player cannot land on a world tab, so the window is never blank.
  assert.equal(ModuleSettingsCatalog.resolveTab("migration", false), "diagnostics");
});

test("a player's rail holds only the client tab", () => {
  const context = ModuleSettingsCatalog.buildContext({ isGM: false, readSetting: readDefaults });

  assert.deepEqual(context.tabs.map((tab) => tab.id), ["diagnostics"]);
  assert.equal(context.activeTab, "diagnostics");
  assert.equal(context.sections[0].active, true);
});

test("controls carry their defaults so a reset needs no re-render", () => {
  const context = ModuleSettingsCatalog.buildContext({ isGM: true, readSetting: () => undefined });
  const fields = context.sections.flatMap((section) => section.fields);

  const movement = fields.find((field) => field.key === SETTINGS_KEYS.ALLOW_PLAYER_TOKEN_MOVEMENT);
  const external = fields.find((field) => field.key === SETTINGS_KEYS.MIGRATION_INCLUDE_EXTERNAL_PACKS);
  const retention = fields.find((field) => field.key === SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION);

  assert.equal(movement.defaultChecked, "true");
  assert.equal(external.defaultChecked, "false");
  assert.equal(retention.defaultValue, "3");
});

test("a tab snapshot changes only when one of that tab's own fields changes", () => {
  const values = {
    [SETTINGS_KEYS.ALLOW_PLAYER_TOKEN_MOVEMENT]: true,
    [SETTINGS_KEYS.CANVAS_RESULT_CARDS]: true,
    [SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION]: "3",
    [SETTINGS_KEYS.DEBUG_LOGGING]: false
  };
  const baseline = {
    gameplay: ModuleSettingsCatalog.snapshot("gameplay", values),
    migration: ModuleSettingsCatalog.snapshot("migration", values),
    diagnostics: ModuleSettingsCatalog.snapshot("diagnostics", values)
  };

  const edited = { ...values, [SETTINGS_KEYS.CANVAS_RESULT_CARDS]: false };
  assert.notEqual(ModuleSettingsCatalog.snapshot("gameplay", edited), baseline.gameplay);
  // Editing one tab must not light up the dirty dot on the others.
  assert.equal(ModuleSettingsCatalog.snapshot("migration", edited), baseline.migration);
  assert.equal(ModuleSettingsCatalog.snapshot("diagnostics", edited), baseline.diagnostics);
});

test("a snapshot compares normalized values, so a clamped edit is not dirty", () => {
  const stored = { [SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION]: 10 };
  const typedTooHigh = { [SETTINGS_KEYS.MIGRATION_BACKUP_RETENTION]: "99" };

  assert.equal(
    ModuleSettingsCatalog.snapshot("migration", typedTooHigh),
    ModuleSettingsCatalog.snapshot("migration", stored)
  );
});

test("an unknown section snapshots to an empty string instead of throwing", () => {
  assert.equal(ModuleSettingsCatalog.snapshot("nope", {}), "");
});
