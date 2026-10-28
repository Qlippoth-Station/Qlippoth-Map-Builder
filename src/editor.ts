import {
  ENTRY_ID,
  LAYERS,
  cellKey,
  clampCohort,
  clampSize,
  createDocument,
  contentKey,
  entryRenumbering,
  fromItems,
  inBounds,
  itemsOf,
  normalizeAngle,
  parseKey,
  QUARTER_TURN,
  sameBrush,
  type Brush,
  type EntrySettings,
  type Item,
  type LayerId,
  type MapDocument,
  type ModuleInstance,
  type RoomSlot,
  type StationProfile,
} from "./document";
import { pickEntry, SET_PREFIX, spawnerData, type RandomSetLibrary } from "./randomsets";
import { MODE_INFO, type ModeId } from "./modes";
import { findItem, type Palette } from "./palette";
import { exportableChecks, lightChecks, moduleEdgeChecks } from "./station/checks";

/** What a click does. */
export const ACTIONS = ["brush", "erase", "select"] as const;
export type ActionId = (typeof ACTIONS)[number];

/** Which cells a click covers; shared by all actions. */
export const SHAPES = ["single", "rect", "fill"] as const;
export type ShapeId = (typeof SHAPES)[number];

export const ACTION_INFO: Record<ActionId, { name: string; key: string; hint: string }> = {
  brush: { name: "Brush", key: "B", hint: "Paint with the selected item" },
  erase: { name: "Erase", key: "E", hint: "Clear cells on the active layer" },
  select: { name: "Select", key: "M", hint: "Select cells, then drag them to move. Shift adds, Alt removes" },
};

export const SHAPE_INFO: Record<ShapeId, { name: string; key: string; hint: string }> = {
  single: { name: "Single", key: "S", hint: "One cell at a time; drag for a line" },
  rect: { name: "Rectangle", key: "R", hint: "Drag a rectangle" },
  fill: { name: "Fill", key: "F", hint: "The connected area of the same content on the active layer" },
};

export type SelectOp = "replace" | "add" | "subtract";

/** What changed, so views only redo the work they need. "area" is the cell selection and floating content. */
export type Topic = "cells" | "document" | "selection" | "view" | "history" | "mode" | "area";

type Change =
  | { type: "cell"; layer: LayerId; key: string; before: Brush | null; after: Brush | null }
  | { type: "size"; before: [number, number]; after: [number, number] }
  | { type: "name"; before: string; after: string }
  | { type: "entry"; before: EntrySettings; after: EntrySettings }
  | { type: "instances"; before: ModuleInstance[]; after: ModuleInstance[] }
  | { type: "slots"; before: RoomSlot[]; after: RoomSlot[] };

export interface Warning {
  message: string;
  at?: [number, number];
  /** "error": the map does not load or cannot be played (shown red); otherwise a warning (yellow). */
  level?: "error";
}

/**
 * Content picked up from the map (a moved selection) or brought in from another file (Add).
 * It follows the mouse and is only written into the document when placed.
 */
export interface Floating {
  /** Contents per layer, keyed by cell relative to (x, y). */
  cells: Map<LayerId, Map<string, Brush>>;
  /** Outline of the floating content, relative keys. */
  mask: Set<string>;
  x: number;
  y: number;
  /** Where it was picked up; placing it there again changes nothing. */
  fromX: number;
  fromY: number;
  /** Cells the content was lifted from (absolute keys), cleared when it is placed. Null for added files. */
  source: Set<string> | null;
  /** Set when the content is a module from the library: placing it records an instance. */
  module?: { id: string; name: string; version: number; width: number; height: number };
  /** Quarter turns clockwise since it was picked up or added. */
  turns: number;
}

/** Turns cells and their outline a quarter (1 = clockwise, -1 = counter-clockwise); entities on stacking layers turn too. */
function turnContent(
  cells: Map<LayerId, Map<string, Brush>>,
  mask: Set<string>,
  direction: 1 | -1,
  stacks: (layer: LayerId) => boolean
): { cells: Map<LayerId, Map<string, Brush>>; mask: Set<string>; width: number; height: number } {
  const points = [...mask].map(parseKey);
  const width = Math.max(...points.map(([x]) => x)) + 1;
  const height = Math.max(...points.map(([, y]) => y)) + 1;
  const turn = (key: string): string => {
    const [x, y] = parseKey(key);
    return direction === 1 ? cellKey(y, width - 1 - x) : cellKey(height - 1 - y, x);
  };
  const turned = new Map<LayerId, Map<string, Brush>>();
  for (const [layer, layerCells] of cells) {
    const out = new Map<string, Brush>();
    for (const [key, brush] of layerCells) {
      const items = stacks(layer) ? itemsOf(brush).map((item) => withRotation(item, (item.rot ?? 0) - direction * QUARTER_TURN)) : itemsOf(brush);
      out.set(turn(key), fromItems(items)!);
    }
    turned.set(layer, out);
  }
  return { cells: turned, mask: new Set([...mask].map(turn)), width, height };
}

