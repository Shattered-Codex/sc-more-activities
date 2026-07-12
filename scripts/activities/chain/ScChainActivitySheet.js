export class ScChainActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--chain"]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-chain-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    const configuredIds = this.#parseActivityIds(this.activity?.chain?.activityIds);
    const availableActivities = this.#getAvailableActivities();
    context.chain = {
      activityIds: this.activity?.chain?.activityIds ?? "",
      maxDepth: this.activity?.chain?.maxDepth ?? 5,
      continueOnFailure: this.activity?.chain?.continueOnFailure === true,
      stopOnCancel: this.activity?.chain?.stopOnCancel !== false,
      suppressChildMessages: this.activity?.chain?.suppressChildMessages === true
    };
    context.configuredActivities = this.#configuredActivities(configuredIds, availableActivities);
    context.activityOptions = availableActivities.map((activity) => ({
      value: activity.id,
      label: `${activity.name} (${activity.type})`
    }));
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const idsInput = this.element.querySelector("[data-chain-activity-ids]");
    const select = this.element.querySelector("[data-chain-activity-select]");
    const addButton = this.element.querySelector("[data-action='sc-add-chain-activity']");
    const list = this.element.querySelector("[data-chain-activity-list]");
    if (!idsInput || !select || !addButton || !list) {
      return;
    }

    let configuredIds = this.#parseActivityIds(idsInput.value);
    const availableActivities = this.#getAvailableActivities();

    const refreshAddButton = () => {
      addButton.disabled = !select.value;
    };
    const syncConfiguredActivities = async() => {
      idsInput.value = configuredIds.join("\n");
      this.#renderConfiguredActivities(list, configuredIds, availableActivities);
      await this.submit();
    };

    select.addEventListener("change", (event) => {
      // The dnd5e ActivitySheet submits and rerenders on every bubbled change.
      // Keep this draft-only picker stable until the user confirms with +.
      event.stopPropagation();
      refreshAddButton();
    });
    addButton.addEventListener("click", async(event) => {
      event.preventDefault();
      if (!select.value) {
        return;
      }
      configuredIds.push(select.value);
      select.value = "";
      refreshAddButton();
      await syncConfiguredActivities();
    });

    list.addEventListener("click", async(event) => {
      const button = event.target.closest("[data-action='sc-remove-chain-activity']");
      if (!button || !list.contains(button)) {
        return;
      }
      event.preventDefault();
      const index = Number(button.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= configuredIds.length) {
        return;
      }
      configuredIds.splice(index, 1);
      await syncConfiguredActivities();
    });

    refreshAddButton();
  }

  #parseActivityIds(value) {
    return String(value ?? "")
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  #getAvailableActivities() {
    const activities = this.activity?.item?.system?.activities;
    const values = typeof activities?.values === "function" ? activities.values() : activities;
    return Array.from(values ?? [])
      .filter((activity) => activity.id !== this.activity?.id)
      .map((activity) => ({
        id: activity.id,
        name: activity.name || activity.id,
        type: activity.type || ""
      }))
      .sort((left, right) => left.name.localeCompare(right.name, game?.i18n?.lang ?? undefined));
  }

  #configuredActivities(configuredIds, availableActivities = this.#getAvailableActivities()) {
    const availableById = new Map(availableActivities.map((activity) => [activity.id, activity]));
    return configuredIds.map((id, index) => {
      const activity = availableById.get(id);
      return {
        id,
        index,
        name: activity?.name ?? id,
        type: activity?.type ?? "",
        missing: !activity
      };
    });
  }

  #renderConfiguredActivities(list, configuredIds, availableActivities) {
    const configuredActivities = this.#configuredActivities(configuredIds, availableActivities);
    list.replaceChildren();

    if (!configuredActivities.length) {
      const empty = document.createElement("li");
      empty.className = "sc-ma-chain-activity-empty";
      empty.textContent = game.i18n.localize(
        "SCMOREACTIVITIES.Activities.ScChain.Fields.ActivityList.Empty"
      );
      list.append(empty);
      return;
    }

    for (const activity of configuredActivities) {
      const row = document.createElement("li");
      row.className = "sc-ma-chain-activity-row";

      const summary = document.createElement("span");
      summary.className = "sc-ma-chain-activity-summary";

      const name = document.createElement("strong");
      name.textContent = activity.name;
      summary.append(name);

      if (activity.type) {
        const type = document.createElement("small");
        type.textContent = activity.type;
        summary.append(type);
      }

      if (activity.missing) {
        row.classList.add("is-missing");
        const missing = document.createElement("small");
        missing.className = "sc-ma-chain-activity-missing";
        missing.textContent = game.i18n.format(
          "SCMOREACTIVITIES.Activities.ScChain.Fields.ActivityList.Missing",
          { activity: activity.id }
        );
        summary.append(missing);
      } else {
        const id = document.createElement("code");
        id.textContent = activity.id;
        summary.append(id);
      }

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "unbutton control-button";
      remove.dataset.action = "sc-remove-chain-activity";
      remove.dataset.index = String(activity.index);
      remove.dataset.tooltip = "";
      remove.setAttribute("aria-label", game.i18n.localize(
        "SCMOREACTIVITIES.Activities.ScChain.Fields.ActivityList.Remove"
      ));
      const icon = document.createElement("i");
      icon.className = "fas fa-minus";
      icon.setAttribute("inert", "");
      remove.append(icon);

      row.append(summary, remove);
      list.append(row);
    }
  }
}
