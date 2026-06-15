import { Constants } from "../constants/Constants.js";

export class ApiPublisher {
  static publish(api) {
    const module = game?.modules?.get?.(Constants.MODULE_ID);
    if (module) {
      module.api = api;
    }

    globalThis.ShatteredCodex ??= {};
    globalThis.ShatteredCodex.activities = api.activities;
    return api;
  }
}
