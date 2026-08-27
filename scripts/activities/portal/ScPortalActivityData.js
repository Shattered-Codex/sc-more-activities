export class ScPortalActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  /** Scene units per square assumed for portals stored before the footprint change. */
  static #LEGACY_SQUARE_UNITS = 5;

  /** @inheritDoc */
  static migrateData(source) {
    ScPortalActivityData.#migrateSize(source);
    return super.migrateData(source);
  }

  /**
   * `portal.size` was a free-text measurement in scene units, defaulting to "5"
   * for a single square. It is now a footprint counted in squares, so a stored
   * measurement is converted instead of being read as a huge square count.
   */
  static #migrateSize(source) {
    const size = source?.portal?.size;
    if (size === undefined || size === null || size === "") {
      return;
    }

    const numeric = Number(String(size).trim());
    if (!Number.isFinite(numeric) || numeric <= 0) {
      // The old field accepted roll formulas, which have no footprint meaning.
      source.portal.size = "1";
      return;
    }

    const squares = numeric >= ScPortalActivityData.#LEGACY_SQUARE_UNITS
      ? Math.round(numeric / ScPortalActivityData.#LEGACY_SQUARE_UNITS)
      : Math.round(numeric);
    source.portal.size = String(Math.min(4, Math.max(1, squares)));
  }

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();
    if (schema.target?.fields?.prompt?.options) {
      schema.target.fields.prompt.options.initial = false;
    }

    return {
      ...schema,
      portal: new fields.SchemaField({
        placementRange: new fields.StringField({
          required: false,
          initial: "30"
        }),
        linkRange: new fields.StringField({
          required: false,
          initial: ""
        }),
        shape: new fields.StringField({
          required: false,
          initial: "square",
          choices: ["square", "circle"]
        }),
        size: new fields.StringField({
          required: false,
          initial: "1"
        }),
        snapToGrid: new fields.BooleanField({
          required: false,
          initial: true
        }),
        avoidOccupied: new fields.BooleanField({
          required: false,
          initial: true
        }),
        oneWay: new fields.BooleanField({
          required: false,
          initial: false
        }),
        maxUses: new fields.StringField({
          required: false,
          initial: ""
        }),
        durationRounds: new fields.StringField({
          required: false,
          initial: "10"
        }),
        visibility: new fields.StringField({
          required: false,
          initial: "all",
          choices: ["all", "gm", "hidden"]
        }),
        color: new fields.StringField({
          required: false,
          initial: "#8a63d2"
        }),
        entryImage: new fields.StringField({
          required: false,
          initial: ""
        }),
        exitImage: new fields.StringField({
          required: false,
          initial: ""
        }),
        allowPlayerRequests: new fields.BooleanField({
          required: false,
          initial: true
        })
      })
    };
  }
}
