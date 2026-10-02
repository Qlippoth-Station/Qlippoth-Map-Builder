import { LAYERS, LAYER_NAMES, MAX_SIZE, MIN_SIZE, type LayerId } from "./document";
import { TOOLS, TOOL_INFO, type Editor, type Topic } from "./editor";
import { clear, h } from "./dom";
import { iconOrigin, type Palette, type PaletteItem } from "./palette";
import { isListLayer, type TileList } from "./lists";
import { listBrush, type Brush } from "./brush";
import { normalizeSeed } from "./resolve";
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
  return h("span", { class: "icon unknown", title: id ? `Unknown id: ${id}` : "Empty" }, id ? "?" : "");
}

/** The icon a random list shows in the palette and on the map. */
export function listIcon(list: TileList | undefined, id?: string): HTMLElement {
  if (!list) return h("span", { class: "icon unknown list-icon", title: id ? `List not loaded: ${id}` : "" }, "?");
  const element = h("span", { class: "icon glyph list-icon" }, list.glyph);
  element.style.backgroundColor = list.color;
  return element;
}

/** Human-readable name of what a cell holds, for the status bar. */
export function brushName(editor: Editor, layer: LayerId, brush: Brush): string {
  switch (brush.kind) {
    case "fixed":
      return editor.palette.byLayer[layer].get(brush.id)?.name ?? brush.id;
    case "list": {
      const name = `random from ${editor.lists.get(brush.list)?.name ?? brush.list}`;
      return brush.group === undefined ? name : `${name} (same pick as group ${brush.group})`;
    }
  }
}

// ---- Left sidebar: tools, layers, view options, warnings -------------------------------------------

