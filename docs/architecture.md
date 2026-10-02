# Architecture

A guide to the editor's code for contributors. The editor is a static site: Vite, TypeScript, plain DOM and one
canvas. There is no framework, no backend and no runtime dependency.

## Files

| File | Role |
|---|---|
| `index.html` | Page shell with `<div id="app">` |
| `src/main.ts` | Startup, actions (new/open/save), dialogs, autosave, keyboard shortcuts |
| `src/document.ts` | `DomainDocument` model, `serialize` / `parseDocument`, format constants |
| `src/brush.ts` | The `Brush` union (fixed, list) and everything that depends on its shape |
| `src/migrate.ts` | Upgrades older file versions step by step |
| `src/lists.ts` | Random lists: model, `.list.json` read/write, ids |
| `src/resolve.ts` | The seeded roll of list cells ([randomness.md](randomness.md)); shared spec with the game |
| `src/listsDialog.ts` | The Lists dialog: create, edit, chances, import, export |
| `src/builtinLists.ts` | Bundles the read-only lists in `lists/` |
| `src/listFolder.ts` | The lists folder: saving lists into a folder on disk (File System Access API), remembered in IndexedDB |
| `src/assets.ts` | Bundles and preloads list symbols (`assets/list-symbols/`) and map effects (`assets/effects/`) |
| `lists/`, `assets/` | Built-in lists and editor art; added by dropping files in, see their READMEs |
| `src/editor.ts` | `Editor`: state, edits, undo/redo, change notifications, checks |
| `src/view.ts` | `MapView`: canvas rendering, camera, mouse input for tools |
| `src/ui.ts` | Left sidebar (tools, layers, view, checks), palette panel, top bar |
| `src/palette.ts` | Loads `palette.json` + `atlas.png`, marker definitions |
| `src/dom.ts` | `h()` element helper and `clear()` |
| `src/style.css` | All styles |
| `scripts/build-palette.mjs` | Node script that builds the palette from the game (see [palette.md](palette.md)) |
| `scripts/check-domains.mjs` | Node script that checks the domain files in the game checkout |
| `scripts/game-dir.mjs` | Finds the game checkout, next to this repository by default |
| `scripts/sync-lists.mjs` | Copies the built-in lists into the game checkout |
| `scripts/check-list-changes.mjs` | List guard: compares the lists of a pull request with its base branch |
| `scripts/lists-common.mjs` | Dependency-free helpers shared by the list scripts |
| `.github/workflows/lists-guard.yml` | Runs the list guard on pull requests that touch `lists/` |
| `.github/workflows/check-game-domains.yml` | Reusable workflow the game repository calls to check its domain and list files |

## Data flow

```
 palette.json + atlas.png ──loadPalette()──► Palette
                                               │
 autosave / file ──deserialize()──► DomainDocument ──► Editor ──emit(topics)──► ui.ts panels
                                               ▲          │                 └─► MapView (canvas)
              user input (view.ts, ui.ts) ─────┘          └──serialize()──► Save / autosave
```

### Document

`DomainDocument` holds the name, size and one sparse `Map<"x,y", Brush>` per layer. A `Brush` is
`{ kind: "fixed", id }` or `{ kind: "list", list, group? }` (see `src/brush.ts`). `serialize` writes cells sorted by
`y`, then `x`, with the lowest format version that holds them. `parseDocument` upgrades older versions, rejects newer
ones, and reports the cells it drops (out of bounds, unknown brush kind, list brushes on the marker layer).

### Random lists

Lists are not part of the document: `Editor.lists` holds the built-in lists (`builtIn: true`, read-only: `setList`
and `removeList` refuse them) and the user's library (stored in `localStorage`, imported or exported as `.list.json`
files), and cells refer to lists by id. Chances in the dialog are a view of the weights (`chances`, `setEntryChance`
in `src/lists.ts`); the empty choice is an entry with `id: null`. `Editor.strokeBrush()` gives each stroke its own
`group` when *Same pick* is on; `linkSelection()` does the same for a selection. `previewCells()` runs
`resolveDocument` for the preview seed and caches it until the document or the lists change.

### Editor and undo

Every edit goes through `Editor.apply(change)`. A change is one of:

- `cell`: one cell on one layer, before and after,
- `size`: width and height before and after,
- `name`: before and after.

Changes are grouped into **strokes** (`beginStroke` / `endStroke`): one brush drag, one rectangle, one fill or one
resize is one undo step. Undo applies the inverted changes of a stroke in reverse order. The stack keeps 500 strokes.

`revision` counts edits and `savedRevision` remembers the revision at the last save; `dirty` compares them.

### Change notifications

`Editor.emit(...topics)` queues topics and delivers them once per microtask, so many cell changes in one stroke cause
one update. Topics:

| Topic | Emitted when |
|---|---|
| `cells` | Any cell changed |
| `document` | Name or size changed, or a new document was loaded |
| `selection` | Active layer, tool or selected item changed |
| `view` | Grid, dimming or layer visibility changed |
| `history` | Undo/redo stacks or the saved state changed |
| `lists` | A list was added, changed or removed |

Panels subscribe and redraw only for the topics they show. Checks are re-run 150 ms after the last cell change.

### View

`MapView` draws to one canvas, scaled for the device pixel ratio. A cell is 32 px at zoom 1; zoom is limited to
0.25–4. The view flips `y`, so the bottom row of the document is drawn at the bottom of the screen. Painting with a fast
drag fills the gap between mouse events with a Bresenham line.

## Rules

From [CONTRIBUTING.md](../CONTRIBUTING.md):

- Keep the editor fully client-side: no backend, no tracking, no requests other than its own files.
- Any file format change bumps `FORMAT_VERSION` in `src/document.ts` and updates [format.md](format.md). The game
  reader ([game-integration.md](game-integration.md)) must be updated in the same release.
- `npm run build` (type check + build) must pass; CI runs the same command.
- Do not commit `public/palette/`.

## Adding things

**A new marker:** add it to `MARKERS` in `src/palette.ts`, document it in [format.md](format.md), and teach the game's
`RecipeDungeon` what to do with it. Markers need no format version bump, but older game readers will warn about them.

**A new check:** add it to `Editor.validate()` in `src/editor.ts`. Return `at` when the problem has a position so the
warning can be clicked. If the game must enforce it too, add it to `QlippothDomainFile.Validate` on the game side.

**A new tool:** add it to `TOOLS` and `TOOL_INFO` in `src/editor.ts` (pick a free key) and handle it in the
`pointerdown` handler in `src/view.ts`. Wrap multi-cell edits in one stroke.

**A new brush kind:** extend the `Brush` union in `src/brush.ts` and let the type checker lead you through the switches
there, add it to `parseBrush`, bump `FORMAT_VERSION` with a step in `src/migrate.ts`, make `requiredVersion` return the
new version when the kind is used, and update [format.md](format.md), the schema, the fixtures and the game reader.
