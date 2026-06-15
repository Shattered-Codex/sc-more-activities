import { Constants } from "../../constants/Constants.js";
import { Logger } from "../../support/Logger.js";

export class ScSoundActivityService {
  static async play(activity) {
    const src = activity?.audio?.source?.trim?.() ?? "";
    if (!src) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScSound.Warning.MissingSoundFile",
        "Choose an audio file before using this activity."
      ));
      return;
    }

    const volume = ScSoundActivityService.#clampVolume(activity.audio?.volume);
    const audience = activity?.playback?.audience ?? "self";
    const broadcast = Boolean(audience === "everyone" && game?.user?.isGM);
    if (audience === "everyone" && !game?.user?.isGM) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScSound.Warning.BroadcastRequiresGm",
        "Only a GM can play this sound for everyone. Playing locally instead."
      ));
    }

    try {
      await foundry.audio.AudioHelper.play({ src, volume, loop: false }, broadcast);
    } catch (error) {
      Logger.error("Could not play sc-sound activity.", error);
      ui.notifications?.error?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScSound.Error.PlayFailed",
        { error: error?.message ?? String(error) },
        `Could not play audio: ${error?.message ?? String(error)}`
      ));
    }
  }

  static #clampVolume(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 0.8;
    }
    return Math.min(1, Math.max(0, numeric));
  }
}
