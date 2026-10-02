// The domain document: what the editor edits and what is saved to / loaded from .json files.
// See docs/format.md for the on-disk format and docs/domain.schema.json for its schema.

import { parseBrush, sameBrush, type Brush } from "./brush";
import { migrate, type FileData } from "./migrate";

export { sameBrush, type Brush };

export const LAYERS = ["floor", "structure", "object", "marker"] as const;
export type LayerId = (typeof LAYERS)[number];

export const LAYER_NAMES: Record<LayerId, string> = {
  floor: "Floor",
  structure: "Structure",
  object: "Object",
  marker: "Marker",
};

export interface DomainDocument {
  name: string;
  width: number;
  height: number;
  /** Sparse cells per layer, keyed by cellKey(x, y). Origin is bottom-left and y grows upwards, like game grids. */
  layers: Record<LayerId, Map<string, Brush>>;
}

export const FORMAT_ID = "qlippoth-domain";
/** Newest version the editor reads and writes. */
export const FORMAT_VERSION = 2;
export const MIN_SIZE = 1;
export const MAX_SIZE = 256;

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseKey(key: string): [number, number] {
  const [x, y] = key.split(",").map(Number);
  return [x, y];
}

export function createDocument(name: string, width: number, height: number): DomainDocument {
  return {
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

/**
 * The lowest format version that can hold the document. Files are written with it, so a domain that uses no
 * version 2 feature stays readable by version 1 readers (the first game reader, stage 4a).
 */
export function requiredVersion(doc: DomainDocument): number {
  for (const layer of LAYERS) for (const brush of doc.layers[layer].values()) if (brush.kind === "list") return 2;
  return 1;
}

export function serialize(doc: DomainDocument): string {
  const layers: Record<string, Record<string, Brush>> = {};
  for (const layer of LAYERS) {
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
    { format: FORMAT_ID, version: requiredVersion(doc), name: doc.name, width: doc.width, height: doc.height, layers },
    null,
    2
  ) + "\n";
}

export interface ParseResult {
  document: DomainDocument;
  /** Things that were dropped while reading, so the user can be told instead of losing data silently. */
  problems: string[];
}

/** Reads a domain file of any known version. Throws if it is not a domain file or the version is unknown. */
export function parseDocument(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Not a valid JSON file.");
  }
  if (typeof raw !== "object" || raw === null || (raw as FileData).format !== FORMAT_ID) throw new Error("Not a Qlippoth domain file.");
  const data = migrate(raw as FileData, FORMAT_VERSION);

  const width = Number(data.width);
  const height = Number(data.height);
  const problems: string[] = [];
  if (!Number.isInteger(width) || !Number.isInteger(height) || clampSize(width) !== width || clampSize(height) !== height) {
    problems.push(`Size ${String(data.width)}×${String(data.height)} is not valid; it was changed to fit ${MIN_SIZE}–${MAX_SIZE}.`);
  }

  const document = createDocument(typeof data.name === "string" ? data.name : "Untitled", width, height);
  const layers = (typeof data.layers === "object" && data.layers !== null ? data.layers : {}) as Record<string, unknown>;
  for (const layer of LAYERS) {
    const cells = layers[layer];
    if (cells === undefined) continue;
    if (typeof cells !== "object" || cells === null) {
      problems.push(`Layer "${layer}" is not an object and was skipped.`);
      continue;
    }
    let outside = 0;
    let invalid = 0;
    for (const [key, value] of Object.entries(cells)) {
      const [x, y] = parseKey(key);
      const brush = parseBrush(value);
      // Markers are always fixed: the game needs to know exactly where they are.
      if (!brush || cellKey(x, y) !== key || (layer === "marker" && brush.kind !== "fixed")) invalid++;
      else if (!inBounds(document, x, y)) outside++;
      else document.layers[layer].set(key, brush);
    }
    if (outside) problems.push(`${outside} ${layer} cell(s) outside the map were dropped.`);
    if (invalid) problems.push(`${invalid} ${layer} cell(s) with an unknown key or brush were dropped.`);
  }
  for (const layer of Object.keys(layers)) {
    if (!(LAYERS as readonly string[]).includes(layer)) problems.push(`Unknown layer "${layer}" was skipped.`);
  }
  return { document, problems };
}

export function deserialize(text: string): DomainDocument {
  return parseDocument(text).document;
}

export function inBounds(doc: DomainDocument, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < doc.width && y < doc.height;
}