/** Everything that belongs to one mode's document; the mode being left is parked in this form. */
interface Session {
  doc: MapDocument;
  activeLayer: LayerId;
  selected: Record<LayerId, string | null>;
  selection: Set<string> | null;
  undoStack: Change[][];
  redoStack: Change[][];
  revision: number;
  savedRevision: number;
}

function newSession(doc: MapDocument): Session {
  return {
    doc,
    activeLayer: "floor",
    selected: { floor: null, structure: null, object: null, marker: null },
    selection: null,
    undoStack: [],
    redoStack: [],
    revision: 0,
    savedRevision: 0,
  };
}

export class Editor {
  doc: MapDocument;
  activeLayer: LayerId = "floor";
  action: ActionId = "brush";
  shape: ShapeId = "single";
  selected: Record<LayerId, string | null> = { floor: null, structure: null, object: null, marker: null };
  visible: Record<LayerId, boolean> = { floor: true, structure: true, object: true, marker: true };
  dimInactive = false;
  showGrid = true;
  /** Selected cells (absolute keys). While set, painting and erasing only touch these cells. */
  selection: Set<string> | null = null;
  floating: Floating | null = null;
  /** Moving and erasing a selection takes every layer (true) or only the active one. */
  allLayers = true;
  /** Cell shown in the Cell panel (set by right click). */
  inspected: [number, number] | null = null;
  /** Rotation of what the brush places on stacking layers, in radians (game convention: counter-clockwise). */
  brushRot = 0;
  /** Random sets the brush can draw from (selected as "set:<id>"). */
  randomSets: RandomSetLibrary | null = null;
  /** Increases on every edit; compared against the last saved value to know about unsaved work. */
  revision = 0;
  savedRevision = 0;

  private undoStack: Change[][] = [];
  private redoStack: Change[][] = [];
  private stroke: Change[] | null = null;
  private parked: Partial<Record<ModeId, Session>> = {};
  /** Cells changed since the view last asked, so it only redraws those parts of its cache. */
  private changedCells = new Set<string>();
  private listeners = new Set<(topics: Set<Topic>) => void>();
  private queued = new Set<Topic>();
  private flushScheduled = false;

  constructor(readonly palette: Palette, doc: MapDocument) {
    this.doc = doc;
  }

  get mode(): ModeId {
    return this.doc.mode;
  }

  /** Layers of the current mode, bottom to top. */
  get layers(): readonly LayerId[] {
    return MODE_INFO[this.doc.mode].layers;
  }

  subscribe(listener: (topics: Set<Topic>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(...topics: Topic[]): void {
    for (const topic of topics) this.queued.add(topic);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      const batch = this.queued;
      this.queued = new Set();
      for (const listener of this.listeners) listener(batch);
    });
  }

  get dirty(): boolean {
    return this.revision !== this.savedRevision;
  }

  isDirty(mode: ModeId): boolean {
    if (mode === this.mode) return this.dirty;
    const session = this.parked[mode];
    return !!session && session.revision !== session.savedRevision;
  }

  get anyDirty(): boolean {
    return this.dirty || Object.values(this.parked).some((session) => session.revision !== session.savedRevision);
  }

  // ---- Modes -----------------------------------------------------------------------------------

  /**
   * Switches to another mode. The mode being left keeps its document, undo history and selection;
   * `create` makes the document when the target mode has not been opened in this tab yet.
   */
  switchMode(mode: ModeId, create: () => MapDocument): void {
    if (mode === this.mode) return;
    this.commitFloating();
    this.endStroke();
    this.parked[this.mode] = this.capture();
    const next = this.parked[mode] ?? newSession(create());
    delete this.parked[mode];
    this.restore(next);
    this.emit("mode", "document", "cells", "history", "selection", "view", "area");
  }

  private capture(): Session {
    const { doc, activeLayer, selected, selection, undoStack, redoStack, revision, savedRevision } = this;
    return { doc, activeLayer, selected, selection, undoStack, redoStack, revision, savedRevision };
  }

  private restore(session: Session): void {
    this.stroke = null;
    this.floating = null;
    ({
      doc: this.doc,
      activeLayer: this.activeLayer,
      selected: this.selected,
      selection: this.selection,
      undoStack: this.undoStack,
      redoStack: this.redoStack,
      revision: this.revision,
      savedRevision: this.savedRevision,
    } = session);
  }

  // ---- Tool state ------------------------------------------------------------------------------

  setLayer(layer: LayerId): void {
    this.activeLayer = layer;
    this.visible[layer] = true;
    this.emit("selection", "view");
  }

  setAction(action: ActionId): void {
    if (action !== "select") this.commitFloating();
    this.action = action;
    this.emit("selection");
  }

  setShape(shape: ShapeId): void {
    this.shape = shape;
    this.emit("selection");
  }

