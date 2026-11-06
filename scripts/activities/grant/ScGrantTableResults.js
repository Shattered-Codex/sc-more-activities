/**
 * How a grant reads roll tables, shared by the draw (ScGrantActivityService)
 * and the sheet's validation, so the sheet flags exactly what a draw would
 * ignore.
 *
 * A result stands for Items, for inner Roll Tables (drawn in turn, so a table
 * can pick a category and its inner table the item), or for nothing a grant
 * can use. It names them as a document result, or else as `@UUID[...]` links
 * in its text. Tables nest up to `MAX_DEPTH` levels, the grant's own table
 * being the first.
 */
export class ScGrantTableResults {
  static MAX_DEPTH = 3;

  /** Problems that stop results from granting anything, and those that only may. */
  static LEVELS = Object.freeze({ ERROR: "error", WARNING: "warning" });

  static CODES = Object.freeze({
    EMPTY: "empty",
    EXHAUSTED: "exhausted",
    NOT_ITEM: "not-item",
    MISSING: "missing",
    TOO_DEEP: "too-deep",
    CYCLE: "cycle"
  });

  /**
   * What a drawn result stands for: `{ items, tables, missing }`, the Items
   * and Roll Tables it names (each once) and the UUIDs it names that resolve
   * to nothing. A document result that names an Item or a Roll Table stands
   * for that document alone; any other result, including one whose document
   * was deleted, is read through its text links.
   *
   * @param {object} result
   * @param {(uuid: string, relative: object) => Promise<object|null>} resolve
   */
  static async classify(result, resolve) {
    const missing = [];
    const uuid = ScGrantTableResults.documentUuid(result);
    if (uuid) {
      const document = await ScGrantTableResults.#safeResolve(resolve, uuid, result);
      if (ScGrantTableResults.isItem(document)) {
        return { items: [document], tables: [], missing: [] };
      }
      if (ScGrantTableResults.isTable(document)) {
        return { items: [], tables: [document], missing: [] };
      }
      if (!document) {
        missing.push(uuid);
      }
    }

    const items = [];
    const tables = [];
    const seen = new Set();
    for (const linked of ScGrantTableResults.linkedUuids(result)) {
      const document = await ScGrantTableResults.#safeResolve(resolve, linked, result);
      if (!document) {
        missing.push(linked);
        continue;
      }
      const key = document.uuid ?? linked;
      if (seen.has(key)) {
        continue;
      }
      if (ScGrantTableResults.isItem(document)) {
        seen.add(key);
        items.push(document);
      } else if (ScGrantTableResults.isTable(document)) {
        seen.add(key);
        tables.push(document);
      }
    }
    return { items, tables, missing };
  }

  /**
   * Checks, without drawing, whether every result of `table` and of the
   * tables it nests grants items: `{ status, issues, itemCount, tableCount,
   * depth }`. `status` is "invalid" with any error, "warning" with only
   * warnings, "valid" otherwise. Each issue is `{ level, code, table, result,
   * inner, max }`, with names rather than documents.
   */
  static async inspect(table, { resolve, maxDepth = ScGrantTableResults.MAX_DEPTH } = {}) {
    const { ERROR, WARNING } = ScGrantTableResults.LEVELS;
    const { EMPTY, EXHAUSTED, NOT_ITEM, MISSING, TOO_DEEP, CYCLE } = ScGrantTableResults.CODES;
    const issues = [];
    const reported = new Set();
    const items = new Set();
    const tables = new Set();
    const walked = new Set();
    let deepest = 0;

    const report = (issue) => {
      const key = JSON.stringify(issue);
      if (!reported.has(key)) {
        reported.add(key);
        issues.push(issue);
      }
    };

    const walk = async(current, depth, chain) => {
      const visit = `${current.uuid}@${depth}`;
      if (walked.has(visit)) {
        return;
      }
      walked.add(visit);
      tables.add(current.uuid);
      deepest = Math.max(deepest, depth);

      const name = current.name ?? "";
      const results = Array.from(current.results ?? []);
      if (!results.length) {
        report({ level: ERROR, code: EMPTY, table: name });
        return;
      }
      if (current.replacement === false && results.every((result) => result?.drawn)) {
        report({ level: WARNING, code: EXHAUSTED, table: name });
      }

      for (const result of results) {
        const label = ScGrantTableResults.label(result);
        const classified = await ScGrantTableResults.classify(result, resolve);
        for (const item of classified.items) {
          items.add(item.uuid ?? item.id ?? item.name);
        }
        if (classified.missing.length) {
          // A dead link only costs the result when nothing else in it grants.
          const grants = classified.items.length || classified.tables.length;
          report({ level: grants ? WARNING : ERROR, code: MISSING, table: name, result: label });
        }
        for (const inner of classified.tables) {
          if (chain.includes(inner.uuid)) {
            report({ level: ERROR, code: CYCLE, table: name, result: label, inner: inner.name ?? "" });
          } else if (depth >= maxDepth) {
            report({ level: ERROR, code: TOO_DEEP, table: name, result: label, inner: inner.name ?? "", max: maxDepth });
          } else {
            await walk(inner, depth + 1, [...chain, inner.uuid]);
          }
        }
        if (!classified.items.length && !classified.tables.length && !classified.missing.length) {
          report({ level: ERROR, code: NOT_ITEM, table: name, result: label });
        }
      }
    };

    await walk(table, 1, [table.uuid]);

    const status = issues.some((issue) => issue.level === ERROR)
      ? "invalid"
      : (issues.length ? "warning" : "valid");
    return { status, issues, itemCount: items.size, tableCount: tables.size, depth: deepest };
  }

