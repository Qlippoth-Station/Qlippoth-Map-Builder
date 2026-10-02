// The "Random lists" dialog: create, edit, import and export the user's lists.

import { LAYER_NAMES } from "./document";
import type { Editor } from "./editor";
import { clear, h } from "./dom";
import {
  LIST_LAYERS,
  MAX_WEIGHT,
  createList,
  listFileName,
  parseList,
  sameList,
  serializeList,
  uniqueListId,
  type ListLayer,
  type TileList,
} from "./lists";
import { icon, listIcon } from "./ui";

const SEARCH_LIMIT = 60;

export interface ListsDialogHelpers {
  download(fileName: string, text: string): void;
  pickFiles(accept: string, multiple: boolean): Promise<File[]>;
}

/**
 * Adds list files to the library. A list with the same id and different content is only replaced after asking.
 * Returns one line per file for the user.
 */
export async function importListFiles(editor: Editor, files: File[]): Promise<string[]> {
  const report: string[] = [];
  for (const file of files) {
    try {
      const list = parseList(await file.text());
      const existing = editor.lists.get(list.id);
      if (existing && sameList(existing, list)) {
        report.push(`${file.name}: already loaded.`);
        continue;
      }
      if (existing && !window.confirm(`A different list with the id "${list.id}" (${existing.name}) is already loaded. Replace it with ${file.name}?`)) {
        report.push(`${file.name}: skipped, kept the loaded "${list.id}".`);
        continue;
      }
      editor.setList(list);
      report.push(`${file.name}: ${existing ? "replaced" : "added"} "${list.name}".`);
    } catch (error) {
      report.push(`${file.name}: ${(error as Error).message}`);
    }
  }
  return report;
}

