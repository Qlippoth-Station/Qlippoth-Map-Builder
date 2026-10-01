# Domain file format (version 1)

A domain file is JSON with the `.domain.json` extension.

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
Readers must reject files whose `version` they do not know.
