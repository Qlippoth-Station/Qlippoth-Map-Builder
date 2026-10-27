# File formats

The editor reads and writes two kinds of file. The `format` field decides which mode a file opens in.

| Mode | `format` | Current `version` | Extension | Layers |
|---|---|---|---|---|
| Domain | `qlippoth-domain` | 2 | `.domain.json` | `floor`, `structure`, `object`, `marker` |
| Station | `qlippoth-station` | 1 | `.station.json` | `floor`, `structure`, `object` |

Both share the structure below. The station file is a working file for the editor; the game will get station maps
as its own map `.yml` files once export lands (see the README roadmap).

## Domain file

```json
{
  "format": "qlippoth-domain",
  "version": 2,
  "name": "Yellow Palace",
  "width": 20,
  "height": 15,
  "entry": { "mode": "cohort", "cohort": 3, "loop": true },
  "layers": {
    "floor":     { "0,0": { "kind": "fixed", "id": "FloorSteel" } },
    "structure": { "0,1": { "kind": "fixed", "id": "WallSolid" } },
    "object":    {},
    "marker":    {
      "10,1": { "kind": "fixed", "id": "Entry", "order": 1 },
      "3,12": { "kind": "fixed", "id": "Entry", "order": 2 }
    }
  }
}
```

### Entries

A domain has one or more `Entry` markers: the portals the Q-Gate drops players at. Each has an `order`
(1, 2, 3, ... without gaps). `entry` says how arriving players are spread over them:

| `mode` | Behaviour |
|---|---|
| `random` | Every player arrives at a random Entry. `order` is ignored. |
| `order` | The first player goes to Entry 1, the second to Entry 2, and so on; after the last Entry it starts again at Entry 1. |
| `cohort` | Like `order`, but each Entry takes `cohort` players (1-99) before the next one is used. After the last Entry it starts again at Entry 1 when `loop` is `true`; when `false` the Q-Gate stops accepting players. |

Version 1 domain files have no `entry` and no `order`. They read as `random`, with orders given bottom-to-top,
then left-to-right. Editors write version 2.

## Coordinates

Cells are keyed `"x,y"`. The origin is the **bottom-left** cell and `y` grows **upwards**, the same as game grids.
Keys are written sorted by `y`, then `x`, so files diff cleanly.

## Layers

| Layer | `id` refers to |
|---|---|
| `floor` | a tile prototype id |
| `structure` | an entity prototype id (walls, doors, windows) |
| `object` | an entity prototype id (everything else) |
| `marker` | an editor marker: `Entry` (with `order`), `QlippothSpot`, `Objective`, `Connection` |

A cell may hold one item per layer. Missing keys are empty cells.

## Brushes

Only fixed brushes exist so far:

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
