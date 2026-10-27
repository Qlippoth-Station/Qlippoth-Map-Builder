# File formats (version 1)

The editor reads and writes two kinds of file. The `format` field decides which mode a file opens in.

| Mode | `format` | Extension | Layers |
|---|---|---|---|
| Domain | `qlippoth-domain` | `.domain.json` | `floor`, `structure`, `object`, `marker` |
| Station | `qlippoth-station` | `.station.json` | `floor`, `structure`, `object` |

Both share the structure below. The station file is a working file for the editor; the game will get station maps
as its own map `.yml` files once export lands (see the README roadmap).

## Domain file

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

## Station file

Same structure as a domain file, with `"format": "qlippoth-station"` and no `marker` layer:

```json
{
  "format": "qlippoth-station",
  "version": 1,
  "name": "Medbay",
  "width": 64,
  "height": 64,
  "layers": { "floor": {}, "structure": {}, "object": {} }
}
```
