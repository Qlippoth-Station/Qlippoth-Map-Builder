# Qlippoth Domain Builder

A browser-based, visual editor for the rift domains of [Qlippoth Station](https://github.com/Qlippoth-Station/Qlippoth-station-14).
Contributors paint domains and templates cell by cell with real game sprites, then save them as `.json` files the game reads.

Everything runs in the browser. Nothing is uploaded anywhere; work is autosaved in your own browser and shared as files.

## Using it

1. Pick a layer (Floor, Structure, Object, Marker).
2. Pick an item from the palette on the right.
3. Paint with Brush, Rectangle or Fill. Right click picks what is under the cursor.
4. Place one **Entry** and one **Qlippoth spot** marker. The *Checks* panel lists anything that is missing.
5. **Save** downloads a `.domain.json` file. Open it again later or add it to a pull request.

Press `?` in the editor for all shortcuts.

## Roadmap

Listed in the order the work is done.

| Stage | Contents | Status |
|---|---|---|
| 1 | Palette from game data, layered grid editor, fixed brushes, save/open, checks | ✅ |
| 0 | Groundwork: tests in CI, JSON schema, format fixtures, version upgrades, brush logic in one module | ✅ |
| 4a | Game side, first slice: `RecipeDungeon` reads version 1 files (fixed brushes and markers); file location decided | ⏳ |
| 2 | Tile sets and random modes (weak / default / full / chance) with roll scope (cell / group / map), seeded preview. Starts with a written randomness spec and seeded test vectors shared with the game | ⏳ |
| 3 | Templates, template sets, connection points, rotate/mirror, compatibility checks | ⏳ |
| 4b | Game side: reads stage 2 and 3 files and resolves randomness with the same seeded RNG, checked against the shared test vectors | ⏳ |
| 5 | Fully random domains built from the same template library | ⏳ |

## Development

Requires Node.js 22+ and a checkout of the game repository.

```bash
npm install
npm run palette -- --game ../Qlippoth-station-14   # builds public/palette from the game files
npm run dev
```

`npm test` runs the unit tests. `npm run build` type-checks and produces `dist/`. Neither needs the palette.

The palette (`public/palette/`) is generated, not committed. CI checks out the game repository, rebuilds the palette
and deploys to GitHub Pages on every push to `main` and once a day. The game repository can be changed with the
`GAME_REPOSITORY` and `GAME_REF` repository variables.

### Layout

| Path | What |
|---|---|
| `scripts/build-palette.mjs` | Reads tile and entity prototypes, resolves inheritance, builds `palette.json`, `atlas.png`, `credits.json` |
| `src/document.ts` | Domain document model and file format |
| `src/brush.ts` | Brush kinds and everything that depends on their shape |
| `src/migrate.ts` | Upgrades older file versions to the current one |
| `src/editor.ts` | Editor state, edits, undo/redo, checks |
| `src/view.ts` | Canvas rendering, camera and tool input |
| `src/ui.ts` | Side panels and top bar |
| `docs/format.md` | File format reference |
| `docs/format.schema.json` | JSON schema of the file format |
| `fixtures/` | Example files shared by the editor's and the game's tests |
| `src/*.test.ts` | Unit tests (Vitest) |

## Licenses

Code in this repository is MIT licensed (see [LICENSE](LICENSE)).

Sprites shown in the editor come from the game repository and keep their original licenses, mostly CC-BY-SA 3.0.
The editor's **Credits** dialog lists the source, license and copyright of every sprite used.
