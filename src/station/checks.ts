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
