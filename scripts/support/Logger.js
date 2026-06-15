import { Constants } from "../constants/Constants.js";
import { ModuleSettings } from "../settings/ModuleSettings.js";

export class Logger {
  static debug(message, ...args) {
    if (!ModuleSettings.isDebugLoggingEnabled()) {
      return;
    }
    console.debug(Logger.#prefix(message), ...args);
  }

  static info(message, ...args) {
    console.info(Logger.#prefix(message), ...args);
  }

  static warn(message, ...args) {
    console.warn(Logger.#prefix(message), ...args);
  }

  static error(message, ...args) {
    console.error(Logger.#prefix(message), ...args);
  }

  static #prefix(message) {
    return `[${Constants.MODULE_ID}] ${message}`;
  }
}
