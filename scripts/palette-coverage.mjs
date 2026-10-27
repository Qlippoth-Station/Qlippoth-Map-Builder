// Reports how much of the game's own maps the generated palette knows.
//
//   npm run palette:coverage -- --game ../Qlippoth-station-14 [--min 99]
//
// Reads public/palette/palette.json and every map .yml directly under Resources/Maps (the station maps) and counts
// the entity prototypes and tiles they use that the palette does not list. With --min, exits with an error when
// the entity coverage of any map is below that percentage.

import fs from "node:fs";
import path from "node:path";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const game = arg("--game") ?? process.env.QLIPPOTH_GAME_DIR;
if (!game) {
  console.error("Usage: npm run palette:coverage -- --game <path to Qlippoth-station-14 checkout> [--min <percent>]");
  process.exit(1);
}
const mapsDir = path.resolve(game, "Resources", "Maps");
const minimum = arg("--min") !== undefined ? Number(arg("--min")) : null;

const palette = JSON.parse(fs.readFileSync("public/palette/palette.json", "utf8"));
const entities = new Set(palette.items.filter((item) => item.layer !== "floor").map((item) => item.id));
const tiles = new Set(palette.items.filter((item) => item.layer === "floor").map((item) => item.id));
// Renamed ids the game migrates on load count as known when their new id is (or when the game deletes them).
const migrations = palette.migrations ?? {};
const knownEntity = (id) => entities.has(id) || (id in migrations && (migrations[id] === null || entities.has(migrations[id])));

// Map files are scanned line by line: "- proto: Id" starts a prototype group, "  - uid: N" is one entity of it,
// and the tilemap lists "  N: TileId". Parsing the whole YAML would take seconds per map for no benefit here.
function scan(file) {
  const used = new Map();
  const tilemap = [];
  let proto = null;
  let inTilemap = false;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.startsWith("tilemap:")) {
      inTilemap = true;
      continue;
    }
    if (inTilemap) {
      const match = /^\s+\d+:\s*(\S+)/.exec(line);
      if (match) {
        tilemap.push(match[1]);
        continue;
      }
      inTilemap = false;
    }
    if (line.startsWith("- proto: ")) proto = line.slice(9).trim().replace(/^"(.*)"$/, "$1");
    else if (proto && line.startsWith("  - uid: ")) used.set(proto, (used.get(proto) ?? 0) + 1);
  }
  return { used, tilemap };
}

const percent = (part, whole) => (whole === 0 ? 100 : (100 * part) / whole);
const missingTotal = new Map();
let failed = false;
const rows = [];

const files = fs.existsSync(mapsDir) ? fs.readdirSync(mapsDir).filter((name) => name.endsWith(".yml")).sort() : [];
if (files.length === 0) {
  console.error(`No map files under ${mapsDir}`);
  process.exit(1);
}

for (const name of files) {
  const { used, tilemap } = scan(path.join(mapsDir, name));
  // The map entity and grids are written with an empty prototype; they are not palette items.
  used.delete("");
  let instances = 0;
  let knownInstances = 0;
  let known = 0;
  for (const [id, count] of used) {
    instances += count;
    if (knownEntity(id)) {
      known++;
      knownInstances += count;
    } else {
      missingTotal.set(id, (missingTotal.get(id) ?? 0) + count);
    }
  }
  const usedTiles = tilemap.filter((id) => id !== "Space");
  const knownTiles = usedTiles.filter((id) => tiles.has(id)).length;
  const coverage = percent(known, used.size);
  if (minimum !== null && coverage < minimum) failed = true;
  rows.push([
    name,
    `${known}/${used.size} prototypes (${coverage.toFixed(1)}%)`,
    `${knownInstances}/${instances} entities (${percent(knownInstances, instances).toFixed(1)}%)`,
    `${knownTiles}/${usedTiles.length} tiles`,
  ]);
}

const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
for (const row of rows) console.log(row.map((cell, column) => cell.padEnd(widths[column])).join("  "));

if (missingTotal.size > 0) {
  const top = [...missingTotal].sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log(`\nNot in the palette (${missingTotal.size} prototypes; most used first):`);
  for (const [id, count] of top) console.log(`  ${id}  ×${count}`);
}

if (failed) {
  console.error(`\nEntity prototype coverage is below ${minimum}% on at least one map.`);
  process.exit(1);
}
