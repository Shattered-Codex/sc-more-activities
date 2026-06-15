export class ScMacroActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--macro"]
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-macro-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    context.executionMode = this.activity?.execution?.mode || "world";
    context.isWorldMode = context.executionMode === "world";
    context.isInlineMode = context.executionMode === "inline";
    context.worldMacroUuid = this.activity?.world?.macroUuid || "";
    context.inlineCode = this.activity?.inline?.code || "";
    context.canEditInlineCode = this.#canEditInlineCode();
    context.hasCodeMirrorEditor = Boolean(globalThis.customElements?.get?.("code-mirror"));
    context.inlineCodeLabel = game.i18n.localize("SCMOREACTIVITIES.Activities.ScMacro.Fields.InlineCode.Label");
    context.availableMacros = this.#getAvailableMacros(context.worldMacroUuid);
    context.executionModeOptions = [
      {
        value: "world",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScMacro.Fields.ExecutionMode.Choices.World")
      },
      {
        value: "inline",
        label: game.i18n.localize("SCMOREACTIVITIES.Activities.ScMacro.Fields.ExecutionMode.Choices.Inline")
      }
    ];
    return context;
  }

  _prepareSubmitData(event, formData) {
    const submitData = super._prepareSubmitData(event, formData);
    const editor = this.#getInlineCodeEditor();
    if (editor && this.#canEditInlineCode()) {
      foundry.utils.setProperty(submitData, "inline.code", this.#getInlineCodeEditorValue(editor));
    }
    return submitData;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#bindInlineCodeEditor();
  }

  async close(options = {}) {
    await this.#saveInlineCodeEditorValue();
    return super.close(options);
  }

  #getAvailableMacros(selectedMacroUuid) {
    return (game?.macros?.contents ?? [])
      .map((macro) => ({
        id: macro.id,
        uuid: macro.uuid,
        name: macro.name,
        type: macro.type,
        selected: macro.uuid === selectedMacroUuid
      }))
      .sort((left, right) => left.name.localeCompare(right.name, game?.i18n?.lang ?? undefined));
  }

  #bindInlineCodeEditor() {
    const editor = this.#getInlineCodeEditor();
    if (!editor) {
      return;
    }

    editor.addEventListener("focusout", () => {
      void this.#saveInlineCodeEditorValue();
    });
  }

  #getInlineCodeEditor() {
    return this.element?.querySelector?.('[name="inline.code"].sc-ma-code-editor') ?? null;
  }

  #getInlineCodeEditorValue(editor) {
    return editor.value ?? editor.textContent ?? "";
  }

  #canEditInlineCode() {
    return Boolean(this.isEditable && game?.user?.isGM);
  }

  async #saveInlineCodeEditorValue() {
    if (!this.#canEditInlineCode()) {
      return;
    }

    const editor = this.#getInlineCodeEditor();
    if (!editor) {
      return;
    }

    const code = this.#getInlineCodeEditorValue(editor);
    if ((this.activity?.inline?.code ?? "") === code) {
      return;
    }

    try {
      await this.activity.update({ "inline.code": code });
    } catch (error) {
      console.warn("[sc-more-activities] Could not save inline macro code.", error);
    }
  }
}
