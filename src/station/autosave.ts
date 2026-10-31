// Station autosaves: the game map text plus what the map itself does not store (the editor's margins).

import { readInstances } from "../autosave";
import type { MapDocument } from "../document";
import type { Palette } from "../palette";
import { exportStation, newSource } from "./export";
import { DEPARTMENT_INFO, isDepartment } from "./departments";
import { importStation } from "./import";

const FORMAT = "qlippoth-station-autosave";

export function stationAutosave(doc: MapDocument, palette: Palette): string {
  const { originX, originY } = doc.station ?? newSource(doc);
  const { text } = exportStation(doc, palette);
  return JSON.stringify({ format: FORMAT, version: 1, name: doc.name, originX, originY, width: doc.width, height: doc.height, profile: doc.profile, stationKind: doc.stationKind, department: doc.department, instances: doc.instances, roomSlots: doc.roomSlots, map: text });
}

/** The station in an autosave, or null when the text is not a station autosave. */
export function readStationAutosave(text: string, palette: Palette): MapDocument | null {
  if (!text.startsWith("{")) return null;
  const data = JSON.parse(text);
  if (data?.format !== FORMAT || typeof data.map !== "string") return null;
  const doc = importStation(data.map, palette, String(data.name ?? "Station"), {
    originX: Number(data.originX),
    originY: Number(data.originY),
    width: Number(data.width),
    height: Number(data.height),
  });
  if (data.profile === "exportable") doc.profile = "exportable";
  if (data.stationKind === "department") doc.stationKind = "department";
  const department: unknown = data.department?.id;
  if (isDepartment(department)) {
    const known = new Set(DEPARTMENT_INFO[department].areas.map((area) => area.id));
    const saved: unknown[] = Array.isArray(data.department.areas) ? data.department.areas : [];
    doc.department = { id: department, areas: saved.filter((area): area is string => typeof area === "string" && known.has(area)) };
  }
  doc.instances = readInstances(data.instances);
  doc.roomSlots = Array.isArray(data.roomSlots) ? data.roomSlots : [];
  return doc;
}