  /** The document a result links to, as a UUID, or `null` for a text result. */
  static documentUuid(result) {
    if (result?.documentUuid) {
      return String(result.documentUuid);
    }
    const collection = result?.documentCollection;
    const id = result?.documentId;
    if (!collection || !id) {
      return null;
    }
    const isPack = collection.includes(".");
    return isPack ? `Compendium.${collection}.Item.${id}` : `${collection}.${id}`;
  }

  /** The UUIDs a result's text links to, in order: `@UUID[...]` and content-link anchors. */
  static linkedUuids(result) {
    const text = [result?.description, result?.name]
      .filter((value) => typeof value === "string" && value)
      .join("\n");
    const uuids = [];
    for (const match of text.matchAll(/@UUID\[([^\]]+)\]/g)) {
      uuids.push(match[1].trim());
    }
    for (const match of text.matchAll(/data-uuid=["']([^"']+)["']/g)) {
      uuids.push(match[1].trim());
    }
    return uuids.filter(Boolean);
  }

  /** A readable name for a result, for the messages that list it. */
  static label(result) {
    const name = String(result?.name ?? "").trim();
    if (name) {
      return name;
    }
    const description = String(result?.description ?? "")
      .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (description) {
      return description.length > 40 ? `${description.slice(0, 39)}…` : description;
    }
    const range = Array.isArray(result?.range) ? result.range : null;
    if (range?.length === 2) {
      return range[0] === range[1] ? `#${range[0]}` : `#${range[0]}–${range[1]}`;
    }
    return result?.documentUuid ?? "?";
  }

  /**
   * A resolver for `inspect` that avoids loading compendium items: their
   * index entry tells whether they exist, and their UUID what they are. Roll
   * tables are always loaded, since their results have to be read.
   */
  static async lookup(uuid, relative) {
    let document = null;
    try {
      document = globalThis.fromUuidSync?.(uuid, { relative, strict: false }) ?? null;
    } catch {
      document = null;
    }
    if (ScGrantTableResults.#documentName(document)) {
      return document;
    }
    if (document) {
      let type = null;
      try {
        type = globalThis.foundry?.utils?.parseUuid?.(uuid, { relative })?.type ?? null;
      } catch {
        type = null;
      }
      if (type && type !== "RollTable") {
        return { documentName: type, uuid: document.uuid ?? uuid, name: document.name ?? "" };
      }
    }
    if (typeof globalThis.fromUuid !== "function") {
      return null;
    }
    return await globalThis.fromUuid(uuid, { relative }) ?? null;
  }

  static isItem(document) {
    return ScGrantTableResults.#documentName(document) === "Item";
  }

  static isTable(document) {
    return ScGrantTableResults.#documentName(document) === "RollTable";
  }

  static #documentName(document) {
    return document?.documentName ?? document?.constructor?.documentName ?? null;
  }

  static async #safeResolve(resolve, uuid, relative) {
    try {
      return await resolve(uuid, relative) ?? null;
    } catch {
      return null;
    }
  }
}
