import { Constants } from "../../constants/Constants.js";

const ENHANCED_ATTR = "scMaActivityCreateTabs";
const NATIVE_GROUP_ICON = "fa-brands fa-d-and-d";
const SHATTERED_CODEX_GROUP_ICON = "fa-solid fa-book-sparkles";

export class ActivityCreateDialogTabs {
  static #activitiesApi = null;
  static #activated = false;
  static #nextId = 0;

  static activate(activitiesApi) {
    if (ActivityCreateDialogTabs.#activated) {
      return;
    }

    ActivityCreateDialogTabs.#activated = true;
    ActivityCreateDialogTabs.#activitiesApi = activitiesApi;
    Hooks.on("renderCreateDocumentDialog", ActivityCreateDialogTabs.#onRenderCreateDocumentDialog);
    Hooks.on("renderDialog", ActivityCreateDialogTabs.#onRenderCreateDocumentDialog);
  }

  static #onRenderCreateDocumentDialog(dialog, html) {
    const root = ActivityCreateDialogTabs.#resolveRoot(html);
    const appElement = root ? ActivityCreateDialogTabs.#resolveApplicationElement(root) : null;
    if (!root || !appElement) {
      return;
    }
    if (appElement.dataset?.[ENHANCED_ATTR] === "true" && appElement.querySelector(".sc-ma-create-tabs")) {
      return;
    }

    if (!ActivityCreateDialogTabs.#isActivityCreateDialog(dialog, root)) {
      return;
    }

    const container = root.querySelector("#document-create") ?? root;
    const header = container.querySelector("header");
    const list = container.querySelector("ol.unlist.card");
    if (!header || !list) {
      return;
    }

    const items = Array.from(list.querySelectorAll("li"))
      .map((element) => ({ element, radio: element.querySelector('input[name="type"]') }))
      .filter(({ radio }) => radio?.value);
    if (items.length < 2) {
      return;
    }

    const groups = ActivityCreateDialogTabs.#buildGroups(items);
    if (groups.length < 2) {
      return;
    }

    appElement.dataset[ENHANCED_ATTR] = "true";
    appElement.classList.add("sc-more-activities", "sc-ma-create-dialog");
    container.classList.add("sc-ma-create-dialog-content");

    const layout = document.createElement("div");
    layout.classList.add("sc-ma-create-layout");

    const nav = document.createElement("nav");
    nav.classList.add("sc-ma-create-tabs");
    nav.setAttribute("aria-label", Constants.localize(
      "SCMOREACTIVITIES.CreateDialog.Groups.Label",
      "Activity groups"
    ));
    nav.setAttribute("aria-orientation", "vertical");
    nav.setAttribute("role", "tablist");

    const panels = document.createElement("div");
    panels.classList.add("sc-ma-create-panels");

    const idPrefix = `sc-ma-create-${++ActivityCreateDialogTabs.#nextId}`;
    const groupElements = groups.map((group, index) => {
      const tabId = ActivityCreateDialogTabs.#createElementId(idPrefix, "tab", group.key, index);
      const panelId = ActivityCreateDialogTabs.#createElementId(idPrefix, "panel", group.key, index);
      const tab = ActivityCreateDialogTabs.#createTab(group, tabId, panelId);
      const panel = ActivityCreateDialogTabs.#createPanel(group, panelId, tabId);
      nav.append(tab);
      panels.append(panel);
      return { group, tab, panel };
    });

    layout.append(panels);
    header.after(nav, layout);
    list.remove();

    const setDialogCreateType = (type) => {
      dialog.options ??= {};
      dialog.options.createData ??= {};
      dialog.options.createData.type = type;
    };

    const clearDialogCreateType = () => {
      if (dialog.options?.createData) {
        delete dialog.options.createData.type;
      }
    };

    const clearSelectedType = () => {
      for (const radio of container.querySelectorAll('input[name="type"]:checked')) {
        radio.checked = false;
      }
      clearDialogCreateType();
    };

    const activate = (groupKey, { selectFirst = true } = {}) => {
      for (const entry of groupElements) {
        const active = entry.group.key === groupKey;
        entry.tab.classList.toggle("active", active);
        entry.tab.setAttribute("aria-selected", String(active));
        entry.tab.tabIndex = active ? 0 : -1;
        entry.panel.classList.toggle("active", active);
        entry.panel.hidden = !active;
        entry.panel.style.display = active ? "" : "none";
        entry.panel.setAttribute("aria-hidden", String(!active));
        entry.panel.toggleAttribute("inert", !active);
      }

      const activeEntry = groupElements.find((entry) => entry.group.key === groupKey);
      if (!activeEntry) {
        return;
      }

      const checked = activeEntry.panel.querySelector('input[name="type"]:checked:not(:disabled)');
      const target = checked
        ?? (selectFirst ? activeEntry.panel.querySelector('input[name="type"]:not(:disabled)') : null);
      if (target) {
        target.checked = true;
        setDialogCreateType(target.value);
      } else {
        clearSelectedType();
      }
    };

    for (const [index, { group, tab, panel }] of groupElements.entries()) {
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        activate(group.key);
      });
      tab.addEventListener("keydown", (event) => {
        const targetIndex = ActivityCreateDialogTabs.#getKeyboardTargetIndex(event, groupElements, index);
        if (targetIndex === null) {
          return;
        }

        event.preventDefault();
        const target = groupElements[targetIndex];
        target.tab.focus();
        activate(target.group.key);
      });

      for (const radio of panel.querySelectorAll('input[name="type"]')) {
        radio.addEventListener("change", (event) => {
          if (event.currentTarget.checked) {
            setDialogCreateType(event.currentTarget.value);
          }
        });
      }
    }

