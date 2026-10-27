// Reads game map .yml files (RobustToolbox map format 6 and 7) line by line.
//
// A full YAML parse of a station takes seconds; this scanner takes a fraction of that because it only looks at what
// the editor needs: the tilemap, every entity's uid, prototype and Transform, and each grid's tiles and atmosphere.
// Every entity remembers which lines of the file it came from, so untouched entities are written back byte for byte.

export interface TransformLines {
  /** "    - type: Transform" line, or -1 when the entity has no Transform component written. */
  at: number;
  /** One past the last line of the Transform component. */
  end: number;
  pos: number;
  rot: number;
  parent: number;
}

export interface EntityRecord {
  uid: number;
  /** Prototype id; "" for the map and grid entities. */
  proto: string;
  /** "  - uid: N" line. */
  start: number;
  /** One past the last line of the entity. */
  end: number;
  /** Position relative to the parent, in tiles. */
  pos: [number, number] | null;
  /** Rotation in radians, counter-clockwise. */
  rot: number;
  parent: number | null;
  transform: TransformLines;
  /** RandomSpawner fields written on this entity in the map (only those the map overrides). */
  spawner?: { prototypes?: string[]; chance?: number; rarePrototypes?: string[]; rareChance?: number };
}

export interface Tile {
  /** Index into the file's tilemap. */
  type: number;
  flags: number;
  variant: number;
  /** Rotation/mirroring byte (chunk version 7 and later). */
  rotation: number;
}

export interface GridAtmosphere {
  /** Line range of the GridAtmosphere component. */
  start: number;
  end: number;
  chunkSize: number;
  /** Gas mixture index per tile, keyed "x,y" in grid tiles. */
  mixes: Map<string, number>;
  /** The uniqueMixes list as written in the file (its lines, unchanged). */
  uniqueMixes: string[];
}

export interface GridRecord {
  uid: number;
  chunkSize: number;
  /** Chunk version of the file's chunks (6 or 7); decides the tile size when writing. */
  chunkVersion: number;
  /** Non-space tiles keyed "x,y" in grid tiles. */
  tiles: Map<string, Tile>;
  /** Line range of the MapGrid component. */
  mapGrid: [number, number];
  atmosphere: GridAtmosphere | null;
}

/** A "- proto: X" group of the entities section. */
export interface ProtoGroup {
  proto: string;
  /** "- proto: X" line; the group's header runs until its first entity. */
  start: number;
  entities: EntityRecord[];
}

export interface MapFile {
  lines: string[];
  eol: string;
  format: number;
  /** "entities:" line. */
  entitiesLine: number;
  groups: ProtoGroup[];
  /** One past the last entity line; what follows (e.g. a "..." end marker) is kept as it is. */
  entitiesEnd: number;
  tilemap: Map<number, string>;
  /** Line range of the tilemap entries (after "tilemap:"). */
  tilemapLines: [number, number];
  entities: EntityRecord[];
  byUid: Map<number, EntityRecord>;
  grids: GridRecord[];
  /** "  entityCount: N" line in meta, or -1. */
  entityCountLine: number;
}

export class MapFileError extends Error {}

const SPACE = "Space";

