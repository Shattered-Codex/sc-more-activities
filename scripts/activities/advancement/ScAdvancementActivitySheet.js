export class ScAdvancementActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--advancement"]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-advancement-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    const sourceItemUuid = String(this.activity?.sourceItemUuid ?? "").trim();
    const sourceItem = sourceItemUuid ? await fromUuid(sourceItemUuid).catch(() => null) : null;
    const selections = this.#normalizeSelections(this.activity?.selections ?? []);
    const availableSelections = ScAdvancementActivitySheet.#getAvailableSelections(sourceItem, selections);

    context.sourceItemUuid = sourceItemUuid;
    context.sourceItem = sourceItem && (sourceItem.documentName === "Item" || sourceItem.constructor?.documentName === "Item")
      ? {
        name: sourceItem.name,
        img: sourceItem.img,
        type: sourceItem.type,
        uuid: sourceItem.uuid,
        count: availableSelections.length
      }
      : null;
    context.sourceItemMissing = Boolean(sourceItemUuid) && !context.sourceItem;
    context.availableSelections = availableSelections;
    context.selectedSelections = selections.map((selection, index) => ({
      ...selection,
      index
    }));
    return context;
  }

  _prepareSubmitData(event, formData) {
    const submitData = super._prepareSubmitData(event, formData);
    const rawSelections = foundry.utils.getProperty(submitData, "selections");
    foundry.utils.setProperty(submitData, "selections", this.#normalizeSelections(rawSelections));
    submitData.sourceItemUuid ??= this.activity?.sourceItemUuid ?? "";
    return submitData;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const sourceInput = this.element.querySelector("[data-advancement-source-input]");
    if (sourceInput) {
      this.#bindUuidDrop(sourceInput);
      sourceInput.addEventListener("change", () => {
        void this.#updateSourceItem(sourceInput.value);
      });
      sourceInput.addEventListener("blur", () => {
        void this.#updateSourceItem(sourceInput.value);
      });
    }

    this.element.querySelectorAll("[data-advancement-checkbox]").forEach((input) => {
      input.addEventListener("change", async(event) => {
        const advancementId = String(event.currentTarget.dataset.advancementId ?? "").trim();
        const level = Math.max(0, Math.floor(Number(event.currentTarget.dataset.level) || 0));
        if (!advancementId) {
          return;
        }

        const selections = this.#normalizeSelections(this.activity?.selections ?? []);
        const nextSelections = event.currentTarget.checked
          ? [...selections, { advancementId, level }]
          : selections.filter((selection) => !(selection.advancementId === advancementId && selection.level === level));
        await this.activity.update({ selections: this.#normalizeSelections(nextSelections) });
        this.render();
      });
    });
  }

  async #updateSourceItem(value) {
    const sourceItemUuid = String(value ?? "").trim();
    if (sourceItemUuid === String(this.activity?.sourceItemUuid ?? "").trim()) {
      return;
    }

    const sourceItem = sourceItemUuid ? await fromUuid(sourceItemUuid).catch(() => null) : null;
    const availableKeys = new Set(
      ScAdvancementActivitySheet.#getAvailableSelections(sourceItem, [])
        .map((selection) => `${selection.advancementId}:${selection.level}`)
    );
    const selections = this.#normalizeSelections(this.activity?.selections ?? [])
      .filter((selection) => availableKeys.has(`${selection.advancementId}:${selection.level}`));

    await this.activity.update({
      sourceItemUuid,
      selections
    });
    this.render();
  }

  #bindUuidDrop(input) {
    input.addEventListener("dragover", (event) => {
      event.preventDefault();
    });

    input.addEventListener("drop", async(event) => {
      event.preventDefault();
      const data = TextEditor.getDragEventData(event);
      const uuid = String(data?.uuid ?? "").trim();
      if (!uuid) {
        return;
      }
      input.value = uuid;
      await this.#updateSourceItem(uuid);
    });
  }

  #normalizeSelections(rawSelections) {
    if (!rawSelections) {
      return foundry.utils.deepClone(this.activity?.selections ?? []);
    }

    const entries = Array.isArray(rawSelections)
      ? rawSelections
      : Object.entries(rawSelections)
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([, value]) => value);
    const deduped = new Map();

    for (const entry of entries) {
      const advancementId = String(entry?.advancementId ?? "").trim();
      const level = Math.max(0, Math.floor(Number(entry?.level) || 0));
      if (!advancementId) {
        continue;
      }
      deduped.set(`${advancementId}:${level}`, { advancementId, level });
    }

    return Array.from(deduped.values()).sort((left, right) => {
      if (left.level !== right.level) {
        return left.level - right.level;
      }
      return left.advancementId.localeCompare(right.advancementId, game?.i18n?.lang ?? undefined);
    });
  }

  static #getAvailableSelections(sourceItem, selectedSelections) {
    if (!sourceItem || (sourceItem.documentName !== "Item" && sourceItem.constructor?.documentName !== "Item")) {
      return [];
    }

    const selectedKeys = new Set(
      selectedSelections.map((selection) => `${selection.advancementId}:${selection.level}`)
    );

    return Object.entries(sourceItem.advancement?.byLevel ?? {})
      .flatMap(([levelKey, advancements]) => {
        const level = Math.max(0, Math.floor(Number(levelKey) || 0));
        return advancements.map((advancement) => ({
          advancementId: advancement.id,
          level,
          title: advancement.title || advancement.constructor?.metadata?.label || advancement.type,
          type: advancement.type,
          selected: selectedKeys.has(`${advancement.id}:${level}`)
        }));
      })
      .sort((left, right) => {
        if (left.level !== right.level) {
          return left.level - right.level;
        }
        return left.title.localeCompare(right.title, game?.i18n?.lang ?? undefined);
      });
  }
}
