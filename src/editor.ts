import {
  LAYERS,
  cellKey,
  clampSize,
  inBounds,
  parseKey,
  sameBrush,
  type Brush,
  type DomainDocument,
  type LayerId,
} from "./document";
import type { Palette } from "./palette";

export const TOOLS = ["brush", "rect", "fill", "erase", "pick"] as const;
export type ToolId = (typeof TOOLS)[number];

export const TOOL_INFO: Record<ToolId, { name: string; key: string; hint: string }> = {
  brush: { name: "Brush", key: "B", hint: "Paint cells with the selected item" },
  rect: { name: "Rectangle", key: "R", hint: "Drag to fill a rectangle" },
  fill: { name: "Fill", key: "F", hint: "Fill the connected area of the same content" },
  erase: { name: "Erase", key: "E", hint: "Clear cells on the active layer" },
  pick: { name: "Pick", key: "I", hint: "Pick the item under the cursor (also right click)" },
};

/** What changed, so views only redo the work they need. */
export type Topic = "cells" | "document" | "selection" | "view" | "history";

type Change =
  | { type: "cell"; layer: LayerId; key: string; before: Brush | null; after: Brush | null }
  | { type: "size"; before: [number, number]; after: [number, number] }
  | { type: "name"; before: string; after: string };

export interface Warning {
  message: string;
  at?: [number, number];
}

export class Editor {
  doc: DomainDocument;
  activeLayer: LayerId = "floor";
  tool: ToolId = "brush";
  selected: Record<LayerId, string | null> = { floor: null, structure: null, object: null, marker: null };
  visible: Record<LayerId, boolean> = { floor: true, structure: true, object: true, marker: true };
  dimInactive = false;
  showGrid = true;
  /** Increases on every edit; compared against the last saved value to know about unsaved work. */
  revision = 0;
  savedRevision = 0;

  private undoStack: Change[][] = [];
  private redoStack: Change[][] = [];
  private stroke: Change[] | null = null;
  private listeners = new Set<(topics: Set<Topic>) => void>();
  private queued = new Set<Topic>();
  private flushScheduled = false;

