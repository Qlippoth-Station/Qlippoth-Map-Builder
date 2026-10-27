// Writes a station document as a game map .yml.
//
// The output starts from the map the station came from (or the new-station template) and changes only what the
// editor changed. Untouched entities are copied line by line, so opening a map and saving it without edits gives
// back the same file. Moved or rotated entities get new Transform lines; removed entities go with everything
// inside them; new entities are written with just a Transform. When tiles change, the grid's chunks and its
// atmosphere are rewritten: existing tiles keep their gas mixture, new tiles get standard air.

import { itemsOf, normalizeAngle, parseKey, type MapDocument } from "../document";
import { findItem, type Palette } from "../palette";
import { parseMapFile, toBase64, type EntityRecord, type GridRecord, type MapFile } from "./mapfile";
import type { StationSource } from "./source";
import { newStationText } from "./template";

export interface ExportSummary {
  entities: number;
  added: number;
  removed: number;
  moved: number;
  tilesChanged: boolean;
}

export interface ExportResult {
  text: string;
  summary: ExportSummary;
}

interface WantedTile {
  name: string;
  flags: number;
  variant: number;
  rotation: number;
}

/** The source of a station that was not imported: an empty map from the template, centred on the grid origin. */
export function newSource(doc: MapDocument): StationSource {
  const file = parseMapFile(newStationText(doc.name));
  return { file, gridUid: file.grids[0].uid, originX: -Math.floor(doc.width / 2), originY: -Math.floor(doc.height / 2) };
}

export function exportStation(doc: MapDocument, palette: Palette): ExportResult {
  const source = doc.station ?? newSource(doc);
  const { file, gridUid, originX, originY } = source;
  const grid = file.grids.find((candidate) => candidate.uid === gridUid);
  if (!grid) throw new Error("The station's grid is missing from its source map.");

  // ---- Tiles ----
  const wanted = new Map<string, WantedTile>();
  for (const [key, brush] of doc.layers.floor) {
    const item = itemsOf(brush)[0];
    if (!item) continue;
    const [x, y] = parseKey(key);
    const [gx, gy] = [x + originX, y + originY];
    const variants = findItem(palette, "floor", item.id)?.flags?.variants ?? 1;
    const [flags, variant, rotation] = item.tile ?? [0, hash(gx, gy) % variants, 0];
    wanted.set(`${gx},${gy}`, { name: item.id, flags, variant, rotation });
  }
  const tilesChanged = !sameTiles(file, grid, wanted);

  // ---- Entities ----
  const placed = new Map<number, { x: number; y: number; rot: number }>();
  const added: { proto: string; x: number; y: number; rot: number }[] = [];
  for (const layer of ["structure", "object"] as const) {
    for (const [key, brush] of doc.layers[layer]) {
      const [x, y] = parseKey(key);
      for (const item of itemsOf(brush)) {
        const cell = { x: x + originX, y: y + originY, rot: normalizeAngle(item.rot ?? 0) };
        const record = item.uid !== undefined ? file.byUid.get(item.uid) : undefined;
        if (record && record.parent === gridUid && !placed.has(item.uid!)) placed.set(item.uid!, cell);
        else added.push({ proto: item.id, ...cell });
      }
    }
  }

  const children = new Map<number, number[]>();
  for (const entity of file.entities) {
    if (entity.parent === null) continue;
    const list = children.get(entity.parent);
    if (list) list.push(entity.uid);
    else children.set(entity.parent, [entity.uid]);
  }
  const removed = new Set<number>();
  const remove = (uid: number) => {
    if (removed.has(uid)) return;
    removed.add(uid);
    for (const child of children.get(uid) ?? []) remove(child);
  };
  for (const entity of file.entities) {
    if (entity.parent === gridUid && entity.pos && entity.proto !== "" && !placed.has(entity.uid)) remove(entity.uid);
  }

  let nextUid = Math.max(0, ...file.byUid.keys()) + 1;
  const newByProto = new Map<string, string[][]>();
  for (const entity of added) {
    const block = newEntity(nextUid++, entity, gridUid);
    const list = newByProto.get(entity.proto);
    if (list) list.push(block);
    else newByProto.set(entity.proto, [block]);
  }

  // ---- Output ----
  const lines = file.lines;
  const out: string[] = [];
  const copy = (from: number, to: number) => {
    for (let i = from; i < to; i++) out.push(lines[i]);
  };
  const entityCount = file.entities.length - removed.size + added.length;

  // Header up to and including "tilemap:".
  const [tilemapStart, tilemapEnd] = file.tilemapLines;
  for (let i = 0; i < tilemapStart; i++) {
    out.push(i === file.entityCountLine ? `  entityCount: ${entityCount}` : lines[i]);
  }
  const tilemap = new Map(file.tilemap);
  if (tilesChanged) {
    const names = new Map([...tilemap].map(([index, name]) => [name, index]));
    let next = Math.max(0, ...tilemap.keys()) + 1;
    for (const tile of wanted.values()) {
      if (!names.has(tile.name)) {
        names.set(tile.name, next);
        tilemap.set(next++, tile.name);
      }
    }
    if (![...tilemap.values()].includes("Space")) tilemap.set(0, "Space");
    for (const [index, name] of [...tilemap].sort((a, b) => a[0] - b[0])) out.push(`  ${index}: ${name}`);
  } else {
    copy(tilemapStart, tilemapEnd);
  }
  copy(tilemapEnd, file.entitiesLine + 1);

  let moved = 0;
  const writeEntity = (entity: EntityRecord) => {
    if (entity.uid === gridUid && tilesChanged) {
      out.push(...rewriteGrid(file, entity, grid, wanted, tilemap));
      return;
    }
    const target = placed.get(entity.uid);
    if (target && entity.pos) {
      const [dx, dy] = [target.x - Math.floor(entity.pos[0]), target.y - Math.floor(entity.pos[1])];
      if (dx !== 0 || dy !== 0 || Math.abs(target.rot - normalizeAngle(entity.rot)) > 1e-9) {
        moved++;
        out.push(...moveEntity(lines, entity, entity.pos[0] + dx, entity.pos[1] + dy, target.rot));
        return;
      }
    }
    copy(entity.start, entity.end);
  };

  const pending = [...newByProto.keys()].filter((proto) => !file.groups.some((group) => group.proto === proto)).sort(compareOrdinal);
  const writeNewGroup = (proto: string) => {
    out.push(`- proto: ${proto === "" ? '""' : proto}`, "  entities:");
    for (const block of newByProto.get(proto)!) out.push(...block);
  };
  for (const group of file.groups) {
    while (pending.length > 0 && compareOrdinal(pending[0], group.proto) < 0) writeNewGroup(pending.shift()!);
    const kept = group.entities.filter((entity) => !removed.has(entity.uid));
    const fresh = newByProto.get(group.proto) ?? [];
    if (kept.length === 0 && fresh.length === 0 && group.entities.length > 0) continue;
    copy(group.start, group.entities[0]?.start ?? group.start + 2);
    for (const entity of kept) writeEntity(entity);
    for (const block of fresh) out.push(...block);
  }
  for (const proto of pending) writeNewGroup(proto);
  copy(file.entitiesEnd, lines.length);

  return {
    text: out.join(file.eol),
    summary: { entities: entityCount, added: added.length, removed: removed.size, moved, tilesChanged },
  };
}

