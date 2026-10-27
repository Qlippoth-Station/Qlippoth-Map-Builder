# Qlippoth Map Builder

A browser-based, visual editor for [Qlippoth Station](https://github.com/Qlippoth-Station/Qlippoth-station-14) maps.
Contributors paint maps cell by cell with real game sprites, then save them as files the game reads.

The editor has two modes, switched in the top bar. Both share the same tools, palette and shortcuts:

| Mode | For | Saves |
|---|---|---|
| **Domain** | Rift domains and templates for the Q-Gate | `.domain.json` |
| **Station** | Station maps and station parts (departments) | the game's own map `.yml` |

Each mode keeps its own document, undo history and autosave, so switching never loses work.

Everything runs in the browser. Nothing is uploaded anywhere; work is autosaved in your own browser and shared as files.

## Using it

1. Pick a mode, then a layer (Floor, Structure, Object, and Marker in domain mode).
2. Pick an item from the palette on the right.
3. Choose an **action** (Brush, Erase, Select) and a **shape** (Single, Rectangle, Fill); every action works with every shape.
   Right click picks what is under the cursor.
   In station mode the Structure and Object layers hold a stack per cell, like the game: painting adds the item on
   top, erasing clears the cell. Right click shows everything in a cell in the *Cell* panel, where single items can be
   turned or removed. **T** / **Shift+T** turns what the brush places, or the selection, a quarter turn.
4. **Select** cells, then drag them (or use the arrow keys) to move them. While something is selected, Brush and Erase
   only touch the selection; the *Selection* panel fills or erases it in one go.
5. **Add** brings another file of the same mode into the current map, ready to move into place. Build departments or
   rooms one by one and put them together this way. A domain can't be added to a station, or the other way round.
6. Domains: place at least one **Entry** and one **Qlippoth spot** marker, and choose how players are spread over
   the entries (*Random*, *Order* or *Cohort*). The *Checks* panel lists anything that is missing.
7. **Save** downloads the file: a `.domain.json` for domains, a game map `.yml` for stations. **Open** takes either
   kind of file and switches to its mode, including the game's own map files (`Resources/Maps/*.yml`).

### Station maps

Opening a game map and saving it without edits gives back the same file, byte for byte. The editor shows the main
grid's tiles and the entities standing on it; everything else (other grids, decals, contents of lockers, device
links and other component data) is kept and written back. Edits change only what they touch:

- moved or turned entities get new Transform lines, removed entities go together with what is inside them;
- new entities are written with just their prototype and Transform, like the game's spawn menu places them;
- when tiles change, the grid's chunks and atmosphere are rewritten: existing tiles keep their gas mixture, new tiles
  get standard air, so the station does not open as vacuum.

### Modules and projects

The **Modules** tab next to the palette keeps a library of map parts per mode (stored in the browser):

- **Save selection** stores the selected cells as a module (a station module is a normal game map `.yml`, so it can be
  exported and tested in the game on its own; a domain module is a `.domain.json`). Saving under an existing name
  makes a new version.
- **Place** brings a module in like Add: move it, turn it with **T**, place it with **Enter**. The map remembers
  where each module was placed and how it was turned.
- When a module has a newer version, **Update** replaces every placed copy (its footprint is cleared on all layers
  and the new version is written, turned as before), as one undo step.
- Station checks look at where placed modules meet the rest: doors on a module's edge that open into a wall or space,
  and edge floor open to space.
- **Save project** downloads a `.project.zip` with `project.yml` (map, modules, placements), the map and every module
  of the mode; **Open project** reads it back (modules join the library as new versions).

### Randomness

The **Random** tab keeps random sets per mode (in the browser) and, for stations, random room slots:

- A **random set** is a list of tiles or entities with weights. **Use** makes it the brush: every painted cell gets
  one entry, picked by weight, so the map shows exactly what you get. On a station's Structure and Object layers a
  set can instead be left to the game (**Game picks every round**): the map gets one `RandomSpawner` entity with the
  set (weights become repeated entries) and a spawn chance, and the game picks what spawns there each round. Such
  spawners show the set's first entry with a die badge.
- A **room slot** is an area of the station (made from the selection) the game fills with one of several rooms at
  round start, using its `RoomFill` system. Rooms are modules of the slot's exact size, ticked in the slot's list.
  Saving and testing show what is painted in the slot now; the export package adds the rooms: an atlas map under
  `Resources/Maps/Dungeon/`, `dungeonRoom` prototypes with a tag per slot, and a room marker entity at the middle of
  each slot.

### Draft and Exportable

Stations have two profiles, switched above the *Checks* list:

- **Draft** (default) only runs the checks every map gets: unknown ids, ids the game renamed or removed, entities
  marked Do not map. Fast, for working and quick tests in the game.
