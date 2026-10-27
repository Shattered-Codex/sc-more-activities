import { Constants } from "../../constants/Constants.js";
import { ScJournalActivityService } from "./ScJournalActivityService.js";

const LANG = "SCMOREACTIVITIES.Activities.ScJournal";

export class ScJournalActivitySheet extends dnd5e.applications.activity.ActivitySheet {
  static DEFAULT_OPTIONS = {
    classes: ["dnd5e2", "sheet", "activity-sheet", "sc-more-activities", "sc-ma-activity", "sc-ma-activity--journal"],
    actions: {
      scJournalPreview: ScJournalActivitySheet.#onPreview,
      scJournalClear: ScJournalActivitySheet.#onClear
    }
  };

  static PARTS = {
    ...super.PARTS,
    effect: {
      template: "modules/sc-more-activities/templates/activity-parts/sc-journal-effect.hbs",
      templates: [...super.PARTS.effect.templates]
    }
  };

  async _prepareEffectContext(context, options) {
    context = await super._prepareEffectContext(context, options);
    const journal = this.activity?.journal ?? {};
    const { entry = null, page = null } = await ScJournalActivityService.resolve(journal);
    const pages = ScJournalActivityService.pageOptions(entry);
    context.journal = {
      uuid: journal.uuid ?? "",
      pageId: journal.pageId ?? "",
      editable: this.isEditable !== false,
      entry,
      name: entry?.name ?? "",
      source: ScJournalActivitySheet.#sourceLabel(entry),
      pages: ScJournalActivitySheet.#pageCountLabel(pages.length),
      pageMissing: Boolean(entry && journal.pageId && !page)
    };
    context.pageOptions = [
      { value: "", label: game.i18n.localize(`${LANG}.Fields.Page.Whole`) },
      ...pages
    ];
    return context;
  }

  /** A pasted page uuid sets the page too; choosing another journal drops the old page. */
  _prepareSubmitData(event, formData) {
    const submitData = super._prepareSubmitData(event, formData);
    if (!foundry.utils.hasProperty(submitData, "journal.uuid")) {
      return submitData;
    }
    const { uuid, pageId } = ScJournalActivityService.splitUuid(foundry.utils.getProperty(submitData, "journal.uuid"));
    foundry.utils.setProperty(submitData, "journal.uuid", uuid);
    if (pageId !== null) {
      foundry.utils.setProperty(submitData, "journal.pageId", pageId);
    } else if (uuid !== (this.activity?.journal?.uuid ?? "")) {
      foundry.utils.setProperty(submitData, "journal.pageId", "");
    }
    return submitData;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const zone = this.element.querySelector("[data-sc-journal-drop]");
    if (!zone || this.isEditable === false) {
      return;
    }
    // The whole fieldset takes the drop, so a journal can be replaced by dropping on its card.
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("is-dragover");
    });
    zone.addEventListener("dragleave", (event) => {
      if (!zone.contains(event.relatedTarget)) {
        zone.classList.remove("is-dragover");
      }
    });
    zone.addEventListener("drop", async(event) => {
      event.preventDefault();
      event.stopPropagation();
      zone.classList.remove("is-dragover");
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      const target = await ScJournalActivityService.targetFromUuid(data?.uuid);
      if (!target) {
        ui.notifications?.warn?.(Constants.localize(
          `${LANG}.Warning.InvalidDrop`,
          "Only a journal entry or one of its pages can be opened by this activity."
        ));
        return;
      }
      await this.#setJournal(target.uuid, target.pageId);
    });
  }

  async #setJournal(uuid, pageId) {
    await this.activity.update({ journal: { uuid, pageId } });
    this.render();
  }

  /** Opens the journal for whoever edits the activity, the way it opens on use. */
  static async #onPreview() {
    await ScJournalActivityService.open(this.activity);
  }

  static async #onClear() {
    await this.#setJournal("", "");
  }

  static #sourceLabel(entry) {
    if (!entry?.pack) {
      return game.i18n.localize(`${LANG}.Fields.Journal.World`);
    }
    const pack = game.packs?.get?.(entry.pack)?.title ?? entry.pack;
    return Constants.format(`${LANG}.Fields.Journal.Compendium`, { pack }, `Compendium: ${pack}`);
  }

  static #pageCountLabel(count) {
    if (!count) {
      return game.i18n.localize(`${LANG}.Fields.Journal.Pages.None`);
    }
    return count === 1
      ? game.i18n.localize(`${LANG}.Fields.Journal.Pages.One`)
      : Constants.format(`${LANG}.Fields.Journal.Pages.Other`, { count }, `${count} pages`);
  }
}
