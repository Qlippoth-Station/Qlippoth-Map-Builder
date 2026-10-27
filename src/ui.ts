import { ENTRY_MODES, LAYER_NAMES, MAX_COHORT, MAX_SIZE, MIN_SIZE, parseKey, type EntryMode, type LayerId } from "./document";
import { ACTIONS, ACTION_INFO, SHAPES, SHAPE_INFO, type Editor, type Topic } from "./editor";
import { clear, h } from "./dom";
import { MODES, MODE_INFO, type ModeId } from "./modes";
import { findItem, iconOrigin, itemNotes, type Palette, type PaletteItem } from "./palette";
import type { MapView } from "./view";

const PALETTE_LIMIT = 400;

export function icon(palette: Palette, item: PaletteItem | undefined, id?: string): HTMLElement {
  if (item?.icon != null) {
    const [x, y] = iconOrigin(palette, item.icon);
    const element = h("span", { class: "icon" });
    element.style.backgroundImage = `url("${palette.atlasUrl}")`;
    element.style.backgroundPosition = `-${x}px -${y}px`;
    return element;
  }
  if (item?.glyph) {
    const element = h("span", { class: "icon glyph" }, item.glyph);
    element.style.backgroundColor = item.color ?? "";
    return element;
  }
  if (item) return h("span", { class: "icon placeholder", title: "No sprite" }, item.name.charAt(0).toUpperCase());
  return h("span", { class: "icon unknown", title: id ? `Unknown id: ${id}` : "Empty" }, id ? "?" : "");
}

const ENTRY_MODE_INFO: Record<EntryMode, { name: string; hint: string }> = {
  random: { name: "Random", hint: "Every player arrives at a random Entry." },
  order: { name: "Order", hint: "First player to Entry 1, second to Entry 2, and so on, looping back to Entry 1." },
  cohort: { name: "Cohort", hint: "Like Order, but each Entry takes a whole group before the next one is used." },
};

// ---- Left sidebar: tools, layers, selection, entries, view options, warnings -----------------------