export function buildSidebar(editor: Editor, view: MapView): HTMLElement {
  const tools = h("div", { class: "tool-grid", role: "toolbar", "aria-label": "Tools" });
  const layers = h("div", { class: "layer-list" });
  const options = h("div", { class: "options" });
  const warnings = h("div", { class: "warnings" });
  const warningTitle = h("h2", {}, "Checks");

  const renderTools = () =>
    clear(
      tools,
      ...TOOLS.map((tool) =>
        h(
          "button",
          {
            class: `tool${editor.tool === tool ? " active" : ""}`,
            title: `${TOOL_INFO[tool].hint} (${TOOL_INFO[tool].key})`,
            "aria-pressed": String(editor.tool === tool),
            onclick: () => editor.setTool(tool),
          },
          h("span", { class: "tool-name" }, TOOL_INFO[tool].name),
          h("kbd", {}, TOOL_INFO[tool].key)
        )
      )
    );

  const renderLayers = () =>
    clear(
      layers,
      ...[...LAYERS].reverse().map((layer) => {
        const index = LAYERS.indexOf(layer) + 1;
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

  const renderOptions = () => {
    const seedFocused = document.activeElement?.classList.contains("seed-input") ?? false;
    renderOptionsContent();
    // A new seed re-renders the panel; keep the cursor in the seed field the user was typing in.
    if (seedFocused) options.querySelector<HTMLInputElement>(".seed-input")?.focus();
  };

  const renderOptionsContent = () =>
    clear(
      options,
      checkbox("Grid", "showGrid", "G"),
      checkbox("Dim other layers", "dimInactive", "D"),
      h(
        "label",
        { class: "check", title: "Show what random list cells roll for a seed, the way the game picks them" },
        h("input", {
          type: "checkbox",
          checked: editor.previewSeed !== null,
          onchange: (event: Event) => editor.setPreview((event.target as HTMLInputElement).checked ? newSeed() : null),
        }),
        h("span", {}, "Random preview"),
        h("kbd", {}, "P")
      ),
      editor.previewSeed !== null
        ? h(
            "div",
            { class: "seed" },
            h(
              "label",
              { title: "The game logs the seed of every rift; type it here to see that rift" },
              h("span", {}, "Seed"),
              h("input", {
                type: "number",
                min: 0,
                max: 4294967295,
                value: String(editor.previewSeed),
                class: "seed-input",
                "aria-label": "Preview seed",
                onchange: (event: Event) => {
                  const value = Number((event.target as HTMLInputElement).value);
                  if (Number.isFinite(value)) editor.setPreview(normalizeSeed(value));
                },
              })
            ),
            h("button", { class: "secondary", title: "Roll again with a new seed (N)", onclick: () => editor.setPreview(newSeed()) }, "Reroll")
          )
        : null,
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
  renderOptions();
  renderWarnings();
  editor.subscribe((topics: Set<Topic>) => {
    if (topics.has("selection")) renderTools();
    if (topics.has("selection") || topics.has("view") || topics.has("cells") || topics.has("document")) renderLayers();
    if (topics.has("view")) renderOptions();
    if (topics.has("cells") || topics.has("document") || topics.has("lists")) renderWarnings();
  });

  return h(
    "aside",
    { class: "sidebar left" },
    h("section", {}, h("h2", {}, "Tools"), tools),
    h("section", {}, h("h2", {}, "Layers"), layers),
    h("section", {}, h("h2", {}, "View"), options),
    h("section", { class: "grow" }, warningTitle, warnings)
  );
}

// ---- Right sidebar: palette ------------------------------------------------------------------------

/** A random seed for the preview, in the unsigned 32-bit range the game uses. */
export function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

export function buildPalettePanel(editor: Editor, actions: { manageLists(): void }): HTMLElement {
  const palette = editor.palette;
  const search = h("input", { type: "search", placeholder: "Search name or id  ( / )", "aria-label": "Search palette", class: "search" });
  const category = h("select", { "aria-label": "Category" });
  const list = h("div", { class: "palette-list", role: "listbox", "aria-label": "Palette items" });
  const title = h("h2", {});
  const selected = h("div", { class: "selected-item" });
  const more = h("p", { class: "more" });
  const lists = h("section", { class: "palette-lists" });

  let shownLayer: LayerId | null = null;

  const renderCategories = () => {
    const categories = [...new Set(palette.items.filter((item) => item.layer === editor.activeLayer).map((item) => item.category))].sort();
    clear(category, h("option", { value: "" }, "All categories"), ...categories.map((name) => h("option", { value: name }, name)));
  };

  const renderSelected = () => {
    const brush = editor.selected[editor.activeLayer];
    if (brush?.kind === "list") {
      const list = editor.lists.get(brush.list);
      clear(
        selected,
        listIcon(list, brush.list),
        h(
          "div",
          { class: "selected-text" },
          h("strong", {}, list ? `Random: ${list.name}` : brush.list),
          h("code", {}, list ? `${list.entries.length} entries · ${list.id}` : "List not loaded"),
          h(
            "label",
            { class: "check same-choice", title: "Every stroke (brush drag, rectangle or fill) gets one random pick for all its cells" },
            h("input", { type: "checkbox", checked: editor.sameChoice, onchange: (event: Event) => editor.setSameChoice((event.target as HTMLInputElement).checked) }),
            h("span", {}, "Same pick for the whole stroke")
          )
        )
      );
      return;
    }
    const id = brush?.id ?? null;
    const item = id ? palette.byLayer[editor.activeLayer].get(id) : undefined;
    clear(
      selected,
      icon(palette, item, id ?? undefined),
      h(
        "div",
        { class: "selected-text" },
        h("strong", {}, item?.name ?? (id ? id : "Nothing selected")),
        h("code", {}, id ?? "Pick an item below"),
        item?.description ? h("p", {}, item.description) : null
      )
    );
  };

  const renderList = () => {
    const query = search.value.trim().toLowerCase();
    const matches = palette.items.filter(
      (item) =>
        item.layer === editor.activeLayer &&
        (!category.value || item.category === category.value) &&
        (!query || item.name.toLowerCase().includes(query) || item.id.toLowerCase().includes(query))
    );
    const selectedBrush = editor.selected[editor.activeLayer];
    const current = selectedBrush?.kind === "fixed" ? selectedBrush.id : null;
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
            onclick: () => editor.select(item.layer, { kind: "fixed", id: item.id }),
          },
          icon(palette, item),
          h("span", { class: "palette-name" }, item.name)
        )
      )
    );
    more.textContent =
      matches.length > PALETTE_LIMIT ? `Showing ${PALETTE_LIMIT} of ${matches.length}. Search to narrow down.` : matches.length === 0 ? "No matches." : "";
  };

  const renderLists = () => {
    const layer = editor.activeLayer;
    if (!isListLayer(layer)) {
      clear(lists);
      lists.hidden = true;
      return;
    }
    lists.hidden = false;
    const query = search.value.trim().toLowerCase();
    const selectedBrush = editor.selected[layer];
    const current = selectedBrush?.kind === "list" ? selectedBrush.list : null;
    const matches = [...editor.lists.values()]
      .filter((list) => list.layer === layer && (!query || list.name.toLowerCase().includes(query) || list.id.includes(query)))
      .sort((a, b) => a.name.localeCompare(b.name));
    clear(
      lists,
      h(
        "header",
        {},
        h("h3", {}, "Random lists"),
        h("button", { class: "ghost", title: "Create, edit, import and export lists", onclick: () => actions.manageLists() }, "Manage…")
      ),
      matches.length
        ? h(
            "div",
            { class: "palette-list lists-grid" },
            ...matches.map((list) =>
              h(
                "button",
                {
                  class: `palette-item${list.id === current ? " active" : ""}`,
                  title: `${list.name} (${list.id})\n${list.entries.length} entries: ${list.entries.map((entry) => entry.id).join(", ")}`,
                  onclick: () => editor.select(layer, listBrush(list.id)),
                },
                listIcon(list),
                h("span", { class: "palette-name" }, list.name)
              )
            )
          )
        : h("p", { class: "muted small" }, query ? "No lists match." : `No ${LAYER_NAMES[layer].toLowerCase()} lists yet. Use Manage… to create or import one.`)
    );
  };

  const render = () => {
    title.textContent = `${LAYER_NAMES[editor.activeLayer]} palette`;
    if (shownLayer !== editor.activeLayer) {
      shownLayer = editor.activeLayer;
      renderCategories();
    }
    renderSelected();
    renderLists();
    renderList();
  };

  search.addEventListener("input", () => {
    renderLists();
    renderList();
  });
  category.addEventListener("change", renderList);
  render();
  editor.subscribe((topics) => {
    if (topics.has("selection") || topics.has("lists")) render();
  });

  return h(
    "aside",
    { class: "sidebar right" },
    h("section", {}, title, selected),
    h("section", { class: "palette-filters" }, search, category),
    lists,
    list,
    more
  );
}

