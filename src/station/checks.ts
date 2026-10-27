// Station checks of the Exportable profile: things that make a station unplayable or odd in the game.
// The Draft profile only has the checks every map gets (unknown, renamed or removed ids).

import { itemsOf, parseKey, type MapDocument } from "../document";
import { findItem, type Palette } from "../palette";

export interface StationWarning {
  message: string;
  at?: [number, number];
}

/** What a playable station needs at least one of, by prototype id prefix (Qlippoth / upstream SS14 ids). */
const ESSENTIALS: [prefix: string, what: string][] = [
  ["SpawnPointLatejoin", "late-join spawn point (SpawnPointLatejoin)"],
  ["SpawnPointObserver", "observer spawn point (SpawnPointObserver)"],
  ["GravityGenerator", "gravity generator"],
  ["SMES", "SMES (power storage)"],
  ["Substation", "substation"],
  ["APC", "APC"],
  ["GasVentPump", "air vent (GasVentPump)"],
  ["GasVentScrubber", "air scrubber (GasVentScrubber)"],
];

export function exportableChecks(doc: MapDocument, palette: Palette): StationWarning[] {
  const warnings: StationWarning[] = [];
  const ids = new Set<string>();
  let onSpace = 0;
  let firstOnSpace: [number, number] | undefined;
  let doubled = 0;
  let firstDoubled: [number, number] | undefined;
  let jobs = 0;

  for (const layer of ["structure", "object"] as const) {
    for (const [key, brush] of doc.layers[layer]) {
      const items = itemsOf(brush);
      const seen = new Set<string>();
      for (const item of items) {
        ids.add(item.id);
        const flags = findItem(palette, layer, item.id)?.flags;
        if (flags?.job) jobs++;
        // Loose items pile up and pipes sit on several pipe layers; a second anchored entity of the same id
        // facing the same way (two cables, two identical windows) is a mistake.
        if (flags?.placement !== "SnapgridCenter") continue;
        const signature = `${item.id}@${item.rot ?? 0}`;
        if (seen.has(signature)) {
          doubled++;
          firstDoubled ??= parseKey(key);
        }
        seen.add(signature);
      }
      if (!doc.layers.floor.has(key)) {
        onSpace += items.length;
        firstOnSpace ??= parseKey(key);
      }
    }
  }

  if (onSpace) warnings.push({ message: `${onSpace} entities stand on space (no tile under them).`, at: firstOnSpace });
  if (doubled) warnings.push({ message: `${doubled} anchored entities are doubled (same id and direction in one cell).`, at: firstDoubled });
  if (doc.layers.floor.size === 0) warnings.push({ message: "The station has no tiles." });
  if (!jobs) warnings.push({ message: "No job spawn points: the gameMap gets no job slots." });
  for (const [prefix, what] of ESSENTIALS) {
    if (![...ids].some((id) => id.startsWith(prefix))) warnings.push({ message: `No ${what}.` });
  }
  return warnings;
}

/**
 * Where placed modules meet the rest of the station: a door on the module's edge that opens into a wall or space,
 * and floor on the edge that is open to space (no wall or window on it and no tile outside).
 */
export function moduleEdgeChecks(doc: MapDocument, palette: Palette): StationWarning[] {
  const warnings: StationWarning[] = [];
  const category = (key: string, prefix: string) =>
    itemsOf(doc.layers.structure.get(key)).some((item) => findItem(palette, "structure", item.id)?.category.startsWith(prefix));
  const blocked = (key: string) => category(key, "Structures/Walls") || category(key, "Structures/Windows");

  for (const instance of doc.instances ?? []) {
    const [w, h] = instance.turns % 2 ? [instance.height, instance.width] : [instance.width, instance.height];
    let badDoors = 0;
    let openEdges = 0;
    let firstDoor: [number, number] | undefined;
    let firstOpen: [number, number] | undefined;
    for (let y = instance.y; y < instance.y + h; y++) {
      for (let x = instance.x; x < instance.x + w; x++) {
        const outside: [number, number][] = [];
        if (x === instance.x) outside.push([x - 1, y]);
        if (x === instance.x + w - 1) outside.push([x + 1, y]);
        if (y === instance.y) outside.push([x, y - 1]);
        if (y === instance.y + h - 1) outside.push([x, y + 1]);
        const key = `${x},${y}`;
        for (const [ox, oy] of outside) {
          if (ox < 0 || oy < 0 || ox >= doc.width || oy >= doc.height) continue;
          const outsideKey = `${ox},${oy}`;
          const outsideFloor = doc.layers.floor.has(outsideKey);
          if (category(key, "Structures/Doors") && (!outsideFloor || blocked(outsideKey))) {
            badDoors++;
            firstDoor ??= [x, y];
          } else if (doc.layers.floor.has(key) && !blocked(key) && !category(key, "Structures/Doors") && !outsideFloor) {
            openEdges++;
            firstOpen ??= [x, y];
          }
        }
      }
    }
    if (badDoors) warnings.push({ message: `Module "${instance.name}": ${badDoors} door(s) on its edge open into a wall or space.`, at: firstDoor });
    if (openEdges) warnings.push({ message: `Module "${instance.name}": ${openEdges} edge tile(s) are open to space.`, at: firstOpen });
  }
  return warnings;
}
