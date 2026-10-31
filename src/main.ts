import "./style.css";
import { LAYER_NAMES, clampSize, createDocument, deserialize, itemsOf, serialize, type MapDocument } from "./document";
import { ACTIONS, ACTION_INFO, Editor, SHAPES, SHAPE_INFO } from "./editor";
import { clear, h } from "./dom";
import { MODE_INFO, type ModeId } from "./modes";
import { parseRepository } from "./codebase/github";
import {
  customCodebases,
  customId,
  DEFAULT_CODEBASE,
  registeredCodebases,
  removeCustomCodebase,
  saveCustomCodebase,
  setCurrentCodebase,
  type CodebaseInfo,
  type CustomCodebase,
} from "./codebase/store";
import type { WorkerMessage } from "./codebase/worker";
import { diffCodebases, type DiffGroup } from "./codebase/diff";
import { GameFolder, type FolderFile } from "./gamefolder";
import { findItem, loadCodebaseItems, loadPalette, type Palette } from "./palette";
import { autosaveText, readAutosave } from "./autosave";
import { exportStation, teleportTarget } from "./station/export";
import { exportPackage } from "./station/gamemap";
import { importStation } from "./station/import";
import { loadAutosaves, saveAutosave, saveLastMode, type Autosaves } from "./storage";
import { ModuleLibrary, type ModuleRecord } from "./modules";
import { RandomSetLibrary } from "./randomsets";
import { exportProject, openProject, slug } from "./project";
import { buildRightSidebar, buildSidebar, buildTopBar } from "./ui";
import { MapView, isTyping } from "./view";
import { key, openGuide, p, ui } from "./guide";

const app = document.getElementById("app")!;

