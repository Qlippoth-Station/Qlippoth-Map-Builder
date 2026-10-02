// Random lists: named lists of tiles or entities a cell picks from at random ("weak walls", "strong walls", …).
// Each list is its own .list.json file, so people can keep their own library, share lists and add them to pull
// requests next to the domains that use them. See docs/format.md for the file format.

import type { LayerId } from "./document";

export const LIST_FORMAT_ID = "qlippoth-list";
export const LIST_FORMAT_VERSION = 1;

/** Markers are always fixed, so lists exist for the other layers only. */
export const LIST_LAYERS = ["floor", "structure", "object"] as const;
export type ListLayer = (typeof LIST_LAYERS)[number];

export const MAX_WEIGHT = 1000;
/** List ids are file names and appear in roll keys (docs/randomness.md), so they are kept to plain ASCII. */
export const LIST_ID_PATTERN = /^[a-z0-9]+(_[a-z0-9]+)*$/;

export interface ListEntry {
  id: string;
  /** Relative chance, a whole number from 1 to MAX_WEIGHT. */
  weight: number;
}

export interface TileList {
  id: string;
  name: string;
  layer: ListLayer;
  /** Shown on the map in place of the cell's content: one or two characters on a colored square. */
  glyph: string;
  color: string;
  entries: ListEntry[];
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
      .replace(/[\u0300-\u036f]/g, "")
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
  return { id, name, layer, glyph: name.trim().charAt(0).toUpperCase() || "?", color: "#c0803a", entries: [] };
}

export function sameList(a: TileList, b: TileList): boolean {
  return serializeList(a) === serializeList(b);
}

export function serializeList(list: TileList): string {
  return (
    JSON.stringify(
      {
        format: LIST_FORMAT_ID,
        version: LIST_FORMAT_VERSION,
        id: list.id,
        name: list.name,
        layer: list.layer,
        icon: { glyph: list.glyph, color: list.color },
        entries: list.entries.map((entry) => ({ id: entry.id, weight: entry.weight })),
      },
      null,
      2
    ) + "\n"
  );
}

/** Reads a .list.json file. Throws with a readable message when it is not a valid list. */
export function parseList(text: string): TileList {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Not a valid JSON file.");
  }
  if (typeof data !== "object" || data === null || data.format !== LIST_FORMAT_ID) throw new Error("Not a Qlippoth list file.");
  if (data.version !== LIST_FORMAT_VERSION) throw new Error(`Unsupported list format version ${JSON.stringify(data.version)}.`);

  const id = data.id;
  if (typeof id !== "string" || !LIST_ID_PATTERN.test(id)) throw new Error(`List id ${JSON.stringify(id)} must be lowercase snake_case.`);
  const layer = data.layer;
  if (typeof layer !== "string" || !isListLayer(layer as LayerId)) throw new Error(`List layer ${JSON.stringify(layer)} must be floor, structure or object.`);

  const icon = (typeof data.icon === "object" && data.icon !== null ? data.icon : {}) as Record<string, unknown>;
  const entries: ListEntry[] = [];
  for (const raw of Array.isArray(data.entries) ? data.entries : []) {
    const entry = raw as Record<string, unknown>;
    const weight = entry?.weight === undefined ? 1 : entry.weight;
    if (typeof entry?.id !== "string" || entry.id === "") throw new Error("Every list entry needs an id.");
    if (!Number.isInteger(weight) || (weight as number) < 1 || (weight as number) > MAX_WEIGHT) {
      throw new Error(`Weight of "${entry.id}" must be a whole number from 1 to ${MAX_WEIGHT}.`);
    }
    entries.push({ id: entry.id, weight: weight as number });
  }

  return {
    id,
    name: typeof data.name === "string" && data.name.trim() ? data.name : id,
    layer: layer as ListLayer,
    glyph: typeof icon.glyph === "string" && icon.glyph.trim() ? [...icon.glyph.trim()].slice(0, 2).join("") : "?",
    color: typeof icon.color === "string" && /^#[0-9a-fA-F]{6}$/.test(icon.color) ? icon.color : "#c0803a",
    entries,
  };
}
