// Station checks of the Exportable profile: things that make a station unplayable or odd in the game.
// The Draft profile only has the checks every map gets (unknown, renamed or removed ids) and the light check.

import { itemsOf, parseKey, type MapDocument } from "../document";
import { findItem, type Palette } from "../palette";

export interface StationWarning {
  message: string;
  at?: [number, number];
  /** "error": the map does not load or the round is badly broken (shown red); otherwise a warning (yellow). */
  level?: "error";
}

/**
 * What a playable station needs at least one of, by prototype id prefix (Qlippoth / upstream SS14 ids). Errors:
 * without them nobody can join as crew, nothing has power, or everyone floats.
 */
const ESSENTIALS: [prefix: string, what: string, level?: "error"][] = [
  ["SpawnPointLatejoin", "late-join spawn point (SpawnPointLatejoin): players joining mid-round have nowhere to appear", "error"],
  ["SpawnPointObserver", "observer spawn point (SpawnPointObserver)"],
  ["GravityGenerator", "gravity generator: everyone floats", "error"],
  ["SMES", "SMES (power storage): the station has no power", "error"],
  ["Substation", "substation: the station has no power", "error"],
  ["APC", "APC: rooms have no power", "error"],
  ["GasVentPump", "air vent (GasVentPump)"],
  ["GasVentScrubber", "air scrubber (GasVentScrubber)"],
];

/** Light fixtures: the Lighting category, or the ids the game uses for lights and lamps outside it. */
export function isLight(id: string, category: string | undefined): boolean {
  return category?.startsWith("Structures/Lighting") === true || /^(Always)?Powered.*light|^EmergencyLight|^Lamp/i.test(id);
}

/** Without any light the station is pitch black in the game. */
export function lightChecks(doc: MapDocument, palette: Palette): StationWarning[] {
  for (const brush of doc.layers.object.values()) {
    for (const item of itemsOf(brush)) if (isLight(item.id, findItem(palette, "object", item.id)?.category)) return [];
  }
  return doc.layers.floor.size ? [{ message: "No lights: the station is pitch black in the game (togglelight shows it anyway)." }] : [];
}

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
  if (doc.layers.floor.size === 0) warnings.push({ message: "The station has no tiles.", level: "error" });
  if (!jobs) warnings.push({ message: "No job spawn points: the gameMap gets no job slots, so nobody can join as crew.", level: "error" });
  for (const [prefix, what, level] of ESSENTIALS) {
    if (![...ids].some((id) => id.startsWith(prefix))) warnings.push({ message: `No ${what}.`, level });
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
    if (openEdges) warnings.push({ message: `Module "${instance.name}": ${openEdges} edge tile(s) are open to space; the air leaks out.`, at: firstOpen, level: "error" });
  }
  return warnings;
}
