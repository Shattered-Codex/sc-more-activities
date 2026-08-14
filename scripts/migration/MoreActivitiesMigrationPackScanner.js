import { Logger } from "../support/Logger.js";

export class MoreActivitiesMigrationPackScanner {
  static SUPPORTED_DOCUMENT_NAMES = Object.freeze(["Item", "Actor"]);

  static collectPacks({ includeExternalPacks = false } = {}) {
    const packs = [];
    const skippedExternalPacks = [];

    for (const pack of game?.packs ?? []) {
      if (!MoreActivitiesMigrationPackScanner.SUPPORTED_DOCUMENT_NAMES.includes(pack?.documentName)) {
        continue;
      }

      if (!MoreActivitiesMigrationPackScanner.isWorldPack(pack) && !includeExternalPacks) {
        skippedExternalPacks.push(MoreActivitiesMigrationPackScanner.describe(pack));
        continue;
      }

      packs.push(pack);
    }

    return { packs, skippedExternalPacks };
  }

  static isWorldPack(pack) {
    const packageType = pack?.metadata?.packageType;
    if (packageType) {
      return packageType === "world";
    }
    return String(pack?.collection ?? "").startsWith("world.");
  }

  static describe(pack) {
    return Object.freeze({
      id: pack?.collection ?? pack?.metadata?.id ?? null,
      label: pack?.title ?? pack?.metadata?.label ?? pack?.collection ?? "",
      documentName: pack?.documentName ?? null,
      locked: pack?.locked === true,
      world: MoreActivitiesMigrationPackScanner.isWorldPack(pack)
    });
  }

  static async loadPackItems(pack) {
    const documents = await pack.getDocuments();
    if (pack?.documentName === "Actor") {
      return documents.flatMap((actor) => (actor?.items?.contents ?? []).map((item) => ({ item, actor })));
    }
    return documents.map((item) => ({ item, actor: null }));
  }

  static async unlockPacks(packIds = []) {
    const unlocked = [];
    for (const packId of packIds) {
      const pack = game?.packs?.get?.(packId);
      if (!pack || pack.locked !== true) {
        continue;
      }

      try {
        await pack.configure({ locked: false });
        unlocked.push(packId);
        Logger.debug(`Unlocked compendium "${packId}" for migration.`);
      } catch (error) {
        Logger.error(`Failed to unlock compendium "${packId}".`, error);
      }
    }
    return unlocked;
  }

  static async relockPacks(packIds = []) {
    for (const packId of packIds) {
      const pack = game?.packs?.get?.(packId);
      if (!pack || pack.locked === true) {
        continue;
      }

      try {
        await pack.configure({ locked: true });
        Logger.debug(`Re-locked compendium "${packId}" after migration.`);
      } catch (error) {
        Logger.error(`Failed to re-lock compendium "${packId}".`, error);
      }
    }
  }
}
