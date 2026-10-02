// Built-in lists: the .list.json files in lists/ at the root of this repository. They are bundled into the editor,
// shown to everyone and cannot be changed or removed there, because they are part of the game. To add one, put its
// file in lists/ (see lists/README.md).

import { parseList, type TileList } from "./lists";

const files = import.meta.glob("../lists/*.list.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;

export interface BuiltInLoad {
  lists: TileList[];
  /** Files that could not be used, with the reason. The tests fail on these, so they only show up in development. */
  problems: string[];
}

export function loadBuiltInLists(): BuiltInLoad {
  const lists: TileList[] = [];
  const problems: string[] = [];
  for (const [path, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const fileName = path.split("/").pop()!;
    try {
      const list = parseList(text);
      if (fileName !== `${list.id}.list.json`) throw new Error(`file name must be ${list.id}.list.json`);
      if (lists.some((other) => other.id === list.id)) throw new Error(`another built-in list already has the id "${list.id}"`);
      lists.push({ ...list, builtIn: true });
    } catch (error) {
      problems.push(`lists/${fileName}: ${(error as Error).message}`);
    }
  }
  return { lists, problems };
}
