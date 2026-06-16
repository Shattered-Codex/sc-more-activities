import { Constants } from "../../constants/Constants.js";

export class ScGrantActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--grant"]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-grant-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    context.recipient = this.activity?.recipient ?? "self";
    context.recipientOptions = [
      {
        value: "self",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScGrant.Fields.Recipient.Choices.Self")
      },
      {
        value: "target",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScGrant.Fields.Recipient.Choices.Target")
      }
    ];
    context.grants = await Promise.all(
      (this.activity?.grants ?? []).map(async(entry, index) => {
        const uuid = String(entry?.uuid ?? "").trim();
        let item = null;
        try {
          item = uuid ? await fromUuid(uuid) : null;
        } catch {
          item = null;
        }

        return {
          index,
          uuid,
          quantity: Math.max(1, Number(entry?.quantity) || 1),
          name: item?.name ?? uuid,
          img: item?.img ?? "icons/svg/hazard.svg",
          typeLabel: item?.type ?? "",
          missing: !item
        };
      })
    );
    return context;
  }

  _prepareSubmitData(event, formData) {
    const submitData = super._prepareSubmitData(event, formData);
    const rawGrants = foundry.utils.getProperty(submitData, "grants");
    foundry.utils.setProperty(submitData, "grants", this.#normalizeGrantSubmitData(rawGrants));
    return submitData;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const addInput = this.element.querySelector("[data-grant-uuid-input]");
    const addButton = this.element.querySelector("[data-action='add-grant']");

    if (addInput) {
      this.#bindUuidDrop(addInput);
      addInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.#addGrantFromInput(addInput);
        }
      });
    }

    addButton?.addEventListener("click", (event) => {
      event.preventDefault();
      this.#addGrantFromInput(addInput);
    });

    this.element.querySelectorAll("[data-action='remove-grant']").forEach((button) => {
      button.addEventListener("click", async(event) => {
        event.preventDefault();
        const index = Number(event.currentTarget.dataset.index);
        if (!Number.isInteger(index)) {
          return;
        }
        const grants = foundry.utils.deepClone(this.activity?.grants ?? []);
        grants.splice(index, 1);
        await this.activity.update({ grants });
        this.render();
      });
    });

    this.element.querySelectorAll("[data-grant-quantity]").forEach((input) => {
      const commit = async() => {
        const index = Number(input.dataset.index);
        if (!Number.isInteger(index)) {
          return;
        }
        const quantity = Math.max(1, Math.floor(Number(input.value) || 1));
        input.value = quantity;
        const grants = foundry.utils.deepClone(this.activity?.grants ?? []);
        if (!grants[index]) {
          return;
        }
        grants[index].quantity = quantity;
        await this.activity.update({ grants });
      };

      input.addEventListener("change", commit);
      input.addEventListener("blur", commit);
    });
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
      await this.#addGrantFromInput(input);
    });
  }

  async #addGrantFromInput(input) {
    const uuid = String(input?.value ?? "").trim();
    if (!uuid) {
      return;
    }

    const item = await fromUuid(uuid).catch(() => null);
    if (!item || (item.documentName !== "Item" && item.constructor?.documentName !== "Item")) {
      ui.notifications?.warn?.(Constants.format(
        "SCMOREACTIVITIES.Activities.ScGrant.Error.InvalidUuid",
        { uuid },
        `Invalid grant item UUID: ${uuid}`
      ));
      return;
    }

    const grants = foundry.utils.deepClone(this.activity?.grants ?? []);
    if (grants.some((entry) => String(entry?.uuid ?? "").trim() === uuid)) {
      ui.notifications?.warn?.(Constants.localize(
        "SCMOREACTIVITIES.Activities.ScGrant.Warning.DuplicateItem",
        "This item is already in the granted items list."
      ));
      return;
    }

    grants.push({ uuid, quantity: 1 });
    await this.activity.update({ grants });
    input.value = "";
    this.render();
  }

  #normalizeGrantSubmitData(rawGrants) {
    if (!rawGrants) {
      return foundry.utils.deepClone(this.activity?.grants ?? []);
    }

    const entries = Array.isArray(rawGrants)
      ? rawGrants
      : Object.entries(rawGrants)
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([, value]) => value);

    return entries
      .map((entry) => ({
        uuid: String(entry?.uuid ?? "").trim(),
        quantity: Math.max(1, Math.floor(Number(entry?.quantity) || 1))
      }))
      .filter((entry) => entry.uuid);
  }
}