- **Exportable** adds what a playable station needs: no entities on space, no doubled anchored entities (same id and
  direction in one cell), job spawn points, late-join and observer spawn points, gravity generator, SMES, substation,
  APC, air vents and scrubbers.

In the Exportable profile **Export package** downloads a `.zip` laid out like the game repository: the map under
`Resources/Maps/`, a `gameMap` prototype under `Resources/Prototypes/Maps/` (station id from the grid's
`BecomesStation`, job slots counted from the job spawn points) and a README with the steps to add it to the rotation.

### Testing in the game

**Game** links the game server's data folder (Chrome and Edge; for a development server `bin/Content.Server/data`).
The game's `loadmap` / `loadgrid` commands read from that folder and `savemap` / `savegrid` write into it, so:

1. **Export station here** writes the station's `.yml` into the folder.
2. In the game's console: `loadmap 10 /name.yml` (any unused map id), then `tp 0 0 10` as an admin ghost.
3. After changing things in the game, `savemap 10 /name.yml` writes them back; the file shows up in the dialog's list
   to **Open** (or **Add** into the current map).

The dialog shows the commands ready to copy. Other browsers use Save and copy the file into the folder by hand.

A station made from scratch is written into a template map (one station grid with the components the game's station
grids carry, a `BecomesStation` id from the name). Entities added with **Add** from another map are placed as new
entities of the same prototype and rotation; their extra data (locker contents, links) belongs to the other map.

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
| 2 | Palette v2: classification by component instead of folder, markers, fills, rotation metadata, game id renames | ✅ |
| 3a | Import game map `.yml` files (fast line scanner), several entities per cell, rotation display, chunk-cached rendering, Cell panel | ✅ |
| 3b | Editing stations: turning (T), Cell panel turn/remove, turning selections; game map `.yml` export with a lossless round trip | ✅ |
| 4 | Link the server data folder: export straight to `loadmap`, import `savemap` output | ✅ |
| 5 | *Draft* / *Exportable* profiles, station checks, export package with the `gameMap` prototype | ✅ |
| 6 | Module library (departments, rooms), placed instances with updates, edge checks, project files | ✅ |
| 7 | Random sets (painted or `RandomSpawner`), random room slots (`RoomFill`) in the export package | ✅ |
| 8 | Codebase picker for other SS14 forks | ⏳ |

## Development

Requires Node.js 22+ and a checkout of the game repository.

```bash
npm install
npm run palette -- --game ../Qlippoth-station-14   # builds public/palette from the game files
npm run dev
```

`npm run test:roundtrip -- --game ../Qlippoth-station-14` imports and exports every station map of the game (they must
come back byte for byte) and checks an edited map. CI runs it too.

`npm run palette:coverage -- --game ../Qlippoth-station-14` reports how many of the prototypes and tiles used by the
game's station maps (`Resources/Maps/*.yml`) the palette knows. CI runs it and fails below 95% on any map.

The palette lists every tile and every non-abstract entity prototype, wherever it is under `Resources/Prototypes`.
Walls, windows, doors, grilles and girders go to the Structure layer (by their `Wall`/`Window` tags, `Door` component
or parent), everything else to the Object layer. Entities the game hides from its spawn menu are known but only shown
when searched for. Renamed ids from the game's `Resources/migration.yml` resolve to their new id.

`npm run build` type-checks and produces `dist/`.

The palette (`public/palette/`) is generated, not committed. CI checks out the game repository, rebuilds the palette
and deploys to GitHub Pages on every push to `main` and once a day. The game repository can be changed with the
`GAME_REPOSITORY` and `GAME_REF` repository variables.

### Layout

| Path | What |
|---|---|
| `scripts/build-palette.mjs` | Reads tile and entity prototypes, resolves inheritance, builds `palette.json`, `atlas.png`, `credits.json` |
| `scripts/palette-coverage.mjs` | Checks the palette against the game's station maps |
| `src/modes.ts` | Mode definitions: layers, file suffix, defaults |
| `src/document.ts` | Document model and file formats |
| `src/storage.ts` | Autosave (IndexedDB, one slot per mode) |
| `src/station/` | Game map reader (`mapfile.ts`), import, export, new-station template, station autosave |
| `src/modules.ts`, `src/project.ts` | Module library and project files |
| `src/randomsets.ts` | Random sets |
| `src/gamefolder.ts` | Linked game server data folder |
| `scripts/station-roundtrip.ts` | Round-trip test of station import/export against the game's maps |
| `src/editor.ts` | Editor state, edits, undo/redo, checks |
| `src/view.ts` | Canvas rendering, camera and tool input |
| `src/ui.ts` | Side panels and top bar |
| `docs/format.md` | File format reference |

## Licenses

Code in this repository is MIT licensed (see [LICENSE](LICENSE)).

Sprites shown in the editor come from the game repository and keep their original licenses, mostly CC-BY-SA 3.0.
The editor's **Credits** dialog lists the source, license and copyright of every sprite used.