export function buildSidebar(editor: Editor, view: MapView): HTMLElement {
  const tools = h("div", { class: "tools" });
  const layers = h("div", { class: "layer-list" });
  const selectionSection = h("section", { class: "selection-panel" });
  const entrySection = h("section", { class: "entry-panel" });
  const options = h("div", { class: "options" });
  const warnings = h("div", { class: "warnings" });
  const warningTitle = h("h2", {}, "Checks");

  const toolButton = (info: { name: string; key: string; hint: string }, active: boolean, onclick: () => void) =>
    h(
      "button",
      { class: `tool${active ? " active" : ""}`, title: `${info.hint} (${info.key})`, "aria-pressed": String(active), onclick },
      h("span", { class: "tool-name" }, info.name),
      h("kbd", {}, info.key)
    );

  const renderTools = () =>
    clear(
      tools,
      h("h3", {}, "Action"),
      h(
        "div",
        { class: "tool-grid", role: "toolbar", "aria-label": "Action" },
        ...ACTIONS.map((action) => toolButton(ACTION_INFO[action], editor.action === action, () => editor.setAction(action)))
      ),
      h("h3", {}, "Shape"),
      h(
        "div",
        { class: "tool-grid", role: "toolbar", "aria-label": "Shape" },
        ...SHAPES.map((shape) => toolButton(SHAPE_INFO[shape], editor.shape === shape, () => editor.setShape(shape)))
      )
    );

  const renderSelection = () => {
    const floating = editor.floating;
    selectionSection.hidden = !floating && !editor.selection;
    if (selectionSection.hidden) return;
    const allLayers = h(
      "label",
      { class: "check", title: "Moving and erasing takes every layer, or only the active one" },
      h("input", {
        type: "checkbox",
        checked: editor.allLayers,
        disabled: !!floating,
        onchange: (event: Event) => {
          editor.allLayers = (event.target as HTMLInputElement).checked;
          editor.emit("area");
        },
      }),
      h("span", {}, "All layers")
    );
    if (floating) {
      clear(
        selectionSection,
        h("h2", {}, floating.source ? "Moving selection" : "Adding map"),
        h("p", { class: "muted" }, "Drag or use the arrow keys to move it. Enter places it, Esc cancels."),
        h(
          "div",
          { class: "button-row" },
          h("button", { class: "primary", onclick: () => editor.commitFloating() }, "Place"),
          h("button", { class: "secondary", onclick: () => editor.cancelFloating() }, "Cancel")
        ),
        allLayers
      );
      return;
    }
    const brush = editor.selectedBrush();
    const item = brush ? findItem(editor.palette, editor.activeLayer, brush.id) : undefined;
    clear(
      selectionSection,
      h("h2", {}, `Selection · ${editor.selection!.size} cells`),
      h(
        "div",
        { class: "button-row" },
        h(
          "button",
          {
            class: "secondary",
            disabled: !brush,
            title: brush ? `Fill the selection with ${item?.name ?? brush.id} on the ${LAYER_NAMES[editor.activeLayer]} layer` : "Pick an item first",
            onclick: () => editor.fillSelection(),
          },
          "Fill"
        ),
        h("button", { class: "secondary", title: "Clear the selected cells (Delete)", onclick: () => editor.eraseSelection() }, "Erase"),
        h("button", { class: "secondary", title: "Deselect (Esc)", onclick: () => editor.deselect() }, "Deselect")
      ),
      allLayers
    );
  };

  const renderEntries = () => {
    entrySection.hidden = editor.mode !== "domain";
    if (entrySection.hidden) return;
    const settings = editor.doc.entry;
    const entries = editor.entries();
    const mode = h(
      "select",
      {
        "aria-label": "Entry mode",
        onchange: (event: Event) => editor.setEntrySettings({ mode: (event.target as HTMLSelectElement).value as EntryMode }),
      },
      ...ENTRY_MODES.map((id) => h("option", { value: id, selected: settings.mode === id }, ENTRY_MODE_INFO[id].name))
    );
    const cohort =
      settings.mode === "cohort"
        ? h(
            "div",
            { class: "cohort" },
            h(
              "label",
              { class: "field inline" },
              h("span", {}, "Group size"),
              h("input", {
                type: "number",
                min: 1,
                max: MAX_COHORT,
                value: String(settings.cohort),
                onchange: (event: Event) => editor.setEntrySettings({ cohort: Number((event.target as HTMLInputElement).value) }),
              })
            ),
            h(
              "label",
              { class: "check", title: "After the last Entry: start again at Entry 1, or stop sending players" },
              h("input", {
                type: "checkbox",
                checked: settings.loop,
                onchange: (event: Event) => editor.setEntrySettings({ loop: (event.target as HTMLInputElement).checked }),
              }),
              h("span", {}, "Loop after the last Entry")
            )
          )
        : null;
    const ordered = settings.mode !== "random";
    clear(
      entrySection,
      h("h2", {}, `Entries · ${entries.length}`),
      mode,
      h("p", { class: "muted" }, ENTRY_MODE_INFO[settings.mode].hint),
      cohort,
      entries.length
        ? h(
            "ol",
            { class: "entry-list" },
            ...entries.map(([key, brush], index) => {
              const [x, y] = parseKey(key);
              return h(
                "li",
                {},
                h("button", { class: "ghost entry-name", title: "Show on the map", onclick: () => view.focus(x, y) }, ordered ? `Entry ${brush.order}` : "Entry", h("span", { class: "at" }, `${x}, ${y}`)),
                ordered
                  ? h("button", { class: "ghost", title: "Earlier", "aria-label": `Move Entry ${brush.order} earlier`, disabled: index === 0, onclick: () => editor.moveEntry(key, -1) }, "↑")
                  : null,
                ordered
                  ? h("button", { class: "ghost", title: "Later", "aria-label": `Move Entry ${brush.order} later`, disabled: index === entries.length - 1, onclick: () => editor.moveEntry(key, 1) }, "↓")
                  : null
              );
            })
          )
        : h("p", { class: "muted" }, "Place Entry markers on the Marker layer.")
    );
  };

  const renderLayers = () =>
    clear(
      layers,
      ...[...editor.layers].reverse().map((layer) => {
        const index = editor.layers.indexOf(layer) + 1;
        const active = editor.activeLayer === layer;
        return h(
          "div",
          { class: `layer${active ? " active" : ""}${editor.visible[layer] ? "" : " hidden"}` },
          h(
            "button",
            {
              class: "eye",
              title: editor.visible[layer] ? "Hide layer" : "Show layer",
              "aria-label": `${editor.visible[layer] ? "Hide" : "Show"} ${LAYER_NAMES[layer]} layer`,
              onclick: () => {
                editor.visible[layer] = !editor.visible[layer];
                editor.emit("view");
              },
            },
            editor.visible[layer] ? "◉" : "○"
          ),
          h(
            "button",
            { class: "layer-name", "aria-pressed": String(active), onclick: () => editor.setLayer(layer) },
            h("span", {}, LAYER_NAMES[layer]),
            h("span", { class: "count" }, String(editor.doc.layers[layer].size)),
            h("kbd", {}, String(index))
          )
        );
      })
    );

  const checkbox = (label: string, key: "showGrid" | "dimInactive", shortcut: string) =>
    h(
      "label",
      { class: "check" },
      h("input", {
        type: "checkbox",
        checked: editor[key],
        onchange: (event: Event) => {
          editor[key] = (event.target as HTMLInputElement).checked;
          editor.emit("view");
        },
      }),
      h("span", {}, label),
      h("kbd", {}, shortcut)
    );

  const renderOptions = () =>
    clear(
      options,
      checkbox("Grid", "showGrid", "G"),
      checkbox("Dim other layers", "dimInactive", "D"),
      h("button", { class: "secondary", onclick: () => view.fit(), title: "Fit map to view (0)" }, "Fit to view")
    );

  let validateTimer = 0;
  const renderWarnings = () => {
    window.clearTimeout(validateTimer);
    validateTimer = window.setTimeout(() => {
      const list = editor.validate();
      warningTitle.textContent = list.length ? `Checks · ${list.length}` : "Checks";
      if (list.length === 0) {
        clear(warnings, h("p", { class: "ok" }, "No problems found."));
        return;
      }
      clear(
        warnings,
        ...list.slice(0, 50).map((warning) =>
          warning.at
            ? h("button", { class: "warning", onclick: () => view.focus(...warning.at!) }, warning.message, h("span", { class: "at" }, `${warning.at[0]}, ${warning.at[1]}`))
            : h("div", { class: "warning" }, warning.message)
        )
      );
    }, 150);
  };

  renderTools();
  renderLayers();
  renderSelection();
  renderEntries();
  renderOptions();
  renderWarnings();
  editor.subscribe((topics: Set<Topic>) => {
    if (topics.has("selection")) renderTools();
    if (topics.has("area") || topics.has("selection")) renderSelection();
    if (topics.has("cells") || topics.has("document") || topics.has("mode")) renderEntries();
    if (topics.has("selection") || topics.has("view") || topics.has("cells") || topics.has("document")) renderLayers();
    if (topics.has("view")) renderOptions();
    if (topics.has("cells") || topics.has("document")) renderWarnings();
  });

  return h(
    "aside",
    { class: "sidebar left" },
    h("section", {}, h("h2", {}, "Tools"), tools),
    selectionSection,
    h("section", {}, h("h2", {}, "Layers"), layers),
    entrySection,
    h("section", {}, h("h2", {}, "View"), options),
    h("section", { class: "grow" }, warningTitle, warnings)
  );
}

