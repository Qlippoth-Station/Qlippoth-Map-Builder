import { ENTRY_MODES, LAYER_NAMES, MAX_COHORT, MIN_SIZE, itemsOf, parseKey, type EntryMode, type LayerId } from "./document";
import { ACTIONS, ACTION_INFO, SHAPES, SHAPE_INFO, type Editor, type Topic } from "./editor";
import { clear, h } from "./dom";
import { MODES, MODE_INFO, type ModeId } from "./modes";
import type { ModuleLibrary, ModuleRecord } from "./modules";
import { clampWeight, SET_PREFIX, type RandomSet, type RandomSetLibrary } from "./randomsets";
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

export function buildSidebar(editor: Editor, view: MapView, actions: { exportPackage(): void }): HTMLElement {
  const tools = h("div", { class: "tools" });
  const layers = h("div", { class: "layer-list" });
  const selectionSection = h("section", { class: "selection-panel" });
  const cellSection = h("section", { class: "cell-panel" });
  const entrySection = h("section", { class: "entry-panel" });
  const options = h("div", { class: "options" });
  const warnings = h("div", { class: "warnings" });
  const warningTitle = h("h2", {}, "Checks");
  const profile = h("div", { class: "profile" });

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

  const renderCell = () => {
    const at = editor.inspected;
    cellSection.hidden = !at;
    if (!at) return;
    const [x, y] = at;
    const rows = editor.layers.flatMap((layer) =>
      itemsOf(editor.get(layer, x, y)).map((brush, index) => {
        const item = findItem(editor.palette, layer, brush.id);
        const degrees = brush.rot ? Math.round((brush.rot * 180) / Math.PI) : 0;
        const name = item?.name ?? brush.id;
        return h(
          "li",
          { title: `${brush.id}${brush.uid !== undefined ? `\nuid ${brush.uid}` : ""}` },
          icon(editor.palette, item, brush.id),
          h("span", { class: "cell-item-name" }, name, h("small", {}, LAYER_NAMES[layer])),
          degrees ? h("span", { class: "rot" }, `${degrees}°`) : null,
          editor.stacks(layer)
            ? h("button", { class: "ghost", title: "Turn clockwise", "aria-label": `Turn ${name} clockwise`, onclick: () => editor.rotateCellItem(layer, x, y, index, 1) }, "⟳")
            : null,
          h("button", { class: "ghost", title: "Remove", "aria-label": `Remove ${name}`, onclick: () => editor.removeCellItem(layer, x, y, index) }, "✕")
        );
      })
    );
    clear(
      cellSection,
      h("h2", {}, `Cell ${x}, ${y}`, h("button", { class: "ghost close", title: "Close", "aria-label": "Close cell panel", onclick: () => editor.inspect(-1, -1) }, "✕")),
      rows.length ? h("ul", { class: "cell-items" }, ...rows) : h("p", { class: "muted" }, "Empty.")
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
  // Stations: Draft / Exportable profile, and the export package once the station is meant to be played.
  const renderProfile = () => {
    profile.hidden = editor.mode !== "station";
    if (profile.hidden) return;
    const button = (id: "draft" | "exportable", label: string, hint: string) =>
      h("button", { class: editor.profile === id ? "active" : "", "aria-pressed": String(editor.profile === id), title: hint, onclick: () => editor.setProfile(id) }, label);
    clear(
      profile,
      h(
        "div",
        { class: "mode-switch", role: "group", "aria-label": "Profile" },
        button("draft", "Draft", "Basic checks only, for quick work and testing"),
        button("exportable", "Exportable", "All checks a playable station needs, and the export package")
      ),
      editor.profile === "exportable"
        ? h("button", { class: "secondary", title: "Map .yml, gameMap prototype and a README in one .zip", onclick: () => actions.exportPackage() }, "Export package")
        : null
    );
  };

  const renderWarnings = () => {
    window.clearTimeout(validateTimer);
    validateTimer = window.setTimeout(() => {
      const list = editor.validate();
      const errors = list.filter((warning) => warning.level === "error").length;
      warningTitle.textContent = list.length ? `Checks · ${list.length}${errors ? ` (${errors} critical)` : ""}` : "Checks";
      if (list.length === 0) {
        clear(warnings, h("p", { class: "ok" }, "No problems found."));
        return;
      }
      clear(
        warnings,
        ...list.slice(0, 50).map((warning) => {
          const className = warning.level === "error" ? "warning error" : "warning";
          return warning.at
            ? h("button", { class: className, onclick: () => view.focus(...warning.at!) }, warning.message, h("span", { class: "at" }, `${warning.at[0]}, ${warning.at[1]}`))
            : h("div", { class: className }, warning.message);
        })
      );
    }, 150);
  };

  renderTools();
  renderLayers();
  renderSelection();
  renderCell();
  renderEntries();
  renderOptions();
  renderProfile();
  renderWarnings();
  editor.subscribe((topics: Set<Topic>) => {
    if (topics.has("selection")) renderTools();
    if (topics.has("area") || topics.has("selection")) renderSelection();
    if (topics.has("area") || topics.has("cells") || topics.has("document")) renderCell();
    if (topics.has("cells") || topics.has("document") || topics.has("mode")) renderEntries();
    if (topics.has("selection") || topics.has("view") || topics.has("cells") || topics.has("document")) renderLayers();
    if (topics.has("view")) renderOptions();
    if (topics.has("cells") || topics.has("document")) renderWarnings();
    if (topics.has("document") || topics.has("mode")) renderProfile();
  });

  return h(
    "aside",
    { class: "sidebar left" },
    h("section", {}, h("h2", {}, "Tools"), tools),
    selectionSection,
    cellSection,
    h("section", {}, h("h2", {}, "Layers"), layers),
    entrySection,
    h("section", {}, h("h2", {}, "View"), options),
    h("section", { class: "grow" }, warningTitle, profile, warnings)
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
    const set = id?.startsWith(SET_PREFIX) ? editor.randomSets?.get(id.slice(SET_PREFIX.length)) : undefined;
    if (set) {
      const first = set.entries[0] ? findItem(palette, editor.activeLayer, set.entries[0].id) : undefined;
      clear(
        selected,
        icon(palette, first, set.entries[0]?.id),
        h(
          "div",
          { class: "selected-text" },
          h("strong", {}, set.name),
          h("code", {}, `random set · ${set.entries.length} entries`),
          h("ul", { class: "notes" }, h("li", {}, set.resolve === "game" && editor.mode === "station" && set.layer !== "floor" ? "Game picks every round" : "Picked per cell while painting"))
        )
      );
      return;
    }
    const item = id ? findItem(palette, editor.activeLayer, id) : undefined;
    const notes = item ? itemNotes(item) : [];
    const rot = editor.selectedBrush()?.rot;
    if (rot) notes.unshift(`Placed turned ${Math.round((rot * 180) / Math.PI)}° (T)`);
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

  return h("div", { class: "panel-body" }, h("section", {}, title, selected), h("section", { class: "palette-filters" }, search, category), list, more);
}

// ---- Right sidebar: palette and modules tabs --------------------------------------------------------

export interface ModuleActions {
  saveSelectionAsModule(): void;
  importModule(): void;
  placeModule(module: ModuleRecord): void;
  updateModule(module: ModuleRecord): void;
  exportModule(module: ModuleRecord): void;
  deleteModule(module: ModuleRecord): void;
  exportProject(): void;
  openProject(): void;
}

export function buildRightSidebar(
  editor: Editor,
  library: ModuleLibrary,
  sets: RandomSetLibrary,
  view: MapView,
  actions: ModuleActions & RandomActions
): HTMLElement {
  const panels = {
    palette: buildPalettePanel(editor),
    modules: buildModulesPanel(editor, library, view, actions),
    random: buildRandomPanel(editor, sets, library, view, actions),
  };
  const tabs = h("div", { class: "tabs", role: "tablist" });
  let shown: keyof typeof panels = "palette";
  const render = () => {
    for (const [tab, panel] of Object.entries(panels)) panel.hidden = tab !== shown;
    const labels = { palette: "Palette", modules: `Modules · ${library.forMode(editor.mode).length}`, random: "Random" };
    clear(
      tabs,
      ...(Object.keys(panels) as (keyof typeof panels)[]).map((tab) =>
        h("button", { role: "tab", class: shown === tab ? "active" : "", "aria-selected": String(shown === tab), onclick: () => ((shown = tab), render()) }, labels[tab])
      )
    );
  };
  render();
  library.subscribe(render);
  editor.subscribe((topics) => {
    if (topics.has("mode")) render();
    // Picking something in the palette (also a random set) shows the palette, where the brush is described.
  });
  return h("aside", { class: "sidebar right" }, tabs, panels.palette, panels.modules, panels.random);
}

function buildModulesPanel(editor: Editor, library: ModuleLibrary, view: MapView, actions: ModuleActions): HTMLElement {
  const panel = h("div", { class: "panel-body modules" });
  const render = () => {
    const modules = library.forMode(editor.mode);
    const instances = editor.instances;
    const hasSelection = !!editor.selection || !!editor.floating;
    const kind = editor.mode === "station" ? "departments or rooms" : "rooms";
    clear(
      panel,
      h(
        "section",
        {},
        h("p", { class: "muted" }, `Save parts of the map (${kind}) as modules, place them in other maps and update every placed copy when the module changes.`),
        h(
          "div",
          { class: "button-row" },
          h("button", { class: "primary", disabled: !hasSelection, title: hasSelection ? "Save the selection as a module" : "Select cells first (Select action)", onclick: () => actions.saveSelectionAsModule() }, "Save selection"),
          h("button", { class: "secondary", title: "Add a map file to the library as a module", onclick: () => actions.importModule() }, "Import…")
        ),
        h(
          "div",
          { class: "button-row" },
          h("button", { class: "secondary", title: "This map, its modules and their placements in one .zip", onclick: () => actions.exportProject() }, "Save project"),
          h("button", { class: "secondary", title: "Open a project .zip", onclick: () => actions.openProject() }, "Open project…")
        )
      ),
      h(
        "section",
        { class: "module-list" },
        h("h2", {}, `Library · ${modules.length}`),
        modules.length
          ? h(
              "ul",
              {},
              ...modules.map((module) => {
                const placed = instances.filter((instance) => instance.module === module.id);
                const outdated = placed.filter((instance) => instance.version !== module.updated).length;
                return h(
                  "li",
                  {},
                  h("div", { class: "module-name" }, h("strong", {}, module.name), h("span", { class: "muted" }, `${module.width}×${module.height} · placed ${placed.length}×`)),
                  h(
                    "div",
                    { class: "button-row" },
                    h("button", { class: "secondary", title: "Place it in the map (move, T to turn, Enter to place)", onclick: () => actions.placeModule(module) }, "Place"),
                    outdated
                      ? h("button", { class: "primary", title: "Replace placed copies with this version", onclick: () => actions.updateModule(module) }, `Update ${outdated}`)
                      : null,
                    h("button", { class: "ghost", title: "Download the module file", onclick: () => actions.exportModule(module) }, "Export"),
                    h("button", { class: "ghost", title: "Remove from the library", "aria-label": `Remove ${module.name}`, onclick: () => actions.deleteModule(module) }, "✕")
                  )
                );
              })
            )
          : h("p", { class: "muted" }, "No modules yet.")
      ),
      h(
        "section",
        { class: "module-list" },
        h("h2", {}, `Placed in this map · ${instances.length}`),
        instances.length
          ? h(
              "ul",
              {},
              ...instances.map((instance, index) => {
                const module = library.get(instance.module);
                const state = !module ? "not in the library" : module.updated !== instance.version ? "older version" : "up to date";
                return h(
                  "li",
                  {},
                  h(
                    "div",
                    { class: "module-name" },
                    h("strong", {}, module?.name ?? instance.name),
                    h("span", { class: "muted" }, `at ${instance.x}, ${instance.y}${instance.turns ? ` · turned ${instance.turns * 90}°` : ""} · ${state}`)
                  ),
                  h(
                    "div",
                    { class: "button-row" },
                    h("button", { class: "ghost", onclick: () => view.focus(instance.x, instance.y) }, "Show"),
                    h("button", { class: "ghost", title: "Stop tracking it (the cells stay)", onclick: () => editor.forgetInstance(index) }, "Forget")
                  )
                );
              })
            )
          : h("p", { class: "muted" }, "Placed modules are listed here.")
      )
    );
  };
  render();
  library.subscribe(render);
  editor.subscribe((topics) => {
    if (topics.has("document") || topics.has("mode") || topics.has("area")) render();
  });
  return panel;
}

// ---- Random tab: random sets and room slots ---------------------------------------------------------

export interface RandomActions {
  newSet(): void;
  addRoomSlot(): void;
}

function buildRandomPanel(editor: Editor, sets: RandomSetLibrary, library: ModuleLibrary, view: MapView, actions: RandomActions): HTMLElement {
  const panel = h("div", { class: "panel-body modules random" });
  let editing: string | null = null;

  const setEditor = (set: RandomSet) => {
    const selected = editor.selected[set.layer];
    const canAdd = !!selected && !selected.startsWith(SET_PREFIX) && !set.entries.some((entry) => entry.id === selected);
    const station = editor.mode === "station" && set.layer !== "floor";
    return h(
      "div",
      { class: "set-editor" },
      set.entries.length
        ? h(
            "ul",
            { class: "set-entries" },
            ...set.entries.map((entry, index) => {
              const item = findItem(editor.palette, set.layer, entry.id);
              return h(
                "li",
                {},
                icon(editor.palette, item, entry.id),
                h("span", { class: "cell-item-name" }, item?.name ?? entry.id),
                h("input", {
                  type: "number",
                  min: 1,
                  max: 20,
                  value: String(entry.weight),
                  title: "Weight: how often it is picked compared to the others",
                  "aria-label": `Weight of ${item?.name ?? entry.id}`,
                  onchange: (event: Event) =>
                    sets.update(set.id, { entries: set.entries.map((other, i) => (i === index ? { ...other, weight: clampWeight(Number((event.target as HTMLInputElement).value)) } : other)) }),
                }),
                h("button", { class: "ghost", title: "Remove", "aria-label": `Remove ${item?.name ?? entry.id}`, onclick: () => sets.update(set.id, { entries: set.entries.filter((_, i) => i !== index) }) }, "✕")
              );
            })
          )
        : h("p", { class: "muted" }, `Pick an item on the ${LAYER_NAMES[set.layer]} layer in the palette, then add it here.`),
      h(
        "button",
        {
          class: "secondary",
          disabled: !canAdd,
          title: canAdd ? `Add ${selected}` : `Select an item on the ${LAYER_NAMES[set.layer]} layer in the Palette tab first`,
          onclick: () => sets.update(set.id, { entries: [...set.entries, { id: selected!, weight: 1 }] }),
        },
        "Add selected item"
      ),
      station
        ? h(
            "div",
            { class: "set-resolve" },
            h(
              "label",
              { class: "check", title: "The map gets one random spawner; the game picks what spawns there every round" },
              h("input", { type: "radio", name: `resolve-${set.id}`, checked: set.resolve === "game", onchange: () => sets.update(set.id, { resolve: "game" }) }),
              h("span", {}, "Game picks every round")
            ),
            h(
              "label",
              { class: "check", title: "One entry is picked per cell while painting; the map gets that entity" },
              h("input", { type: "radio", name: `resolve-${set.id}`, checked: set.resolve === "paint", onchange: () => sets.update(set.id, { resolve: "paint" }) }),
              h("span", {}, "Pick while painting")
            ),
            set.resolve === "game"
              ? h(
                  "label",
                  { class: "field inline" },
                  h("span", {}, "Spawn chance %"),
                  h("input", {
                    type: "number",
                    min: 0,
                    max: 100,
                    value: String(Math.round(set.chance * 100)),
                    onchange: (event: Event) => sets.update(set.id, { chance: Math.min(100, Math.max(0, Number((event.target as HTMLInputElement).value) || 0)) / 100 }),
                  })
                )
              : null
          )
        : h("p", { class: "muted" }, "Picked per cell while painting."),
      h("div", { class: "button-row" }, h("button", { class: "ghost", title: "Delete the set", onclick: () => window.confirm(`Delete the set ${set.name}?`) && sets.remove(set.id) }, "Delete set"))
    );
  };

  const render = () => {
    const list = sets.forMode(editor.mode);
    const station = editor.mode === "station";
    const slots = editor.roomSlots;
    const modules = library.forMode("station");
    clear(
      panel,
      h(
        "section",
        { class: "module-list" },
        h("h2", {}, `Random sets · ${list.length}`),
        h("p", { class: "muted" }, "Lists of tiles or entities to paint with: every cell gets one of them, by weight." + (station ? " On the Structure and Object layers the game can pick instead, every round." : "")),
        h("div", { class: "button-row" }, h("button", { class: "secondary", title: `New set for the ${LAYER_NAMES[editor.activeLayer]} layer`, onclick: () => actions.newSet() }, `New ${LAYER_NAMES[editor.activeLayer]} set`)),
        list.length
          ? h(
              "ul",
              {},
              ...list.map((set) => {
                const active = editor.selected[set.layer] === `${SET_PREFIX}${set.id}`;
                return h(
                  "li",
                  { class: active ? "active" : "" },
                  h(
                    "div",
                    { class: "module-name" },
                    h("strong", {}, set.name),
                    h("span", { class: "muted" }, `${LAYER_NAMES[set.layer]} · ${set.entries.length} entries · ${set.resolve === "game" ? "game picks" : "picked while painting"}`)
                  ),
                  h(
                    "div",
                    { class: "button-row" },
                    h("button", { class: active ? "primary" : "secondary", disabled: set.entries.length === 0, onclick: () => editor.select(set.layer, `${SET_PREFIX}${set.id}`) }, active ? "In use" : "Use"),
                    h("button", { class: "ghost", onclick: () => ((editing = editing === set.id ? null : set.id), render()) }, editing === set.id ? "Close" : "Edit")
                  ),
                  editing === set.id ? setEditor(set) : null
                );
              })
            )
          : null
      ),
      station
        ? h(
            "section",
            { class: "module-list" },
            h("h2", {}, `Random rooms · ${slots.length}`),
            h(
              "p",
              { class: "muted" },
              "A room slot is an area the game fills with one of its rooms at round start. Rooms are modules of the slot's exact size. The export package (Exportable profile) writes them; saving and testing show what is painted there now."
            ),
            h(
              "div",
              { class: "button-row" },
              h("button", { class: "secondary", disabled: !editor.selection, title: editor.selection ? "Make a slot of the selection's bounding box" : "Select an area first", onclick: () => actions.addRoomSlot() }, "Slot from selection")
            ),
            slots.length
              ? h(
                  "ul",
                  {},
                  ...slots.map((slot, index) => {
                    const fitting = modules.filter((module) => module.width === slot.width && module.height === slot.height);
                    return h(
                      "li",
                      {},
                      h("div", { class: "module-name" }, h("strong", {}, slot.name), h("span", { class: "muted" }, `${slot.width}×${slot.height} at ${slot.x}, ${slot.y} · ${slot.modules.length} room(s)`)),
                      fitting.length
                        ? h(
                            "div",
                            { class: "slot-rooms" },
                            ...fitting.map((module) =>
                              h(
                                "label",
                                { class: "check" },
                                h("input", {
                                  type: "checkbox",
                                  checked: slot.modules.includes(module.id),
                                  onchange: (event: Event) =>
                                    editor.setSlotModules(
                                      index,
                                      (event.target as HTMLInputElement).checked ? [...slot.modules, module.id] : slot.modules.filter((id) => id !== module.id)
                                    ),
                                }),
                                h("span", {}, module.name)
                              )
                            )
                          )
                        : h("p", { class: "muted" }, `No ${slot.width}×${slot.height} modules in the library yet.`),
                      h(
                        "div",
                        { class: "button-row" },
                        h("button", { class: "ghost", onclick: () => view.focus(slot.x + Math.floor(slot.width / 2), slot.y + Math.floor(slot.height / 2)) }, "Show"),
                        h("button", { class: "ghost", onclick: () => editor.removeRoomSlot(index) }, "Remove")
                      )
                    );
                  })
                )
              : null
          )
        : null
    );
  };
  render();
  sets.subscribe(render);
  library.subscribe(render);
  editor.subscribe((topics) => {
    if (topics.has("document") || topics.has("mode") || topics.has("selection") || topics.has("area")) render();
  });
  return panel;
}

// ---- Top bar ---------------------------------------------------------------------------------------

export interface TopBarActions {
  switchMode(mode: ModeId): void;
  newDocument(): void;
  open(): void;
  add(): void;
  save(): void;
  showCredits(): void;
  showGuide(): void;
  showHelp(): void;
  showGame(): void;
  showCodebase(): void;
}

export function buildTopBar(editor: Editor, actions: TopBarActions): HTMLElement {
  const name = h("input", { class: "doc-name", spellcheck: false });
  const modes = h("div", { class: "mode-switch", role: "group", "aria-label": "Mode" });
  const width = h("input", { type: "number", min: MIN_SIZE, "aria-label": "Width", class: "size" });
  const height = h("input", { type: "number", min: MIN_SIZE, "aria-label": "Height", class: "size" });
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
    width.max = height.max = String(MODE_INFO[editor.mode].maxSize);
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
      h("button", { class: "secondary", title: "Open a .json file or a game map .yml (Ctrl+O)", onclick: () => actions.open() }, "Open"),
      h("button", { class: "secondary", title: "Add another file of the same kind into this map (Ctrl+Shift+O)", onclick: () => actions.add() }, "Add"),
      saveButton
    ),
    h("button", { class: "secondary", onclick: () => actions.showGame(), title: "Link the game server's data folder: export to the game and open what it saved" }, "Game"),
    h("button", { class: "secondary", onclick: () => actions.showCodebase(), title: "Which game codebase the palette comes from (Qlippoth Station or another SS14 fork)" }, "Codebase"),
    h("button", { class: "ghost", onclick: () => actions.showHelp(), title: "Shortcuts" }, "?"),
    h("button", { class: "ghost", onclick: () => actions.showGuide(), title: "How to use the editor, step by step" }, "Guide"),
    h("button", { class: "ghost", onclick: () => actions.showCredits() }, "Credits")
  );
}
