/**
 * Carries a use's scaling (an upcast, or a scaled consumption) to the GM.
 *
 * dnd5e applies the scaling to a clone of the item made for that use, which
 * the GM never sees: a request names the activity by UUID, and the stored
 * activity has no scaling. So the request carries the number, and the GM
 * builds the same clone again from the stored item, with its own formulas and
 * roll data; only the count comes from the request.
 */
export class ScUsageScaling {
  /** The scaling `activity` is being used with, for a request. */
  static of(activity) {
    const scaling = Number(activity?.item?.flags?.dnd5e?.scaling ?? 0);
    return Number.isSafeInteger(scaling) && scaling > 0 ? scaling : 0;
  }

  /** The stored `activity` as used with `scaling`, or `null` when `scaling` is not a count. */
  static apply(activity, scaling = 0) {
    if (!Number.isSafeInteger(scaling) || scaling < 0) {
      return null;
    }
    if (scaling === ScUsageScaling.of(activity)) {
      return activity;
    }

    // Item5e.clone prepares the embedded activities and final attributes with
    // this flag, just as the system does when configuring a scaled use.
    const item = activity.item.clone({ "flags.dnd5e.scaling": scaling }, { keepId: true });
    return item.system.activities.get(activity.id) ?? null;
  }
}