  select(layer: LayerId, id: string | null): void {
    this.selected[layer] = id;
    this.activeLayer = layer;
    this.visible[layer] = true;
    if (this.action !== "brush") this.setAction("brush");
    this.emit("selection", "view");
  }

  selectedBrush(): Item | null {
    const id = this.selected[this.activeLayer];
    if (!id) return null;
    let item: Item = { kind: "fixed", id };
    if (id.startsWith(SET_PREFIX)) {
      const set = this.randomSets?.get(id.slice(SET_PREFIX.length));
      if (!set?.entries.length) return null;
      // Game sets become one random spawner entity; other sets are picked from per cell while painting.
      const carrier = this.palette.spawnerCarrier;
      item =
        set.resolve === "game" && this.stacks(this.activeLayer) && carrier
          ? { kind: "fixed", id: carrier, spawner: spawnerData(set) }
          : { kind: "fixed", id: set.entries[0].id, set: set.id };
    }
    if (this.brushRot && this.stacks(this.activeLayer)) item.rot = this.brushRot;
    return item;
  }

  /** A brush with its random set entries picked (one pick per call, i.e. per cell). */
  private resolveSets(brush: Brush): Brush {
    if (!itemsOf(brush).some((item) => item.set)) return brush;
    const items = itemsOf(brush).map(({ set: setId, ...item }): Item => {
      const set = setId ? this.randomSets?.get(setId) : undefined;
      const id = set ? pickEntry(set) : null;
      return id ? { ...item, id } : item;
    });
    return fromItems(items)!;
  }

  /** Turns what the brush places by a quarter: 1 = clockwise, -1 = counter-clockwise. */
  rotateBrush(direction: 1 | -1): void {
    this.brushRot = normalizeAngle(this.brushRot - direction * QUARTER_TURN);
    this.emit("selection");
  }

  inspect(x: number, y: number): void {
    this.inspected = inBounds(this.doc, x, y) ? [x, y] : null;
    this.emit("area");
  }

  takeChangedCells(): Set<string> {
    const changed = this.changedCells;
    this.changedCells = new Set();
    return changed;
  }

  // ---- Editing ---------------------------------------------------------------------------------

  beginStroke(): void {
    this.endStroke();
    this.stroke = [];
  }

  endStroke(): void {
    // Entry orders stay 1..n after any marker edit; the renumbering is part of the same undo step.
    if (this.stroke && this.mode === "domain" && this.stroke.some((change) => change.type === "cell" && change.layer === "marker")) {
      for (const [key, brush] of entryRenumbering(this.doc.layers.marker)) this.set("marker", ...parseKey(key), brush);
    }
    if (this.stroke && this.stroke.length > 0) {
      this.undoStack.push(this.stroke);
      if (this.undoStack.length > 500) this.undoStack.shift();
      this.redoStack = [];
      this.emit("history");
    }
    this.stroke = null;
  }

  get(layer: LayerId, x: number, y: number): Brush | null {
    return this.doc.layers[layer].get(cellKey(x, y)) ?? null;
  }

  /** What a cell shows right now: floating content wins over the document, and lifted cells look empty. */
  displayed(layer: LayerId, x: number, y: number): Brush | null {
    const floating = this.floating;
    const cells = floating?.cells.get(layer);
    if (floating && cells) {
      const brush = cells.get(cellKey(x - floating.x, y - floating.y));
      if (brush) return brush;
      if (floating.source?.has(cellKey(x, y))) return null;
    }
    return this.get(layer, x, y);
  }

  /** What a cell shows apart from floating content: the document, with lifted cells empty. */
  underFloating(layer: LayerId, x: number, y: number): Brush | null {
    const floating = this.floating;
    if (floating?.source?.has(cellKey(x, y)) && floating.cells.has(layer)) return null;
    return this.get(layer, x, y);
  }

  /** Sets one cell, ignoring the selection. Must be called inside a stroke (or it opens a single-change stroke itself). */
  set(layer: LayerId, x: number, y: number, brush: Brush | null): void {
    if (!inBounds(this.doc, x, y)) return;
    const key = cellKey(x, y);
    const before = this.doc.layers[layer].get(key) ?? null;
    if (sameBrush(before, brush)) return;
    // Painting an Entry over an Entry keeps the existing one and its place in the order.
    if (brush?.kind === "fixed" && brush.id === ENTRY_ID && brush.order === undefined && before?.kind === "fixed" && before.id === ENTRY_ID) return;

    const standalone = !this.stroke;
    if (standalone) this.beginStroke();
    this.apply({ type: "cell", layer, key, before, after: brush });
    this.stroke!.push({ type: "cell", layer, key, before, after: brush });
    if (standalone) this.endStroke();
  }

  /** Whether user edits may touch a cell: with a selection, only cells inside it. */
  editable(x: number, y: number): boolean {
    return !this.selection || this.selection.has(cellKey(x, y));
  }

