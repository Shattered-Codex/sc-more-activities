import { ScRangeShape } from "../canvas/ScRangeShape.js";

export class ScRecallActivityData extends dnd5e.dataModels.activity.BaseActivityData {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      recall: new fields.SchemaField({
        // "region": a Region chosen here, on any scene. "home": beside the NPC
        // each character bound as their home.
        mode: new fields.StringField({
          required: false,
          initial: "region",
          choices: ["region", "home"]
        }),
        regionUuid: new fields.StringField({
          required: false,
          blank: true,
          initial: ""
        }),
        // Which NPCs can become a home: only those the GM marked on the token
        // HUD, or any NPC token.
        homeSource: new fields.StringField({
          required: false,
          initial: "marked",
          choices: ["marked", "any"]
        }),
        // How close to an NPC the user must stand to bind it as their home.
        bindRange: new fields.NumberField({
          required: false,
          initial: 10,
          min: 0
        }),
        // Creatures within this distance may come along; 0 means only the user.
        allyRange: new fields.NumberField({
          required: false,
          initial: 0,
          min: 0
        }),
        allyFilter: new fields.StringField({
          required: false,
          initial: "friendly",
          choices: ["friendly", "any"]
        }),
        rangeShape: ScRangeShape.field(fields),
        // "instant": the user (and chosen companions) arrive at once. "portal":
        // a pair of portals opens here and at the destination, and anyone
        // allowed may cross by clicking it while it stays open.
        delivery: new fields.StringField({
          required: false,
          initial: "instant",
          choices: ["instant", "portal"]
        })
      }),
      portal: new fields.SchemaField({
        // How far from the user's token the near side may open; 0 means anywhere on the scene.
        placementRange: new fields.StringField({
          required: false,
          initial: "30"
        }),
        // "both" lets creatures come back through the destination side.
        direction: new fields.StringField({
          required: false,
          initial: "both",
          choices: ["oneWay", "both"]
        }),
        // Close both sides once whoever opened the portal comes back through it.
        closeOnReturn: new fields.BooleanField({
          required: false,
          initial: true
        }),
        // Each creature may cross out once and back once.
        roundTrip: new fields.BooleanField({
          required: false,
          initial: false
        }),
        // Crossings in total, in either direction; blank means unlimited.
        maxUses: new fields.StringField({
          required: false,
          initial: ""
        }),
        durationRounds: new fields.StringField({
          required: false,
          initial: "10"
        }),
        size: new fields.StringField({
          required: false,
          initial: "1",
          choices: ["1", "2", "3", "4"]
        }),
        shape: new fields.StringField({
          required: false,
          initial: "circle",
          choices: ["square", "circle"]
        }),
        visibility: new fields.StringField({
          required: false,
          initial: "all",
          choices: ["all", "gm", "hidden"]
        }),
        color: new fields.StringField({
          required: false,
          initial: "#ffb3a7"
        }),
        image: new fields.StringField({
          required: false,
          initial: ""
        })
      })
    };
  }
}
