# Domain file format (version 1)

A domain file is UTF-8 JSON with the `.domain.json` extension. It is written by the editor and read by the game
(see [game-integration.md](game-integration.md)). A machine-readable [JSON Schema](domain.schema.json) is included,
and [`fixtures/`](../fixtures) holds example files that every reader should handle identically.

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

## Top-level fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `format` | string | yes | Always `"qlippoth-domain"` |
| `version` | integer | yes | Format version, `1` for this document |
| `name` | string | no | Display name. Defaults to `"Untitled"` when missing |
| `width` | integer | yes | Number of columns, 1 to 256 |
| `height` | integer | yes | Number of rows, 1 to 256 |
| `layers` | object | yes | One object per layer: `floor`, `structure`, `object`, `marker`. A missing layer means an empty layer |

## Coordinates

Cells are keyed `"x,y"` with integers in base 10, no spaces: `"0,0"`, `"12,3"`.

- The origin `"0,0"` is the **bottom-left** cell and `y` grows **upwards**, the same as game grid indices.
  The game uses the key as the tile index directly, without flipping.
- `0 ≤ x < width` and `0 ≤ y < height`.
- Entities and markers sit at the **center** of their cell: `(x + 0.5, y + 0.5)` in grid coordinates.

Keys are written sorted by `y`, then `x`, so files diff cleanly. Readers must not depend on the order.

## Layers

| Layer | `id` refers to | Game action |
|---|---|---|
| `floor` | a tile prototype id | Tile set at the cell |
| `structure` | an entity prototype id (walls, doors, windows) | Entity spawned at the cell center |
| `object` | an entity prototype id (everything else) | Entity spawned at the cell center |
| `marker` | an editor marker id | Read by the game builder, nothing is spawned for the marker itself |

A cell holds at most one item per layer. Missing keys are empty cells. A cell with no `floor` entry is space in the game.

Which entities go to `structure` and which to `object` is decided by the palette builder from the prototype's folder
(see [palette.md](palette.md)). The game treats both layers the same way; the split exists for editing.

## Markers

| Id | Count | Meaning |
|---|---|---|
| `Entry` | exactly 1 | Where the Q-Gate drops players |
| `QlippothSpot` | at least 1 (the first is used) | Where the Qlippoth is spawned |
| `Objective` | any | A rift objective is placed here. Which one is chosen by the Qlippoth's dungeon settings, in marker order |
| `Connection` | any | A doorway other templates can attach to. Reserved for stage 3; ignored by the game for now |

"Marker order" is the same as key order: by `y`, then `x`. "First" also means first in this order.

## Brushes

Version 1 only has fixed brushes: the cell always becomes the given id.

```json
{ "kind": "fixed", "id": "FloorSteel" }
```

| Field | Type | Meaning |
|---|---|---|
| `kind` | `"fixed"` | Brush kind |
| `id` | string | Tile id, entity id or marker id, depending on the layer |

Later versions will add set brushes with random modes (weak / default / full / chance) and roll scopes (cell / group / map).

## Not in version 1

Atmosphere, gravity, lighting and entity rotation are not stored. The game decides them. Storing the atmosphere is
proposed in [atmosphere.md](atmosphere.md).

## Rules for readers

- Reject files whose `format` is not `"qlippoth-domain"`.
- Reject files whose `version` is newer than they know. Do not guess. Older versions are upgraded (see Versioning).
- The editor ignores cells outside the size and brushes of unknown kind when opening a file. The game reader is
  stricter and rejects the file, because a game file should never contain them.
- Unknown ids (renamed or removed prototypes) are reported, not fatal. The editor shows them in Checks; the game skips the cell and logs a warning.

## Rules for writers

- Write all four layers, even if empty.
- Sort keys by `y`, then `x`.
- Two-space indentation and a trailing newline, so files written by hand and by the editor look the same.

## Validation checklist

A file is ready for the game when:

1. it passes the [JSON Schema](domain.schema.json),
2. there is exactly one `Entry` and at least one `QlippothSpot`,
3. every marker stands on a floor tile and not inside a wall,
4. every id exists in the game (the editor's Checks panel and the game's integration test both check this),
5. the Qlippoth using it has at least one objective (an `Objective` marker or an objective entity).

## Versioning

`version` is a positive integer that grows by one with every change to the format.

- Readers **must reject** files with a `version` newer than they know.
- Readers **should accept** older versions by upgrading them step by step (1 → 2 → 3 …).
  The editor does this in `src/migrate.ts`; each step only rewrites raw JSON, so old files keep opening.
- The editor always writes the newest version. Opening and saving an old file upgrades it.
- When opening a file, the editor tells the user which cells it had to drop (outside the map, bad key, unknown
  brush, unknown layer).

| Version | Editor | Changes |
|---|---|---|
| 1 | 0.1.0 | First version: fixed brushes, four layers, four markers |
| 2 | planned | Optional top-level `atmosphere` ([atmosphere.md](atmosphere.md)) and random brushes (roadmap stage 2) |

Any change to the format bumps `FORMAT_VERSION` in `src/document.ts`, adds an upgrade step in `src/migrate.ts` and a
row here, and needs a matching change in the game reader. New marker ids are not a format change, but older game readers will warn about them.
