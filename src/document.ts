// The map document: what the editor edits and what is saved to / loaded from .json files.
// See docs/format.md for the on-disk formats.

import { MODE_INFO, type ModeId } from "./modes";

export const LAYERS = ["floor", "structure", "object", "marker"] as const;
export type LayerId = (typeof LAYERS)[number];

export const LAYER_NAMES: Record<LayerId, string> = {
  floor: "Floor",
  structure: "Structure",
  object: "Object",
  marker: "Marker",
};

/**
 * What a cell becomes in the game. Only fixed brushes exist for now;
 * tile sets and random modes (weak/default/full/chance) will extend this union.
 * `order` is only used by Entry markers: the portal's place in the entry order (1, 2, ...).
 */
export type Brush = { kind: "fixed"; id: string; order?: number };

export const ENTRY_ID = "Entry";

/** How players arriving through the Q-Gate are spread over the Entry markers of a domain. */
export const ENTRY_MODES = ["random", "order", "cohort"] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];

export interface EntrySettings {
  mode: EntryMode;
  /** Cohort mode: players sent through one portal before the next one is used. */
  cohort: number;
  /** Cohort mode: after the last portal, start again at the first (true) or stop accepting (false). */
  loop: boolean;
}

export const DEFAULT_ENTRY: EntrySettings = { mode: "random", cohort: 3, loop: true };
export const MAX_COHORT = 99;

export interface MapDocument {
  mode: ModeId;
  name: string;
  width: number;
  height: number;
  /** Domain only. */
  entry: EntrySettings;
  /** Sparse cells per layer, keyed by cellKey(x, y). Origin is bottom-left and y grows upwards, like game grids. Layers outside the mode stay empty. */
  layers: Record<LayerId, Map<string, Brush>>;
}

/** File format id and current version per mode. Domain version 2 added entry settings and entry order. */
export const FORMAT_IDS: Record<ModeId, string> = { domain: "qlippoth-domain", station: "qlippoth-station" };
export const FORMAT_VERSIONS: Record<ModeId, number> = { domain: 2, station: 1 };
export const MIN_SIZE = 1;
export const MAX_SIZE = 256;

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseKey(key: string): [number, number] {
  const [x, y] = key.split(",").map(Number);
  return [x, y];
}

export function sameBrush(a: Brush | null | undefined, b: Brush | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.kind === b.kind && a.id === b.id && a.order === b.order;
}

export function clampCohort(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_COHORT, Math.max(1, Math.round(value))) : DEFAULT_ENTRY.cohort;
}

/**
 * Gives the Entry markers the orders 1..n, keeping their current relative order.
 * Entries without an order (new ones) go last, bottom-to-top then left-to-right. Returns the cells to change.
 */
export function entryRenumbering(markers: Map<string, Brush>): [string, Brush][] {
  const entries = [...markers].filter(([, brush]) => brush.id === ENTRY_ID);
  entries.sort(([ka, a], [kb, b]) => {
    const [ax, ay] = parseKey(ka);
    const [bx, by] = parseKey(kb);
    return (a.order ?? Infinity) - (b.order ?? Infinity) || ay - by || ax - bx;
  });
  const changes: [string, Brush][] = [];
  entries.forEach(([key, brush], index) => {
    if (brush.order !== index + 1) changes.push([key, { ...brush, order: index + 1 }]);
  });
  return changes;
}

export function createDocument(mode: ModeId, name: string, width: number, height: number): MapDocument {
  return {
    mode,
    name,
    width: clampSize(width),
    height: clampSize(height),
    entry: { ...DEFAULT_ENTRY },
    layers: { floor: new Map(), structure: new Map(), object: new Map(), marker: new Map() },
  };
}

export function clampSize(value: number): number {
  if (!Number.isFinite(value)) return MIN_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(value)));
}

export function serialize(doc: MapDocument): string {
  const layers: Record<string, Record<string, Brush>> = {};
  for (const layer of MODE_INFO[doc.mode].layers) {
    // Sorted by y then x so saved files diff cleanly in pull requests.
    const keys = [...doc.layers[layer].keys()].sort((a, b) => {
      const [ax, ay] = parseKey(a);
      const [bx, by] = parseKey(b);
      return ay - by || ax - bx;
    });
    const cells: Record<string, Brush> = {};
    for (const key of keys) cells[key] = doc.layers[layer].get(key)!;
    layers[layer] = cells;
  }
  const entry = doc.mode === "domain" ? { entry: doc.entry } : {};
  return JSON.stringify(
    { format: FORMAT_IDS[doc.mode], version: FORMAT_VERSIONS[doc.mode], name: doc.name, width: doc.width, height: doc.height, ...entry, layers },
    null,
    2
  ) + "\n";
}

/** Reads a domain or station file; the format id decides the mode. */
export function deserialize(text: string): MapDocument {
  const data = JSON.parse(text);
  const mode = (Object.keys(FORMAT_IDS) as ModeId[]).find((id) => FORMAT_IDS[id] === data?.format);
  if (!mode) throw new Error("Not a Qlippoth domain or station file.");
  if (!Number.isInteger(data.version) || data.version < 1 || data.version > FORMAT_VERSIONS[mode]) {
    throw new Error(`Unsupported format version ${data.version}.`);
  }

  const doc = createDocument(mode, String(data.name ?? MODE_INFO[mode].defaultName), Number(data.width), Number(data.height));
  if (mode === "domain" && data.entry) {
    const { mode: entryMode, cohort, loop } = data.entry;
    doc.entry = {
      mode: ENTRY_MODES.includes(entryMode) ? entryMode : DEFAULT_ENTRY.mode,
      cohort: clampCohort(Number(cohort)),
      loop: typeof loop === "boolean" ? loop : DEFAULT_ENTRY.loop,
    };
  }
  for (const layer of MODE_INFO[mode].layers) {
    const cells = data.layers?.[layer] ?? {};
    for (const [key, brush] of Object.entries(cells)) {
      const [x, y] = parseKey(key);
      if (!inBounds(doc, x, y)) continue;
      const b = brush as Brush;
      if (b?.kind !== "fixed" || typeof b.id !== "string") continue;
      const order = b.id === ENTRY_ID && Number.isInteger(b.order) && b.order! > 0 ? { order: b.order } : {};
      doc.layers[layer].set(cellKey(x, y), { kind: "fixed", id: b.id, ...order });
    }
  }
  // Version 1 files have no entry order; this also repairs gaps and duplicates.
  for (const [key, brush] of entryRenumbering(doc.layers.marker)) doc.layers.marker.set(key, brush);
  return doc;
}

export function inBounds(doc: MapDocument, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < doc.width && y < doc.height;
}
