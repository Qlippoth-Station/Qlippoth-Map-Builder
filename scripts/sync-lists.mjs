// Copies the editor's built-in lists (lists/*.list.json) into the game checkout next to this repository, so domains
// that use them work in the game too.
//
//   npm run lists:sync                   into ../Qlippoth-station-14/Resources/Domains/Lists/
//   npm run lists:sync -- --game <path>  any other checkout
//
// Only built-in lists are written; other list files in the game are left alone. Commit the result in the game repository.

import fs from "node:fs";
import path from "node:path";
import { EDITOR_ROOT, findGame } from "./game-dir.mjs";

const { game, resources } = findGame();
const source = path.join(EDITOR_ROOT, "lists");
const target = path.join(resources, "Domains", "Lists");
fs.mkdirSync(target, { recursive: true });

let changed = 0;
const files = fs.existsSync(source) ? fs.readdirSync(source).filter((name) => name.endsWith(".list.json")).sort() : [];
for (const name of files) {
  const text = fs.readFileSync(path.join(source, name), "utf8");
  const destination = path.join(target, name);
  const before = fs.existsSync(destination) ? fs.readFileSync(destination, "utf8") : null;
  if (before === text) continue;
  fs.writeFileSync(destination, text);
  changed++;
  console.log(`${before === null ? "added  " : "updated"} ${path.relative(game, destination).split(path.sep).join("/")}`);
}
console.log(`${files.length} built-in lists, ${changed} written to ${path.relative(process.cwd(), target) || target}.`);
