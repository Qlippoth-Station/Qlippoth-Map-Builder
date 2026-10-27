import "./style.css";
import { LAYER_NAMES, clampSize, createDocument, deserialize, serialize, type MapDocument } from "./document";
import { TOOLS, TOOL_INFO, Editor } from "./editor";
import { clear, h } from "./dom";
import { MODE_INFO, type ModeId } from "./modes";
import { loadPalette, type Palette } from "./palette";
import { loadAutosaves, saveAutosave, saveLastMode, type Autosaves } from "./storage";
import { buildPalettePanel, buildSidebar, buildTopBar } from "./ui";
import { MapView, isTyping } from "./view";

const app = document.getElementById("app")!;

function fileName(name: string, mode: ModeId): string {
  const slug = name.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${slug || mode}${MODE_INFO[mode].fileSuffix}`;
}

function start(palette: Palette, autosaves: Autosaves): void {
  // The autosave of a mode, or a fresh document when there is none (or it is corrupt or outdated).
  const documentFor = (mode: ModeId): MapDocument => {
    const saved = autosaves.documents[mode];
    if (saved) {
      try {
        const doc = deserialize(saved);
        if (doc.mode === mode) return doc;
      } catch {
        // Start fresh.
      }
    }
    const info = MODE_INFO[mode];
    return createDocument(mode, info.defaultName, ...info.defaultSize);
  };

  const editor = new Editor(palette, documentFor(autosaves.lastMode ?? "domain"));
  const stage = h("section", { class: "stage" });
  const status = h("footer", { class: "statusbar" });
  const dialog = h("dialog", { class: "dialog" });

  const view = new MapView(editor, stage);
  const hoverText = h("span", { class: "hover" }, "");
  const stateText = h("span", { class: "state" });
  clear(
    status,
    hoverText,
    h("span", { class: "spacer" }),
    stateText,
    h("span", { class: "commit", title: "Game commit the palette was built from" }, palette.gameCommit ? `palette @ ${palette.gameCommit.slice(0, 8)}` : "palette")
  );

  view.onHover = (cell) => {
    if (!cell) {
      hoverText.textContent = "";
      return;
    }
    const [x, y] = cell;
    const contents = editor.layers.map((layer) => {
      const brush = editor.get(layer, x, y);
      if (!brush) return null;
      return `${LAYER_NAMES[layer]}: ${palette.byLayer[layer].get(brush.id)?.name ?? brush.id}`;
    }).filter(Boolean);
    hoverText.textContent = `${x}, ${y}${contents.length ? "  ·  " + contents.join("  ·  ") : ""}`;
  };

  const confirmDiscard = (mode: ModeId = editor.mode) =>
    !editor.isDirty(mode) || window.confirm(`You have unsaved changes in ${MODE_INFO[mode].name} mode. Discard them?`);

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
      const input = h("input", { type: "file", accept: ".json,application/json" });
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          // The file decides the mode; opening a station file while in domain mode switches to station mode.
          const doc = deserialize(await file.text());
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
      const blob = new Blob([serialize(editor.doc)], { type: "application/json" });
      const link = h("a", { href: URL.createObjectURL(blob), download: fileName(editor.doc.name, editor.mode) });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      editor.markSaved();
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
    const info = MODE_INFO[editor.mode];
    const name = h("input", { name: "name", value: info.defaultName, required: true });
    const width = h("input", { name: "width", type: "number", value: String(info.defaultSize[0]), min: 1, max: 256, required: true });
    const height = h("input", { name: "height", type: "number", value: String(info.defaultSize[1]), min: 1, max: 256, required: true });
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
              editor.replaceDocument(createDocument(info.id, name.value.trim() || info.defaultName, clampSize(Number(width.value)), clampSize(Number(height.value))));
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
      ...TOOLS.map((tool): [string, string] => [TOOL_INFO[tool].key, TOOL_INFO[tool].name]),
      ...editor.layers.map((layer, index): [string, string] => [String(index + 1), `${LAYER_NAMES[layer]} layer`]),
      ["Right click", "Pick item under cursor"],
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
    openDialog("Credits", body);
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

  // One pending write per mode, each bound to its own document, so switching modes never drops the last edits.
  const pending = new Map<ModeId, { timer: number; write: () => void }>();
  const scheduleAutosave = () => {
    const { mode, doc } = editor;
    window.clearTimeout(pending.get(mode)?.timer);
    const write = () => {
      pending.delete(mode);
      void saveAutosave(mode, serialize(doc));
    };
    pending.set(mode, { timer: window.setTimeout(write, 600), write });
  };
  const flushAutosaves = () => {
    for (const { timer, write } of [...pending.values()]) {
      window.clearTimeout(timer);
      write();
    }
  };

  editor.subscribe((topics) => {
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
        o: () => actions.open(),
      };
      if (handled[key] && !(isTyping(event) && (key === "z" || key === "y"))) {
        event.preventDefault();
        handled[key]();
      }
      return;
    }
    if (isTyping(event) || event.altKey) return;

    const tool = TOOLS.find((id) => TOOL_INFO[id].key.toLowerCase() === key);
    if (tool) return editor.setTool(tool);
    const layerIndex = Number(event.key) - 1;
    if (Number.isInteger(layerIndex) && layerIndex >= 0 && layerIndex < editor.layers.length) return editor.setLayer(editor.layers[layerIndex]);

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
      case "/":
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".search")?.focus();
        break;
    }
  });

  clear(
    app,
    buildTopBar(editor, actions),
    h("main", { class: "workspace" }, buildSidebar(editor, view), stage, buildPalettePanel(editor)),
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
