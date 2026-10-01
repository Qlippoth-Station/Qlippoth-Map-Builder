// Finds the game checkout the scripts work with.
//
// The expected layout keeps both repositories side by side in one parent folder:
//
//   <any folder>/
//     Qlippoth-station-14/    the game
//     Qlippoth-Map-Builder/   this editor
//
// so no path has to be given. `--game <path>` or QLIPPOTH_GAME_DIR override it (CI uses `--game game`).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EDITOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const GAME_FOLDER_NAME = "Qlippoth-station-14";
export const DEFAULT_GAME_DIR = path.resolve(EDITOR_ROOT, "..", GAME_FOLDER_NAME);

/** Returns the absolute game path and its Resources folder, or exits with a message that explains the layout. */
export function findGame(argv = process.argv) {
  const index = argv.indexOf("--game");
  const given = index >= 0 ? argv[index + 1] : process.env.QLIPPOTH_GAME_DIR;
  const game = given ? path.resolve(given) : DEFAULT_GAME_DIR;
  const resources = path.join(game, "Resources");
  if (!fs.existsSync(path.join(resources, "Prototypes"))) {
    console.error(
      [
        `No game checkout found at ${game} (Resources/Prototypes is missing).`,
        "",
        "Put both repositories in the same folder:",
        "",
        `  ${path.dirname(EDITOR_ROOT)}${path.sep}`,
        `    ${GAME_FOLDER_NAME}${path.sep}`,
        `    ${path.basename(EDITOR_ROOT)}${path.sep}`,
        "",
        "or pass another location with --game <path> or QLIPPOTH_GAME_DIR.",
      ].join("\n")
    );
    process.exit(1);
  }
  return { game, resources };
}
