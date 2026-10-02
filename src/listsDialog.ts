// The "Random lists" dialog: create, edit, import and export the user's lists.

import { LAYER_NAMES } from "./document";
import type { Editor } from "./editor";
import { clear, h } from "./dom";
import {
  LIST_LAYERS,
  MAX_WEIGHT,
  chances,
  createList,
  equalChances,
  hasEmptyChoice,
  setEntryChance,
  type ListEntry,
  listFileName,
  parseList,
  sameList,
  serializeList,
  uniqueListId,
  type ListLayer,
  type TileList,
} from "./lists";
import { icon, listIcon } from "./ui";
import { SYMBOLS } from "./assets";
import { describeSave, folderSupported, readListFiles, type ListFolderLink } from "./listFolder";

const SEARCH_LIMIT = 60;

/** 62.5 -> "62.5", 50 -> "50". */
function formatChance(percent: number): string {
  return String(Math.round(percent * 10) / 10);
}

export interface ListsDialogHelpers {
  download(fileName: string, text: string): void;
  pickFiles(accept: string, multiple: boolean): Promise<File[]>;
  folder: ListFolderLink;
}

/** Where list files go in the game, shown wherever the user is told where to put them. */
export const GAME_LISTS_PATH = "Resources/Domains/Lists/";

/**
 * Saves lists where they belong: into the connected lists folder, or as downloads. Built-in lists are skipped; they
 * reach the game through `npm run lists:sync`. Returns a line for the user.
 */