export function parseMapFile(text: string): MapFile {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  if (!lines[0]?.startsWith("meta:")) throw new MapFileError("Not a game map file (no meta section).");

  const file: MapFile = {
    lines,
    eol,
    format: 0,
    entitiesLine: -1,
    groups: [],
    entitiesEnd: lines.length,
    tilemap: new Map(),
    tilemapLines: [0, 0],
    entities: [],
    byUid: new Map(),
    grids: [],
    entityCountLine: -1,
  };

  let i = 1;
  // meta
  for (; i < lines.length && lines[i].startsWith("  "); i++) {
    const line = lines[i];
    if (line.startsWith("  format: ")) file.format = Number(line.slice(10));
    else if (line.startsWith("  entityCount: ")) file.entityCountLine = i;
  }
  if (!file.format) throw new MapFileError("The map file has no format version.");
  let group: ProtoGroup | null = null;
  if (file.format < 6 || file.format > 7) throw new MapFileError(`Map format ${file.format} is not supported (6 and 7 are).`);

  // Top-level sections up to the entities.
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === "tilemap:") {
      const start = ++i;
      for (; i < lines.length && lines[i].startsWith("  "); i++) {
        const colon = lines[i].indexOf(":");
        file.tilemap.set(Number(lines[i].slice(0, colon)), lines[i].slice(colon + 1).trim());
      }
      file.tilemapLines = [start, i];
      i--;
    } else if (line === "entities:") {
      file.entitiesLine = i;
      i++;
      break;
    }
  }

  let proto = "";
  let entity: EntityRecord | null = null;
  let component = "";
  let componentStart = 0;
  let grid: GridRecord | null = null;
  let atmos: GridAtmosphere | null = null;
  let chunk: { ind: [number, number]; tiles: string; version: number; size: number } | null = null;
  let atmosChunk: [number, number] | null = null;
  let spawnerList: string[] | null = null;
  // Atmosphere masks are decoded once the component is read, because chunkSize comes after the tiles.
  let atmosMasks: [number, number, number, number][] = [];
  let inUniqueMixes = false;

  const finishChunk = () => {
    if (!chunk || !grid) return;
    decodeChunk(file, grid, chunk.ind, chunk.tiles, chunk.version, chunk.size);
    grid.chunkVersion = Math.max(grid.chunkVersion, chunk.version);
    grid.chunkSize = chunk.size;
    chunk = null;
  };

  const finishComponent = (end: number) => {
    if (!entity) return;
    if (component === "Transform") entity.transform.end = end;
    else if (component === "MapGrid" && grid) {
      finishChunk();
      grid.mapGrid = [componentStart, end];
    } else if (component === "GridAtmosphere" && atmos) {
      atmos.end = end;
      const size = atmos.chunkSize;
      for (const [cx, cy, mix, mask] of atmosMasks) {
        for (let bit = 0; bit < size * size; bit++) {
          if (Math.floor(mask / 2 ** bit) % 2 === 1) atmos.mixes.set(`${cx * size + (bit % size)},${cy * size + Math.floor(bit / size)}`, mix);
        }
      }
      atmosMasks = [];
      atmos = null;
    }
    component = "";
  };

  const finishEntity = (end: number) => {
    if (!entity) return;
    finishComponent(end);
    entity.end = end;
    if (grid) {
      file.grids.push(grid);
      grid = null;
    }
    entity = null;
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("- proto: ")) {
      finishEntity(i);
      proto = unquote(line.slice(9).trim());
      group = { proto, start: i, entities: [] };
      file.groups.push(group);
      continue;
    }
    if (line.startsWith("  - uid: ")) {
      finishEntity(i);
      entity = {
        uid: Number(line.slice(9)),
        proto,
        start: i,
        end: i + 1,
        pos: null,
        rot: 0,
        parent: null,
        transform: { at: -1, end: -1, pos: -1, rot: -1, parent: -1 },
      };
      file.entities.push(entity);
      file.byUid.set(entity.uid, entity);
      group?.entities.push(entity);
      continue;
    }
    if (line.length > 0 && line[0] !== " ") {
      // Anything else at the top level (e.g. the "..." document end) ends the entities section.
      finishEntity(i);
      file.entitiesEnd = i;
      break;
    }
    if (!entity) continue;
    if (line.startsWith("    - type: ")) {
      finishComponent(i);
      component = line.slice(12).trim();
      componentStart = i;
      if (component === "Transform") entity.transform.at = i;
      else if (component === "MapGrid") grid = { uid: entity.uid, chunkSize: 16, chunkVersion: 6, tiles: new Map(), mapGrid: [i, i], atmosphere: null };
      else if (component === "RandomSpawner") {
        entity.spawner = {};
        spawnerList = null;
      } else if (component === "GridAtmosphere") {
        atmos = { start: i, end: i, chunkSize: 4, mixes: new Map(), uniqueMixes: [] };
        grid ??= { uid: entity.uid, chunkSize: 16, chunkVersion: 6, tiles: new Map(), mapGrid: [i, i], atmosphere: null };
        grid.atmosphere = atmos;
        inUniqueMixes = false;
      }
      continue;
    }

    if (component === "RandomSpawner" && entity.spawner) {
      const field = /^ {6}(\w+):(?: (.*))?$/.exec(line);
      if (field) {
        const [, key, value] = field;
        spawnerList = null;
        if (key === "chance" || key === "rareChance") entity.spawner[key] = Number(value);
        else if (key === "prototypes" || key === "rarePrototypes") {
          const list = value === "[]" ? [] : value?.startsWith("[") ? value.slice(1, -1).split(",").map((id) => id.trim()).filter(Boolean) : [];
          entity.spawner[key] = list;
          if (value === undefined) spawnerList = list;
        }
      } else if (spawnerList && line.startsWith("      - ")) {
        spawnerList.push(line.slice(8).trim());
      }
    } else if (component === "Transform") {
      if (line.startsWith("      pos: ")) {
        entity.transform.pos = i;
        const [x, y] = line.slice(11).split(",").map(Number);
        entity.pos = [x, y];
      } else if (line.startsWith("      rot: ")) {
        entity.transform.rot = i;
        entity.rot = parseFloat(line.slice(11));
      } else if (line.startsWith("      parent: ")) {
        entity.transform.parent = i;
        const value = line.slice(14).trim();
        entity.parent = value === "invalid" ? null : Number(value);
      }
    } else if (component === "MapGrid") {
      if (/^ {8}-?\d+,-?\d+:$/.test(line)) {
        finishChunk();
        chunk = { ind: [0, 0], tiles: "", version: 1, size: 16 };
      } else if (chunk) {
        if (line.startsWith("          ind: ")) chunk.ind = line.slice(15).split(",").map(Number) as [number, number];
        else if (line.startsWith("          tiles: ")) chunk.tiles = line.slice(17).trim();
        else if (line.startsWith("          version: ")) chunk.version = Number(line.slice(19));
        else if (line.startsWith("          size: ")) chunk.size = Number(line.slice(16));
      }
    } else if (component === "GridAtmosphere" && atmos) {
      if (line.startsWith("        uniqueMixes:")) {
        inUniqueMixes = true;
        atmos.uniqueMixes.push(line);
      } else if (line.startsWith("        chunkSize: ")) {
        inUniqueMixes = false;
        atmos.chunkSize = Number(line.slice(19));
      } else if (inUniqueMixes) {
        atmos.uniqueMixes.push(line);
      } else if (/^ {10}-?\d+,-?\d+:$/.test(line)) {
        atmosChunk = line.trim().slice(0, -1).split(",").map(Number) as [number, number];
      } else if (atmosChunk && /^ {12}\d+: \d+$/.test(line)) {
        const [mix, mask] = line.trim().split(": ").map(Number);
        atmosMasks.push([atmosChunk[0], atmosChunk[1], mix, mask]);
      }
    }
  }
  if (entity) {
    finishEntity(lines.length);
    file.entitiesEnd = lines.length;
  }
  // Trailing empty lines (the final newline) belong to the tail, not to the last entity.
  const last = file.entities.at(-1);
  if (last) {
    while (last.end > last.start + 1 && lines[last.end - 1] === "") last.end--;
    file.entitiesEnd = Math.min(file.entitiesEnd, last.end);
  }
  return file;
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function decodeChunk(file: MapFile, grid: GridRecord, [cx, cy]: [number, number], base64: string, version: number, size: number): void {
  const bytes = fromBase64(base64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stride = version >= 7 ? 7 : version >= 6 ? 6 : 4;
  let offset = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (offset + stride > bytes.length) return;
      const type = version >= 6 ? view.getInt32(offset, true) : view.getUint16(offset, true);
      const typeOffset = version >= 6 ? 4 : 2;
      const flags = bytes[offset + typeOffset];
      const variant = bytes[offset + typeOffset + 1];
      const rotation = version >= 7 ? bytes[offset + 6] : 0;
      offset += stride;
      if (file.tilemap.get(type) === SPACE || (type === 0 && !file.tilemap.has(0))) continue;
      grid.tiles.set(`${cx * size + x},${cy * size + y}`, { type, flags, variant, rotation });
    }
  }
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The grid the editor shows: the one with the most tiles. */
export function mainGrid(file: MapFile): GridRecord | null {
  let best: GridRecord | null = null;
  for (const grid of file.grids) if (!best || grid.tiles.size > best.tiles.size) best = grid;
  return best;
}
