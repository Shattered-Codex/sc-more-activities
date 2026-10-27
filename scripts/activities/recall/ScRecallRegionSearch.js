const normalize = (value) => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

/** Search data for the region selector; only the visible results become DOM nodes. */
export class ScRecallRegionSearch {
  static LIMIT = 20;

  static entries(scenes) {
    return Array.from(scenes ?? []).flatMap((scene) => (scene.regions?.contents ?? []).map((region) => {
      const label = `${scene.name || scene.id} → ${region.name || region.id}`;
      return { uuid: region.uuid, label, search: normalize(label) };
    })).sort((left, right) => left.label.localeCompare(right.label, game.i18n.lang));
  }

  static find(entries, query) {
    const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
    const results = [];
    for (const entry of entries) {
      if (!terms.every((term) => entry.search.includes(term))) continue;
      if (results.length === this.LIMIT) return { results, hasMore: true };
      results.push(entry);
    }
    return { results, hasMore: false };
  }
}
