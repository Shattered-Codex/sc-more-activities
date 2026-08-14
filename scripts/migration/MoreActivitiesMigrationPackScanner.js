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

  /**
   * @returns {Promise<{unlocked: string[], failed: Array<{packId: string, label: string, reason: string}>}>}
   */
  static async unlockPacks(packIds = []) {
    const unlocked = [];
    const failed = [];
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
        // configure() can apply the state change and still reject, e.g. from a
        // downstream hook. The pack is editable either way, so it has to reach
        // the relock list or the migration would leave it unlocked.
        if (pack.locked === false) {
          unlocked.push(packId);
          Logger.warn(`Compendium "${packId}" was unlocked but its configure call failed; it will still be re-locked.`, error);
          continue;
        }

        Logger.error(`Failed to unlock compendium "${packId}".`, error);
        failed.push(MoreActivitiesMigrationPackScanner.#lockFailure(pack, packId, error));
      }
    }
    return { unlocked, failed };
  }

  /**
   * Re-locks packs unlocked for a migration. Failures are returned instead of
   * swallowed: a pack left editable is world state the GM has to fix by hand.
   *
   * @returns {Promise<{relocked: string[], failed: Array<{packId: string, label: string, reason: string}>}>}
   */
  static async relockPacks(packIds = []) {
    const relocked = [];
    const failed = [];
    for (const packId of packIds) {
      const pack = game?.packs?.get?.(packId);
      if (!pack) {
        Logger.error(`Compendium "${packId}" is gone and could not be re-locked after migration.`);
        failed.push(MoreActivitiesMigrationPackScanner.#lockFailure(null, packId, "pack-not-found"));
        continue;
      }
      if (pack.locked === true) {
        continue;
      }

      try {
        await pack.configure({ locked: true });
        relocked.push(packId);
        Logger.debug(`Re-locked compendium "${packId}" after migration.`);
      } catch (error) {
        // Symmetric with unlockPacks: configure() can apply the lock and still
        // reject. Reporting a re-locked pack as still editable would raise a
        // permanent notification about a problem that does not exist.
        if (pack.locked === true) {
          relocked.push(packId);
          Logger.warn(`Compendium "${packId}" was re-locked but its configure call failed.`, error);
          continue;
        }

        Logger.error(`Failed to re-lock compendium "${packId}".`, error);
        failed.push(MoreActivitiesMigrationPackScanner.#lockFailure(pack, packId, error));
      }
    }
    return { relocked, failed };
  }

  static #lockFailure(pack, packId, error) {
    return {
      packId,
      label: pack?.title ?? pack?.metadata?.label ?? packId,
      reason: error?.message ?? String(error)
    };
  }
}
