# Palette

The palette is the list of tiles and entities the editor offers, with one icon each. It is generated from the game
repository by `scripts/build-palette.mjs`, so the editor always offers what the game has.

## Building it

```bash
npm run palette -- --game ../Qlippoth-station-14
# or
QLIPPOTH_GAME_DIR=../Qlippoth-station-14 npm run palette
```

The game checkout only needs `Resources/Prototypes`, `Resources/Textures` and `Resources/Locale/en-US`.

Output, in `public/palette/` (git-ignored):

| File | Contents |
|---|---|
| `palette.json` | `version`, `gameCommit`, `iconSize` (32), `atlasColumns`, and `items`: `{ id, name, layer, category, icon }` |
| `atlas.png` | All icons in one image, 32 × 32 each, in a square grid. `icon` is the index into this grid |
| `credits.json` | `{ source, license, copyright }` for every sprite source used |

The script prints how many tiles, structures and objects it found, and lists YAML files it could not parse.

## What is included

### Floor layer: tiles

Every non-abstract `type: tile` prototype under `Resources/Prototypes/Tiles` that has a `sprite`. Parents are merged
in field by field. Subfloor tiles get the category `Subfloor`, others `Floor`. Names come from the `en-US` locale
files when the tile name is a locale key.

### Structure and Object layers: entities

Non-abstract `type: entity` prototypes under `Resources/Prototypes/Entities`, sorted to a layer by folder.
The first matching rule wins:

| Folder under `Entities/` | Layer |
|---|---|
| `Structures/Walls` | structure |
| `Structures/Doors` | structure |
| `Structures/Windows` | structure |
| `Structures/` (everything else) | object |
| `Objects/` | object |
| `Qlippoths/` | object |

Entities in other folders (mobs, clothing, markers…) are left out. So are entities in the `HideSpawnMenu`, `DoNotMap`
or `Debug` categories, because they are hidden in the game's spawn menu too. The rules live in `ENTITY_LAYERS` and
`HIDDEN_CATEGORIES` at the top of the script.

The category shown in the editor is the first two folders, for example `Structures/Walls`.

### Icons

For each entity the script resolves inheritance per component, then picks an icon:

1. `Icon` component sprite and state, else
2. `Sprite` component sprite and state, else
3. the first `Sprite` layer that has a state or sprite.

If the state does not exist in the RSI, the first state is used. The first frame of the south direction is scaled to
fit 32 × 32 with nearest-neighbour sampling. Entities without a usable sprite are left out.

This is close to the game, but not exact: layered sprites show only one layer, and colour tints are not applied.
The icon is only for recognising the item; the game uses its own sprites.

### Markers

`Entry`, `QlippothSpot`, `Objective` and `Connection` are not game prototypes. They are defined in `src/palette.ts`
(`MARKERS`) and drawn as coloured letters.

## In CI

`.github/workflows/deploy.yml` checks out the game repository (sparse: prototypes, textures and locale only), builds
the palette, builds the editor and deploys it to GitHub Pages:

- on every push to `main`,
- every day at 04:00 UTC, so new tiles and entities in the game show up without a change here,
- on demand (`workflow_dispatch`).

Pull requests are built but not deployed.

Repository variables:

| Variable | Default | Use |
|---|---|---|
| `GAME_REPOSITORY` | `Qlippoth-Station/Qlippoth-station-14` | Which game repository to build from |
| `GAME_REF` | default branch | Branch, tag or commit to build from |

The status bar in the editor shows `palette @ <commit>`, the game commit of the deployed palette.

## When an id disappears

If the game renames or removes a prototype, the next palette no longer has it. Domains that use it still open; the
cells show a `?` icon and the Checks panel lists `Unknown … id`. Repaint those cells with the new item and save.
