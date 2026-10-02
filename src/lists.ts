// Random lists: named lists of tiles or entities a cell picks from at random ("weak walls", "strong walls", …).
// Each list is its own .list.json file, so people can keep their own library, share lists and add them to pull
// requests next to the domains that use them. See docs/format.md for the file format.

import type { LayerId } from "./document";

export const LIST_FORMAT_ID = "qlippoth-list";
/** Newest list format: 2 adds the empty choice and symbol icons. Files are written with the lowest version that fits. */
export const LIST_FORMAT_VERSION = 2;

/** Markers are always fixed, so lists exist for the other layers only. */
export const LIST_LAYERS = ["floor", "structure", "object"] as const;
export type ListLayer = (typeof LIST_LAYERS)[number];

export const MAX_WEIGHT = 1000;
/** List ids are file names and appear in roll keys (docs/randomness.md), so they are kept to plain ASCII. */
export const LIST_ID_PATTERN = /^[a-z0-9]+(_[a-z0-9]+)*$/;
/** Symbol ids are file names in assets/list-symbols/. */
export const SYMBOL_ID_PATTERN = /^[a-z0-9]+([_-][a-z0-9]+)*$/;
export const DEFAULT_LIST_COLOR = "#c0803a";

export interface ListEntry {
  /** Tile or entity id, or null for the empty choice: the cell is left empty. */
  id: string | null;
  /** Relative chance, a whole number from 1 to MAX_WEIGHT. */
  weight: number;
}

export interface TileList {
  id: string;
  name: string;
  layer: ListLayer;
  /** Shown on the map in place of the cell's content: a symbol from assets/list-symbols, or one or two characters, on a colored square. */
  glyph: string;
  symbol?: string;
  color: string;
  entries: ListEntry[];
  /** Ships with the editor (lists/ in this repository) and cannot be changed or removed in the editor. Not saved in files. */
  builtIn?: boolean;
}

export function isListLayer(layer: LayerId): layer is ListLayer {
  return (LIST_LAYERS as readonly string[]).includes(layer);
}

/** "Weak walls" -> "weak_walls". */
export function listIdFromName(name: string): string {
  return (
    name
      .toLocaleLowerCase("en")
      .replace(/ı/g, "i")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "list"
  );
}