// ---- Right sidebar: palette ------------------------------------------------------------------------

export function buildPalettePanel(editor: Editor): HTMLElement {
  const palette = editor.palette;
  const search = h("input", { type: "search", placeholder: "Search name or id  ( / )", "aria-label": "Search palette", class: "search" });
  const category = h("select", { "aria-label": "Category" });
  const list = h("div", { class: "palette-list", role: "listbox", "aria-label": "Palette items" });
  const title = h("h2", {});
  const selected = h("div", { class: "selected-item" });
  const more = h("p", { class: "more" });

  let shownLayer: LayerId | null = null;

  const renderCategories = () => {
    const categories = [...new Set(palette.items.filter((item) => item.layer === editor.activeLayer && !item.flags?.hidden).map((item) => item.category))].sort();
    clear(category, h("option", { value: "" }, "All categories"), ...categories.map((name) => h("option", { value: name }, name)));
  };

  const renderSelected = () => {
    const id = editor.selected[editor.activeLayer];
    const item = id ? findItem(palette, editor.activeLayer, id) : undefined;
    const notes = item ? itemNotes(item) : [];
    clear(
      selected,
      icon(palette, item, id ?? undefined),
      h(
        "div",
        { class: "selected-text" },
        h("strong", {}, item?.name ?? (id ? id : "Nothing selected")),
        h("code", {}, id ?? "Pick an item below"),
        item?.description ? h("p", {}, item.description) : null,
        notes.length ? h("ul", { class: "notes" }, ...notes.map((note) => h("li", {}, note))) : null
      )
    );
  };

  const renderList = () => {
    const query = search.value.trim().toLowerCase();
    const matches = palette.items.filter(
      (item) =>
        item.layer === editor.activeLayer &&
        // Items the game hides from its spawn menu are only listed when searched for.
        (!item.flags?.hidden || query !== "") &&
        (!category.value || item.category === category.value) &&
        (!query || item.name.toLowerCase().includes(query) || item.id.toLowerCase().includes(query))
    );
    const current = editor.selected[editor.activeLayer];
    clear(
      list,
      ...matches.slice(0, PALETTE_LIMIT).map((item) =>
        h(
          "button",
          {
            class: `palette-item${item.id === current ? " active" : ""}`,
            role: "option",
            "aria-selected": String(item.id === current),
            title: `${item.name}\n${item.id}\n${item.category}`,
            onclick: () => editor.select(item.layer, item.id),
          },
          icon(palette, item),
          h("span", { class: "palette-name" }, item.name)
        )
      )
    );
    more.textContent =
      matches.length > PALETTE_LIMIT ? `Showing ${PALETTE_LIMIT} of ${matches.length}. Search to narrow down.` : matches.length === 0 ? "No matches." : "";
  };

  const render = () => {
    title.textContent = `${LAYER_NAMES[editor.activeLayer]} palette`;
    if (shownLayer !== editor.activeLayer) {
      shownLayer = editor.activeLayer;
      renderCategories();
    }
    renderSelected();
    renderList();
  };

  search.addEventListener("input", renderList);
  category.addEventListener("change", renderList);
  render();
  editor.subscribe((topics) => {
    if (topics.has("selection")) render();
  });

  return h("aside", { class: "sidebar right" }, h("section", {}, title, selected), h("section", { class: "palette-filters" }, search, category), list, more);
}

