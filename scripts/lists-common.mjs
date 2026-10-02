// Helpers shared by the list scripts. No dependencies, so CI can run the list checks without `npm ci`.

import fs from "node:fs";
import path from "node:path";

/** Where list files live inside the game's Resources/Domains/. Directly in it, no subfolders. */
export const LISTS_FOLDER = "Lists";

/** Same list content, ignoring formatting and the editor-only name and icon. */
export function sameListContent(a, b) {
  const content = (list) =>
    JSON.stringify({ id: list.id, layer: list.layer, entries: (list.entries ?? []).map((entry) => ({ ...entry, weight: entry.weight ?? 1 })) });
  return content(a) === content(b);
}

/** The *.list.json files directly in `dir`, by file name, parsed. Files that are not valid JSON have `data: null`. */
export function readListDir(dir) {
  const lists = new Map();
  if (!dir || !fs.existsSync(dir)) return lists;
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith(".list.json")).sort()) {
    let data = null;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    } catch {
      // Reported by `npm run domains`; here the file only counts as present.
    }
    lists.set(name, data);
  }
  return lists;
}

/** Every *.domain.json under `dir` (recursively), as { name, data } with `name` relative to `dir`. */
export function readDomains(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".domain.json"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
    .flatMap((file) => {
      try {
        return [{ name: path.relative(dir, file).split(path.sep).join("/"), data: JSON.parse(fs.readFileSync(file, "utf8")) }];
      } catch {
        return [];
      }
    });
}

/** Names of the domains that use the list with this id on any layer. */
export function domainsUsing(domains, listId) {
  return domains
    .filter(({ data }) => Object.values(data?.layers ?? {}).some((cells) => Object.values(cells ?? {}).some((brush) => brush?.kind === "list" && brush.list === listId)))
    .map(({ name }) => name);
}