/** A list id that is not in `taken`, based on the name. */
export function uniqueListId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = listIdFromName(name);
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}_${index}`)) index++;
  return `${base}_${index}`;
}

export function listFileName(list: TileList): string {
  return `${list.id}.list.json`;
}

export function createList(id: string, name: string, layer: ListLayer): TileList {
  return { id, name, layer, glyph: name.trim().charAt(0).toUpperCase() || "?", color: DEFAULT_LIST_COLOR, entries: [] };
}

export function hasEmptyChoice(list: TileList): boolean {
  return list.entries.some((entry) => entry.id === null);
}

/** Entries that place something (everything except the empty choice). */
export function itemEntries(list: TileList): { id: string; weight: number }[] {
  return list.entries.filter((entry): entry is { id: string; weight: number } => entry.id !== null);
}

export function sameList(a: TileList, b: TileList): boolean {
  return serializeList(a) === serializeList(b);
}

// ---- Chances -------------------------------------------------------------------------------------

/** Chance of each entry in percent, from the weights. */
export function chances(entries: ListEntry[]): number[] {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return entries.map((entry) => (total ? (entry.weight / total) * 100 : 0));
}

/** Weights out of this total when chances are set directly: 0.1 % steps. */
export const CHANCE_SCALE = 1000;

/**
 * Sets one entry's chance in percent and scales all others so the chances add up to 100 % again, keeping the others'
 * proportions. Every entry keeps at least the smallest step (0.1 %); remove an entry to drop it entirely.
 */
export function setEntryChance(entries: ListEntry[], index: number, percent: number): ListEntry[] {
  if (entries.length < 2 || index < 0 || index >= entries.length) return entries;
  const others = entries.length - 1;
  const target = Math.min(CHANCE_SCALE - others, Math.max(1, Math.round((percent / 100) * CHANCE_SCALE)));
  const remaining = CHANCE_SCALE - target;
  const otherTotal = entries.reduce((sum, entry, i) => (i === index ? sum : sum + entry.weight), 0);

  // Largest remainder: share `remaining` by the old weights, at least 1 each, adding up exactly.
  const shares = entries.map((entry, i) => (i === index ? 0 : (entry.weight / otherTotal) * remaining));
  const weights = shares.map((share, i) => (i === index ? target : Math.max(1, Math.floor(share))));
  let left = CHANCE_SCALE - weights.reduce((sum, weight) => sum + weight, 0);
  const byFraction = shares.map((share, i) => ({ i, fraction: share - Math.floor(share) })).filter(({ i }) => i !== index).sort((a, b) => b.fraction - a.fraction);
  for (let k = 0; left > 0; k++, left--) weights[byFraction[k % byFraction.length].i]++;
  while (left < 0) {
    // Only possible when the minimum of 1 pushed the sum over: take from the biggest other entry.
    let biggest = -1;
    for (let i = 0; i < weights.length; i++) if (i !== index && weights[i] > 1 && (biggest < 0 || weights[i] > weights[biggest])) biggest = i;
    weights[biggest]--;
    left++;
  }
  return entries.map((entry, i) => ({ ...entry, weight: weights[i] }));
}

/** Gives every entry the same chance. */
export function equalChances(entries: ListEntry[]): ListEntry[] {
  return entries.map((entry) => ({ ...entry, weight: 1 }));
}

// ---- Files ---------------------------------------------------------------------------------------

/** The lowest list format version that can hold the list. */
export function requiredListVersion(list: TileList): number {
  return hasEmptyChoice(list) || list.symbol ? 2 : 1;
}

export function serializeList(list: TileList): string {
  return (
    JSON.stringify(
      {
        format: LIST_FORMAT_ID,
        version: requiredListVersion(list),
        id: list.id,
        name: list.name,
        layer: list.layer,
        icon: list.symbol ? { symbol: list.symbol, glyph: list.glyph, color: list.color } : { glyph: list.glyph, color: list.color },
        entries: list.entries.map((entry) => (entry.id === null ? { empty: true, weight: entry.weight } : { id: entry.id, weight: entry.weight })),
      },
      null,
      2
    ) + "\n"
  );
}

/** Reads a .list.json file (version 1 or 2). Throws with a readable message when it is not a valid list. */
export function parseList(text: string): TileList {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Not a valid JSON file.");
  }
  if (typeof data !== "object" || data === null || data.format !== LIST_FORMAT_ID) throw new Error("Not a Qlippoth list file.");
  const version = data.version;
  if (version !== 1 && version !== 2) {
    throw new Error(typeof version === "number" && version > LIST_FORMAT_VERSION ? `List format version ${version} is newer than this editor; reload to get the latest editor.` : `Unsupported list format version ${JSON.stringify(version)}.`);
  }

  const id = data.id;
  if (typeof id !== "string" || !LIST_ID_PATTERN.test(id)) throw new Error(`List id ${JSON.stringify(id)} must be lowercase snake_case.`);
  const layer = data.layer;
  if (typeof layer !== "string" || !isListLayer(layer as LayerId)) throw new Error(`List layer ${JSON.stringify(layer)} must be floor, structure or object.`);

  const icon = (typeof data.icon === "object" && data.icon !== null ? data.icon : {}) as Record<string, unknown>;
  const entries: ListEntry[] = [];
  for (const raw of Array.isArray(data.entries) ? data.entries : []) {
    const entry = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const weight = entry.weight === undefined ? 1 : entry.weight;
    const empty = entry.empty === true;
    if (empty && version < 2) throw new Error("The empty choice needs list format version 2.");
    if (empty && entry.id !== undefined) throw new Error("An entry is either empty or has an id, not both.");
    if (!empty && (typeof entry.id !== "string" || entry.id === "")) throw new Error("Every list entry needs an id (or \"empty\": true).");
    const label = empty ? "the empty choice" : `"${entry.id}"`;
    if (!Number.isInteger(weight) || (weight as number) < 1 || (weight as number) > MAX_WEIGHT) {
      throw new Error(`Weight of ${label} must be a whole number from 1 to ${MAX_WEIGHT}.`);
    }
    if (empty && entries.some((other) => other.id === null)) throw new Error("A list can have only one empty choice.");
    entries.push({ id: empty ? null : (entry.id as string), weight: weight as number });
  }

  const symbol = typeof icon.symbol === "string" && SYMBOL_ID_PATTERN.test(icon.symbol) ? icon.symbol : undefined;
  if (symbol && version < 2) throw new Error("Symbol icons need list format version 2.");
  return {
    id,
    name: typeof data.name === "string" && data.name.trim() ? data.name : id,
    layer: layer as ListLayer,
    glyph: typeof icon.glyph === "string" && icon.glyph.trim() ? [...icon.glyph.trim()].slice(0, 2).join("") : "?",
    ...(symbol ? { symbol } : {}),
    color: typeof icon.color === "string" && /^#[0-9a-fA-F]{6}$/.test(icon.color) ? icon.color : DEFAULT_LIST_COLOR,
    entries,
  };
}
