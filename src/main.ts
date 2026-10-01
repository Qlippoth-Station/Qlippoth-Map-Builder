import "./style.css";
import { LAYERS, LAYER_NAMES, clampSize, createDocument, deserialize, serialize } from "./document";
import { TOOLS, TOOL_INFO, Editor } from "./editor";
import { clear, h } from "./dom";
import { loadPalette, type Palette } from "./palette";
import { buildPalettePanel, buildSidebar, buildTopBar } from "./ui";
import { MapView, isTyping } from "./view";

const AUTOSAVE_KEY = "qlippoth-domain-builder.autosave";
const app = document.getElementById("app")!;

// Browser storage can be missing or throw (private mode, blocked site data); the editor works without it.
function readAutosave(): string | null {
  try {
    return localStorage.getItem(AUTOSAVE_KEY);
  } catch {
    return null;
  }
}

function writeAutosave(text: string): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, text);
  } catch {
    // Ignored: autosave is a convenience only.
  }
}

function initialDocument() {
  const saved = readAutosave();
  if (saved) {
    try {
      return deserialize(saved);
    } catch {
      // Corrupt or outdated autosave: start fresh.
    }
  }
  return createDocument("Untitled domain", 20, 15);
}

function fileName(name: string): string {
  const slug = name.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${slug || "domain"}.domain.json`;
}

function start(palette: Palette): void {
  const editor = new Editor(palette, initialDocument());
  const stage = h("section", { class: "stage" });
  const status = h("footer", { class: "statusbar" });
  const dialog = h("dialog", { class: "dialog" });

  const view = new MapView(editor, stage);
  const hoverText = h("span", { class: "hover" }, "");
  const stateText = h("span", { class: "state" });
  const selectionText = h("span", { class: "selection-info" });
  clear(
    status,
    hoverText,
    h("span", { class: "spacer" }),
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
      return `${LAYER_NAMES[layer]}: ${palette.byLayer[layer].get(brush.id)?.name ?? brush.id}`;
    }).filter(Boolean);
    hoverText.textContent = `${x}, ${y}${contents.length ? "  ·  " + contents.join("  ·  ") : ""}`;
  };

  const confirmDiscard = () => !editor.dirty || window.confirm("You have unsaved changes. Discard them?");

  const actions = {
    newDocument() {
      showNewDialog();
    },
    open() {
      if (!confirmDiscard()) return;
      const input = h("input", { type: "file", accept: ".json,application/json" });
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          editor.replaceDocument(deserialize(await file.text()));
          view.fit();
        } catch (error) {
          window.alert(`Could not open ${file.name}: ${(error as Error).message}`);
        }
      });
      input.click();
    },
    save() {
      const blob = new Blob([serialize(editor.doc)], { type: "application/json" });
      const link = h("a", { href: URL.createObjectURL(blob), download: fileName(editor.doc.name) });
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

  function showHelpDialog() {
    const rows: [string, string][] = [
      ...TOOLS.map((tool): [string, string] => [TOOL_INFO[tool].key, TOOL_INFO[tool].name]),
      ...LAYERS.map((layer, index): [string, string] => [String(index + 1), `${LAYER_NAMES[layer]} layer`]),
      ["Right click", "Pick item under cursor"],
      ["Drag inside selection", "Move the selection and its contents"],
      ["Arrows / Shift+Arrows", "Move the selection by 1 / 5 cells"],
      ["Delete", "Clear the selected area on every layer"],
      ["Esc", "Drop the selection"],
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
    start(await loadPalette());
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
