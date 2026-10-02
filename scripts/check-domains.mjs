// Checks every domain file in the game checkout next to this repository (see game-dir.mjs).
//
//   npm run domains                      checks <game>/Resources/Domains/**/*.domain.json and *.list.json
//   npm run domains -- --game <path>     any other checkout
//
// A file passes when it matches docs/domain.schema.json, every cell is inside the map, it has exactly one Entry and at
// least one Qlippoth spot, every marker stands on floor, and every id exists in the palette built from the same game
// checkout (`npm run palette`). This is the same list as the "validation checklist" in docs/format.md, so problems show
// up here before the game's integration test or a rift finds them.
//
// Random lists (*.list.json) must be directly in Resources/Domains/Lists/, so a list id always has one path and two
// pull requests adding the same id conflict in git instead of silently overwriting each other. They must match
// docs/list.schema.json, be named <id>.list.json, have unique ids and only hold ids the game has. Every list a domain
// uses must exist and be for the layer it is used on.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Ajv from "ajv/dist/2020.js";
import { EDITOR_ROOT, findGame } from "./game-dir.mjs";
import { LISTS_FOLDER, sameListContent } from "./lists-common.mjs";

export { sameListContent };

export const DOMAINS_FOLDER = "Domains";
const LAYERS = ["floor", "structure", "object", "marker"];
const FILE_NAME = /^[a-z0-9]+(_[a-z0-9]+)*\.domain\.json$/;

const ajv = new Ajv({ allErrors: true });
const readSchema = (name) => JSON.parse(fs.readFileSync(path.join(EDITOR_ROOT, "docs", name), "utf8"));
const validateSchema = ajv.compile(readSchema("domain.schema.json"));
const validateListSchema = ajv.compile(readSchema("list.schema.json"));

/** Problems in one list file, and the list itself when it could be read. */
export function checkList(text, fileName, knownIds) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { list: null, problems: [`Not valid JSON: ${error.message}`] };
  }
  if (!validateListSchema(data)) {
    return { list: null, problems: validateListSchema.errors.map((error) => `Schema: ${error.instancePath || "/"} ${error.message}`) };
  }
  const problems = [];
  if (fileName !== `${data.id}.list.json`) problems.push(`File name should be ${data.id}.list.json (the list id).`);
  const empties = data.entries.filter((entry) => entry.empty).length;
  if (data.entries.length === 0) problems.push("The list is empty.");
  else if (empties === data.entries.length) problems.push("The list only has the empty choice.");
  if (empties > 1) problems.push("A list can have only one empty choice.");
  if (data.version < 2 && (empties > 0 || data.icon?.symbol)) problems.push("The empty choice and symbols need list format version 2.");
  if (knownIds) {
    for (const entry of data.entries) if (!entry.empty && !knownIds[data.layer].has(entry.id)) problems.push(`unknown ${data.layer} id "${entry.id}".`);
  }
  return { list: data, problems };
}

/** The editor's built-in lists (lists/*.list.json), by id, as parsed JSON. */
export function readBuiltInLists() {
  const dir = path.join(EDITOR_ROOT, "lists");
  const lists = new Map();
  if (!fs.existsSync(dir)) return lists;
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith(".list.json"))) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    lists.set(data.id, data);
  }
  return lists;
}


/**
 * Problems in one domain file. `knownIds` maps a layer to the ids the game has (markers are checked by the schema);
 * pass null to skip the id check.
 */
