// Turns random list cells into concrete ids for one seed. The game does the same when it builds a rift, so this
// algorithm is a specification: docs/randomness.md describes it step by step and fixtures/ holds test vectors.
// Change it only together with the game reader.

import { LAYERS, parseKey, type DomainDocument, type LayerId } from "./document";
import type { Brush, ListLookup } from "./brush";
import type { TileList } from "./lists";

/** FNV-1a over the character codes of an ASCII string, followed by the murmur3 finalizer. Unsigned 32-bit result. */
export function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/**
 * What decides a roll. Cells with the same key always get the same entry for a seed:
 * a cell without a group rolls on its own, all cells of one list group share one roll.
 */
export function rollKey(layer: LayerId, x: number, y: number, brush: Extract<Brush, { kind: "list" }>): string {
  return brush.group === undefined ? `${layer}/${x},${y}` : `${layer}/${brush.list}/group${brush.group}`;
}

/** Picks an entry by weight. Returns null for an empty list and when the empty choice is picked. */
export function pickEntry(list: TileList, hash: number): string | null {
  const total = list.entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total === 0) return null;
  let roll = hash % total;
  for (const entry of list.entries) {
    if (roll < entry.weight) return entry.id;
    roll -= entry.weight;
  }
  return null; // Unreachable: roll < total.
}

/** Keeps a seed in the unsigned 32-bit range the game uses. */
export function normalizeSeed(seed: number): number {
  return Math.trunc(seed) >>> 0;
}

export function rollId(seed: number, layer: LayerId, x: number, y: number, brush: Extract<Brush, { kind: "list" }>, lists: ListLookup): string | null {
  const list = lists(brush.list);
  if (!list) return null;
  return pickEntry(list, hash32(`${normalizeSeed(seed)}/${rollKey(layer, x, y, brush)}`));
}

/**
 * The concrete id of every cell for a seed. Fixed cells keep their id; list cells get their roll.
 * Cells whose list is missing or empty are left out, the same as the game skips them.
 */
export function resolveDocument(doc: DomainDocument, lists: ListLookup, seed: number): Record<LayerId, Map<string, string>> {
  const result = Object.fromEntries(LAYERS.map((layer) => [layer, new Map<string, string>()])) as Record<LayerId, Map<string, string>>;
  for (const layer of LAYERS) {
    for (const [key, brush] of doc.layers[layer]) {
      if (brush.kind === "fixed") {
        result[layer].set(key, brush.id);
        continue;
      }
      const [x, y] = parseKey(key);
      const id = rollId(seed, layer, x, y, brush, lists);
      if (id !== null) result[layer].set(key, id);
    }
  }
  return result;
}