/** Renders the dialog body into `host` and keeps it up to date while the dialog is open. */
export function buildListsDialog(editor: Editor, host: HTMLElement, helpers: ListsDialogHelpers, isOpen: () => boolean): void {
  const palette = editor.palette;
  const firstForLayer = [...editor.lists.values()].find((list) => list.layer === editor.activeLayer);
  let currentId: string | null = firstForLayer?.id ?? editor.lists.keys().next().value ?? null;
  let query = "";
  let message = "";

  const update = (list: TileList, changes: Partial<TileList>) => editor.setList({ ...list, ...changes });

  const newList = () => {
    const layer: ListLayer = (LIST_LAYERS as readonly string[]).includes(editor.activeLayer) ? (editor.activeLayer as ListLayer) : "structure";
    const name = window.prompt("Name of the new list (for example: Weak walls)", "");
    if (!name?.trim()) return;
    const list = createList(uniqueListId(name, editor.lists.keys()), name.trim(), layer);
    currentId = list.id;
    editor.setList(list);
  };

  const importLists = async () => {
    const files = await helpers.pickFiles(".json,application/json", true);
    if (files.length === 0) return;
    const report = await importListFiles(editor, files);
    message = report.join(" ");
    render();
  };

  const exportUsed = () => {
    const used = [...editor.usedLists()];
    const loaded = used.map((id) => editor.lists.get(id)).filter((list): list is TileList => !!list);
    for (const list of loaded) helpers.download(listFileName(list), serializeList(list));
    const missing = used.filter((id) => !editor.lists.has(id));
    message = loaded.length
      ? `Downloaded ${loaded.map(listFileName).join(", ")}.${missing.length ? ` Not loaded, so not exported: ${missing.join(", ")}.` : ""}`
      : "This domain uses no loaded lists.";
    render();
  };

  const renderSidebar = () => {
    const lists = [...editor.lists.values()].sort((a, b) => a.layer.localeCompare(b.layer) || a.name.localeCompare(b.name));
    if (lists.length === 0) return h("p", { class: "muted small" }, "No lists yet. Create one or import .list.json files.");
    return h(
      "div",
      { class: "list-index" },
      ...lists.map((list) =>
        h(
          "button",
          {
            type: "button",
            class: `palette-item${list.id === currentId ? " active" : ""}`,
            onclick: () => {
              currentId = list.id;
              query = "";
              render();
            },
          },
          listIcon(list),
          h("span", { class: "palette-name" }, list.name, h("small", {}, ` · ${LAYER_NAMES[list.layer]} · ${list.entries.length}`))
        )
      )
    );
  };

  const renderEditor = (list: TileList) => {
    const items = palette.byLayer[list.layer];
    const total = list.entries.reduce((sum, entry) => sum + entry.weight, 0);
    const search = h("input", { type: "search", placeholder: `Add ${LAYER_NAMES[list.layer].toLowerCase()} items: search name or id`, value: query, class: "list-search" });
    const results = h("div", { class: "list-results" });
    const renderResults = () => {
      const q = query.trim().toLowerCase();
      if (!q) return clear(results);
      const taken = new Set(list.entries.map((entry) => entry.id));
      const matches = [...items.values()].filter((item) => !taken.has(item.id) && (item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)));
      clear(
        results,
        ...matches.slice(0, SEARCH_LIMIT).map((item) =>
          h(
            "button",
            { type: "button", class: "palette-item", title: item.id, onclick: () => update(list, { entries: [...list.entries, { id: item.id, weight: 1 }] }) },
            icon(palette, item),
            h("span", { class: "palette-name" }, item.name)
          )
        ),
        matches.length === 0 ? h("p", { class: "muted small" }, "No matches.") : null
      );
    };
    search.addEventListener("input", () => {
      query = search.value;
      renderResults();
    });
    renderResults();

    return h(
      "div",
      { class: "list-editor" },
      h(
        "div",
        { class: "row" },
        h("label", { class: "field grow" }, h("span", {}, "Name"), h("input", { value: list.name, onchange: (event: Event) => update(list, { name: (event.target as HTMLInputElement).value.trim() || list.name }) })),
        h(
          "label",
          { class: "field narrow" },
          h("span", {}, "Icon"),
          h("input", {
            value: list.glyph,
            maxlength: 2,
            onchange: (event: Event) => update(list, { glyph: [...(event.target as HTMLInputElement).value.trim()].slice(0, 2).join("") || list.glyph }),
          })
        ),
        h(
          "label",
          { class: "field narrow" },
          h("span", {}, "Color"),
          h("input", { type: "color", value: list.color, onchange: (event: Event) => update(list, { color: (event.target as HTMLInputElement).value }) })
        ),
        h(
          "label",
          { class: "field", title: list.entries.length ? "Empty the list to change its layer" : "" },
          h("span", {}, "Layer"),
          h(
            "select",
            {
              disabled: list.entries.length > 0,
              onchange: (event: Event) => update(list, { layer: (event.target as HTMLSelectElement).value as ListLayer }),
            },
            ...LIST_LAYERS.map((layer) => h("option", { value: layer, selected: layer === list.layer }, LAYER_NAMES[layer]))
          )
        )
      ),
      h("p", { class: "muted small" }, "File: ", h("code", {}, listFileName(list)), ". Domains refer to the list by this id."),
      h("h3", {}, `Entries (${list.entries.length})`),
      list.entries.length === 0
        ? h("p", { class: "muted small" }, "Empty. Search below and click items to add them.")
        : h(
            "table",
            { class: "entries" },
            h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "Item"), h("th", { title: "Relative chance" }, "Weight"), h("th", {}, "Chance"), h("th", {}, ""))),
            h(
              "tbody",
              {},
              ...list.entries.map((entry, index) =>
                h(
                  "tr",
                  {},
                  h("td", {}, icon(palette, items.get(entry.id), entry.id)),
                  h("td", {}, h("div", {}, items.get(entry.id)?.name ?? "Unknown id"), h("code", {}, entry.id)),
                  h(
                    "td",
                    {},
                    h("input", {
                      type: "number",
                      min: 1,
                      max: MAX_WEIGHT,
                      value: String(entry.weight),
                      class: "weight",
                      onchange: (event: Event) => {
                        const weight = Math.min(MAX_WEIGHT, Math.max(1, Math.round(Number((event.target as HTMLInputElement).value)) || 1));
                        update(list, { entries: list.entries.map((other, i) => (i === index ? { ...other, weight } : other)) });
                      },
                    })
                  ),
                  h("td", { class: "muted" }, `${Math.round((entry.weight / total) * 100)}%`),
                  h(
                    "td",
                    {},
                    h("button", { type: "button", class: "ghost", title: "Remove", onclick: () => update(list, { entries: list.entries.filter((_, i) => i !== index) }) }, "✕")
                  )
                )
              )
            )
          ),
      search,
      results,
      h(
        "footer",
        {},
        h(
          "button",
          {
            type: "button",
            class: "danger",
            onclick: () => {
              const used = editor.usedLists().has(list.id);
              if (!window.confirm(`Remove "${list.name}" from this browser?${used ? " This domain uses it; its cells stay but show as not loaded." : ""}`)) return;
              editor.removeList(list.id);
              currentId = editor.lists.keys().next().value ?? null;
            },
          },
          "Delete"
        ),
        h("span", { class: "spacer" }),
        h("button", { type: "button", class: "primary", onclick: () => helpers.download(listFileName(list), serializeList(list)) }, "Export .list.json")
      )
    );
  };

  const render = () => {
    const list = currentId ? editor.lists.get(currentId) : undefined;
    const usedCount = editor.usedLists().size;
    const focused = document.activeElement instanceof HTMLInputElement && host.contains(document.activeElement) ? document.activeElement.className : null;
    clear(
      host,
      h(
        "div",
        { class: "lists-toolbar" },
        h("button", { type: "button", class: "secondary", onclick: newList }, "New list"),
        h("button", { type: "button", class: "secondary", onclick: importLists }, "Import…"),
        h(
          "button",
          { type: "button", class: "secondary", disabled: usedCount === 0, title: "Download every list this domain uses, to add them to a pull request", onclick: exportUsed },
          `Export lists used by this domain (${usedCount})`
        )
      ),
      message ? h("p", { class: "small notice" }, message) : null,
      h("div", { class: "lists-layout" }, renderSidebar(), list ? renderEditor(list) : h("p", { class: "muted small" }, "Select or create a list."))
    );
    // Keep typing in the item search after the list re-renders.
    if (focused === "list-search") {
      const input = host.querySelector<HTMLInputElement>(".list-search");
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }
  };

  // Enter in a field would submit the dialog form and close it.
  host.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      event.target.dispatchEvent(new Event("change"));
    }
  });

  render();
  const unsubscribe = editor.subscribe((topics) => {
    if (!isOpen()) return unsubscribe();
    if (topics.has("lists") || topics.has("cells") || topics.has("document")) render();
  });
}
