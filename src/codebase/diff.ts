// What changes in the palette when another codebase is used: objects that are gone, and objects that are new,
// grouped by the prototype file they are defined in.

import { LAYERS, itemsOf, type MapDocument } from "../document";
import type { PaletteItem } from "../palette";

export interface DiffGroup {
  /** Prototype file (relative to Resources/Prototypes), or the palette category for palettes built without files. */
  label: string;
  byFile: boolean;
  items: PaletteItem[];
}

export interface CodebaseDiff {
  removed: DiffGroup[];
  added: DiffGroup[];
  removedCount: number;
  addedCount: number;
  /** Ids the new codebase renamed: maps that use them keep working. */
  renamed: number;
  /** Objects placed in the given maps whose id the new codebase does not know. */
  placedRemoved: number;
}

// Tiles and entities have separate id spaces.
const key = (item: PaletteItem) => `${item.layer === "floor" ? "tile" : "entity"}:${item.id}`;

function group(items: PaletteItem[]): DiffGroup[] {
  const groups = new Map<string, DiffGroup>();
  for (const item of items) {
    const label = item.file ?? item.category;
    let entry = groups.get(label);
    if (!entry) groups.set(label, (entry = { label, byFile: !!item.file, items: [] }));
    entry.items.push(item);
  }
  for (const entry of groups.values()) entry.items.sort((a, b) => a.name.localeCompare(b.name));
  // Biggest changes first.
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
}

export function diffCodebases(
  current: PaletteItem[],
  next: { items: PaletteItem[]; migrations: Map<string, string | null> },
  maps: MapDocument[] = []
): CodebaseDiff {
  const nextKeys = new Set(next.items.map(key));
  const currentKeys = new Set(current.map(key));
  const removed: PaletteItem[] = [];
  let renamed = 0;
  for (const item of current) {
    if (item.layer === "marker" || nextKeys.has(key(item))) continue;
    const target = next.migrations.get(item.id);
    if (target && nextKeys.has(key({ ...item, id: target }))) renamed++;
    else removed.push(item);
  }
  const added = next.items.filter((item) => item.layer !== "marker" && !currentKeys.has(key(item)));

  const removedKeys = new Set(removed.map(key));
  let placedRemoved = 0;
  for (const doc of maps) {
    for (const layer of LAYERS) {
      if (layer === "marker") continue;
      for (const brush of doc.layers[layer]?.values() ?? []) {
        for (const item of itemsOf(brush)) if (removedKeys.has(`${layer === "floor" ? "tile" : "entity"}:${item.id}`)) placedRemoved++;
      }
    }
  }

  return { removed: group(removed), added: group(added), removedCount: removed.length, addedCount: added.length, renamed, placedRemoved };
}
