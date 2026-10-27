// Station autosaves: the game map text plus what the map itself does not store (the editor's margins).

import type { MapDocument } from "../document";
import type { Palette } from "../palette";
import { exportStation, newSource } from "./export";
import { importStation } from "./import";

const FORMAT = "qlippoth-station-autosave";

export function stationAutosave(doc: MapDocument, palette: Palette): string {
  const { originX, originY } = doc.station ?? newSource(doc);
  const { text } = exportStation(doc, palette);
  return JSON.stringify({ format: FORMAT, version: 1, name: doc.name, originX, originY, width: doc.width, height: doc.height, map: text });
}

/** The station in an autosave, or null when the text is not a station autosave. */
export function readStationAutosave(text: string, palette: Palette): MapDocument | null {
  if (!text.startsWith("{")) return null;
  const data = JSON.parse(text);
  if (data?.format !== FORMAT || typeof data.map !== "string") return null;
  return importStation(data.map, palette, String(data.name ?? "Station"), {
    originX: Number(data.originX),
    originY: Number(data.originY),
    width: Number(data.width),
    height: Number(data.height),
  });
}