/** C#-style ordinal string order, which is how the game sorts prototype groups. */
function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Small stable hash for picking tile variants of new tiles. */
function hash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function formatNumber(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}

function sameTiles(file: MapFile, grid: GridRecord, wanted: Map<string, WantedTile>): boolean {
  if (grid.tiles.size !== wanted.size) return false;
  for (const [key, tile] of grid.tiles) {
    const other = wanted.get(key);
    if (!other || file.tilemap.get(tile.type) !== other.name) return false;
    if (tile.flags !== other.flags || tile.variant !== other.variant || tile.rotation !== other.rotation) return false;
  }
  return true;
}

function newEntity(uid: number, entity: { x: number; y: number; rot: number }, gridUid: number): string[] {
  const block = ["  - uid: " + uid, "    components:", "    - type: Transform"];
  if (entity.rot) block.push(`      rot: ${formatNumber(entity.rot)} rad`);
  block.push(`      pos: ${formatNumber(entity.x + 0.5)},${formatNumber(entity.y + 0.5)}`, `      parent: ${gridUid}`);
  return block;
}

/** The entity's lines with its Transform position and rotation replaced (the game writes rot before pos). */
function moveEntity(lines: string[], entity: EntityRecord, x: number, y: number, rot: number): string[] {
  const { pos, rot: rotLine } = entity.transform;
  const out: string[] = [];
  for (let i = entity.start; i < entity.end; i++) {
    if (i === rotLine) {
      if (rot) out.push(`      rot: ${formatNumber(rot)} rad`);
    } else if (i === pos) {
      if (rot && rotLine < 0) out.push(`      rot: ${formatNumber(rot)} rad`);
      out.push(`      pos: ${formatNumber(x)},${formatNumber(y)}`);
    } else {
      out.push(lines[i]);
    }
  }
  return out;
}

/** The grid entity with its MapGrid chunks and GridAtmosphere rewritten for the wanted tiles. */
function rewriteGrid(file: MapFile, entity: EntityRecord, grid: GridRecord, wanted: Map<string, WantedTile>, tilemap: Map<number, string>): string[] {
  const lines = file.lines;
  const out: string[] = [];
  const [gridStart, gridEnd] = grid.mapGrid;
  const atmos = grid.atmosphere;
  for (let i = entity.start; i < entity.end; i++) {
    if (i === gridStart) {
      out.push(...mapGridLines(file, grid, wanted, tilemap));
      i = gridEnd - 1;
    } else if (atmos && i === atmos.start) {
      out.push(...atmosphereLines(file, grid, wanted));
      i = atmos.end - 1;
    } else {
      out.push(lines[i]);
    }
  }
  return out;
}

