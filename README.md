# Qlippoth Map Builder

A browser-based, visual editor for [Qlippoth Station](https://github.com/Qlippoth-Station/Qlippoth-station-14) maps.
Contributors paint maps cell by cell with real game sprites, then save them as files the game reads.

The editor has two modes, switched in the top bar. Both share the same tools, palette and shortcuts:

| Mode | For | Saves |
|---|---|---|
| **Domain** | Rift domains and templates for the Q-Gate | `.domain.json` |
| **Station** | Station maps and station parts (departments) | `.station.json` (working file until game map export lands, see roadmap) |

Each mode keeps its own document, undo history and autosave, so switching never loses work.

Everything runs in the browser. Nothing is uploaded anywhere; work is autosaved in your own browser and shared as files.

## Using it

1. Pick a mode, then a layer (Floor, Structure, Object, and Marker in domain mode).
2. Pick an item from the palette on the right.
3. Choose an **action** (Brush, Erase, Select) and a **shape** (Single, Rectangle, Fill); every action works with every shape.
   Right click picks what is under the cursor.
4. **Select** cells, then drag them (or use the arrow keys) to move them. While something is selected, Brush and Erase
   only touch the selection; the *Selection* panel fills or erases it in one go.
5. **Add** brings another file of the same mode into the current map, ready to move into place. Build departments or
   rooms one by one and put them together this way. A domain can't be added to a station, or the other way round.
6. Domains: place at least one **Entry** and one **Qlippoth spot** marker, and choose how players are spread over
   the entries (*Random*, *Order* or *Cohort*). The *Checks* panel lists anything that is missing.
7. **Save** downloads the file. **Open** takes either kind of file and switches to its mode.

Press `?` in the editor for all shortcuts.

## Roadmap

### Domain mode

| Stage | Contents | Status |
|---|---|---|
| 1 | Palette from game data, layered grid editor, fixed brushes, save/open, checks | ✅ |
| 2 | Tile sets and random modes (weak / default / full / chance) with roll scope (cell / group / map), seeded preview | ⏳ |
| 3 | Templates, template sets, connection points, rotate/mirror, compatibility checks | ⏳ |
| 4 | Game side: `RecipeDungeon` reads the files and resolves randomness with the same seeded RNG | ⏳ |
| 5 | Fully random domains built from the same template library | ⏳ |

### Station mode

| Phase | Contents | Status |
|---|---|---|
| 1 | Mode system (domain / station), per-mode autosave in IndexedDB | ✅ |
| 2 | Palette v2: classification by component instead of folder, markers, fills, rotation metadata | ⏳ |
| 3a | Import game map `.yml` files (fast line scanner), chunk-cached rendering | ⏳ |
| 3b | Several entities per cell, rotation, game map `.yml` export (lossless round trip), *Draft* profile | ⏳ |
| 4 | Link the server data folder: export straight to `loadmap`, import `savemap` output | ⏳ |
| 5 | *Exportable* profile: full station checks, `gameMap` prototype export | ⏳ |
| 6 | Modules (departments) and project files | ⏳ |
| 7 | Random spawners and `RoomFill` rooms | ⏳ |
| 8 | Codebase picker for other SS14 forks | ⏳ |

## Development

Requires Node.js 22+ and a checkout of the game repository.

```bash
npm install
npm run palette -- --game ../Qlippoth-station-14   # builds public/palette from the game files
npm run dev
```

`npm run build` type-checks and produces `dist/`.

The palette (`public/palette/`) is generated, not committed. CI checks out the game repository, rebuilds the palette
and deploys to GitHub Pages on every push to `main` and once a day. The game repository can be changed with the
`GAME_REPOSITORY` and `GAME_REF` repository variables.

### Layout

| Path | What |
|---|---|
| `scripts/build-palette.mjs` | Reads tile and entity prototypes, resolves inheritance, builds `palette.json`, `atlas.png`, `credits.json` |
| `src/modes.ts` | Mode definitions: layers, file suffix, defaults |
| `src/document.ts` | Document model and file formats |
| `src/storage.ts` | Autosave (IndexedDB, one slot per mode) |
| `src/editor.ts` | Editor state, edits, undo/redo, checks |
| `src/view.ts` | Canvas rendering, camera and tool input |
| `src/ui.ts` | Side panels and top bar |
| `docs/format.md` | File format reference |

## Licenses

Code in this repository is MIT licensed (see [LICENSE](LICENSE)).

Sprites shown in the editor come from the game repository and keep their original licenses, mostly CC-BY-SA 3.0.
The editor's **Credits** dialog lists the source, license and copyright of every sprite used.
