import "./style.css";
import { LAYERS, LAYER_NAMES, clampSize, createDocument, parseDocument, serialize, type DomainDocument } from "./document";
import { TOOLS, TOOL_INFO, Editor } from "./editor";
import { clear, h } from "./dom";
import { loadPalette, type Palette } from "./palette";
import { brushName, buildPalettePanel, buildSidebar, buildTopBar, newSeed } from "./ui";
import { parseList, serializeList, uniqueListId, type TileList } from "./lists";
import { loadBuiltInLists } from "./builtinLists";
import { ART_CREDITS, loadArt } from "./assets";
import { buildListsDialog, importListFiles, saveListsSomewhere, type ListsDialogHelpers } from "./listsDialog";
import { ListFolderLink } from "./listFolder";
import { MapView, isTyping } from "./view";

const AUTOSAVE_KEY = "qlippoth-domain-builder.autosave";
/** An autosave that could not be read is moved here instead of being overwritten by the next autosave. */
const UNREADABLE_AUTOSAVE_KEY = "qlippoth-domain-builder.autosave.unreadable";
/** The user's random lists, as an array of .list.json texts. */
const LISTS_KEY = "qlippoth-domain-builder.lists";
const app = document.getElementById("app")!;

// Browser storage can be missing or throw (private mode, blocked site data); the editor works without it.
function readAutosave(): string | null {
  try {
    return localStorage.getItem(AUTOSAVE_KEY);
  } catch {
    return null;
  }
}