function mapGridLines(file: MapFile, grid: GridRecord, wanted: Map<string, WantedTile>, tilemap: Map<number, string>): string[] {
  const lines = file.lines;
  const [start, end] = grid.mapGrid;
  const size = grid.chunkSize;
  const version = grid.chunkVersion >= 7 ? 7 : 6;
  const stride = version === 7 ? 7 : 6;
  const indices = new Map([...tilemap].map(([index, name]) => [name, index]));
  const space = indices.get("Space") ?? 0;

  const chunks = new Map<string, Uint8Array>();
  for (const [key, tile] of wanted) {
    const [x, y] = key.split(",").map(Number);
    const [cx, cy] = [Math.floor(x / size), Math.floor(y / size)];
    const chunkKey = `${cx},${cy}`;
    let bytes = chunks.get(chunkKey);
    if (!bytes) {
      bytes = new Uint8Array(size * size * stride);
      const view = new DataView(bytes.buffer);
      for (let offset = 0; offset < bytes.length; offset += stride) view.setInt32(offset, space, true);
      chunks.set(chunkKey, bytes);
    }
    const offset = ((y - cy * size) * size + (x - cx * size)) * stride;
    new DataView(bytes.buffer).setInt32(offset, indices.get(tile.name)!, true);
    bytes[offset + 4] = tile.flags;
    bytes[offset + 5] = tile.variant;
    if (stride === 7) bytes[offset + 6] = tile.rotation;
  }

  const out = [lines[start]];
  if (chunks.size === 0) {
    out.push("      chunks: {}");
  } else {
    out.push("      chunks:");
    const keys = [...chunks.keys()].sort((a, b) => {
      const [ax, ay] = a.split(",").map(Number);
      const [bx, by] = b.split(",").map(Number);
      return ax - bx || ay - by;
    });
    for (const key of keys) {
      out.push(`        ${key}:`, `          ind: ${key}`, `          tiles: ${toBase64(chunks.get(key)!)}`, `          version: ${version}`);
      if (size !== 16) out.push(`          size: ${size}`);
    }
  }
  // Keep whatever else the component had (anything that is not part of the chunks).
  for (let i = start + 1; i < end; i++) {
    if (lines[i].startsWith("      chunks:") || lines[i].startsWith("        ")) continue;
    out.push(lines[i]);
  }
  return out;
}

const AIR_OXYGEN = "21.824879";
const AIR_NITROGEN = "82.10312";

function atmosphereLines(file: MapFile, grid: GridRecord, wanted: Map<string, WantedTile>): string[] {
  const atmos = grid.atmosphere!;
  // Split uniqueMixes into entries ("        - volume: ..." starts one).
  const header = atmos.uniqueMixes[0] ?? "        uniqueMixes:";
  const entries: string[][] = [];
  for (const line of atmos.uniqueMixes.slice(1)) {
    if (line.startsWith("        - ")) entries.push([line]);
    else entries.at(-1)?.push(line);
  }
  let air = entries.findIndex((entry) => {
    const text = entry.join("\n");
    return !text.includes("immutable") && text.includes(AIR_OXYGEN) && text.includes(AIR_NITROGEN) && text.includes("temperature: 293.15");
  });
  if (air < 0) {
    air = entries.length;
    entries.push(
      file.format >= 7
        ? ["        - volume: 2500", "          temperature: 293.15", "          moles:", `            Oxygen: ${AIR_OXYGEN}`, `            Nitrogen: ${AIR_NITROGEN}`]
        : ["        - volume: 2500", "          temperature: 293.15", "          moles:", `          - ${AIR_OXYGEN}`, `          - ${AIR_NITROGEN}`, ...Array(7).fill("          - 0")]
    );
  }

  const size = atmos.chunkSize;
  const masks = new Map<string, Map<number, number>>();
  for (const key of wanted.keys()) {
    const mix = atmos.mixes.has(key) ? atmos.mixes.get(key)! : grid.tiles.has(key) ? -1 : air;
    if (mix < 0) continue;
    const [x, y] = key.split(",").map(Number);
    const [cx, cy] = [Math.floor(x / size), Math.floor(y / size)];
    const chunkKey = `${cx},${cy}`;
    let chunk = masks.get(chunkKey);
    if (!chunk) masks.set(chunkKey, (chunk = new Map()));
    chunk.set(mix, (chunk.get(mix) ?? 0) + 2 ** (x - cx * size + (y - cy * size) * size));
  }

  const out = ["    - type: GridAtmosphere", "      version: 2", "      data:"];
  if (masks.size === 0) out.push("        tiles: {}");
  else {
    out.push("        tiles:");
    for (const [key, chunk] of masks) {
      out.push(`          ${key}:`);
      for (const [mix, mask] of [...chunk].sort((a, b) => a[0] - b[0])) out.push(`            ${mix}: ${mask}`);
    }
  }
  out.push(header, ...entries.flat(), `        chunkSize: ${size}`);
  return out;
}