  /** Whether cells of a layer hold stacks (station structure and object layers). */
  stacks(layer: LayerId): boolean {
    return MODE_INFO[this.mode].stacking.includes(layer);
  }

  /**
   * Sets one cell as a user edit, respecting the selection. On stacking layers painting adds the item on top
   * (unless the cell already holds that id) and erasing clears the cell's layer.
   */
  paint(layer: LayerId, x: number, y: number, brush: Brush | null): void {
    if (!this.editable(x, y)) return;
    if (brush) brush = this.resolveSets(brush);
    if (brush && this.stacks(layer)) {
      const items = itemsOf(this.get(layer, x, y));
      const added = itemsOf(brush).filter((item) => !items.some((existing) => existing.id === item.id));
      if (added.length === 0) return;
      brush = fromItems([...items, ...added]);
    }
    this.set(layer, x, y, brush);
  }

  fillRect(layer: LayerId, x0: number, y0: number, x1: number, y1: number, brush: Brush | null): void {
    this.beginStroke();
    for (const key of this.rectKeys(x0, y0, x1, y1)) this.paint(layer, ...parseKey(key), brush);
    this.endStroke();
  }

  /** 4-neighbour flood fill over cells that hold the same thing as the start cell (within the selection, if any). */
  floodFill(layer: LayerId, startX: number, startY: number, brush: Brush | null): void {
    if (!inBounds(this.doc, startX, startY) || !this.editable(startX, startY)) return;
    if (sameBrush(this.get(layer, startX, startY), brush)) return;
    const region = this.region(layer, startX, startY, true);
    this.beginStroke();
    for (const key of region) this.paint(layer, ...parseKey(key), brush);
    this.endStroke();
  }

  /** Cells connected to the start cell holding the same items on a layer (regardless of order or rotation). */
  private region(layer: LayerId, startX: number, startY: number, withinSelection: boolean): Set<string> {
    const target = contentKey(this.get(layer, startX, startY));
    const stack: [number, number][] = [[startX, startY]];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const key = cellKey(x, y);
      if (seen.has(key) || !inBounds(this.doc, x, y) || (withinSelection && !this.editable(x, y))) continue;
      if (contentKey(this.get(layer, x, y)) !== target) continue;
      seen.add(key);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return seen;
  }

