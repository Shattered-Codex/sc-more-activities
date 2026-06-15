import { Constants } from "../constants/Constants.js";
import { HOOKS } from "../constants/Hooks.js";

export class PublicApiFactory {
  static create({ activities, moduleVersion }) {
    return Object.freeze({
      moduleId: Constants.MODULE_ID,
      moduleVersion: moduleVersion ?? "0.0.0",
      apiVersion: 1,
      capabilities: Object.freeze({
        registry: true,
        dnd5eAdapter: true,
        activityCreation: true,
        migration: false
      }),
      hooks: Object.freeze({ ...HOOKS }),
      activities,
      migration: Object.freeze({})
    });
  }
}
