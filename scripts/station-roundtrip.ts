// Checks the station importer and exporter against the game's own maps.
//
//   npm run test:roundtrip -- --game ../Qlippoth-station-14
//
// 1. Every map directly under Resources/Maps is imported and exported without edits; the output must equal the
//    file byte for byte.
// 2. One map is edited (an entity moved and rotated, one removed, one added, a tile added) and the export is read
//    back to check each edit landed and nothing else changed.
// Needs public/palette/palette.json (npm run palette).

import fs from "node:fs";
import path from "node:path";
import { cellKey, fromItems, itemsOf, normalizeAngle, type Item } from "../src/document";
import { createPalette } from "../src/palette";
import { exportStation } from "../src/station/export";
import { importStation } from "../src/station/import";
import { mainGrid, parseMapFile } from "../src/station/mapfile";

const index = process.argv.indexOf("--game");
const game = index >= 0 ? process.argv[index + 1] : process.env.QLIPPOTH_GAME_DIR;
if (!game) {
  console.error("Usage: npm run test:roundtrip -- --game <path to Qlippoth-station-14 checkout>");
  process.exit(1);
}
const mapsDir = path.resolve(game, "Resources", "Maps");
const palette = createPalette(JSON.parse(fs.readFileSync("public/palette/palette.json", "utf8")), "", null as unknown as HTMLImageElement);

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}`);
};

const files = fs.readdirSync(mapsDir).filter((name) => name.endsWith(".yml")).sort();
for (const name of files) {
  const text = fs.readFileSync(path.join(mapsDir, name), "utf8");
  const started = performance.now();
  const doc = importStation(text, palette, name);
  const imported = performance.now();
  const { text: output } = exportStation(doc, palette);
  const exported = performance.now();
  let detail = "";
  if (output !== text) {
    const [a, b] = [text.split("\n"), output.split("\n")];
    const line = a.findIndex((value, i) => value !== b[i]);
    detail = ` first difference at line ${line + 1}: ${JSON.stringify(a[line])} vs ${JSON.stringify(b[line])}`;
  }
  check(output === text, `${name}: unchanged round trip (import ${Math.round(imported - started)} ms, export ${Math.round(exported - imported)} ms)${detail}`);
}

// ---- Edits ----
const editName = files.includes("box.yml") ? "box.yml" : files[0];
const text = fs.readFileSync(path.join(mapsDir, editName), "utf8");
const doc = importStation(text, palette, editName);
const source = doc.station!;

// Pick a cell on the Object layer holding exactly one entity whose cell to the right is empty.
const pick = [...doc.layers.object].find(([key, brush]) => {
  const [x, y] = key.split(",").map(Number);
  return itemsOf(brush).length === 1 && !doc.layers.object.has(cellKey(x + 1, y)) && x + 1 < doc.width;
})!;
const [pickKey, pickBrush] = pick;
const [px, py] = pickKey.split(",").map(Number);
const movedItem: Item = { ...itemsOf(pickBrush)[0], rot: normalizeAngle((itemsOf(pickBrush)[0].rot ?? 0) - Math.PI / 2) };
doc.layers.object.delete(pickKey);
doc.layers.object.set(cellKey(px + 1, py), movedItem);

// Remove a single-entity object that contains other entities (a filled locker), so its contents must go too.
const parents = new Set(source.file.entities.map((entity) => entity.parent));
const [removeKey, removeBrush] = [...doc.layers.object].find(
  ([key, brush]) => key !== cellKey(px + 1, py) && itemsOf(brush).length === 1 && parents.has(itemsOf(brush)[0].uid!)
)!;
const removedUid = itemsOf(removeBrush)[0].uid!;
doc.layers.object.delete(removeKey);

// Add an entity next to an existing stack and a tile in an empty cell.
const addKey = [...doc.layers.object.keys()].find((key) => key !== cellKey(px + 1, py))!;
doc.layers.object.set(addKey, fromItems([...itemsOf(doc.layers.object.get(addKey)), { kind: "fixed", id: "ChairOfficeDark", rot: Math.PI }])!);
let emptyKey = "";
for (let y = 0; y < doc.height && !emptyKey; y++) for (let x = 0; x < doc.width && !emptyKey; x++) if (!doc.layers.floor.has(cellKey(x, y))) emptyKey = cellKey(x, y);
doc.layers.floor.set(emptyKey, { kind: "fixed", id: "FloorSteel" });

const { text: edited, summary } = exportStation(doc, palette);
const before = parseMapFile(text);
const after = parseMapFile(edited);
check(summary.moved === 1 && summary.added === 1 && summary.tilesChanged, `edit summary ${JSON.stringify(summary)}`);
check(after.entities.length === before.entities.length - summary.removed + 1, `entity count ${before.entities.length} -> ${after.entities.length}`);
check(Number(after.lines[after.entityCountLine].split(": ")[1]) === after.entities.length, "meta entityCount matches the entities written");

const moved = after.byUid.get(movedItem.uid!)!;
const original = before.byUid.get(movedItem.uid!)!;
check(moved.pos![0] === original.pos![0] + 1 && moved.pos![1] === original.pos![1], `moved entity ${movedItem.uid} one tile right`);
check(Math.abs(normalizeAngle(moved.rot) - movedItem.rot!) < 1e-9, `moved entity rotated to ${movedItem.rot}`);
check(!after.byUid.has(removedUid), `removed entity ${removedUid} is gone`);
const removedChildren = before.entities.filter((entity) => entity.parent === removedUid).map((entity) => entity.uid);
check(removedChildren.length > 0 && removedChildren.every((uid) => !after.byUid.has(uid)), `its ${removedChildren.length} contained entities are gone too`);

const [ex, ey] = emptyKey.split(",").map(Number);
const gridKey = `${ex + source.originX},${ey + source.originY}`;
const grid = mainGrid(after)!;
const newTile = grid.tiles.get(gridKey);
check(!!newTile && after.tilemap.get(newTile.type) === "FloorSteel", `new tile at grid ${gridKey} is FloorSteel`);
check(grid.atmosphere!.mixes.has(gridKey), "new tile has an atmosphere");
const oldGrid = mainGrid(before)!;
check([...oldGrid.tiles].every(([key, tile]) => {
  const other = grid.tiles.get(key);
  return !!other && after.tilemap.get(other.type) === before.tilemap.get(tile.type) && other.variant === tile.variant && other.flags === tile.flags;
}), "every other tile kept its type, flags and variant");
check([...oldGrid.atmosphere!.mixes].every(([key, mix]) => grid.atmosphere!.mixes.get(key) === mix), "every other tile kept its gas mixture");

// The edited map reads back as the same document.
const reread = importStation(edited, palette, editName);
const count = (d: typeof doc) => [...d.layers.structure.values(), ...d.layers.object.values()].reduce((sum, brush) => sum + itemsOf(brush).length, 0);
check(count(reread) === count(doc), `re-import has the same ${count(doc)} entities on the grid`);
check(reread.layers.floor.size === doc.layers.floor.size, `re-import has the same ${doc.layers.floor.size} tiles`);

// A new station from the template.
const fresh = importStation(exportStation({ ...doc, station: undefined, name: "Test Station" }, palette).text, palette, "fresh");
check(fresh.layers.floor.size === doc.layers.floor.size && count(fresh) === count(doc), "the same content written into a new station reads back");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
