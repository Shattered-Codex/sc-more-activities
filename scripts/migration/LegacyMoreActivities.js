export const LEGACY_MORE_ACTIVITIES_TYPES = Object.freeze([
  "macro",
  "hook",
  "contested",
  "chain",
  "teleport",
  "movement",
  "sound",
  "grant",
  "wall",
  "advancement"
]);

export const LEGACY_MORE_ACTIVITIES_TARGET_TYPES = Object.freeze({
  macro: "sc-macro",
  hook: "sc-hook",
  contested: "sc-contest",
  chain: "sc-chain",
  teleport: "sc-teleport",
  movement: "sc-movement",
  sound: "sc-sound",
  grant: "sc-grant",
  wall: "sc-wall",
  advancement: "sc-advancement"
});

/**
 * Fields a legacy More Activities teleport stores at the top level of its
 * activity source. The native dnd5e teleport never stores any of them.
 */
export const LEGACY_TELEPORT_SOURCE_KEYS = Object.freeze([
  "maxTargets",
  "targetSelf",
  "onlyTargetSelf",
  "targetRadius",
  "teleportDistance",
  "keepArrangement",
  "clusterRadius",
  "manualPlacement",
  "manualRadius",
  "autoApply",
  "appliedEffects"
]);