    const selectedRadio = container.querySelector('input[name="type"]:checked:not(:disabled)');
    const selectedGroup = selectedRadio
      ? groupElements.find((entry) => entry.panel.contains(selectedRadio))?.group.key
      : null;
    activate(selectedGroup ?? groupElements[0].group.key, { selectFirst: !selectedRadio });
    dialog.setPosition?.(dialog.position ?? {});
  }

  static #isActivityCreateDialog(dialog, root) {
    const isCreateDialog = root.classList?.contains("create-document")
      || dialog?.constructor?.name === "CreateDocumentDialog"
      || dialog?.options?.classes?.includes?.("create-document");
    if (!isCreateDialog) {
      return false;
    }

    const documentTypeName = dialog?.options?.documentType?.metadata?.name
      ?? dialog?.options?.documentType?.documentName;
    if (documentTypeName === "Activity") {
      return true;
    }

    return Boolean(root.querySelector('input[name="type"][value="sc-macro"], input[name="type"][value="sc-sound"]'));
  }

  static #buildGroups(items) {
    const summaries = new Map(
      (ActivityCreateDialogTabs.#activitiesApi?.listTypes?.() ?? [])
        .map((summary) => [summary.type, summary])
    );
    const groups = new Map();

    for (const item of items) {
      const summary = summaries.get(item.radio.value)
        ?? ActivityCreateDialogTabs.#getConfigSummary(item.radio.value);
      const group = ActivityCreateDialogTabs.#getGroup(summary);
      if (!groups.has(group.key)) {
        groups.set(group.key, { ...group, items: [] });
      }
      groups.get(group.key).items.push(item.element);
    }

    return Array.from(groups.values())
      .filter((group) => group.items.length)
      .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, game.i18n.lang));
  }

  static #getConfigSummary(type) {
    const config = globalThis.CONFIG?.DND5E?.activityTypes?.[type];
    const metadata = config?.scMoreActivities ?? config?.documentClass?.metadata?.scMoreActivities;
    if (!metadata) {
      return null;
    }

    const ui = metadata.ui ?? {
      scope: metadata.scope,
      groupId: metadata.groupId,
      groupLabel: metadata.groupLabel,
      groupIcon: metadata.groupIcon,
      groupOrder: metadata.groupOrder
    };

    return {
      type,
      moduleId: metadata.moduleId ?? config?.documentClass?.metadata?.moduleId ?? null,
      category: metadata.category ?? "external",
      ui,
      source: metadata.source ?? "external"
    };
  }

  static #getGroup(summary) {
    if (!summary) {
      return {
        key: "native",
        label: Constants.localize("SCMOREACTIVITIES.CreateDialog.Groups.Native", "D&D 5e"),
        icon: NATIVE_GROUP_ICON,
        order: 0
      };
    }

    const ui = summary.ui ?? {};
    if (ui.scope === "shattered-codex" || summary.moduleId === Constants.MODULE_ID) {
      return {
        key: ui.groupId ?? "shattered-codex",
        label: ActivityCreateDialogTabs.#resolveLabel(
          ui.groupLabel,
          Constants.localize("SCMOREACTIVITIES.CreateDialog.Groups.ShatteredCodex", "Shattered Codex")
        ),
        icon: ActivityCreateDialogTabs.#resolveGroupIcon(ui.groupIcon, SHATTERED_CODEX_GROUP_ICON),
        order: Number(ui.groupOrder ?? 100)
      };
    }

    const module = game.modules.get(summary.moduleId);
    return {
      key: ui.groupId ?? summary.moduleId ?? "external",
      label: ActivityCreateDialogTabs.#resolveLabel(
        ui.groupLabel,
        module?.title ?? summary.moduleId ?? Constants.localize("SCMOREACTIVITIES.CreateDialog.Groups.External", "External")
      ),
      icon: ui.groupIcon ?? "fa-solid fa-cube",
      order: Number(ui.groupOrder ?? 200)
    };
  }

  static #createTab(group, tabId, panelId) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = tabId;
    tab.classList.add("sc-ma-create-tab");
    tab.dataset.scGroup = group.key;
    tab.setAttribute("data-tooltip", "");
    tab.title = group.label;
    tab.setAttribute("data-tooltip-direction", "LEFT");
    tab.setAttribute("aria-controls", panelId);
    tab.setAttribute("aria-label", group.label);
    tab.setAttribute("aria-selected", "false");
    tab.setAttribute("role", "tab");
    tab.tabIndex = -1;

    tab.append(ActivityCreateDialogTabs.#createIcon(group.icon));
    return tab;
  }

  static #createIcon(iconValue) {
    const icon = String(iconValue ?? "").trim();
    if (ActivityCreateDialogTabs.#isIconPath(icon)) {
      const element = document.createElement("dnd5e-icon");
      element.setAttribute("src", icon);
      element.setAttribute("aria-hidden", "true");
      return element;
    }

    const element = document.createElement("i");
    element.className = icon || "fa-solid fa-cube";
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  static #isIconPath(icon) {
    return icon.includes("/") || /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(icon);
  }

  static #createPanel(group, panelId, tabId) {
    const panel = document.createElement("section");
    panel.id = panelId;
    panel.classList.add("sc-ma-create-panel");
    panel.dataset.scGroup = group.key;
    panel.setAttribute("aria-labelledby", tabId);
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("role", "tabpanel");

    const list = document.createElement("ol");
    list.classList.add("unlist", "card");
    list.append(...group.items);

    panel.append(list);
    return panel;
  }

  static #createElementId(prefix, type, groupKey, index) {
    const safeKey = String(groupKey ?? "group")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "group";
    return `${prefix}-${type}-${index}-${safeKey}`;
  }

  static #getKeyboardTargetIndex(event, tabs, currentIndex) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        return (currentIndex + 1) % tabs.length;
      case "ArrowUp":
      case "ArrowLeft":
        return (currentIndex - 1 + tabs.length) % tabs.length;
      case "Home":
        return 0;
      case "End":
        return tabs.length - 1;
      default:
        return null;
    }
  }

  static #resolveLabel(label, fallback) {
    if (!label) {
      return fallback;
    }
    return game.i18n.has?.(label) ? game.i18n.localize(label) : label;
  }

  static #resolveGroupIcon(icon, fallback) {
    const value = String(icon ?? "").trim();
    if (!value || value === "fa-solid fa-book" || value === "fas fa-book") {
      return fallback;
    }
    return value;
  }

  static #resolveRoot(html) {
    if (!html) {
      return null;
    }
    if (html instanceof Element || html?.querySelector) {
      return html;
    }
    if (html.jquery || typeof html.get === "function") {
      return html[0] ?? html.get(0) ?? null;
    }
    return null;
  }

  static #resolveApplicationElement(root) {
    return root.closest?.(".application") ?? root.closest?.(".app") ?? root;
  }
}