function readListLibrary(): TileList[] {
  try {
    const texts: unknown = JSON.parse(localStorage.getItem(LISTS_KEY) ?? "[]");
    if (!Array.isArray(texts)) return [];
    return texts.flatMap((text) => {
      try {
        return [parseList(String(text))];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function writeAutosave(text: string, key = AUTOSAVE_KEY): void {
  try {
    localStorage.setItem(key, text);
  } catch {
    // Ignored: autosave is a convenience only.
  }
}

/** The autosaved document, or a new one. `notice` explains anything that went wrong while restoring. */
function initialDocument(): { doc: DomainDocument; notice: string | null } {
  const saved = readAutosave();
  if (saved) {
    try {
      const { document, problems } = parseDocument(saved);
      return { doc: document, notice: problems.length ? `Some of the autosaved domain could not be restored:\n\n${problems.join("\n")}` : null };
    } catch (error) {
      writeAutosave(saved, UNREADABLE_AUTOSAVE_KEY);
      return {
        doc: createDocument("Untitled domain", 20, 15),
        notice: `The autosaved domain could not be opened (${(error as Error).message}) and a new one was started. The old autosave is kept in this browser's storage under "${UNREADABLE_AUTOSAVE_KEY}".`,
      };
    }
  }
  return { doc: createDocument("Untitled domain", 20, 15), notice: null };
}

function fileName(name: string): string {
  const slug = name.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${slug || "domain"}.domain.json`;
}

function start(palette: Palette): void {
  const initial = initialDocument();
  const editor = new Editor(palette, initial.doc);
  const builtIn = loadBuiltInLists();
  editor.addBuiltInLists(builtIn.lists);
  const listNotices = builtIn.problems.map((problem) => `Built-in list skipped: ${problem}`);
  for (const list of readListLibrary()) {
    if (!editor.lists.get(list.id)?.builtIn) {
      editor.setList(list);
      continue;
    }
    // A list of this user now has the id of a built-in list. The built-in one wins; keep theirs under a new id.
    const id = uniqueListId(`${list.id}_mine`, editor.lists.keys());
    editor.setList({ ...list, id, name: `${list.name} (mine)` });
    listNotices.push(`Your list "${list.name}" has the id "${list.id}", which is now a built-in list. Domains using "${list.id}" now get the built-in list; your version is kept as "${id}".`);
  }
  if (listNotices.length) setTimeout(() => window.alert(listNotices.join("\n\n")), 0);
  editor.subscribe((topics) => {
    if (topics.has("lists")) writeAutosave(JSON.stringify(editor.userLists().map(serializeList)), LISTS_KEY);
  });
  if (initial.notice) setTimeout(() => window.alert(initial.notice), 0);
  const stage = h("section", { class: "stage" });
  const status = h("footer", { class: "statusbar" });
  const dialog = h("dialog", { class: "dialog" });

  const view = new MapView(editor, stage);
  const hoverText = h("span", { class: "hover" }, "");
  const stateText = h("span", { class: "state" });
  const selectionText = h("span", { class: "selection-info" });
  const noticeText = h("span", { class: "status-notice", role: "status" });
  let noticeTimer = 0;
  /** A short message in the status bar that goes away by itself. */
  const notify = (text: string) => {
    noticeText.textContent = text;
    noticeText.title = text;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => (noticeText.textContent = ""), 12000);
  };
  clear(
    status,
    hoverText,
    h("span", { class: "spacer" }),
    noticeText,
    selectionText,
    stateText,
    h("span", { class: "commit", title: "Game commit the palette was built from" }, palette.gameCommit ? `palette @ ${palette.gameCommit.slice(0, 8)}` : "palette")
  );

  view.onHover = (cell) => {
    if (!cell) {
      hoverText.textContent = "";
      return;
    }
    const [x, y] = cell;
    const contents = LAYERS.map((layer) => {
      const brush = editor.get(layer, x, y);
      if (!brush) return null;
      return `${LAYER_NAMES[layer]}: ${brushName(editor, layer, brush)}`;
    }).filter(Boolean);
    hoverText.textContent = `${x}, ${y}${contents.length ? "  ·  " + contents.join("  ·  ") : ""}`;
  };

  const confirmDiscard = () => !editor.dirty || window.confirm("You have unsaved changes. Discard them?");

  function download(name: string, text: string) {
    const blob = new Blob([text], { type: "application/json" });
    const link = h("a", { href: URL.createObjectURL(blob), download: name });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
    return new Promise((resolve) => {
      const input = h("input", { type: "file", accept, multiple });
      input.addEventListener("change", () => resolve([...(input.files ?? [])]));
      input.addEventListener("cancel", () => resolve([]));
      input.click();
    });
  }

  const listFolder = new ListFolderLink();
  const listHelpers: ListsDialogHelpers = { download, pickFiles, folder: listFolder };
  void listFolder.restore();

  const actions = {
    newDocument() {
      showNewDialog();
    },
    /** Opens a domain, list files, or both at once (a domain from a pull request together with its lists). */
    async open() {
      const files = await pickFiles(".json,application/json", true);
      const lists = files.filter((file) => file.name.endsWith(".list.json"));
      const domains = files.filter((file) => !file.name.endsWith(".list.json"));
      const report = lists.length ? await importListFiles(editor, lists) : [];
      if (domains.length > 1) report.push(`Only one domain can be open at a time; opened ${domains[0].name}.`);
      const file = domains[0];
      if (file && confirmDiscard()) {
        try {
          const { document, problems } = parseDocument(await file.text());
          editor.replaceDocument(document);
          view.fit();
          if (problems.length) report.push(`${file.name} was opened, but some of it could not be read:`, ...problems);
        } catch (error) {
          report.push(`Could not open ${file.name}: ${(error as Error).message}`);
        }
      }
      if (report.length && (domains.length === 0 || report.some((line) => !line.endsWith("already loaded.")))) window.alert(report.join("\n"));
    },
    async save() {
      download(fileName(editor.doc.name), serialize(editor.doc));
      editor.markSaved();
      // A domain is only complete with its lists: save them too, or say where they have to go.
      const lists = [...editor.usedLists()].map((id) => editor.lists.get(id)).filter((list): list is TileList => !!list && !list.builtIn);
      if (lists.length === 0) return;
      if (listFolder.ready) notify(`Domain saved. ${await saveListsSomewhere(lists, listHelpers)}`);
      else notify(`Domain saved. It uses ${lists.length} list(s) of yours: add them to the pull request too (Lists → Export lists used by this domain).`);
    },
    manageLists() {
      showListsDialog();
    },
    showCredits() {
      showCreditsDialog();
    },
    showHelp() {
      showHelpDialog();
    },
  };

  function openDialog(title: string, ...body: (Node | string)[]) {
    clear(
      dialog,
      h(
        "form",
        { method: "dialog", class: "dialog-body" },
        h("header", {}, h("h2", {}, title), h("button", { class: "ghost", value: "close", "aria-label": "Close" }, "✕")),
        ...body
      )
    );
    dialog.showModal();
  }

  function showNewDialog() {
    const name = h("input", { name: "name", value: "Untitled domain", required: true });
    const width = h("input", { name: "width", type: "number", value: "20", min: 1, max: 256, required: true });
    const height = h("input", { name: "height", type: "number", value: "15", min: 1, max: 256, required: true });
    openDialog(
      "New domain",
      h("label", { class: "field" }, h("span", {}, "Name"), name),
      h("div", { class: "row" }, h("label", { class: "field" }, h("span", {}, "Width"), width), h("label", { class: "field" }, h("span", {}, "Height"), height)),
      h(
        "footer",
        {},
        h("button", { class: "secondary", value: "cancel", formnovalidate: true }, "Cancel"),
        h(
          "button",
          {
            class: "primary",
            value: "create",
            onclick: (event: Event) => {
              if (!confirmDiscard()) {
                event.preventDefault();
                return;
              }
              editor.replaceDocument(createDocument(name.value.trim() || "Untitled domain", clampSize(Number(width.value)), clampSize(Number(height.value))));
              view.fit();
            },
          },
          "Create"
        )
      )
    );
    name.select();
  }

  function showListsDialog() {
    const body = h("div", { class: "lists-dialog" });
    openDialog("Random lists", body);
    buildListsDialog(editor, body, listHelpers, () => dialog.open);
  }

  function showHelpDialog() {
    const rows: [string, string][] = [
      ...TOOLS.map((tool): [string, string] => [TOOL_INFO[tool].key, TOOL_INFO[tool].name]),
      ...LAYERS.map((layer, index): [string, string] => [String(index + 1), `${LAYER_NAMES[layer]} layer`]),
      ["Right click", "Pick item under cursor"],
      ["Drag inside selection", "Move the selection and its contents"],
      ["Arrows / Shift+Arrows", "Move the selection by 1 / 5 cells"],
      ["Delete", "Clear the selected area on every layer"],
      ["Esc", "Drop the selection"],
      ["L / Shift+L", "Same pick for all list cells in the selection / undo that"],
      ["P", "Random preview on / off"],
      ["N", "New preview seed"],
      ["Space + drag / Middle drag", "Pan"],
      ["Wheel", "Zoom"],
      ["0", "Fit to view"],
      ["G / D", "Toggle grid / dim other layers"],
      ["/", "Search palette"],
      ["Ctrl+Z / Ctrl+Y", "Undo / Redo"],
      ["Ctrl+S / Ctrl+O", "Save / Open"],
    ];
    openDialog(
      "Shortcuts",
      h("table", { class: "shortcuts" }, h("tbody", {}, ...rows.map(([key, what]) => h("tr", {}, h("td", {}, h("kbd", {}, key)), h("td", {}, what)))))
    );
  }

  async function showCreditsDialog() {
    const body = h("div", { class: "credits" }, h("p", {}, "Loading…"));
    // The editor's own art (assets/) is listed first; it ships with the editor, so it never fails to load.
    const art = h(
      "section",
      { class: "art-credits" },
      h("h3", {}, "Editor art"),
      h(
        "p",
        {},
        "List symbols and map effects are the editor's own art, licensed under ",
        h("a", { href: "https://creativecommons.org/licenses/by-sa/3.0/", target: "_blank", rel: "noopener" }, "CC-BY-SA 3.0"),
        "."
      ),
      h(
        "ul",
        { class: "credit-list" },
        ...ART_CREDITS.map((credit) => h("li", {}, h("code", {}, credit.source), h("span", {}, ` · ${credit.license}`), h("p", {}, credit.copyright)))
      ),
      h("h3", {}, "Game sprites")
    );
    openDialog("Credits", art, body);
    try {
      const credits: { source: string; license?: string; copyright?: string }[] = await (await fetch("palette/credits.json")).json();
      const licenses = new Map<string, number>();
      for (const credit of credits) licenses.set(credit.license ?? "Unknown", (licenses.get(credit.license ?? "Unknown") ?? 0) + 1);
      clear(
        body,
        h(
          "p",
          {},
          "Sprites are taken from the Qlippoth Station game repository (a Space Station 14 fork) and keep their original licenses. ",
          "Each entry below lists the sprite source, license and copyright as recorded in the game files."
        ),
        h("ul", { class: "license-summary" }, ...[...licenses].sort((a, b) => b[1] - a[1]).map(([license, count]) => h("li", {}, h("strong", {}, license), ` · ${count} sprite sources`))),
        h(
          "details",
          {},
          h("summary", {}, `All ${credits.length} sources`),
          h(
            "ul",
            { class: "credit-list" },
            ...credits.map((credit) => h("li", {}, h("code", {}, credit.source), h("span", {}, ` · ${credit.license ?? "Unknown license"}`), credit.copyright ? h("p", {}, credit.copyright) : null))
          )
        )
      );
    } catch {
      clear(body, h("p", {}, "credits.json could not be loaded."));
    }
  }

  // ---- Status + autosave -------------------------------------------------------------------------

  let autosaveTimer = 0;
  editor.subscribe((topics) => {
    if (topics.has("view") || topics.has("document")) {
      const rect = editor.selection;
      selectionText.textContent = rect ? `selection ${rect.w}×${rect.h} at ${rect.x}, ${rect.y}` : "";
    }
    if (topics.has("history") || topics.has("cells") || topics.has("document")) {
      stateText.textContent = editor.dirty ? "Unsaved changes (autosaved in this browser)" : "No unsaved changes";
      window.clearTimeout(autosaveTimer);
      autosaveTimer = window.setTimeout(() => writeAutosave(serialize(editor.doc)), 600);
    }
  });
  stateText.textContent = "No unsaved changes";

  window.addEventListener("beforeunload", (event) => {
    if (editor.dirty) event.preventDefault();
  });

  // ---- Shortcuts ---------------------------------------------------------------------------------

  window.addEventListener("keydown", (event) => {
    if (dialog.open) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (ctrl) {
      const handled: Record<string, () => void> = {
        z: () => (event.shiftKey ? editor.redo() : editor.undo()),
        y: () => editor.redo(),
        s: () => actions.save(),
        o: () => actions.open(),
      };
      if (handled[key] && !(isTyping(event) && (key === "z" || key === "y"))) {
        event.preventDefault();
        handled[key]();
      }
      return;
    }
    if (isTyping(event) || event.altKey) return;

    // Selection keys: arrows move it with its contents, Delete clears it, Escape drops it.
    if (editor.selection) {
      const step = event.shiftKey ? 5 : 1;
      const arrows: Record<string, [number, number]> = {
        arrowleft: [-step, 0],
        arrowright: [step, 0],
        arrowup: [0, step],
        arrowdown: [0, -step],
      };
      if (arrows[key]) {
        event.preventDefault();
        return editor.moveSelection(...arrows[key]);
      }
      if (key === "delete" || key === "backspace") {
        event.preventDefault();
        return editor.clearSelection();
      }
      if (key === "escape") return editor.setSelection(null);
      if (key === "l") return editor.linkSelection(!event.shiftKey);
    }

    const tool = TOOLS.find((id) => TOOL_INFO[id].key.toLowerCase() === key);
    if (tool) return editor.setTool(tool);
    const layerIndex = Number(event.key) - 1;
    if (Number.isInteger(layerIndex) && layerIndex >= 0 && layerIndex < LAYERS.length) return editor.setLayer(LAYERS[layerIndex]);

    switch (key) {
      case "g":
        editor.showGrid = !editor.showGrid;
        editor.emit("view");
        break;
      case "d":
        editor.dimInactive = !editor.dimInactive;
        editor.emit("view");
        break;
      case "0":
        view.fit();
        break;
      case "p":
        editor.setPreview(editor.previewSeed === null ? newSeed() : null);
        break;
      case "n":
        if (editor.previewSeed !== null) editor.setPreview(newSeed());
        break;
      case "/":
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".search")?.focus();
        break;
    }
  });

  clear(
    app,
    buildTopBar(editor, actions),
    h("main", { class: "workspace" }, buildSidebar(editor, view), stage, buildPalettePanel(editor, actions)),
    status,
    dialog
  );
  requestAnimationFrame(() => view.fit());
}

async function main() {
  try {
    const [palette] = await Promise.all([loadPalette(), loadArt()]);
    start(palette);
  } catch (error) {
    clear(
      app,
      h(
        "div",
        { class: "fatal" },
        h("h1", {}, "Palette not found"),
        h("p", {}, "The editor needs a palette generated from the game repository. For local development run:"),
        h("pre", {}, "npm run palette   # with the game checked out next to this repository"),
        h("p", { class: "muted" }, String((error as Error).message))
      )
    );
  }
}

main();
