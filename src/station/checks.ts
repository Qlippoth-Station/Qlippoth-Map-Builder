// Station checks: things that make a station unplayable or odd in the game. Every check belongs to a group
// (spawn points, power, atmosphere, ...) or, in the Department submode, to the department being built.
//
// Station submode, Exportable profile: the station-wide essentials (late-join spawn, gravity, SMES, ...).
// Department submode: no station-wide essentials; the checks of the department's ticked areas instead.
// The Draft profile only has the checks every map gets (unknown, renamed or removed ids), the light check, the
// module edges and, in the Department submode, the department checks.

import { itemsOf, parseKey, type MapDocument } from "../document";
import { findItem, type Palette } from "../palette";
import { DEPARTMENT_INFO, type DepartmentId, type Requirement } from "./departments";

/** Groups of the checks that are not about one department. */
export const CHECK_GROUPS = ["spawns", "power", "atmos", "lighting", "construction", "markers", "gamedata"] as const;
export type CheckGroup = (typeof CHECK_GROUPS)[number];

/**
 * Names and colors of the groups. The colors stay clear of the department colors (amber, sky blue, pink-purple,
 * red, brown, lime and slate blue) so a department's checks never look like a station-wide group.
 */
export const CHECK_GROUP_INFO: Record<CheckGroup, { name: string; color: string }> = {
  spawns: { name: "Spawn points", color: "#8b7bff" },
  power: { name: "Power & gravity", color: "#e8f06a" },
  atmos: { name: "Atmosphere", color: "#2fc4a8" },
  lighting: { name: "Lighting", color: "#dfe3ea" },
  construction: { name: "Construction", color: "#a9a26a" },
  markers: { name: "Markers", color: "#b58cf2" },
  gamedata: { name: "Game data", color: "#8a8f9c" },
};

export interface StationWarning {
  message: string;
  at?: [number, number];
  /** "error": the map does not load or the round is badly broken (critical); otherwise a warning. */
  level?: "error";
  /** The group the check belongs to; a department check has `department` instead. */
  group?: CheckGroup;
  /** Department submode: the department this check is about. Department checks are listed first. */
  department?: DepartmentId;
}

/**
 * Parts and leftovers that share a machine's id prefix but are not the machine (boards, flatpacks, frames).
 * Unfinished parts count: maps place the particle accelerator unfinished for the engineers to build.
 */
const NOT_THE_MACHINE = /(Circuitboard|Flatpack|Electronics|Assembly|Frame|Broken|Destroyed)$/;

/** Whether any placed id is (a variant of) one of the prefixes. */
function hasAny(ids: Set<string>, prefixes: string[]): boolean {
  for (const id of ids) if (prefixes.some((prefix) => id.startsWith(prefix)) && !NOT_THE_MACHINE.test(id)) return true;
  return false;
}

/** Every entity id placed on the structure and object layers. */
function placedIds(doc: MapDocument): Set<string> {
  const ids = new Set<string>();
  for (const layer of ["structure", "object"] as const) for (const brush of doc.layers[layer].values()) for (const item of itemsOf(brush)) ids.add(item.id);
  return ids;
}

/**
 * What a whole playable station needs at least one of, by prototype id prefix (Qlippoth / upstream SS14 ids):
 * without them nobody can join, nothing has power, or everyone floats. `local` ones are needed by every room
 * and stay in the Department submode; the others are station-wide.
 */
const ESSENTIALS: [prefix: string, what: string, group: CheckGroup, level?: "error", local?: true][] = [
  ["SpawnPointLatejoin", "late-join spawn point (SpawnPointLatejoin): players joining mid-round have nowhere to appear", "spawns", "error"],
  ["SpawnPointObserver", "observer spawn point (SpawnPointObserver)", "spawns"],
  ["GravityGenerator", "gravity generator: everyone floats", "power", "error"],
  ["SMES", "SMES (power storage): the station has no power", "power", "error"],
  ["Substation", "substation: the station has no power", "power", "error"],
  ["APC", "APC: rooms have no power", "power", "error", true],
  ["GasVentPump", "air vent (GasVentPump)", "atmos", undefined, true],
  ["GasVentScrubber", "air scrubber (GasVentScrubber)", "atmos", undefined, true],
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
  return doc.layers.floor.size ? [{ message: "No lights: the station is pitch black in the game (togglelight shows it anyway).", group: "lighting" }] : [];
}

/**
 * The Exportable profile's checks of a station or a station part. `stationWide` false (the Department submode)
 * leaves out what only a whole station needs: late-join and observer spawns, gravity, SMES, substations and
 * the "no job spawn points at all" check (the department checks name the department's own jobs).
 */
export function exportableChecks(doc: MapDocument, palette: Palette, stationWide = true): StationWarning[] {
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

  if (onSpace) warnings.push({ message: `${onSpace} entities stand on space (no tile under them).`, at: firstOnSpace, group: "construction" });
  if (doubled) warnings.push({ message: `${doubled} anchored entities are doubled (same id and direction in one cell).`, at: firstDoubled, group: "construction" });
  if (doc.layers.floor.size === 0) warnings.push({ message: `The ${stationWide ? "station" : "department"} has no tiles.`, level: "error", group: "construction" });
  if (stationWide && !jobs) warnings.push({ message: "No job spawn points: the gameMap gets no job slots, so nobody can join as crew.", level: "error", group: "spawns" });
  for (const [prefix, what, group, level, local] of ESSENTIALS) {
    if (!stationWide && !local) continue;
    if (!hasAny(ids, [prefix])) warnings.push({ message: `No ${what}.`, level, group });
  }
  return warnings;
}

/** Department submode: what the department's ticked areas need. */
export function departmentChecks(doc: MapDocument, department: DepartmentId, areas: readonly string[]): StationWarning[] {
  const info = DEPARTMENT_INFO[department];
  const ids = placedIds(doc);
  const warnings: StationWarning[] = [];
  // The same need in two ticked areas (e.g. the ID console on the bridge and in the HoP's office) is listed once.
  const listed = new Set<string>();
  const missing = (need: Requirement) => (!need.when || hasAny(ids, need.when)) && !hasAny(ids, need.any);
  for (const area of info.areas) {
    if (!areas.includes(area.id)) continue;
    for (const need of area.needs) {
      const key = need.any.join("|");
      if (listed.has(key) || !missing(need)) continue;
      listed.add(key);
      warnings.push({
        message: `${area.name}: no ${need.what}${need.why ? `: ${need.why}` : ""}.`,
        level: need.level,
        department,
      });
    }
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
    if (badDoors) warnings.push({ message: `Module "${instance.name}": ${badDoors} door(s) on its edge open into a wall or space.`, at: firstDoor, group: "construction" });
    if (openEdges) warnings.push({ message: `Module "${instance.name}": ${openEdges} edge tile(s) are open to space; the air leaks out.`, at: firstOpen, level: "error", group: "atmos" });
  }
  return warnings;
}
