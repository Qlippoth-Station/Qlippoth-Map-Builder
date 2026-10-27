// Turns a game map into a station document: the main grid's tiles become the Floor layer and every entity standing
// on that grid becomes an item on the Structure or Object layer. Everything else (the map entity, other grids,
// entities inside containers, decals, atmosphere, component data) stays in the source and is written back as it was.

import { cellKey, createDocument, fromItems, type Item, type LayerId, type MapDocument } from "../document";
import { MODE_INFO } from "../modes";
import { findItem, type Palette } from "../palette";
import { MapFileError, mainGrid, parseMapFile } from "./mapfile";

/** Layer an entity prototype belongs on; unknown ids go to the Object layer. */
export function entityLayer(palette: Palette, id: string): LayerId {
  return findItem(palette, "structure", id) ? "structure" : "object";
}

/** Where editor cell (0, 0) sits on the grid and how big the document is (autosaves keep the editor's own margins). */
export interface StationLayout {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export function importStation(text: string, palette: Palette, name: string, layout?: StationLayout): MapDocument {
  const file = parseMapFile(text);
  const grid = mainGrid(file);
  if (!grid) throw new MapFileError("The map has no grid with tiles.");

  // Entities without a prototype (written as proto "") are engine-side helpers; they stay in the source untouched.
  const onGrid = file.entities.filter((entity) => entity.parent === grid.uid && entity.pos && entity.proto !== "");
  const cells: [number, number][] = [...grid.tiles.keys()].map((key) => key.split(",").map(Number) as [number, number]);
  for (const entity of onGrid) cells.push([Math.floor(entity.pos![0]), Math.floor(entity.pos![1])]);
  if (cells.length === 0) {
    if (!layout) throw new MapFileError("The main grid is empty.");
    cells.push([layout.originX, layout.originY]);
  }

  let originX = Math.min(...cells.map(([x]) => x));
  let originY = Math.min(...cells.map(([, y]) => y));
  let width = Math.max(...cells.map(([x]) => x)) - originX + 1;
  let height = Math.max(...cells.map(([, y]) => y)) - originY + 1;
  // A saved layout wins when everything still fits in it.
  if (
    layout &&
    layout.originX <= originX &&
    layout.originY <= originY &&
    layout.originX + layout.width >= originX + width &&
    layout.originY + layout.height >= originY + height
  ) {
    ({ originX, originY, width, height } = layout);
  }
  const limit = MODE_INFO.station.maxSize;
  if (width > limit || height > limit) throw new MapFileError(`The station is ${width}×${height} tiles; the editor handles up to ${limit}×${limit}.`);

  const doc = createDocument("station", name, width, height);
  doc.station = { file, gridUid: grid.uid, originX, originY };

  for (const [key, tile] of grid.tiles) {
    const [x, y] = key.split(",").map(Number);
    const id = file.tilemap.get(tile.type) ?? `#${tile.type}`;
    doc.layers.floor.set(cellKey(x - originX, y - originY), { kind: "fixed", id, tile: [tile.flags, tile.variant, tile.rotation] });
  }

  const stacks: Record<"structure" | "object", Map<string, Item[]>> = { structure: new Map(), object: new Map() };
  for (const entity of onGrid) {
    const key = cellKey(Math.floor(entity.pos![0]) - originX, Math.floor(entity.pos![1]) - originY);
    const item: Item = { kind: "fixed", id: entity.proto, uid: entity.uid };
    if (entity.rot) item.rot = entity.rot;
    if (entity.spawner?.prototypes?.length) {
      item.spawner = {
        name: "Random",
        prototypes: entity.spawner.prototypes,
        chance: entity.spawner.chance ?? 1,
        rarePrototypes: entity.spawner.rarePrototypes ?? [],
        rareChance: entity.spawner.rareChance ?? 0.05,
      };
    }
    const layer = entityLayer(palette, entity.proto) as "structure" | "object";
    const stack = stacks[layer].get(key);
    if (stack) stack.push(item);
    else stacks[layer].set(key, [item]);
  }
  for (const layer of ["structure", "object"] as const) {
    for (const [key, items] of stacks[layer]) doc.layers[layer].set(key, fromItems(items)!);
  }
  return doc;
}
