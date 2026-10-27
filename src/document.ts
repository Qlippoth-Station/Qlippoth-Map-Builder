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
 */
export type Brush = { kind: "fixed"; id: string };

export interface MapDocument {
  mode: ModeId;
  name: string;
  width: number;
  height: number;
  /** Sparse cells per layer, keyed by cellKey(x, y). Origin is bottom-left and y grows upwards, like game grids. Layers outside the mode stay empty. */
  layers: Record<LayerId, Map<string, Brush>>;
}

/** File format id per mode. The domain format is unchanged from before modes existed. */
export const FORMAT_IDS: Record<ModeId, string> = { domain: "qlippoth-domain", station: "qlippoth-station" };
export const FORMAT_VERSION = 1;
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
  return a.kind === b.kind && a.id === b.id;
}

export function createDocument(mode: ModeId, name: string, width: number, height: number): MapDocument {
  return {
    mode,
    name,
    width: clampSize(width),
    height: clampSize(height),
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
  return JSON.stringify(
    { format: FORMAT_IDS[doc.mode], version: FORMAT_VERSION, name: doc.name, width: doc.width, height: doc.height, layers },
    null,
    2
  ) + "\n";
}

/** Reads a domain or station file; the format id decides the mode. */
export function deserialize(text: string): MapDocument {
  const data = JSON.parse(text);
  const mode = (Object.keys(FORMAT_IDS) as ModeId[]).find((id) => FORMAT_IDS[id] === data?.format);
  if (!mode) throw new Error("Not a Qlippoth domain or station file.");
  if (data.version !== FORMAT_VERSION) throw new Error(`Unsupported format version ${data.version}.`);

  const doc = createDocument(mode, String(data.name ?? MODE_INFO[mode].defaultName), Number(data.width), Number(data.height));
  for (const layer of MODE_INFO[mode].layers) {
    const cells = data.layers?.[layer] ?? {};
    for (const [key, brush] of Object.entries(cells)) {
      const [x, y] = parseKey(key);
      if (!inBounds(doc, x, y)) continue;
      const b = brush as Brush;
      if (b?.kind === "fixed" && typeof b.id === "string") doc.layers[layer].set(cellKey(x, y), { kind: "fixed", id: b.id });
    }
  }
  return doc;
}

export function inBounds(doc: MapDocument, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < doc.width && y < doc.height;
}
