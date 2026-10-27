// The map document: what the editor edits and what is saved to / loaded from .json files.
// See docs/format.md for the on-disk formats.

import { MODE_INFO, type ModeId } from "./modes";
import type { StationSource } from "./station/source";

export const LAYERS = ["floor", "structure", "object", "marker"] as const;
export type LayerId = (typeof LAYERS)[number];

export const LAYER_NAMES: Record<LayerId, string> = {
  floor: "Floor",
  structure: "Structure",
  object: "Object",
  marker: "Marker",
};

/**
 * One thing in a cell: a tile, an entity or a marker.
 * - `order`: Entry markers only, the portal's place in the entry order (1, 2, ...).
 * - `rot`: entity rotation in radians, counter-clockwise like the game (stations).
 * - `uid`: the entity's uid in the game map it was imported from; its other data stays in the station source.
 * - `tile`: tile flags, variant and rotation/mirroring as stored in game maps.
 */
export interface Item {
  kind: "fixed";
  id: string;
  order?: number;
  rot?: number;
  uid?: number;
  tile?: [flags: number, variant: number, rotation: number];
}

/** Several items in one cell, bottom first (stacking layers of stations). Always at least two items. */
export interface Stack {
  kind: "stack";
  items: Item[];
}

/**
 * What a cell holds on one layer. Tile sets and random modes (weak/default/full/chance) will extend this union.
 */
export type Brush = Item | Stack;

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
  /** Station imported from a game map: everything the editor does not show, kept to write the map back unchanged. */
  station?: StationSource;
}

/**
 * File format id and current version per mode. Domain version 2 added entry settings and entry order;
 * station version 2 added stacks and rotation.
 */
export const FORMAT_IDS: Record<ModeId, string> = { domain: "qlippoth-domain", station: "qlippoth-station" };
export const FORMAT_VERSIONS: Record<ModeId, number> = { domain: 2, station: 2 };
export const MIN_SIZE = 1;
/** Largest map side of any mode; each mode has its own limit (MODE_INFO[mode].maxSize). */
export const MAX_SIZE = 512;

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseKey(key: string): [number, number] {
  const [x, y] = key.split(",").map(Number);
  return [x, y];
}

function sameItem(a: Item, b: Item): boolean {
  return (
    a.id === b.id &&
    a.order === b.order &&
    a.rot === b.rot &&
    a.uid === b.uid &&
    (a.tile === b.tile || (!!a.tile && !!b.tile && a.tile.every((value, index) => value === b.tile![index])))
  );
}

export function sameBrush(a: Brush | null | undefined, b: Brush | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const [ia, ib] = [itemsOf(a), itemsOf(b)];
  return ia.length === ib.length && ia.every((item, index) => sameItem(item, ib[index]));
}

/** Angle in (-π, π]; 0 when it is a whole turn. */
export function normalizeAngle(angle: number): number {
  let value = angle % (2 * Math.PI);
  if (value > Math.PI) value -= 2 * Math.PI;
  if (value <= -Math.PI) value += 2 * Math.PI;
  return Math.abs(value) < 1e-9 ? 0 : value;
}

/** A quarter turn clockwise (-1) or counter-clockwise (1) of a game angle. */
export const QUARTER_TURN = Math.PI / 2;

/** The items of a cell, bottom first. */
export function itemsOf(brush: Brush | null | undefined): Item[] {
  if (!brush) return [];
  return brush.kind === "stack" ? brush.items : [brush];
}

/** A cell value from items: nothing, one item, or a stack. */
export function fromItems(items: Item[]): Brush | null {
  if (items.length === 0) return null;
  return items.length === 1 ? items[0] : { kind: "stack", items };
}

/** What a cell holds, ignoring rotation and identity: used to tell areas of "the same content" apart (fill, wand). */
export function contentKey(brush: Brush | null | undefined): string {
  return itemsOf(brush).map((item) => item.id).join("|");
}

export function clampCohort(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_COHORT, Math.max(1, Math.round(value))) : DEFAULT_ENTRY.cohort;
}

/**
 * Gives the Entry markers the orders 1..n, keeping their current relative order.
 * Entries without an order (new ones) go last, bottom-to-top then left-to-right. Returns the cells to change.
 */
export function entryRenumbering(markers: Map<string, Brush>): [string, Item][] {
  const entries = [...markers].filter((entry): entry is [string, Item] => entry[1].kind === "fixed" && entry[1].id === ENTRY_ID);
  entries.sort(([ka, a], [kb, b]) => {
    const [ax, ay] = parseKey(ka);
    const [bx, by] = parseKey(kb);
    return (a.order ?? Infinity) - (b.order ?? Infinity) || ay - by || ax - bx;
  });
  const changes: [string, Item][] = [];
  entries.forEach(([key, brush], index) => {
    if (brush.order !== index + 1) changes.push([key, { ...brush, order: index + 1 }]);
  });
  return changes;
}

export function createDocument(mode: ModeId, name: string, width: number, height: number): MapDocument {
  return {
    mode,
    name,
    width: clampSize(width, MODE_INFO[mode].maxSize),
    height: clampSize(height, MODE_INFO[mode].maxSize),
    entry: { ...DEFAULT_ENTRY },
    layers: { floor: new Map(), structure: new Map(), object: new Map(), marker: new Map() },
  };
}

export function clampSize(value: number, max = MAX_SIZE): number {
  if (!Number.isFinite(value)) return MIN_SIZE;
  return Math.min(max, Math.max(MIN_SIZE, Math.round(value)));
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
    for (const key of keys) cells[key] = withoutUids(doc.layers[layer].get(key)!);
    layers[layer] = cells;
  }
  const entry = doc.mode === "domain" ? { entry: doc.entry } : {};
  return JSON.stringify(
    { format: FORMAT_IDS[doc.mode], version: FORMAT_VERSIONS[doc.mode], name: doc.name, width: doc.width, height: doc.height, ...entry, layers },
    null,
    2
  ) + "\n";
}

/** Entity uids only mean something next to the game map they came from, which JSON files do not carry. */
function withoutUids(brush: Brush): Brush {
  return fromItems(itemsOf(brush).map(({ uid, ...item }) => item))!;
}

function readItem(data: unknown): Item | null {
  const value = data as Partial<Item> | null;
  if (value?.kind !== "fixed" || typeof value.id !== "string") return null;
  const item: Item = { kind: "fixed", id: value.id };
  if (value.id === ENTRY_ID && Number.isInteger(value.order) && value.order! > 0) item.order = value.order;
  if (typeof value.rot === "number" && Number.isFinite(value.rot) && value.rot !== 0) item.rot = value.rot;
  if (Array.isArray(value.tile) && value.tile.length === 3 && value.tile.every(Number.isInteger)) item.tile = [...value.tile] as Item["tile"];
  return item;
}

function readBrush(data: unknown, stacking: boolean): Brush | null {
  const value = data as { kind?: string; items?: unknown[] } | null;
  if (value?.kind === "stack" && Array.isArray(value.items)) {
    const items = value.items.map(readItem).filter((item): item is Item => item !== null);
    return fromItems(stacking ? items : items.slice(-1));
  }
  return readItem(data);
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
      const value = readBrush(brush, MODE_INFO[mode].stacking.includes(layer));
      if (value) doc.layers[layer].set(cellKey(x, y), value);
    }
  }
  // Version 1 files have no entry order; this also repairs gaps and duplicates.
  for (const [key, brush] of entryRenumbering(doc.layers.marker)) doc.layers.marker.set(key, brush);
  return doc;
}

export function inBounds(doc: MapDocument, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < doc.width && y < doc.height;
}
