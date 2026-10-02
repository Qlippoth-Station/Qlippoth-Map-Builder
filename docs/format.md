# Domain file format (versions 1 and 2)

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
| `version` | integer | yes | Format version: `1`, or `2` when the file uses random lists |
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

A cell holds a brush. Version 1 only has **fixed** brushes: the cell always becomes the given id.

```json
{ "kind": "fixed", "id": "FloorSteel" }
```

| Field | Type | Meaning |
|---|---|---|
| `kind` | `"fixed"` | Brush kind |
| `id` | string | Tile id, entity id or marker id, depending on the layer |

Version 2 adds **list** brushes: the cell becomes one entry of a [random list](#list-files), picked when the game
builds the rift. Markers are always fixed.

```json
{ "kind": "list", "list": "weak_walls" }
{ "kind": "list", "list": "weak_walls", "group": 1 }
```

| Field | Type | Meaning |
|---|---|---|
| `kind` | `"list"` | Brush kind |
| `list` | string | Id of the list (lowercase snake_case), the same as its file name without `.list.json` |
| `group` | integer ≥ 1, optional | Cells on the same layer with the same `list` and `group` always get the same entry. Without it the cell rolls on its own |

How the entry is picked is specified in [randomness.md](randomness.md).

## List files

A random list is its own file, `<id>.list.json`, so it can be shared, reused by many domains and reviewed in pull
requests next to them. In the game repository list files live in `Resources/Domains/Lists/`.
Schema: [list.schema.json](list.schema.json).

**Built-in lists** are the list files in `lists/` of the editor repository. They ship with the editor, cannot be
changed there, and their ids cannot be used by other lists (see [lists/README.md](../lists/README.md)).

```json
{
  "format": "qlippoth-list",
  "version": 1,
  "id": "weak_walls",
  "name": "Weak walls",
  "layer": "structure",
  "icon": { "glyph": "W", "color": "#c0803a" },
  "entries": [
    { "id": "WallSolid", "weight": 3 },
    { "id": "Grille", "weight": 1 }
  ]
}
```

Version 2 of the list format adds the empty choice and symbol icons:

```json
"icon": { "symbol": "crate", "glyph": "C", "color": "#8a6a3a" },
"entries": [
  { "id": "CrateGenericSteel", "weight": 1 },
  { "empty": true, "weight": 2 }
]
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `format` | string | yes | Always `"qlippoth-list"` |
| `version` | integer | yes | List format version: `1`, or `2` when the list has an empty choice or a symbol. The editor writes the lowest that fits |
| `id` | string | yes | Lowercase snake_case. Must match the file name. Domains refer to the list by it |
| `name` | string | no | Display name in the editor |
| `layer` | string | yes | `floor` (entries are tile ids), `structure` or `object` (entries are entity ids). A list is only used on its layer |
| `icon` | object | no | How list cells are drawn in the editor; the game ignores it. `glyph`: 1–2 characters, `color`: `#rrggbb`, `symbol` (version 2): file name of an image in the editor's `assets/list-symbols/`, shown instead of the glyph when it exists |
| `entries` | array | yes | The choices, in order. Each is `{ "id": ..., "weight": ... }` (a tile or entity id) or, in version 2, at most one `{ "empty": true, "weight": ... }` that leaves the cell empty. `weight` is a whole number from 1 to 1000 (default 1); an entry with weight 3 is picked three times as often as one with weight 1 |

List format versions: `1` (editor 0.2.0) holds items only; `2` (editor 0.3.0) adds the empty choice and `icon.symbol`.
Readers must reject list versions newer than they know, like domain versions.

## Not stored

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
   including every entry of every list the file uses, and those list files are in the game too,
5. the Qlippoth using it has at least one objective (an `Objective` marker or an objective entity).

## Versioning

`version` is a positive integer that grows by one with every change to the format.

- Readers **must reject** files with a `version` newer than they know.
- Readers **should accept** older versions by upgrading them step by step (1 → 2 → 3 …).
  The editor does this in `src/migrate.ts`; each step only rewrites raw JSON, so old files keep opening.
- The editor writes the **lowest** version that can hold the domain: version 1 while no random list is used, version 2
  otherwise. Readers that only know version 1 keep working for domains without lists.
- When opening a file, the editor tells the user which cells it had to drop (outside the map, bad key, unknown
  brush, unknown layer).

| Version | Editor | Changes |
|---|---|---|
| 1 | 0.1.0 | First version: fixed brushes, four layers, four markers |
| 2 | 0.2.0 | `list` brushes with optional `group`, referring to `.list.json` files ([randomness.md](randomness.md)) |
| 3 | planned | Optional top-level `atmosphere` ([atmosphere.md](atmosphere.md)) |

Any change to the format bumps `FORMAT_VERSION` in `src/document.ts`, adds an upgrade step in `src/migrate.ts` and a
row here, and needs a matching change in the game reader. New marker ids are not a format change, but older game readers will warn about them.