function fileName(name: string, mode: ModeId): string {
  const slug = name.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${slug || mode}${MODE_INFO[mode].fileSuffix}`;
}

/** A game console command with a Copy button and what it does. */
function command(text: string, hint: string): HTMLElement {
  return h(
    "div",
    { class: "command" },
    h("code", {}, text),
    h("button", { type: "button", class: "ghost", title: "Copy", onclick: () => void navigator.clipboard?.writeText(text) }, "Copy"),
    h("span", { class: "muted" }, hint)
  );
}

function download(blob: Blob, name: string): void {
  const link = h("a", { href: URL.createObjectURL(blob), download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function start(palette: Palette, autosaves: Autosaves): void {
  // The autosave of a mode, or a fresh document when there is none (or it is corrupt or outdated).
  const documentFor = (mode: ModeId): MapDocument => {
    const saved = autosaves.documents[mode];
    if (saved) {
      try {
        const doc = readAutosave(saved, palette);
        if (doc.mode === mode) return doc;
      } catch {
        // Start fresh.
      }
    }
    const info = MODE_INFO[mode];
    return createDocument(mode, info.defaultName, ...info.defaultSize);
  };

  const editor = new Editor(palette, documentFor(autosaves.lastMode ?? "domain"));
  const gameFolder = new GameFolder();
  void gameFolder.restore();
  const library = new ModuleLibrary();
  void library.load();
  const randomSets = new RandomSetLibrary();
  void randomSets.load();
  editor.randomSets = randomSets;
  randomSets.subscribe(() => editor.emit("selection"));
  const stage = h("section", { class: "stage", "data-guide": "stage" });
  const status = h("footer", { class: "statusbar", "data-guide": "statusbar" });
  const dialog = h("dialog", { class: "dialog" });

  const view = new MapView(editor, stage);
  const hoverText = h("span", { class: "hover" }, "");
  const stateText = h("span", { class: "state" });
  clear(
    status,
    hoverText,
    h("span", { class: "spacer" }),
    stateText,
    h(
      "button",
      { class: "commit ghost", "data-guide": "commit", title: "Game codebase and commit the palette was built from (change in Codebase)", onclick: () => showCodebaseDialog() },
      `${palette.codebase.name}${palette.gameCommit ? ` @ ${palette.gameCommit.slice(0, 8)}` : ""}`
    )
  );

  let hovered: [number, number] | null = null;
  view.onHover = (cell) => {
    hovered = cell;
    if (!cell) {
      hoverText.textContent = "";
      return;
    }
    const [x, y] = cell;
    const contents = editor.layers.map((layer) => {
      const items = itemsOf(editor.get(layer, x, y));
      if (items.length === 0) return null;
      const names = items.map((item) => (item.spawner ? `random ${item.spawner.name}` : findItem(palette, layer, item.id)?.name ?? item.id));
      return `${LAYER_NAMES[layer]}: ${names.join(", ")}`;
    }).filter(Boolean);
    // Imported stations also show the game's grid coordinates of the tile.
    const station = editor.doc.station;
    const grid = station ? ` (grid ${x + station.originX}, ${y + station.originY})` : "";
    hoverText.textContent = `${x}, ${y}${grid}${contents.length ? "  ·  " + contents.join("  ·  ") : ""}`;
  };

  const confirmDiscard = (mode: ModeId = editor.mode) =>
    !editor.isDirty(mode) || window.confirm(`You have unsaved changes in ${MODE_INFO[mode].name} mode. Discard them?`);

  /** Reads an editor .json file, or a game map .yml as a station. */
  const readDocument = (text: string, fileName: string): MapDocument =>
    text.startsWith("meta:") ? importStation(text, palette, fileName.replace(/\.(ya?ml)$/i, "")) : deserialize(text);

  /**
   * A library module as a document. Station modules saved from a selection were written into a new-station map,
   * which centres them on the grid; reading them with that layout keeps empty rows and columns at their edges.
   */
  const readModule = (module: ModuleRecord): MapDocument => {
    if (module.mode !== "station") return deserialize(module.text);
    const layout = { originX: -Math.floor(module.width / 2), originY: -Math.floor(module.height / 2), width: module.width, height: module.height };
    return importStation(module.text, palette, module.name, layout);
  };

  /** Lets the user pick a file and reads it as a map document. */
  const pickDocument = (handle: (doc: MapDocument, file: File) => void) => {
    const input = h("input", { type: "file", accept: ".json,.yml,.yaml,application/json" });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        handle(readDocument(await file.text(), file.name), file);
      } catch (error) {
        window.alert(`Could not open ${file.name}: ${(error as Error).message}`);
      }
    });
    input.click();
  };

  const actions = {
    switchMode(mode: ModeId) {
      if (mode === editor.mode) return;
      editor.switchMode(mode, () => documentFor(mode));
      saveLastMode(mode);
      view.fit();
    },
    newDocument() {
      showNewDialog();
    },
    open() {
      // The file decides the mode; opening a station file while in domain mode switches to station mode.
      pickDocument((doc) => {
        if (!confirmDiscard(doc.mode)) return;
        editor.replaceDocument(doc);
        saveLastMode(doc.mode);
        view.fit();
      });
    },
    /** Brings another file of the same mode into the current map as floating content, centred in the view. */
    add() {
      pickDocument((doc, file) => actions.addDocument(doc, file.name));
    },
    /** Brings a document of the same mode in as floating content, centred in the view (offering to grow the map). */
    addDocument(doc: MapDocument, label: string, module?: ModuleRecord) {
      const target = MODE_INFO[editor.mode].name.toLowerCase();
      if (doc.mode !== editor.mode) {
        window.alert(`${label} is a ${MODE_INFO[doc.mode].name.toLowerCase()} file. Only ${target} files can be added to a ${target}.`);
        return;
      }
      const { width, height } = editor.doc;
      if (doc.width > width || doc.height > height) {
        const [w, h] = [Math.max(width, doc.width), Math.max(height, doc.height)];
        const grow = window.confirm(
          `${label} is ${doc.width}×${doc.height}, larger than this ${target} (${width}×${height}).\n\n` +
            `OK: enlarge the map to ${w}×${h}.\nCancel: keep the size; parts outside the map are left out when placed.`
        );
        if (grow) editor.resize(w, h);
      }
      const [cx, cy] = view.centerCell();
      const place = (center: number, size: number, room: number) => Math.max(0, Math.min(room - size, center - Math.floor(size / 2)));
      const info = module && { id: module.id, name: module.name, version: module.updated, width: doc.width, height: doc.height };
      editor.addDocument(doc, place(cx, doc.width, editor.doc.width), place(cy, doc.height, editor.doc.height), info);
    },

    // ---- Random sets and rooms ----
    newSet() {
      const layer = editor.activeLayer;
      const name = window.prompt(`Name of the new ${LAYER_NAMES[layer]} set:`, `Random ${LAYER_NAMES[layer].toLowerCase()} ${randomSets.forMode(editor.mode).length + 1}`)?.trim();
      if (name) randomSets.create(name, editor.mode, layer);
    },
    addRoomSlot() {
      const name = window.prompt("Name of the room slot (e.g. Theater):", `Room ${editor.roomSlots.length + 1}`)?.trim();
      if (name) editor.addRoomSlot(name);
    },

    // ---- Modules and projects ----
    saveSelectionAsModule() {
      const suggested = `Module ${library.forMode(editor.mode).length + 1}`;
      const name = window.prompt("Module name (a module with the same name gets a new version):", suggested)?.trim();
      if (!name) return;
      const doc = editor.selectionDocument(name);
      if (!doc) return;
      try {
        const text = doc.mode === "station" ? exportStation(doc, palette).text : serialize(doc);
        library.put({ name, mode: doc.mode, width: doc.width, height: doc.height, text });
      } catch (error) {
        window.alert(`Could not save the module: ${(error as Error).message}`);
      }
    },
    importModule() {
      pickDocument((doc, file) => {
        const name = file.name.replace(/\.(ya?ml|json)$/i, "").replace(/\.domain$/, "");
        const text = doc.mode === "station" ? exportStation(doc, palette).text : serialize(doc);
        library.put({ name, mode: doc.mode, width: doc.width, height: doc.height, text });
      });
    },
    placeModule(module: ModuleRecord) {
      try {
        actions.addDocument(readModule(module), module.name, module);
      } catch (error) {
        window.alert(`Could not place ${module.name}: ${(error as Error).message}`);
      }
    },
    updateModule(module: ModuleRecord) {
      try {
        editor.updateInstances(module.id, readModule(module), module.updated);
      } catch (error) {
        window.alert(`Could not update ${module.name}: ${(error as Error).message}`);
      }
    },
    exportModule(module: ModuleRecord) {
      download(new Blob([module.text], { type: "text/plain" }), `${slug(module.name)}${MODE_INFO[module.mode].fileSuffix}`);
    },
    deleteModule(module: ModuleRecord) {
      if (window.confirm(`Remove ${module.name} from the library? Placed copies stay in the maps.`)) library.remove(module.id);
    },
    exportProject() {
      editor.commitFloating();
      try {
        download(exportProject(editor.doc, palette, library), `${slug(editor.doc.name)}.project.zip`);
      } catch (error) {
        window.alert(`Could not save the project: ${(error as Error).message}`);
      }
    },
    openProject() {
      const input = h("input", { type: "file", accept: ".zip,application/zip" });
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const { doc, otherCodebase } = await openProject(await file.arrayBuffer(), palette, library);
          if (otherCodebase && !window.confirm(`This project was made with ${otherCodebase}; the palette is ${palette.codebase.repository}. Ids it does not know are listed in Checks. Open it anyway?`)) return;
          if (!confirmDiscard(doc.mode)) return;
          editor.replaceDocument(doc);
          saveLastMode(doc.mode);
          view.fit();
        } catch (error) {
          window.alert(`Could not open ${file.name}: ${(error as Error).message}`);
        }
      });
      input.click();
    },
    save() {
      editor.commitFloating();
      // Stations are saved as game map files; domains as editor .json files.
      let text: string;
      try {
        text = editor.mode === "station" ? exportStation(editor.doc, palette).text : serialize(editor.doc);
      } catch (error) {
        window.alert(`Could not save: ${(error as Error).message}`);
        return;
      }
      download(new Blob([text], { type: editor.mode === "station" ? "text/yaml" : "application/json" }), fileName(editor.doc.name, editor.mode));
      editor.markSaved();
    },
    showCredits() {
      showCreditsDialog();
    },
    showGuide() {
      showGuideDialog();
    },
    showHelp() {
      showHelpDialog();
    },
    showGame() {
      showGameDialog();
    },
    showCodebase() {
      showCodebaseDialog();
    },
    /** Exportable stations: the map, its gameMap prototype and a README in one .zip. */
    exportPackage() {
      editor.commitFloating();
      const problems = editor.validate();
      const critical = problems.filter((problem) => problem.level === "error").length;
      const summary = `${problems.length} problem(s)${critical ? `, ${critical} of them critical` : ""}`;
      if (problems.length && !window.confirm(`The checks list ${summary}. Export the package anyway?`)) return;
      const base = fileName(editor.doc.name, "station").replace(/\.yml$/, "");
      try {
        const moduleDocument = (id: string) => {
          const module = library.get(id);
          return module ? readModule(module) : null;
        };
        download(exportPackage(editor.doc, palette, base, moduleDocument), `${base}.zip`);
      } catch (error) {
        window.alert(`Could not export: ${(error as Error).message}`);
      }
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
    const info = MODE_INFO[editor.mode];
    const name = h("input", { name: "name", value: info.defaultName, required: true });
    const width = h("input", { name: "width", type: "number", value: String(info.defaultSize[0]), min: 1, max: info.maxSize, required: true });
    const height = h("input", { name: "height", type: "number", value: String(info.defaultSize[1]), min: 1, max: info.maxSize, required: true });
    openDialog(
      `New ${info.name.toLowerCase()}`,
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
              editor.replaceDocument(
                createDocument(info.id, name.value.trim() || info.defaultName, clampSize(Number(width.value), info.maxSize), clampSize(Number(height.value), info.maxSize))
              );
              view.fit();
            },
          },
          "Create"
        )
      )
    );
    name.select();
  }

  function showHelpDialog() {
    const rows: [string, string][] = [
      ...ACTIONS.map((action): [string, string] => [ACTION_INFO[action].key, `${ACTION_INFO[action].name} action`]),
      ...SHAPES.map((shape): [string, string] => [SHAPE_INFO[shape].key, `${SHAPE_INFO[shape].name} shape`]),
      ...editor.layers.map((layer, index): [string, string] => [String(index + 1), `${LAYER_NAMES[layer]} layer`]),
      ["Right click", "Pick item under cursor and show the cell"],
      ["Shift / Alt + click", "Add to / remove from the selection"],
      ["Drag selection / Arrows", "Move the selection (Shift + arrow: 10 cells)"],
      ["Enter / Esc", "Place moved content / cancel or deselect"],
      ["Delete", "Erase the selection"],
      ["T / Shift+T", "Turn the selection, or the item to place (stations), a quarter clockwise / counter-clockwise"],
      ["Ctrl+A / Ctrl+D", "Select all / deselect"],
      ["Space + drag / Middle drag", "Pan"],
      ["Wheel", "Zoom"],
      ["0", "Fit to view"],
      ["G / D", "Toggle grid / dim other layers"],
      ["/", "Search palette"],
      ["Ctrl+Z / Ctrl+Y", "Undo / Redo"],
      ["Ctrl+S / Ctrl+O", "Save / Open"],
      ["Ctrl+Shift+O", "Add a file into this map"],
    ];
    openDialog(
      "Shortcuts",
      h("table", { class: "shortcuts" }, h("tbody", {}, ...rows.map(([key, what]) => h("tr", {}, h("td", {}, h("kbd", {}, key)), h("td", {}, what)))))
    );
  }

  /**
   * Which game the palette comes from: Qlippoth Station, codebases served with the site, or any public SS14 fork
   * added from its GitHub link (built in the browser and kept there). Switching reloads the page.
   */
  function showCodebaseDialog() {
    const body = h("div", { class: "codebases" });
    openDialog("Codebase", body);
    const link = h("input", { type: "text", placeholder: "https://github.com/owner/repo  or  owner/repo", "aria-label": "GitHub repository", class: "repo-link" });
    const progress = h("progress", { max: 1, value: 0, hidden: true });
    const status = h("p", { class: "muted" });
    let worker: Worker | null = null;

    const use = async (id: string | null) => {
      flushAutosaves();
      await setCurrentCodebase(id);
      location.reload();
    };

    /** Before switching: which objects the other codebase drops and adds, by the file they are defined in. */
    const review = async (info: CodebaseInfo) => {
      const id = info.id === DEFAULT_CODEBASE.id ? null : info.id;
      worker?.terminate();
      worker = null;
      clear(body, h("p", { class: "muted" }, `Comparing ${palette.codebase.name} with ${info.name}…`));
      const next = await loadCodebaseItems(id);
      const back = h("button", { type: "button", class: "secondary", onclick: () => void render() }, "Back");
      const go = h("button", { type: "button", class: "primary", onclick: () => void use(id) }, `Use ${info.name}`);
      if (!next) {
        clear(
          body,
          h("p", {}, `The palette of ${info.name} could not be read, so the changes cannot be listed. You can still switch to it.`),
          h("footer", { class: "button-row end" }, back, go)
        );
        return;
      }
      const diff = diffCodebases(palette.items, next, [editor.doc]);
      const files = (groups: DiffGroup[]) => {
        const byFile = groups.every((group) => group.byFile);
        return `${groups.length} ${byFile ? (groups.length === 1 ? "file" : "files") : groups.length === 1 ? "category" : "categories"}`;
      };
      const groupRow = (group: DiffGroup) =>
        h(
          "li",
          {},
          h(
            "details",
            {},
            h("summary", {}, h("span", { class: group.byFile ? "diff-file" : "diff-category" }, group.label), h("span", { class: "diff-count" }, String(group.items.length))),
            h(
              "ul",
              { class: "diff-items" },
              ...group.items.slice(0, 60).map((item) => h("li", {}, item.name, h("span", { class: "muted" }, item.id))),
              group.items.length > 60 ? h("li", { class: "muted" }, `and ${group.items.length - 60} more`) : null
            )
          )
        );
      const section = (kind: "removed" | "added", groups: DiffGroup[], count: number) => {
        if (count === 0) return h("p", { class: "muted" }, kind === "removed" ? "Nothing is removed." : "Nothing is added.");
        const shown = groups.slice(0, 12);
        const rest = groups.slice(12);
        return h(
          "section",
          { class: `diff-section ${kind}` },
          h("h3", {}, kind === "removed" ? `Removed: ${count} objects from ${files(groups)}` : `Added: ${count} objects in ${files(groups)}`),
          h("ul", { class: "diff-groups" }, ...shown.map(groupRow)),
          rest.length
            ? h(
                "details",
                { class: "diff-rest" },
                h("summary", {}, `${rest.length} more with ${rest.reduce((sum, group) => sum + group.items.length, 0)} objects`),
                h("ul", { class: "diff-groups" }, ...rest.map(groupRow))
              )
            : null
        );
      };
      const noFiles = [...diff.removed, ...diff.added].some((group) => !group.byFile);
      clear(
        body,
        h("p", { class: "diff-lead" }, `Switching from ${palette.codebase.name} to ${info.name} changes the palette like this:`),
        h(
          "div",
          { class: "diff-totals" },
          h("div", { class: "diff-total removed" }, h("span", { class: "diff-number" }, `−${diff.removedCount}`), h("span", {}, `objects removed${diff.removedCount ? ` from ${files(diff.removed)}` : ""}`)),
          h("div", { class: "diff-total added" }, h("span", { class: "diff-number" }, `+${diff.addedCount}`), h("span", {}, `objects added${diff.addedCount ? ` in ${files(diff.added)}` : ""}`))
        ),
        diff.placedRemoved
          ? h("p", { class: "warning error" }, `${diff.placedRemoved} objects placed in the open map are not in ${info.name}. Checks will list them, and the game will not load the map until they are replaced.`)
          : null,
        diff.renamed ? h("p", { class: "muted" }, `${diff.renamed} more ids are renamed in ${info.name}; maps that use them keep working.`) : null,
        section("removed", diff.removed, diff.removedCount),
        section("added", diff.added, diff.addedCount),
        noFiles ? h("p", { class: "muted" }, "One of the palettes was built before files were recorded, so its objects are grouped by palette category.") : null,
        h("footer", { class: "button-row end" }, back, go)
      );
    };

    const build = () => {
      const repository = parseRepository(link.value);
      if (!repository) {
        status.textContent = "Enter a GitHub repository: owner/repo or its https://github.com/... link.";
        return;
      }
      worker?.terminate();
      worker = new Worker(new URL("./codebase/worker.ts", import.meta.url), { type: "module" });
      progress.hidden = false;
      status.textContent = "Reading the repository…";
      const stages: Record<string, string> = { listing: "Listing files", prototypes: "Reading prototypes", sprites: "Reading sprite data", images: "Loading sprites" };
      worker.onmessage = async (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === "progress") {
          progress.max = message.total;
          progress.value = message.done;
          status.textContent = `${stages[message.stage] ?? message.stage}… ${message.done} / ${message.total}`;
          return;
        }
        worker?.terminate();
        worker = null;
        progress.hidden = true;
        if (message.type === "error") {
          status.textContent = `Could not build the palette: ${message.message}`;
          return;
        }
        const name = `${repository.owner}/${repository.repo}`;
        const codebase: CustomCodebase = {
          id: customId(name, repository.ref),
          name: repository.repo,
          repository: name,
          ref: message.ref,
          commit: message.commit,
          palette: { ...message.palette, gameCommit: message.commit },
          atlas: message.atlas,
          credits: message.credits,
          built: Date.now(),
        };
        const items = (message.palette as { items: unknown[] }).items.length;
        if (!(await saveCustomCodebase(codebase))) {
          status.textContent = "Built, but the browser refused to store it (private mode?).";
          return;
        }
        status.textContent = `Built ${items} palette items from ${name} @ ${message.commit.slice(0, 8)}.`;
        void render();
      };
      worker.postMessage(repository);
    };

    const render = async () => {
      const [registered, custom] = await Promise.all([registeredCodebases(), customCodebases()]);
      const current = palette.codebase.id;
      const row = (info: CodebaseInfo, extra: Node | null, detail: string) =>
        h(
          "li",
          { class: info.id === current ? "active" : "" },
          h("div", { class: "module-name" }, h("strong", {}, info.name), h("span", { class: "muted" }, `${info.repository}${detail}`)),
          h(
            "div",
            { class: "button-row" },
            info.id === current
              ? h("span", { class: "muted" }, "In use")
              : h("button", { type: "button", class: "secondary", title: "See what changes, then switch", onclick: () => void review(info) }, "Use…"),
            extra
          )
        );
      clear(
        body,
        h("p", {}, "The palette, its names and sprites come from one game codebase. Maps keep prototype ids, so a map made with one codebase shows unknown ids in another."),
        h("h3", {}, "Served with the editor"),
        h("ul", { class: "codebase-list" }, ...registered.map((info) => row(info, null, info.commit ? ` @ ${info.commit.slice(0, 8)}` : ""))),
        h("h3", {}, "Added from GitHub"),
        custom.length
          ? h(
              "ul",
              { class: "codebase-list" },
              ...custom.map((info) =>
                row(
                  info,
                  h(
                    "button",
                    { type: "button", class: "ghost", title: "Remove from this browser", onclick: async () => { await removeCustomCodebase(info.id); if (info.id === current) await use(null); else void render(); } },
                    "✕"
                  ),
                  ` @ ${info.commit?.slice(0, 8)} · built ${new Date(info.built).toLocaleDateString()}`
                )
              )
            )
          : h("p", { class: "muted" }, "None yet."),
        h("h3", {}, "Add a codebase"),
        h(
          "p",
          { class: "muted" },
          "Any public SS14 fork on GitHub. The editor reads its Resources folder (prototypes, sprites, a few translations) straight from GitHub and builds the palette here; it takes a minute or two and is kept in this browser."
        ),
        h("div", { class: "button-row" }, link, h("button", { type: "button", class: "primary", onclick: build }, "Build palette")),
        progress,
        status
      );
    };
    void render();
    dialog.addEventListener("close", () => worker?.terminate(), { once: true });
  }

  /** The game server's data folder: export straight into it, open what the game saved, commands to copy. */
  function showGameDialog() {
    const body = h("div", { class: "game-folder" });
    openDialog("Game server", body);
    const mapId = h("input", { type: "number", min: 2, value: "10", class: "map-id", "aria-label": "Map id" });
    let status = "";
    let lastPath = `/${fileName(editor.doc.name, "station")}`;

    const commands = () => {
      const [x, y] = editor.mode === "station" ? teleportTarget(editor.doc) : [0, 0];
      return h(
        "div",
        { class: "commands" },
        h("label", { class: "field inline" }, h("span", {}, "Map id for loadmap"), mapId),
        command(`loadmap ${mapId.value} ${lastPath}`, "loads the station as a new map (pick an unused map id)"),
        command(`mapinit ${mapId.value}`, "starts the map: a loaded map is paused, and nothing on it moves (you included) until it is started"),
        command(`tp ${x} ${y} ${mapId.value}`, "takes you to the station: its observer spawn point, else its middle (as a ghost)"),
        command("togglelight", "all black? With no lights placed the station is dark; this turns lighting off on your screen (again to turn it back on)"),
        command(`savemap ${mapId.value} ${lastPath} true`, "writes your in-game changes back (true: a started map is only saved when forced)")
      );
    };
    mapId.addEventListener("change", () => void render());

    const openFile = async (file: FolderFile, add: boolean) => {
      try {
        const doc = readDocument(await gameFolder.read(file), file.path.split("/").pop()!);
        dialog.close();
        if (add) {
          actions.addDocument(doc, file.path);
        } else if (confirmDiscard(doc.mode)) {
          editor.replaceDocument(doc);
          saveLastMode(doc.mode);
          view.fit();
        }
      } catch (error) {
        status = `Could not open ${file.path}: ${(error as Error).message}`;
        void render();
      }
    };

    const render = async () => {
      if (!GameFolder.supported) {
        clear(
          body,
          h("p", {}, "This browser cannot link folders (Chrome and Edge can). Save downloads the station's .yml instead: put it in the game server's data folder, then use these commands in the game's console:"),
          commands()
        );
        return;
      }
      if (!gameFolder.linked) {
        clear(
          body,
          h(
            "p",
            {},
            "Link the game server's data folder (for a development server: ",
            h("code", {}, "bin/Content.Server/data"),
            "). The game's loadmap and savemap commands read and write there, so stations go to the game and back without downloads."
          ),
          h("div", { class: "button-row" }, h("button", { type: "button", class: "primary", onclick: () => void gameFolder.link().then(render, () => undefined) }, "Link folder…"))
        );
        return;
      }
      const files = await gameFolder.list().catch(() => [] as FolderFile[]);
      const station = editor.mode === "station";
      clear(
        body,
        h("p", {}, "Linked folder: ", h("strong", {}, gameFolder.name)),
        h(
          "div",
          { class: "button-row" },
          h(
            "button",
            {
              type: "button",
              class: "primary",
              disabled: !station,
              title: station ? "Write the station as a .yml into the folder" : "Only stations can be loaded in the game",
              onclick: async () => {
                editor.commitFloating();
                const critical = editor.validate().filter((problem) => problem.level === "error").length;
                if (critical && !window.confirm(`The checks list ${critical} critical problem(s): the game may not load the station, or it cannot be played. Export anyway?`)) return;
                try {
                  const { text, summary } = exportStation(editor.doc, palette);
                  lastPath = await gameFolder.write(fileName(editor.doc.name, "station"), text);
                  editor.markSaved();
                  status = `Wrote ${lastPath} (${summary.entities} entities).`;
                } catch (error) {
                  status = `Could not write: ${(error as Error).message}`;
                }
                void render();
              },
            },
            "Export station here"
          ),
          h("button", { type: "button", class: "secondary", onclick: () => void render() }, "Refresh"),
          h("button", { type: "button", class: "secondary", onclick: () => void gameFolder.unlink().then(render) }, "Unlink")
        ),
        status ? h("p", { class: "status" }, status) : null,
        commands(),
        h("h3", {}, `Maps in the folder · ${files.length}`),
        files.length
          ? h(
              "ul",
              { class: "folder-files" },
              ...files.slice(0, 100).map((file) =>
                h(
                  "li",
                  {},
                  h("code", {}, file.path),
                  h("span", { class: "muted" }, new Date(file.modified).toLocaleString()),
                  h("button", { type: "button", class: "secondary", onclick: () => void openFile(file, false) }, "Open"),
                  h("button", { type: "button", class: "secondary", title: "Add into the current map", onclick: () => void openFile(file, true) }, "Add")
                )
              )
            )
          : h("p", { class: "muted" }, "No .yml files yet. Maps saved with savemap appear here.")
      );
    };
    void render();
  }

  /** The step-by-step guide over the editor; docs/user-guide.md has the long one. */
  function showGuideDialog() {
    const station = editor.mode === "station";
    const [x, y] = station ? teleportTarget(editor.doc) : [0, 0];
    const commands = (...rows: HTMLElement[]) => h("div", { class: "commands tour-commands" }, ...rows);
    const note = (...parts: (Node | string)[]) => h("p", { class: "tour-note" }, ...parts);
    const file = `/${fileName(station ? editor.doc.name : "your-station", "station")}`;
    openGuide([
      {
        title: "Welcome to the Map Builder",
        body: [
          p("This guide walks you through the editor one part at a time. On each page the parts it talks about are circled on the screen, with an arrow pointing at them."),
          p("Move between pages with the ", ui("Next"), " and ", ui("Back"), " buttons, or with the ", key("←"), " and ", key("→"), " keys. The dots at the bottom jump straight to a page."),
          p("The guide closes from its last page."),
        ],
      },
      {
        title: "Domain or Station",
        targets: ["modes"],
        body: [
          p("These two buttons switch what you are making."),
          p(ui("Domain"), " is for rift domains: the maps players reach through the Q-Gate."),
          p(ui("Station"), " is for the game's own station maps, saved as the game's map files."),
          p("Each mode keeps its own map, so switching back and forth loses nothing."),
        ],
      },
      {
        title: "Starting a map",
        targets: ["new", "open", "add"],
        body: [
          p(ui("New"), " makes an empty map. You choose its name and size."),
          p(ui("Open"), " opens a file you saved before, or one of the game's own maps (", h("code", {}, "Resources/Maps/*.yml"), ")."),
          p(ui("Add"), " brings another file of the same kind into the map that is open now, for example a room you saved on its own."),
        ],
      },
      {
        title: "Name, size and undo",
        targets: ["name", "size", "undo"],
        body: [
          p("The text box holds the map's name. It becomes the file name when you save."),
          p(ui("W"), " and ", ui("H"), " are the width and height in tiles. Making a map smaller cuts off what lies outside."),
          p(ui("Undo"), " and ", ui("Redo"), " step back and forward through your changes (", key("Ctrl+Z"), " and ", key("Ctrl+Y"), ")."),
        ],
      },
      {
        title: "Layers",
        targets: ["layers"],
        body: [
          p("A map is built from layers stacked on top of each other: floor at the bottom, then structures such as walls and doors, then objects."),
          p("Click a layer to work on it, or press ", key("1"), " to ", key("4"), ". The eye in front of a layer hides it while you work."),
          p("You only paint on the active layer, so walls never wipe out the floor underneath."),
        ],
      },
      {
        title: "The palette",
        targets: ["palette-search", "palette-list"],
        body: [
          p("The palette on the right lists everything the active layer can hold. Click an item to paint with it."),
          p("Type in the search box to find an item by name or id; ", key("/"), " jumps to it. The list next to it narrows the palette to one category."),
          p("Some items are hidden in the game's spawn menu. They only show up when you search for them."),
        ],
      },
      {
        title: "Actions and shapes",
        targets: ["tools"],
        body: [
          p("The action says what a click does: ", ui("Brush"), " paints, ", ui("Erase"), " clears, ", ui("Select"), " picks cells so you can move or delete them."),
          p("The shape says how much a click covers: ", ui("Single"), " is one cell (drag for a line), ", ui("Rectangle"), " is a dragged box, ", ui("Fill"), " is the whole connected area."),
          p(key("T"), " turns what you are about to place. A right click picks up whatever is in a cell, so you can paint more of it."),
        ],
      },
      {
        title: "Moving around the map",
        targets: ["stage", "statusbar"],
        body: [
          p("The map takes the middle of the screen. Scroll the mouse wheel to zoom."),
          p("To move the view, hold ", key("Space"), " and drag, or drag with the middle mouse button. ", key("0"), " fits the whole map on screen."),
          p("The bar at the bottom shows the cell under the mouse and what it holds."),
        ],
      },
      {
        title: "Checks",
        targets: ["checks"],
        body: [
          p("The checks list problems in the map. Click one to jump to the place it is about."),
          p("Checks are grouped (spawn points, power, atmosphere, ...), each group in its own color. A red ! is critical: the map will not load or cannot be played until it is fixed. The others are warnings worth a look."),
          p(
            "Stations have two profiles here. ",
            ui("Draft"),
            " runs only the basic checks, for quick work and testing. ",
            ui("Exportable"),
            " runs every check a playable station needs and adds the ",
            ui("Export package"),
            " button."
          ),
          p(
            ui("Station"),
            " checks a whole station. ",
            ui("Department"),
            " checks one department on its own: pick it and tick its areas; its checks are listed first, in its color, and the station-wide ones (gravity, SMES, late-join) are left out."
          ),
        ],
      },
      {
        title: "Modules and random rooms",
        targets: ["tabs"],
        body: [
          p("The tabs above the palette open two more panels."),
          p(ui("Modules"), " is your library of saved pieces: select part of a map, save it as a module and place it again in any map. Placed copies can be updated when the module changes."),
          p(ui("Random"), " holds random sets: one of several items, or one of several rooms, is chosen each time the map is used."),
        ],
      },
      {
        title: "Saving your work",
        targets: ["save"],
        body: [
          p(ui("Save"), " downloads the map as a file (", key("Ctrl+S"), "). Stations are saved as a game map ", h("code", {}, ".yml"), "."),
          p("A dot on the button means there are unsaved changes."),
          p("Your work is also kept in this browser between visits, but only a saved file is really safe. Save often."),
        ],
      },
      {
        title: "Trying a station in the game",
        targets: ["game"],
        body: [
          p("The ", ui("Game"), " window connects the editor to a game server running on your computer."),
          p(
            "Press ",
            ui("Link folder…"),
            " there and choose the server's data folder. For a server built from source it is ",
            h("code", {}, "bin/Content.Server/data"),
            ". This works in Chrome and Edge; other browsers save the file and you copy it into that folder yourself."
          ),
          p("Then start the server, join it, and press ", ui("Export station here"), "."),
        ],
      },
      {
        title: "Loading it in the game",
        targets: ["game"],
        body: [
          p("Open the game's console. You need admin rights, which you have on your own server. The ", ui("Game"), " window lists these commands with a Copy button:"),
          commands(
            command(`loadmap 10 ${file}`, "loads the station as a new map"),
            command("mapinit 10", "starts the map; a loaded map is paused"),
            command(station ? `tp ${x} ${y} 10` : "tp <x> <y> 10", "takes you to the station"),
            command(`savemap 10 ${file} true`, "writes your in-game changes back")
          ),
          note("10 is the map number. Use another one if 10 is taken. After savemap, open the file again from the Game window."),
        ],
      },
      {
        title: "Problems in the game",
        body: [
          p("Only space after tp? The station is not always around 0, 0. Go to it with:"),
          commands(
            station
              ? command(`tp ${x} ${y} 10`, "the open station's observer spawn point, else the floor nearest its middle")
              : command("tp <x> <y> 10", "open the station in Station mode to see its numbers here")
          ),
          p("Cannot move? A loaded map is paused until it is started:"),
          commands(command("mapinit 10", "starts the map")),
          p("Everything black? The station has no lights yet. Turn lighting off on your screen:"),
          commands(command("togglelight", "run it again to turn lighting back on")),
        ],
      },
      {
        title: "Another game codebase",
        targets: ["codebase", "commit"],
        body: [
          p("The palette's names and sprites come from one game codebase: Qlippoth Station by default."),
          p(ui("Codebase"), " switches to another SS14 fork, or builds the palette of any public fork from its GitHub link. The name at the bottom right shows the codebase in use."),
          p("Before switching, a summary lists the objects the other codebase removes and adds, file by file, so you know what your maps will miss."),
        ],
      },
      {
        title: "You are ready",
        targets: ["help", "guide"],
        body: [
          p("The ", ui("?"), " button lists every keyboard shortcut."),
          p("The ", ui("Guide"), " button opens this guide again whenever you need it."),
          p("The full user guide, with more detail on every part, is docs/user-guide.md in the editor's repository."),
        ],
      },
    ]);
  }

  async function showCreditsDialog() {
    const body = h("div", { class: "credits" }, h("p", {}, "Loading…"));
    openDialog("Credits", body);
    try {
      const credits = await palette.credits();
      const licenses = new Map<string, number>();
      for (const credit of credits) licenses.set(credit.license ?? "Unknown", (licenses.get(credit.license ?? "Unknown") ?? 0) + 1);
      clear(
        body,
        h(
          "p",
          {},
          `Sprites are taken from the ${palette.codebase.name} game repository (${palette.codebase.repository}) and keep their original licenses. `,
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

  // One pending write per mode, each bound to its own document, so switching modes never drops the last edits.
  const pending = new Map<ModeId, { timer: number; write: () => void }>();
  const scheduleAutosave = () => {
    const { mode, doc } = editor;
    window.clearTimeout(pending.get(mode)?.timer);
    const write = () => {
      pending.delete(mode);
      try {
        void saveAutosave(mode, autosaveText(doc, palette));
      } catch {
        // A document that cannot be written now is written on the next change.
      }
    };
    // Writing a big station takes ~100 ms, so it waits for a longer pause.
    pending.set(mode, { timer: window.setTimeout(write, mode === "station" ? 1500 : 600), write });
  };
  const flushAutosaves = () => {
    for (const { timer, write } of [...pending.values()]) {
      window.clearTimeout(timer);
      write();
    }
  };

  editor.subscribe((topics) => {
    // The cell under the mouse can change without the mouse moving (painting, undo).
    if (topics.has("cells") && hovered) view.onHover(hovered);
    if (topics.has("history") || topics.has("cells") || topics.has("document")) {
      stateText.textContent = editor.dirty ? "Unsaved changes (autosaved in this browser)" : "No unsaved changes";
      scheduleAutosave();
    }
  });
  stateText.textContent = "No unsaved changes";

  window.addEventListener("beforeunload", (event) => {
    if (editor.anyDirty) event.preventDefault();
  });
  window.addEventListener("pagehide", flushAutosaves);

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
        o: () => (event.shiftKey ? actions.add() : actions.open()),
        a: () => editor.selectAll(),
        d: () => editor.deselect(),
      };
      // Text fields keep their own undo, redo and select all.
      if (handled[key] && !(isTyping(event) && "zya".includes(key))) {
        event.preventDefault();
        handled[key]();
      }
      return;
    }
    if (isTyping(event) || event.altKey) return;

    const action = ACTIONS.find((id) => ACTION_INFO[id].key.toLowerCase() === key);
    if (action) return editor.setAction(action);
    const shape = SHAPES.find((id) => SHAPE_INFO[id].key.toLowerCase() === key);
    if (shape) return editor.setShape(shape);
    const layerIndex = Number(event.key) - 1;
    if (Number.isInteger(layerIndex) && layerIndex >= 0 && layerIndex < editor.layers.length) return editor.setLayer(editor.layers[layerIndex]);

    const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, 1], arrowdown: [0, -1] };
    if (arrows[key] && (editor.floating || (editor.selection && editor.action === "select"))) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      return editor.nudge(arrows[key][0] * step, arrows[key][1] * step);
    }

    switch (key) {
      case "enter":
        editor.commitFloating();
        break;
      case "escape":
        if (editor.floating) editor.cancelFloating();
        else editor.deselect();
        break;
      case "delete":
      case "backspace":
        if (editor.selection) {
          event.preventDefault();
          editor.eraseSelection();
        }
        break;
      case "t": {
        // Turn the selection (or what is being moved); otherwise turn what the brush places.
        const direction = event.shiftKey ? -1 : 1;
        if (editor.floating || (editor.selection && editor.action === "select")) editor.rotateSelection(direction);
        else if (editor.mode === "station") editor.rotateBrush(direction);
        break;
      }
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
      case "/":
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".search")?.focus();
        break;
    }
  });

  clear(
    app,
    buildTopBar(editor, actions),
    h("main", { class: "workspace" }, buildSidebar(editor, view, actions), stage, buildRightSidebar(editor, library, randomSets, view, actions)),
    status,
    dialog
  );
  requestAnimationFrame(() => view.fit());
}

async function main() {
  try {
    const [palette, autosaves] = await Promise.all([loadPalette(), loadAutosaves()]);
    start(palette, autosaves);
  } catch (error) {
    clear(
      app,
      h(
        "div",
        { class: "fatal" },
        h("h1", {}, "Palette not found"),
        h("p", {}, "The editor needs a palette generated from the game repository. For local development run:"),
        h("pre", {}, "npm run palette -- --game ../Qlippoth-station-14"),
        h("p", { class: "muted" }, String((error as Error).message))
      )
    );
  }
}

main();