  private rectKeys(x0: number, y0: number, x1: number, y1: number): string[] {
    const [minX, maxX] = [Math.max(0, Math.min(x0, x1)), Math.min(this.doc.width - 1, Math.max(x0, x1))];
    const [minY, maxY] = [Math.max(0, Math.min(y0, y1)), Math.min(this.doc.height - 1, Math.max(y0, y1))];
    const keys: string[] = [];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) keys.push(cellKey(x, y));
    return keys;
  }

  /** Resizes around the bottom-left origin; cells that fall outside are removed (and come back on undo). */
  resize(width: number, height: number): void {
    const max = MODE_INFO[this.mode].maxSize;
    const after: [number, number] = [clampSize(width, max), clampSize(height, max)];
    const before: [number, number] = [this.doc.width, this.doc.height];
    if (after[0] === before[0] && after[1] === before[1]) return;

    this.commitFloating();
    this.beginStroke();
    for (const layer of LAYERS) {
      for (const key of [...this.doc.layers[layer].keys()]) {
        const [x, y] = parseKey(key);
        if (x >= after[0] || y >= after[1]) this.set(layer, x, y, null);
      }
    }
    this.record({ type: "size", before, after });
    this.endStroke();
    if (this.selection) this.setSelection(new Set([...this.selection].filter((key) => inBounds(this.doc, ...parseKey(key)))));
  }

  rename(name: string): void {
    if (name === this.doc.name) return;
    this.beginStroke();
    this.record({ type: "name", before: this.doc.name, after: name });
    this.endStroke();
  }

  private record(change: Change): void {
    this.apply(change);
    this.stroke!.push(change);
  }

  undo(): void {
    // With floating content, undo first puts it back where it came from (or drops an added file).
    if (this.floating) return this.cancelFloating();
    this.endStroke();
    const changes = this.undoStack.pop();
    if (!changes) return;
    for (const change of [...changes].reverse()) this.apply(invert(change));
    this.redoStack.push(changes);
    this.emit("history");
  }

  redo(): void {
    if (this.floating) return;
    this.endStroke();
    const changes = this.redoStack.pop();
    if (!changes) return;
    for (const change of changes) this.apply(change);
    this.undoStack.push(changes);
    this.emit("history");
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0 || !!this.floating;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0 && !this.floating;
  }

  /** Replaces the document of its mode (switching to that mode first); that mode's history is dropped. */
  replaceDocument(doc: MapDocument): void {
    if (doc.mode !== this.mode) {
      delete this.parked[doc.mode];
      this.switchMode(doc.mode, () => doc);
      return;
    }
    this.stroke = null;
    this.floating = null;
    this.selection = null;
    this.doc = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.revision++;
    this.savedRevision = this.revision;
    this.emit("document", "cells", "history", "area");
  }

  markSaved(): void {
    this.savedRevision = this.revision;
    this.emit("history");
  }

  private apply(change: Change): void {
    this.revision++;
    switch (change.type) {
      case "cell":
        if (change.after) this.doc.layers[change.layer].set(change.key, change.after);
        else this.doc.layers[change.layer].delete(change.key);
        this.changedCells.add(change.key);
        this.emit("cells");
        break;
      case "size":
        [this.doc.width, this.doc.height] = change.after;
        this.emit("document", "cells");
        break;
      case "name":
        this.doc.name = change.after;
        this.emit("document");
        break;
      case "entry":
        this.doc.entry = change.after;
        this.emit("document");
        break;
      case "instances":
        this.doc.instances = change.after;
        this.emit("document");
        break;
      case "slots":
        this.doc.roomSlots = change.after;
        this.emit("document", "view");
        break;
    }
  }

  // ---- Selection -------------------------------------------------------------------------------

  private setSelection(keys: Set<string> | null): void {
    this.selection = keys && keys.size > 0 ? keys : null;
    this.emit("area");
  }

  /** Changes the selection: replace it, add to it (Shift) or remove from it (Alt). */
  selectCells(keys: Iterable<string>, op: SelectOp): void {
    this.commitFloating();
    const next = new Set(op === "replace" ? [] : this.selection ?? []);
    for (const key of keys) {
      if (!inBounds(this.doc, ...parseKey(key))) continue;
      if (op === "subtract") next.delete(key);
      else next.add(key);
    }
    this.setSelection(next);
  }

  selectRect(x0: number, y0: number, x1: number, y1: number, op: SelectOp): void {
    this.selectCells(this.rectKeys(x0, y0, x1, y1), op);
  }

  /** Magic wand: the connected area of the same content on the active layer. */
  selectRegion(x: number, y: number, op: SelectOp): void {
    if (inBounds(this.doc, x, y)) this.selectCells(this.region(this.activeLayer, x, y, false), op);
  }

  selectAll(): void {
    this.selectRect(0, 0, this.doc.width - 1, this.doc.height - 1, "replace");
  }

  deselect(): void {
    this.commitFloating();
    this.setSelection(null);
  }

  /** Layers a moved or erased selection takes. */
  get affectedLayers(): LayerId[] {
    return this.allLayers ? [...this.layers] : [this.activeLayer];
  }

  /** Clears the selected cells on the affected layers. */
  eraseSelection(): void {
    this.commitFloating();
    if (!this.selection) return;
    this.beginStroke();
    for (const layer of this.affectedLayers) for (const key of this.selection) this.set(layer, ...parseKey(key), null);
    this.endStroke();
  }

  /** Fills every selected cell of the active layer with the selected item. */
  fillSelection(): void {
    this.commitFloating();
    const brush = this.selectedBrush();
    if (!this.selection || !brush) return;
    this.beginStroke();
    for (const key of this.selection) this.paint(this.activeLayer, ...parseKey(key), brush);
    this.endStroke();
  }

  // ---- Single items (Cell panel) ---------------------------------------------------------------

  /** Turns one item of a cell's stack by a quarter: 1 = clockwise, -1 = counter-clockwise. */
  rotateCellItem(layer: LayerId, x: number, y: number, index: number, direction: 1 | -1): void {
    const items = [...itemsOf(this.get(layer, x, y))];
    if (!items[index]) return;
    items[index] = withRotation(items[index], (items[index].rot ?? 0) - direction * QUARTER_TURN);
    this.set(layer, x, y, fromItems(items));
  }

  removeCellItem(layer: LayerId, x: number, y: number, index: number): void {
    const items = itemsOf(this.get(layer, x, y)).filter((_, i) => i !== index);
    this.set(layer, x, y, fromItems(items));
  }

  // ---- Floating content ------------------------------------------------------------------------

  /** Picks up the selected cells so they can be moved. Returns false when nothing is selected. */
  liftSelection(): boolean {
    if (this.floating) return true;
    if (!this.selection) return false;
    const points = [...this.selection].map(parseKey);
    const x = Math.min(...points.map(([px]) => px));
    const y = Math.min(...points.map(([, py]) => py));
    const cells = new Map<LayerId, Map<string, Brush>>();
    for (const layer of this.affectedLayers) {
      const layerCells = new Map<string, Brush>();
      for (const [px, py] of points) {
        const brush = this.get(layer, px, py);
        if (brush) layerCells.set(cellKey(px - x, py - y), brush);
      }
      cells.set(layer, layerCells);
    }
    const mask = new Set(points.map(([px, py]) => cellKey(px - x, py - y)));
    this.floating = { cells, mask, x, y, fromX: x, fromY: y, source: new Set(this.selection), turns: 0 };
    this.emit("area", "cells", "history");
    return true;
  }

  moveFloating(x: number, y: number): void {
    if (!this.floating || (this.floating.x === x && this.floating.y === y)) return;
    this.floating.x = x;
    this.floating.y = y;
    this.emit("area", "cells");
  }

  /** Moves the selection by whole cells (arrow keys), picking it up first. */
  nudge(dx: number, dy: number): void {
    if (!this.liftSelection()) return;
    this.moveFloating(this.floating!.x + dx, this.floating!.y + dy);
  }

  /**
   * Turns the selection (picking it up first) a quarter around its middle: 1 = clockwise, -1 = counter-clockwise.
   * Entities on stacking layers turn with it.
   */
  rotateSelection(direction: 1 | -1): void {
    if (!this.liftSelection()) return;
    const floating = this.floating!;
    const { cells, mask, width, height } = turnContent(floating.cells, floating.mask, direction, (layer) => this.stacks(layer));
    floating.cells = cells;
    floating.mask = mask;
    floating.turns = (floating.turns + (direction === 1 ? 1 : 3)) % 4;
    // Turn around the middle (two turns back undo it exactly), but stay inside the map when it fits.
    floating.x += Math.trunc((width - height) / 2);
    floating.y += Math.trunc((height - width) / 2);
    if (height <= this.doc.width) floating.x = Math.min(Math.max(floating.x, 0), this.doc.width - height);
    if (width <= this.doc.height) floating.y = Math.min(Math.max(floating.y, 0), this.doc.height - width);
    // A turned selection always changes the map when placed, even where it was picked up.
    floating.fromX = Number.NaN;
    this.emit("area", "cells", "history");
  }

  floatingContains(x: number, y: number): boolean {
    return !!this.floating?.mask.has(cellKey(x - this.floating.x, y - this.floating.y));
  }

  /**
   * Writes floating content into the document as one undo step. Its filled cells overwrite what is below;
   * its empty cells leave the map as it is, so an added department never wipes out its surroundings.
   * Anything outside the map is dropped. The placed area stays selected.
   */
  commitFloating(): void {
    const floating = this.floating;
    if (!floating) return;
    if (floating.source && floating.x === floating.fromX && floating.y === floating.fromY) return this.cancelFloating();
    this.floating = null;
    this.beginStroke();
    if (floating.source) {
      for (const layer of floating.cells.keys()) for (const key of floating.source) this.set(layer, ...parseKey(key), null);
    }
    for (const [layer, cells] of floating.cells) {
      for (const [key, brush] of cells) {
        const [rx, ry] = parseKey(key);
        this.set(layer, floating.x + rx, floating.y + ry, brush);
      }
    }
    if (floating.module) {
      const { id, name, version, width, height } = floating.module;
      const instance: ModuleInstance = { module: id, name, x: floating.x, y: floating.y, width, height, turns: floating.turns, version };
      this.record({ type: "instances", before: this.instances, after: [...this.instances, instance] });
    }
    this.endStroke();
    const placed = [...floating.mask].map((key) => {
      const [rx, ry] = parseKey(key);
      return cellKey(floating.x + rx, floating.y + ry);
    });
    this.setSelection(new Set(placed.filter((key) => inBounds(this.doc, ...parseKey(key)))));
    this.emit("cells", "history");
  }

  /** Drops floating content: a moved selection goes back, an added file is discarded. */
  cancelFloating(): void {
    const floating = this.floating;
    if (!floating) return;
    this.floating = null;
    if (!floating.source) this.setSelection(null);
    this.emit("area", "cells", "history");
  }

  /**
   * Brings another file of the same mode in as floating content at (x, y), to be moved into place.
   * Its entries keep their order but come after the existing ones. Entities from another game map are placed as
   * new entities of the same prototype and rotation: their uids and extra data belong to the other map.
   */
  addDocument(other: MapDocument, x: number, y: number, module?: Floating["module"]): void {
    if (other.mode !== this.mode) {
      throw new Error(`A ${MODE_INFO[other.mode].name.toLowerCase()} can't be added to a ${MODE_INFO[this.mode].name.toLowerCase()}.`);
    }
    this.commitFloating();
    const orderOffset = Math.max(0, ...[...this.doc.layers.marker.values()].flatMap(itemsOf).map((item) => item.order ?? 0));
    const cells = new Map<LayerId, Map<string, Brush>>();
    for (const layer of this.layers) {
      const layerCells = new Map<string, Brush>();
      for (const [key, brush] of other.layers[layer]) {
        const items = itemsOf(brush).map(({ uid, ...item }): Item => (item.order === undefined ? item : { ...item, order: item.order + orderOffset }));
        layerCells.set(key, fromItems(items)!);
      }
      cells.set(layer, layerCells);
    }
    const mask = new Set<string>();
    for (let ry = 0; ry < other.height; ry++) for (let rx = 0; rx < other.width; rx++) mask.add(cellKey(rx, ry));
    this.selection = null;
    this.floating = { cells, mask, x, y, fromX: x, fromY: y, source: null, turns: 0, module };
    this.action = "select";
    this.emit("area", "cells", "selection", "history");
  }

  // ---- Modules ---------------------------------------------------------------------------------

  get instances(): ModuleInstance[] {
    return this.doc.instances ?? [];
  }

  /** The selected cells (or what is being moved) as a document of their own, for saving as a module. */
  selectionDocument(name: string): MapDocument | null {
    const floating = this.floating;
    const keys = floating ? [...floating.mask].map((key) => { const [x, y] = parseKey(key); return cellKey(x + floating.x, y + floating.y); }) : [...(this.selection ?? [])];
    if (keys.length === 0) return null;
    const points = keys.map(parseKey);
    const [minX, minY] = [Math.min(...points.map(([x]) => x)), Math.min(...points.map(([, y]) => y))];
    const [maxX, maxY] = [Math.max(...points.map(([x]) => x)), Math.max(...points.map(([, y]) => y))];
    const doc = createDocument(this.mode, name, maxX - minX + 1, maxY - minY + 1);
    doc.entry = { ...this.doc.entry };
    for (const layer of this.layers) {
      for (const [x, y] of points) {
        const brush = this.displayed(layer, x, y);
        // Entities become new ones in the module: uids belong to this map.
        if (brush) doc.layers[layer].set(cellKey(x - minX, y - minY), fromItems(itemsOf(brush).map(({ uid, ...item }) => item))!);
      }
    }
    return doc;
  }

  /**
   * Replaces every placed instance of a module with a new version: its footprint is cleared on all layers and the
   * module's content is written there again, turned as it was placed. One undo step.
   */
  updateInstances(moduleId: string, module: MapDocument, version: number): number {
    this.commitFloating();
    const targets = this.instances.filter((instance) => instance.module === moduleId && instance.version !== version);
    if (targets.length === 0) return 0;
    this.beginStroke();
    for (const instance of targets) {
      const turnedOld = instance.turns % 2 === 1;
      const [oldW, oldH] = turnedOld ? [instance.height, instance.width] : [instance.width, instance.height];
      for (const layer of this.layers) for (const key of this.rectKeys(instance.x, instance.y, instance.x + oldW - 1, instance.y + oldH - 1)) this.set(layer, ...parseKey(key), null);

      let cells = new Map<LayerId, Map<string, Brush>>(this.layers.map((layer) => [layer, new Map(module.layers[layer])]));
      let mask = new Set<string>();
      for (let y = 0; y < module.height; y++) for (let x = 0; x < module.width; x++) mask.add(cellKey(x, y));
      for (let turn = 0; turn < instance.turns; turn++) ({ cells, mask } = turnContent(cells, mask, 1, (layer) => this.stacks(layer)));
      for (const [layer, layerCells] of cells) {
        for (const [key, brush] of layerCells) {
          const [x, y] = parseKey(key);
          this.set(layer, instance.x + x, instance.y + y, fromItems(itemsOf(brush).map(({ uid, ...item }) => item)));
        }
      }
    }
    const after = this.instances.map((instance) =>
      targets.includes(instance) ? { ...instance, width: module.width, height: module.height, version } : instance
    );
    this.record({ type: "instances", before: this.instances, after });
    this.endStroke();
    return targets.length;
  }

  /** Stops tracking a placed module (its cells stay). */
  forgetInstance(index: number): void {
    const before = this.instances;
    if (!before[index]) return;
    this.beginStroke();
    this.record({ type: "instances", before, after: before.filter((_, i) => i !== index) });
    this.endStroke();
  }

  // ---- Random room slots (stations) ------------------------------------------------------------

  get roomSlots(): RoomSlot[] {
    return this.doc.roomSlots ?? [];
  }

  private setSlots(after: RoomSlot[]): void {
    this.beginStroke();
    this.record({ type: "slots", before: this.roomSlots, after });
    this.endStroke();
  }

  /** A room slot over the selection's bounding box. */
  addRoomSlot(name: string): RoomSlot | null {
    if (!this.selection) return null;
    const points = [...this.selection].map(parseKey);
    const [x, y] = [Math.min(...points.map(([px]) => px)), Math.min(...points.map(([, py]) => py))];
    const slot: RoomSlot = {
      name,
      x,
      y,
      width: Math.max(...points.map(([px]) => px)) - x + 1,
      height: Math.max(...points.map(([, py]) => py)) - y + 1,
      modules: [],
    };
    this.setSlots([...this.roomSlots, slot]);
    return slot;
  }

  setSlotModules(index: number, modules: string[]): void {
    if (!this.roomSlots[index]) return;
    this.setSlots(this.roomSlots.map((slot, i) => (i === index ? { ...slot, modules } : slot)));
  }

  removeRoomSlot(index: number): void {
    this.setSlots(this.roomSlots.filter((_, i) => i !== index));
  }

  // ---- Entries (domain) ------------------------------------------------------------------------

  /** Entry markers in order. */
  entries(): [string, Item][] {
    return [...this.doc.layers.marker]
      .filter((entry): entry is [string, Item] => entry[1].kind === "fixed" && entry[1].id === ENTRY_ID)
      .sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0));
  }

  setEntrySettings(settings: Partial<EntrySettings>): void {
    const before = this.doc.entry;
    const after = { ...before, ...settings };
    after.cohort = clampCohort(after.cohort);
    if (after.mode === before.mode && after.cohort === before.cohort && after.loop === before.loop) return;
    this.beginStroke();
    this.record({ type: "entry", before, after });
    this.endStroke();
  }

  /** Swaps an entry with its neighbour in the order (delta -1 = earlier, +1 = later). */
  moveEntry(key: string, delta: number): void {
    const entries = this.entries();
    const index = entries.findIndex(([entryKey]) => entryKey === key);
    const other = entries[index + delta];
    if (index < 0 || !other) return;
    const [, brush] = entries[index];
    this.beginStroke();
    this.set("marker", ...parseKey(key), { ...brush, order: other[1].order });
    this.set("marker", ...parseKey(other[0]), { ...other[1], order: brush.order });
    this.endStroke();
  }

  // ---- Validation ------------------------------------------------------------------------------

  get profile(): StationProfile {
    return this.doc.profile ?? "draft";
  }

  setProfile(profile: StationProfile): void {
    this.doc.profile = profile;
    this.emit("document");
  }

  validate(): Warning[] {
    const warnings: Warning[] = [];
    if (this.mode === "domain") this.validateDomain(warnings);
    if (this.mode === "station" && this.profile === "exportable") warnings.push(...exportableChecks(this.doc, this.palette));
    if (this.mode === "station") warnings.push(...moduleEdgeChecks(this.doc, this.palette), ...lightChecks(this.doc, this.palette));

    // One warning per id and layer, pointing at its first cell.
    for (const layer of this.layers) {
      const firstSeen = new Map<string, [number, number]>();
      for (const [key, brush] of this.doc.layers[layer]) {
        for (const { id } of itemsOf(brush)) if (!firstSeen.has(id)) firstSeen.set(id, parseKey(key));
      }
      for (const [id, at] of firstSeen) {
        const item = this.palette.byLayer[layer].get(id);
        if (item?.flags?.noMap) warnings.push({ message: `"${id}" is marked Do not map in the game.`, at });
        if (item) continue;
        const renamed = this.palette.migrations.get(id);
        if (renamed === null) warnings.push({ message: `"${id}" was removed from the game; it disappears when the map loads.`, at });
        else if (renamed && findItem(this.palette, layer, id)) warnings.push({ message: `"${id}" was renamed to "${renamed}" in the game.`, at });
        // The game refuses to load a map with an entity or tile it does not know.
        else warnings.push({ message: `Unknown ${layer} id "${id}" (not in the current palette); the game will not load the map.`, at, level: "error" });
      }
    }
    // Errors first; the sort keeps the order within each level.
    return warnings.sort((a, b) => Number(b.level === "error") - Number(a.level === "error"));
  }

  /** Q-Gate rules: at least one entry, a Qlippoth spot, markers on walkable floor. */
  private validateDomain(warnings: Warning[]): void {
    const markers = this.doc.layers.marker;
    const count = (id: string) => [...markers.values()].flatMap(itemsOf).filter((item) => item.id === id).length;

    if (count(ENTRY_ID) === 0) warnings.push({ message: "No Entry marker: players have nowhere to arrive.", level: "error" });
    if (count("QlippothSpot") === 0) warnings.push({ message: "No Qlippoth spot marker.", level: "error" });

    for (const [key] of markers) {
      const [x, y] = parseKey(key);
      if (!this.doc.layers.floor.has(key)) warnings.push({ message: "Marker without a floor tile: it is in space.", at: [x, y], level: "error" });
      const structure = itemsOf(this.doc.layers.structure.get(key));
      if (structure.some((item) => this.palette.byLayer.structure.get(item.id)?.category === "Structures/Walls")) {
        warnings.push({ message: "Marker inside a wall: whoever arrives there is stuck.", at: [x, y], level: "error" });
      }
    }
  }
}

function invert(change: Change): Change {
  switch (change.type) {
    case "cell":
      return { ...change, before: change.after, after: change.before };
    case "size":
    case "name":
    case "entry":
    case "instances":
    case "slots":
      return { ...change, before: change.after, after: change.before } as Change;
  }
}

/** The item with a rotation (normalized; no rot field when it is 0). */
function withRotation(item: Item, rot: number): Item {
  const { rot: _, ...rest } = item;
  const value = normalizeAngle(rot);
  return value ? { ...rest, rot: value } : rest;
}
