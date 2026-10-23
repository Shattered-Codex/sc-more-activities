import { ScRangeShape } from "../canvas/ScRangeShape.js";
import { ScRecallRegionSearch } from "./ScRecallRegionSearch.js";

export class ScRecallActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  #regionEntries = [];

  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--recall"]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-recall-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    const localize = (key) => game.i18n.localize(`SCMOREACTIVITIES.Activities.ScRecall.Fields.${key}`);
    const recall = this.activity?.recall ?? {};

    context.recall = {
      mode: recall.mode ?? "region",
      regionUuid: recall.regionUuid ?? "",
      homeSource: recall.homeSource ?? "marked",
      bindRange: recall.bindRange ?? 10,
      allyRange: recall.allyRange ?? 0,
      allyFilter: recall.allyFilter ?? "friendly",
      rangeShape: ScRangeShape.normalize(recall.rangeShape),
      delivery: recall.delivery ?? "instant"
    };
    const portal = this.activity?.portal ?? {};
    context.portal = {
      placementRange: portal.placementRange ?? "30",
      direction: portal.direction ?? "both",
      roundTrip: portal.roundTrip === true,
      closeOnReturn: portal.closeOnReturn !== false,
      maxUses: portal.maxUses ?? "",
      durationRounds: portal.durationRounds ?? "10",
      size: portal.size ?? "1",
      shape: portal.shape ?? "circle",
      visibility: portal.visibility ?? "all",
      color: portal.color ?? "#ffb3a7",
      image: portal.image ?? ""
    };
    context.isRegionMode = context.recall.mode !== "home";
    context.isPortal = context.recall.delivery === "portal";
    context.showAllyFilter = context.isPortal || Number(context.recall.allyRange) > 0;
    context.showRoundTrip = context.portal.direction === "both";
    // The bind range needs the shape in home mode; otherwise only the companion range does.
    context.shapeWithDestination = !context.isRegionMode;
    context.shapeWithCompanions = context.isRegionMode && !context.isPortal;
    context.shapeWithPortal = context.isRegionMode && context.isPortal;
    context.deliveryOptions = [
      { value: "instant", label: localize("Delivery.Choices.Instant") },
      { value: "portal", label: localize("Delivery.Choices.Portal") }
    ];
    context.directionOptions = [
      { value: "both", label: localize("Portal.Direction.Choices.Both") },
      { value: "oneWay", label: localize("Portal.Direction.Choices.OneWay") }
    ];
    context.portalShapeOptions = [
      { value: "circle", label: localize("Portal.Shape.Choices.Circle") },
      { value: "square", label: localize("Portal.Shape.Choices.Square") }
    ];
    context.portalSizeOptions = ["1", "2", "3", "4"].map((value) => ({ value, label: `${value}×${value}` }));
    context.portalVisibilityOptions = [
      { value: "all", label: localize("Portal.Visibility.Choices.All") },
      { value: "gm", label: localize("Portal.Visibility.Choices.Gm") },
      { value: "hidden", label: localize("Portal.Visibility.Choices.Hidden") }
    ];
    context.modeOptions = [
      { value: "region", label: localize("Mode.Choices.Region") },
      { value: "home", label: localize("Mode.Choices.Home") }
    ];
    context.homeSourceOptions = [
      { value: "marked", label: localize("HomeSource.Choices.Marked") },
      { value: "any", label: localize("HomeSource.Choices.Any") }
    ];
    context.allyFilterOptions = [
      { value: "friendly", label: localize("AllyFilter.Choices.Friendly") },
      { value: "any", label: localize("AllyFilter.Choices.Any") }
    ];
    context.rangeShapeOptions = ScRangeShape.options();
    this.#regionEntries = context.isRegionMode
      ? ScRecallRegionSearch.entries(game.scenes?.contents)
      : [];
    const selected = this.#regionEntries.find((entry) => entry.uuid === context.recall.regionUuid);
    context.selectedRegionLabel = selected?.label
      ?? (context.recall.regionUuid ? localize("Region.Missing") : localize("Region.None"));
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const picker = this.element.querySelector("[data-sc-region-picker]");
    if (!picker) return;
    const value = picker.querySelector('[name="recall.regionUuid"]');
    const toggle = picker.querySelector("[data-sc-region-toggle]");
    const clear = picker.querySelector("[data-sc-region-clear]");
    const panel = picker.querySelector("[data-sc-region-panel]");
    const search = picker.querySelector('input[type="search"]');
    const results = picker.querySelector("[data-sc-region-results]");
    const status = picker.querySelector("[role='status']");
    const localize = (key) => game.i18n.localize(`SCMOREACTIVITIES.Activities.ScRecall.Fields.Region.${key}`);
    if (this.isEditable === false) {
      toggle.disabled = clear.disabled = search.disabled = true;
      return;
    }

    const choose = async (uuid, label) => {
      value.value = uuid;
      toggle.querySelector("[data-sc-region-label]").textContent = label;
      toggle.title = label;
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      clear.disabled = !uuid;
      toggle.focus();
      await this.submit();
    };
    const refresh = () => {
      const found = ScRecallRegionSearch.find(this.#regionEntries, search.value);
      const buttons = found.results.map((entry) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = entry.label;
        button.onclick = () => choose(entry.uuid, entry.label);
        return button;
      });
      results.replaceChildren(...buttons);
      status.textContent = found.hasMore ? localize("More")
        : (!buttons.length ? localize("Empty") : "");
    };
    toggle.onclick = () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) {
        refresh();
        search.focus();
      }
    };
    clear.onclick = () => choose("", localize("None"));
    clear.disabled = !value.value;
    search.oninput = (event) => {
      event.stopPropagation();
      refresh();
    };
    // Activity sheets submit on bubbled changes; typing a query is draft UI only.
    search.onchange = (event) => event.stopPropagation();
    search.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        results.firstElementChild?.focus();
      }
    };
    panel.onkeydown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
    };
  }
}