export function checkDomain(text, fileName, knownIds, lists = null) {
  const problems = [];
  if (!FILE_NAME.test(fileName)) problems.push("File name should be lowercase snake_case ending in .domain.json (content paths are case sensitive).");

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return [...problems, `Not valid JSON: ${error.message}`];
  }
  if (!validateSchema(data)) {
    for (const error of validateSchema.errors) problems.push(`Schema: ${error.instancePath || "/"} ${error.message}`);
    return problems;
  }

  const layers = Object.fromEntries(LAYERS.map((layer) => [layer, new Map(Object.entries(data.layers?.[layer] ?? {}))]));
  let usesLists = false;
  for (const layer of LAYERS) {
    const unknown = new Map(); // id -> cell keys
    const listsUsed = new Map(); // list id -> first cell
    for (const [key, brush] of layers[layer]) {
      const [x, y] = key.split(",").map(Number);
      if (x >= data.width || y >= data.height) problems.push(`${layer} ${key}: outside the ${data.width}×${data.height} map.`);
      if (brush.kind === "list") {
        usesLists = true;
        if (!listsUsed.has(brush.list)) listsUsed.set(brush.list, key);
        continue;
      }
      if (knownIds && layer !== "marker" && !knownIds[layer].has(brush.id)) unknown.set(brush.id, [...(unknown.get(brush.id) ?? []), key]);
    }
    for (const [id, keys] of unknown) problems.push(`${layer}: unknown id "${id}" in ${keys.length} cell(s), first at ${keys[0]}.`);
    if (!lists) continue;
    for (const [id, key] of listsUsed) {
      const list = lists.get(id);
      if (!list) problems.push(`${layer} ${key}: list "${id}" not found (add ${id}.list.json under Resources/Domains/Lists/).`);
      else if (list.layer !== layer) problems.push(`${layer} ${key}: list "${id}" is for the ${list.layer} layer.`);
    }
  }
  if (usesLists && data.version < 2) problems.push("Uses random lists, which need format version 2.");

  const markers = [...layers.marker];
  const entries = markers.filter(([, brush]) => brush.id === "Entry");
  if (entries.length !== 1) problems.push(`Needs exactly one Entry marker, found ${entries.length}.`);
  if (!markers.some(([, brush]) => brush.id === "QlippothSpot")) problems.push("Needs at least one QlippothSpot marker.");
  for (const [key] of markers) if (!layers.floor.has(key)) problems.push(`marker ${key}: not on a floor tile.`);
  return problems;
}

/** Ids per layer from public/palette/palette.json, or null when the palette has not been built. */
export function readKnownIds() {
  const file = path.join(EDITOR_ROOT, "public/palette/palette.json");
  if (!fs.existsSync(file)) return null;
  const known = Object.fromEntries(LAYERS.map((layer) => [layer, new Set()]));
  for (const item of JSON.parse(fs.readFileSync(file, "utf8")).items) known[item.layer]?.add(item.id);
  return known;
}

function findFiles(dir, suffix) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

function main() {
  const { game, resources } = findGame();
  const dir = path.join(resources, DOMAINS_FOLDER);
  const domainFiles = findFiles(dir, ".domain.json");
  // Lists in the right folder first, so a duplicate id is reported on the misplaced file.
  const listsDir = path.join(dir, LISTS_FOLDER);
  const listFiles = findFiles(dir, ".list.json").sort((a, b) => Number(path.dirname(a) !== listsDir) - Number(path.dirname(b) !== listsDir) || a.localeCompare(b));
  if (domainFiles.length + listFiles.length === 0) {
    console.log(`No domain or list files in ${path.relative(process.cwd(), dir) || dir}. Nothing to check.`);
    return;
  }

  const knownIds = readKnownIds();
  if (!knownIds) console.warn("public/palette/palette.json not found: run `npm run palette` to also check ids.\n");

  let failed = 0;
  const report = (file, problems) => {
    const name = path.relative(game, file).split(path.sep).join("/");
    if (problems.length === 0) return console.log(`ok    ${name}`);
    failed++;
    console.log(`FAIL  ${name}`);
    for (const problem of problems) console.log(`      - ${problem}`);
  };

  const lists = new Map();
  const builtIn = readBuiltInLists();
  for (const file of listFiles) {
    const { list, problems } = checkList(fs.readFileSync(file, "utf8"), path.basename(file), knownIds);
    if (path.dirname(file) !== listsDir) problems.push(`List files belong directly in Resources/${DOMAINS_FOLDER}/${LISTS_FOLDER}/ (no other folders), so each list id has exactly one path.`);
    if (list && lists.has(list.id)) problems.push(`Another list file already has the id "${list.id}".`);
    if (list && builtIn.has(list.id) && !sameListContent(list, builtIn.get(list.id))) {
      problems.push(`Differs from the editor's built-in list "${list.id}" (lists/${list.id}.list.json). Run \`npm run lists:sync\` or update the built-in list.`);
    }
    if (list && !lists.has(list.id)) lists.set(list.id, list);
    report(file, problems);
  }
  for (const file of domainFiles) report(file, checkDomain(fs.readFileSync(file, "utf8"), path.basename(file), knownIds, lists));

  const missingBuiltIns = [...builtIn.keys()].filter((id) => !lists.has(id));
  if (missingBuiltIns.length) console.log(`\nnote  Built-in lists not in the game yet: ${missingBuiltIns.join(", ")}. \`npm run lists:sync\` copies them.`);

  const total = domainFiles.length + listFiles.length;
  console.log(`\n${total - failed} of ${total} files passed (${domainFiles.length} domains, ${listFiles.length} lists).`);
  if (failed) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
