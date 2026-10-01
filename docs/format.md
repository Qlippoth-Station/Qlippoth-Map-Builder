# Domain file format (version 1)

A domain file is JSON with the `.domain.json` extension.
Its machine-readable schema is [`format.schema.json`](format.schema.json), and [`fixtures/`](../fixtures) holds example
files that every reader should handle identically.

```json
{
  "format": "qlippoth-domain",
  "version": 1,
  "name": "Yellow Palace",
  "width": 20,
  "height": 15,
  "layers": {
    "floor":     { "0,0": { "kind": "fixed", "id": "FloorSteel" } },
    "structure": { "0,1": { "kind": "fixed", "id": "WallSolid" } },
    "object":    {},
    "marker":    { "10,1": { "kind": "fixed", "id": "Entry" } }
  }
}
```

## Coordinates

Cells are keyed `"x,y"`. The origin is the **bottom-left** cell and `y` grows **upwards**, the same as game grids.
Keys are written sorted by `y`, then `x`, so files diff cleanly.

## Layers

| Layer | `id` refers to |
|---|---|
| `floor` | a tile prototype id |
| `structure` | an entity prototype id (walls, doors, windows) |
| `object` | an entity prototype id (everything else) |
| `marker` | an editor marker: `Entry`, `QlippothSpot`, `Objective`, `Connection` |

A cell may hold one item per layer. Missing keys are empty cells.

## Brushes

Version 1 only has fixed brushes:

```json
{ "kind": "fixed", "id": "FloorSteel" }
```

Later versions will add set brushes with random modes (weak / default / full / chance) and roll scopes (cell / group / map).

## Versions

`version` is a positive integer that grows by one with every change to the format.

- Readers **must reject** files with a `version` newer than they know.
- Readers **should accept** older versions by upgrading them step by step (1 → 2 → 3 …).
  The editor does this in `src/migrate.ts`; each step only rewrites raw JSON, so old files keep opening.
- The editor always writes the newest version. Opening and saving an old file upgrades it.
- When reading, the editor drops cells it cannot use (outside the map, bad key, unknown brush, unknown layer)
  and tells the user what was dropped.
