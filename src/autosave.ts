// What an autosave holds per mode: the map file of the mode plus what the file itself has no place for
// (a station's editor margins and profile, placed module instances).

import { deserialize, serialize, type MapDocument, type ModuleInstance } from "./document";
import type { Palette } from "./palette";
import { readStationAutosave, stationAutosave } from "./station/autosave";

const DOMAIN_FORMAT = "qlippoth-domain-autosave";

export function autosaveText(doc: MapDocument, palette: Palette): string {
  if (doc.mode === "station") return stationAutosave(doc, palette);
  // Plain domain files stay plain; the wrapper is only used when there is something extra to keep.
  if (!doc.instances?.length) return serialize(doc);
  return JSON.stringify({ format: DOMAIN_FORMAT, version: 1, file: serialize(doc), instances: doc.instances });
}

export function readAutosave(text: string, palette: Palette): MapDocument {
  const station = readStationAutosave(text, palette);
  if (station) return station;
  const data = JSON.parse(text);
  if (data?.format === DOMAIN_FORMAT && typeof data.file === "string") {
    const doc = deserialize(data.file);
    doc.instances = readInstances(data.instances);
    return doc;
  }
  return deserialize(text);
}

export function readInstances(data: unknown): ModuleInstance[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((value) => value && typeof value.module === "string" && Number.isInteger(value.x) && Number.isInteger(value.y))
    .map((value) => ({
      module: value.module,
      name: String(value.name ?? value.module),
      x: value.x,
      y: value.y,
      width: Number(value.width) || 1,
      height: Number(value.height) || 1,
      turns: ((Number(value.turns) % 4) + 4) % 4 || 0,
      version: Number(value.version) || 0,
    }));
}