// ---- Top bar ---------------------------------------------------------------------------------------

export interface TopBarActions {
  manageLists(): void;
  newDocument(): void;
  open(): void;
  save(): void;
  showCredits(): void;
  showHelp(): void;
}

export function buildTopBar(editor: Editor, actions: TopBarActions): HTMLElement {
  const name = h("input", { class: "doc-name", "aria-label": "Domain name", spellcheck: false });
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

  const render = () => {
    if (document.activeElement !== name) name.value = editor.doc.name;
    if (document.activeElement !== width) width.value = String(editor.doc.width);
    if (document.activeElement !== height) height.value = String(editor.doc.height);
    undo.disabled = !editor.canUndo;
    redo.disabled = !editor.canRedo;
    saveButton.classList.toggle("unsaved", editor.dirty);
    document.title = `${editor.dirty ? "• " : ""}${editor.doc.name} – Domain Builder`;
  };
  render();
  editor.subscribe((topics) => {
    if (topics.has("document") || topics.has("history") || topics.has("cells")) render();
  });

  return h(
    "header",
    { class: "topbar" },
    h("div", { class: "brand" }, h("span", { class: "logo", "aria-hidden": "true" }, "◇"), h("span", {}, "Domain Builder")),
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
      saveButton
    ),
    h("button", { class: "secondary", title: "Random lists: create, import, export", onclick: () => actions.manageLists() }, "Lists"),
    h("button", { class: "ghost", onclick: () => actions.showHelp(), title: "Shortcuts" }, "?"),
    h("button", { class: "ghost", onclick: () => actions.showCredits() }, "Credits")
  );
}