  constructor(readonly palette: Palette, doc: DomainDocument) {
    this.doc = doc;
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

  // ---- Selection / view state ------------------------------------------------------------------

  setLayer(layer: LayerId): void {
    this.activeLayer = layer;
    this.visible[layer] = true;
    this.emit("selection", "view");
  }

  setTool(tool: ToolId): void {
    this.tool = tool;
    this.emit("selection");
  }

  select(layer: LayerId, id: string | null): void {
    this.selected[layer] = id;
    this.activeLayer = layer;
    this.visible[layer] = true;
    if (this.tool === "erase" || this.tool === "pick") this.tool = "brush";
    this.emit("selection", "view");
  }

  selectedBrush(): Brush | null {
    const id = this.selected[this.activeLayer];
    return id ? { kind: "fixed", id } : null;
  }

  // ---- Editing ---------------------------------------------------------------------------------

  beginStroke(): void {
    this.endStroke();
    this.stroke = [];
  }

  endStroke(): void {
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

  /** Sets one cell. Must be called inside a stroke (or it opens a single-change stroke itself). */
  set(layer: LayerId, x: number, y: number, brush: Brush | null): void {
    if (!inBounds(this.doc, x, y)) return;
    const key = cellKey(x, y);
    const before = this.doc.layers[layer].get(key) ?? null;
    if (sameBrush(before, brush)) return;

    const standalone = !this.stroke;
    if (standalone) this.beginStroke();
    this.apply({ type: "cell", layer, key, before, after: brush });
    this.stroke!.push({ type: "cell", layer, key, before, after: brush });
    if (standalone) this.endStroke();
  }

  fillRect(layer: LayerId, x0: number, y0: number, x1: number, y1: number, brush: Brush | null): void {
    const [minX, maxX] = [Math.max(0, Math.min(x0, x1)), Math.min(this.doc.width - 1, Math.max(x0, x1))];
    const [minY, maxY] = [Math.max(0, Math.min(y0, y1)), Math.min(this.doc.height - 1, Math.max(y0, y1))];
    this.beginStroke();
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) this.set(layer, x, y, brush);
    this.endStroke();
  }

  /** 4-neighbour flood fill over cells that hold the same thing as the start cell. */
  floodFill(layer: LayerId, startX: number, startY: number, brush: Brush | null): void {
    if (!inBounds(this.doc, startX, startY)) return;
    const target = this.get(layer, startX, startY);
    if (sameBrush(target, brush)) return;

    this.beginStroke();
    const stack: [number, number][] = [[startX, startY]];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const key = cellKey(x, y);
      if (seen.has(key) || !inBounds(this.doc, x, y) || !sameBrush(this.get(layer, x, y), target)) continue;
      seen.add(key);
      this.set(layer, x, y, brush);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    this.endStroke();
  }

  /** Resizes around the bottom-left origin; cells that fall outside are removed (and come back on undo). */
  resize(width: number, height: number): void {
    const after: [number, number] = [clampSize(width), clampSize(height)];
    const before: [number, number] = [this.doc.width, this.doc.height];
    if (after[0] === before[0] && after[1] === before[1]) return;

    this.beginStroke();
    for (const layer of LAYERS) {
      for (const key of [...this.doc.layers[layer].keys()]) {
        const [x, y] = parseKey(key);
        if (x >= after[0] || y >= after[1]) this.set(layer, x, y, null);
      }
    }
    const change: Change = { type: "size", before, after };
    this.apply(change);
    this.stroke!.push(change);
    this.endStroke();
  }

  rename(name: string): void {
    if (name === this.doc.name) return;
    const change: Change = { type: "name", before: this.doc.name, after: name };
    this.beginStroke();
    this.apply(change);
    this.stroke!.push(change);
    this.endStroke();
  }

  undo(): void {
    this.endStroke();
    const changes = this.undoStack.pop();
    if (!changes) return;
    for (const change of [...changes].reverse()) this.apply(invert(change));
    this.redoStack.push(changes);
    this.emit("history");
  }

  redo(): void {
    this.endStroke();
    const changes = this.redoStack.pop();
    if (!changes) return;
    for (const change of changes) this.apply(change);
    this.undoStack.push(changes);
    this.emit("history");
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  replaceDocument(doc: DomainDocument): void {
    this.stroke = null;
    this.doc = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.revision++;
    this.savedRevision = this.revision;
    this.emit("document", "cells", "history");
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
    }
  }

  // ---- Validation ------------------------------------------------------------------------------

  validate(): Warning[] {
    const warnings: Warning[] = [];
    const markers = this.doc.layers.marker;
    const positions = (id: string) =>
      [...markers.entries()].filter(([, brush]) => brush.id === id).map(([key]) => parseKey(key));

    const entries = positions("Entry");
    if (entries.length === 0) warnings.push({ message: "No Entry marker." });
    for (const at of entries.slice(1)) warnings.push({ message: "More than one Entry marker.", at });
    if (positions("QlippothSpot").length === 0) warnings.push({ message: "No Qlippoth spot marker." });

    for (const [key] of markers) {
      const [x, y] = parseKey(key);
      if (!this.doc.layers.floor.has(key)) warnings.push({ message: "Marker without a floor tile.", at: [x, y] });
      const structure = this.doc.layers.structure.get(key);
      if (structure && this.palette.byLayer.structure.get(structure.id)?.category === "Structures/Walls") {
        warnings.push({ message: "Marker inside a wall.", at: [x, y] });
      }
    }

    for (const layer of LAYERS) {
      const missing = new Map<string, [number, number]>();
      for (const [key, brush] of this.doc.layers[layer]) {
        if (!this.palette.byLayer[layer].has(brush.id) && !missing.has(brush.id)) missing.set(brush.id, parseKey(key));
      }
      for (const [id, at] of missing) warnings.push({ message: `Unknown ${layer} id "${id}" (not in the current palette).`, at });
    }
    return warnings;
  }
}

function invert(change: Change): Change {
  switch (change.type) {
    case "cell":
      return { ...change, before: change.after, after: change.before };
    case "size":
      return { type: "size", before: change.after, after: change.before };
    case "name":
      return { type: "name", before: change.after, after: change.before };
  }
}