export async function saveListsSomewhere(lists: TileList[], helpers: ListsDialogHelpers): Promise<string> {
  const link = helpers.folder;
  if (link.folder && link.ready) {
    try {
      return describeSave(await link.saveLists(lists), link.folder.name);
    } catch (error) {
      return `Could not write to the lists folder: ${(error as Error).message}`;
    }
  }
  const mine = lists.filter((list) => !list.builtIn);
  for (const list of mine) helpers.download(listFileName(list), serializeList(list));
  const builtIn = lists.length - mine.length;
  return [
    mine.length
      ? `Downloaded ${mine.map(listFileName).join(", ")}. Move ${mine.length > 1 ? "them" : "it"} into ${GAME_LISTS_PATH} of the game${folderSupported() ? ", or connect that folder above to save there directly" : ""}.`
      : "",
    builtIn ? `${builtIn} built-in list(s) skipped: they are already in the game.` : "",
  ]
    .filter(Boolean)
    .join(" ");
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
        report.push(`${file.name}: already loaded${existing.builtIn ? " (built in)" : ""}.`);
        continue;
      }
      if (existing?.builtIn) {
        report.push(`${file.name}: "${list.id}" is a built-in list and cannot be replaced. Give the list another id to import it.`);
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
  const firstForLayer = editor.userLists().find((list) => list.layer === editor.activeLayer) ?? [...editor.lists.values()].find((list) => list.layer === editor.activeLayer);
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

  const exportUsed = async () => {
    const used = [...editor.usedLists()];
    const loaded = used.map((id) => editor.lists.get(id)).filter((list): list is TileList => !!list);
    const missing = used.filter((id) => !editor.lists.has(id));
    message = loaded.length ? await saveListsSomewhere(loaded, helpers) : "This domain uses no loaded lists.";
    if (missing.length) message += ` Not loaded, so not saved: ${missing.join(", ")}.`;
    render();
  };

  const exportOne = async (list: TileList) => {
    // An explicit export of a built-in list still downloads it, e.g. to look at it or to send it to someone.
    if (list.builtIn && !(helpers.folder.folder && helpers.folder.ready)) {
      helpers.download(listFileName(list), serializeList(list));
      message = `Downloaded ${listFileName(list)}.`;
    } else {
      message = await saveListsSomewhere([list], helpers);
    }
    render();
  };

  const loadFromFolder = async () => {
    const folder = helpers.folder.folder;
    if (!folder) return;
    try {
      const report = await importListFiles(editor, await readListFiles(folder));
      const news = report.filter((line) => !line.includes("already loaded"));
      message = `Read ${report.length} list file(s) from "${folder.name}". ${news.length ? news.join(" ") : "Nothing new."}`;
    } catch (error) {
      message = `Could not read the lists folder: ${(error as Error).message}`;
    }
    render();
  };

  const renderFolder = () => {
    const link = helpers.folder;
    const button = (label: string, onclick: () => unknown, title = "") => h("button", { type: "button", class: "secondary", title, onclick }, label);
    if (!folderSupported()) {
      return h(
        "p",
        { class: "small muted folder-bar" },
        `Lists are saved as downloads. Put them in ${GAME_LISTS_PATH} of the game checkout next to this editor. (In Chrome or Edge the editor can save into that folder directly.)`
      );
    }
    if (!link.folder) {
      return h(
        "div",
        { class: "folder-bar" },
        h("span", { class: "small" }, "📁 No lists folder. Connect ", h("code", {}, GAME_LISTS_PATH), " of your game checkout to save lists straight into it:"),
        button("Connect lists folder…", async () => {
          if (await link.connect()) message = link.ready ? `Connected "${link.folder?.name}".` : "The folder was chosen, but the browser did not allow writing to it.";
          render();
        })
      );
    }
    return h(
      "div",
      { class: "folder-bar" },
      h("span", { class: "small" }, `📁 Lists folder: `, h("strong", {}, link.folder.name), link.ready ? " ✓" : " (needs permission)"),
      link.ready ? button("Load lists from folder", loadFromFolder, "Import every .list.json in the folder") : button("Reconnect", () => link.reconnect(), "The browser asks again after a reload"),
      button("Change…", async () => {
        await link.connect();
        render();
      }),
      button("Disconnect", () => link.disconnect())
    );
  };

  const select = (id: string) => {
    currentId = id;
    query = "";
    render();
  };

  const duplicate = (list: TileList) => {
    const name = `${list.name} (copy)`;
    const copy: TileList = { ...list, id: uniqueListId(name, editor.lists.keys()), name, builtIn: false, entries: list.entries.map((entry) => ({ ...entry })) };
    editor.setList(copy);
    select(copy.id);
  };

  const renderSidebar = () => {
    const sorted = [...editor.lists.values()].sort((a, b) => a.layer.localeCompare(b.layer) || a.name.localeCompare(b.name));
    if (sorted.length === 0) return h("p", { class: "muted small" }, "No lists yet. Create one or import .list.json files.");
    const button = (list: TileList) =>
      h(
        "button",
        { type: "button", class: `palette-item${list.id === currentId ? " active" : ""}`, onclick: () => select(list.id) },
        listIcon(list),
        h("span", { class: "palette-name" }, list.name, h("small", {}, ` · ${LAYER_NAMES[list.layer]} · ${list.entries.length}`))
      );
    const builtIn = sorted.filter((list) => list.builtIn);
    const mine = sorted.filter((list) => !list.builtIn);
    return h(
      "div",
      { class: "list-index" },
      builtIn.length ? h("h3", { title: "Part of the game; read-only" }, "🔒 Built in") : null,
      ...builtIn.map(button),
      h("h3", {}, "My lists"),
      ...(mine.length ? mine.map(button) : [h("p", { class: "muted small" }, "None yet.")])
    );
  };

  const renderSymbols = (list: TileList, locked: boolean) => {
    const option = (symbol: string | undefined, label: string, content: HTMLElement) =>
      h(
        "button",
        {
          type: "button",
          class: `symbol-option${list.symbol === symbol ? " active" : ""}`,
          title: label,
          "aria-pressed": String(list.symbol === symbol),
          disabled: locked,
          onclick: () => update(list, symbol ? { symbol } : { symbol: undefined }),
        },
        content
      );
    return h(
      "div",
      { class: "field" },
      h("span", {}, "Symbol"),
      h(
        "div",
        { class: "symbol-grid" },
        option(undefined, `Letter: ${list.glyph}`, listIcon({ ...list, symbol: undefined })),
        ...SYMBOLS.map((symbol) => option(symbol.id, symbol.name, listIcon({ ...list, symbol: symbol.id }))),
        SYMBOLS.length === 0 ? h("span", { class: "muted small" }, "No symbols yet: add images to assets/list-symbols/.") : null
      )
    );
  };

  const renderEntries = (list: TileList, locked: boolean) => {
    const items = palette.byLayer[list.layer];
    if (list.entries.length === 0) return h("p", { class: "muted small" }, locked ? "Empty." : "Empty. Search below and click items to add them.");

    // While a slider is dragged the other rows follow live; the list is only saved when it is released.
    const rows: { range: HTMLInputElement; number: HTMLInputElement }[] = [];
    const show = (entries: ListEntry[]) =>
      chances(entries).forEach((chance, i) => {
        rows[i].range.value = String(chance);
        if (document.activeElement !== rows[i].number) rows[i].number.value = formatChance(chance);
      });
    const percents = chances(list.entries);
    const single = list.entries.length === 1;

    return h(
      "table",
      { class: "entries" },
      h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "Item"), h("th", { colspan: 2 }, "Chance"), h("th", {}, ""))),
      h(
        "tbody",
        {},
        ...list.entries.map((entry, index) => {
          const range = h("input", {
            type: "range",
            min: 0.1,
            max: 99.9,
            step: 0.1,
            value: String(percents[index]),
            class: "chance-range",
            disabled: locked || single,
            "aria-label": `Chance of ${entry.id ?? "nothing"}`,
            oninput: () => show(setEntryChance(list.entries, index, Number(range.value))),
            onchange: () => update(list, { entries: setEntryChance(list.entries, index, Number(range.value)) }),
          });
          const number = h("input", {
            type: "number",
            min: 0.1,
            max: 99.9,
            step: 0.1,
            value: formatChance(percents[index]),
            class: "chance-number",
            disabled: locked || single,
            "aria-label": `Chance of ${entry.id ?? "nothing"} in percent`,
            onchange: () => {
              const value = Number(number.value);
              if (Number.isFinite(value)) update(list, { entries: setEntryChance(list.entries, index, value) });
            },
          });
          rows.push({ range, number });
          const item = entry.id === null ? undefined : items.get(entry.id);
          return h(
            "tr",
            { class: entry.id === null ? "empty-choice" : "" },
            h("td", {}, entry.id === null ? h("span", { class: "icon glyph empty-icon", title: "Nothing" }, "∅") : icon(palette, item, entry.id)),
            entry.id === null
              ? h("td", {}, h("div", {}, "Nothing"), h("code", {}, "the cell stays empty"))
              : h("td", {}, h("div", {}, item?.name ?? "Unknown id"), h("code", {}, entry.id)),
            h("td", { class: "chance-cell" }, range),
            h("td", { class: "chance-cell" }, number, h("span", { class: "muted" }, " %")),
            h(
              "td",
              {},
              locked
                ? null
                : h("button", { type: "button", class: "ghost", title: "Remove", onclick: () => update(list, { entries: list.entries.filter((_, i) => i !== index) }) }, "✕")
            )
          );
        })
      )
    );
  };

  const renderEditor = (list: TileList) => {
    const locked = !!list.builtIn;
    const items = palette.byLayer[list.layer];
    const search = h("input", { type: "search", placeholder: `Add ${LAYER_NAMES[list.layer].toLowerCase()} items: search name or id`, value: query, class: "list-search" });
    const results = h("div", { class: "list-results" });
    // A new entry starts with an average share, not with the smallest one.
    const newWeight = () => (list.entries.length ? Math.min(MAX_WEIGHT, Math.max(1, Math.round(list.entries.reduce((sum, entry) => sum + entry.weight, 0) / list.entries.length))) : 1);
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
            { type: "button", class: "palette-item", title: item.id, onclick: () => update(list, { entries: [...list.entries, { id: item.id, weight: newWeight() }] }) },
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
      locked
        ? h(
            "p",
            { class: "small notice locked" },
            "🔒 Built-in list: part of the game, so it cannot be changed here. ",
            h("button", { type: "button", class: "secondary", onclick: () => duplicate(list) }, "Duplicate as my list"),
            " to make your own version."
          )
        : null,
      h(
        "div",
        { class: "row" },
        h(
          "label",
          { class: "field grow" },
          h("span", {}, "Name"),
          h("input", { value: list.name, disabled: locked, onchange: (event: Event) => update(list, { name: (event.target as HTMLInputElement).value.trim() || list.name }) })
        ),
        h(
          "label",
          { class: "field narrow", title: "Shown when the list has no symbol" },
          h("span", {}, "Letter"),
          h("input", {
            value: list.glyph,
            maxlength: 2,
            disabled: locked,
            onchange: (event: Event) => update(list, { glyph: [...(event.target as HTMLInputElement).value.trim()].slice(0, 2).join("") || list.glyph }),
          })
        ),
        h(
          "label",
          { class: "field narrow" },
          h("span", {}, "Color"),
          h("input", { type: "color", value: list.color, disabled: locked, onchange: (event: Event) => update(list, { color: (event.target as HTMLInputElement).value }) })
        ),
        h(
          "label",
          { class: "field", title: list.entries.length ? "Empty the list to change its layer" : "" },
          h("span", {}, "Layer"),
          h(
            "select",
            {
              disabled: locked || list.entries.length > 0,
              onchange: (event: Event) => update(list, { layer: (event.target as HTMLSelectElement).value as ListLayer }),
            },
            ...LIST_LAYERS.map((layer) => h("option", { value: layer, selected: layer === list.layer }, LAYER_NAMES[layer]))
          )
        )
      ),
      renderSymbols(list, locked),
      h("p", { class: "muted small" }, "File: ", h("code", {}, listFileName(list)), ". Domains refer to the list by this id."),
      h("h3", {}, `Entries (${list.entries.length})`),
      renderEntries(list, locked),
      locked
        ? null
        : h(
            "div",
            { class: "entry-actions" },
            h(
              "button",
              {
                type: "button",
                class: "secondary",
                disabled: hasEmptyChoice(list),
                title: "Adds a choice that leaves the cell empty, e.g. a crate that is only there sometimes",
                onclick: () => update(list, { entries: [...list.entries, { id: null, weight: newWeight() }] }),
              },
              "Add empty choice"
            ),
            h(
              "button",
              { type: "button", class: "secondary", disabled: list.entries.length < 2, onclick: () => update(list, { entries: equalChances(list.entries) }) },
              "Equal chances"
            )
          ),
      locked ? null : search,
      locked ? null : results,
      h(
        "footer",
        {},
        locked
          ? null
          : h(
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
        locked ? null : h("button", { type: "button", class: "secondary", onclick: () => duplicate(list) }, "Duplicate"),
        h("span", { class: "spacer" }),
        h(
          "button",
          { type: "button", class: "primary", onclick: () => exportOne(list) },
          helpers.folder.ready && !list.builtIn ? "Save to lists folder" : "Export .list.json"
        )
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
          { type: "button", class: "secondary", disabled: usedCount === 0, title: "Every list of yours this domain uses, to add to the pull request next to it", onclick: exportUsed },
          `${helpers.folder.ready ? "Save" : "Export"} lists used by this domain (${usedCount})`
        )
      ),
      renderFolder(),
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
  const unsubscribeFolder = helpers.folder.subscribe(() => (isOpen() ? render() : unsubscribeFolder()));
}