// ---- Top bar ---------------------------------------------------------------------------------------

export interface TopBarActions {
  switchMode(mode: ModeId): void;
  newDocument(): void;
  open(): void;
  add(): void;
  save(): void;
  showCredits(): void;
  showHelp(): void;
}

export function buildTopBar(editor: Editor, actions: TopBarActions): HTMLElement {
  const name = h("input", { class: "doc-name", spellcheck: false });
  const modes = h("div", { class: "mode-switch", role: "group", "aria-label": "Mode" });
  const width = h("input", { type: "number", min: MIN_SIZE, max: MAX_SIZE, "aria-label": "Width", class: "size" });
  const height = h("input", { type: "number", min: MIN_SIZE, max: MAX_SIZE, "aria-label": "Height", class: "size" });
  const undo = h("button", { class: "secondary", title: "Undo (Ctrl+Z)", onclick: () => editor.undo() }, "Undo");
  const redo = h("button", { class: "secondary", title: "Redo (Ctrl+Y)", onclick: () => editor.redo() }, "Redo");
  const saveButton = h("button", { class: "primary", title: "Download .json (Ctrl+S)", onclick: () => actions.save() }, "Save");

  name.addEventListener("change", () => editor.rename(name.value.trim() || "Untitled"));
  const applySize = () => {
    editor.resize(Number(width.value), Number(height.value));
    width.value = String(editor.doc.width);
    height.value = String(editor.doc.height);
  };
  width.addEventListener("change", applySize);
  height.addEventListener("change", applySize);

  const renderModes = () =>
    clear(
      modes,
      ...MODES.map((mode) =>
        h(
          "button",
          {
            class: editor.mode === mode ? "active" : "",
            "aria-pressed": String(editor.mode === mode),
            title: `${MODE_INFO[mode].hint}${editor.mode !== mode && editor.isDirty(mode) ? " (unsaved changes)" : ""}`,
            onclick: () => actions.switchMode(mode),
          },
          MODE_INFO[mode].name,
          editor.mode !== mode && editor.isDirty(mode) ? h("span", { class: "dot", "aria-hidden": "true" }, " •") : null
        )
      )
    );

  const render = () => {
    renderModes();
    name.setAttribute("aria-label", `${MODE_INFO[editor.mode].name} name`);
    if (document.activeElement !== name) name.value = editor.doc.name;
    if (document.activeElement !== width) width.value = String(editor.doc.width);
    if (document.activeElement !== height) height.value = String(editor.doc.height);
    undo.disabled = !editor.canUndo;
    redo.disabled = !editor.canRedo;
    saveButton.classList.toggle("unsaved", editor.dirty);
    document.title = `${editor.dirty ? "• " : ""}${editor.doc.name} – ${MODE_INFO[editor.mode].title}`;
  };
  render();
  editor.subscribe((topics) => {
    if (topics.has("document") || topics.has("history") || topics.has("cells") || topics.has("mode")) render();
  });

  return h(
    "header",
    { class: "topbar" },
    h("div", { class: "brand" }, h("span", { class: "logo", "aria-hidden": "true" }, "◇"), h("span", {}, "Map Builder")),
    modes,
    name,
    h("label", { class: "size-field" }, h("span", {}, "W"), width),
    h("label", { class: "size-field" }, h("span", {}, "H"), height),
    h("div", { class: "group" }, undo, redo),
    h("div", { class: "spacer" }),
    h(
      "div",
      { class: "group" },
      h("button", { class: "secondary", onclick: () => actions.newDocument() }, "New"),
      h("button", { class: "secondary", title: "Open .json (Ctrl+O)", onclick: () => actions.open() }, "Open"),
      h("button", { class: "secondary", title: "Add another file of the same kind into this map (Ctrl+Shift+O)", onclick: () => actions.add() }, "Add"),
      saveButton
    ),
    h("button", { class: "ghost", onclick: () => actions.showHelp(), title: "Shortcuts" }, "?"),
    h("button", { class: "ghost", onclick: () => actions.showCredits() }, "Credits")
  );
}
