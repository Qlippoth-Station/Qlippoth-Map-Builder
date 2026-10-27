import type { MapFile } from "./mapfile";

/**
 * Where a station document came from: the parsed game map and how its main grid lines up with editor cells.
 * Editor cell (0, 0) is grid tile (originX, originY).
 */
export interface StationSource {
  file: MapFile;
  gridUid: number;
  originX: number;
  originY: number;
}
