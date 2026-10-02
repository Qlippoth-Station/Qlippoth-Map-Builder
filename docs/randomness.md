# Random lists and how they are rolled

A **random list** is a named list of tiles or entities, for example *Weak walls* (walls that can be broken) or
*Strong walls* (walls that never can). Instead of a fixed item, a cell can hold "one item from this list". The item is
picked when the game builds the rift, so the same domain looks a bit different every time.

This page is the **specification** of that pick. The editor's random preview (`src/resolve.ts`) and the game reader
must follow it exactly, so a preview seed in the editor shows exactly what the game builds with that seed.

## In the files

A list is its own file, `<id>.list.json` ([format.md → List files](format.md#list-files)):

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
    { "id": "Grille", "weight": 1 },
    { "id": "Girder", "weight": 1 }
  ]
}
```

A list can also have one **empty choice**, `{ "empty": true, "weight": 2 }` (list format version 2): when it is
picked, the cell stays empty. "Maybe a crate" is a list of crates plus an empty choice.

A domain cell refers to a list by id ([format.md → Brushes](format.md#brushes), format version 2):

```json
"2,0": { "kind": "list", "list": "weak_walls" }
"3,0": { "kind": "list", "list": "weak_walls", "group": 1 }
"4,0": { "kind": "list", "list": "weak_walls", "group": 1 }
```

- Without `group`, every cell rolls on its own.
- Cells with the **same layer, same list and same `group`** always get the **same** item. In the editor this is the
  *Same pick for the whole stroke* option and the `L` key on a selection (see the [user guide](user-guide.md#random-lists)).

## The roll

Inputs: a **seed** (unsigned 32-bit integer, chosen by the game for each rift) and the loaded lists.

For each cell holding a list brush:

1. **Roll key.** An ASCII string:
   - without a group: `<layer>/<x>,<y>`, for example `structure/2,0`,
   - with a group: `<layer>/<list>/group<group>`, for example `structure/weak_walls/group1`.

   `<layer>` is `floor`, `structure` or `object`; numbers are base 10 without leading zeros.
2. **Hash input.** `<seed>/<roll key>` with the seed in base 10, for example `12345/structure/weak_walls/group1`.
3. **Hash.** `hash32` of the hash input's bytes (all ASCII), as unsigned 32-bit arithmetic:

   ```
   h = 0x811C9DC5                      // FNV-1a 32-bit
   for each byte b:  h = (h XOR b) * 0x01000193      (mod 2^32)
   h = h XOR (h >> 16)                 // murmur3 finalizer
   h = h * 0x85EBCA6B                  (mod 2^32)
   h = h XOR (h >> 13)
   h = h * 0xC2B2AE35                  (mod 2^32)
   h = h XOR (h >> 16)
   ```
4. **Pick.** `total` is the sum of the weights, the empty choice included. `r = h mod total`. Walk the entries in file
   order and subtract each weight from `r` until `r < weight`; that entry is the pick.
5. **Empty choice picked:** the cell stays empty. For a group, the whole group stays empty.
6. **Missing list or list without entries:** the cell gets nothing (the game logs a warning; the editor's Checks panel reports it).

Fixed cells are not affected. Markers are always fixed.

Reference implementation in C#:

```csharp
public static uint Hash32(string text)
{
    var h = 0x811C9DC5u;
    foreach (var c in text) // ASCII only
    {
        h ^= (byte) c;
        h *= 0x01000193u;
    }
    h ^= h >> 16;
    h *= 0x85EBCA6Bu;
    h ^= h >> 13;
    h *= 0xC2B2AE35u;
    h ^= h >> 16;
    return h;
}

public static string RollKey(string layer, Vector2i cell, string list, int? group) =>
    group is { } g ? $"{layer}/{list}/group{g}" : $"{layer}/{cell.X},{cell.Y}";

// Id is null for the empty choice.
public static string? Pick(IReadOnlyList<(string? Id, int Weight)> entries, uint hash)
{
    var total = 0u;
    foreach (var entry in entries)
        total += (uint) entry.Weight;
    if (total == 0)
        return null;

    var roll = hash % total;
    foreach (var entry in entries)
    {
        if (roll < entry.Weight)
            return entry.Id;
        roll -= (uint) entry.Weight;
    }
    return null;
}

// id = Pick(list.Entries, Hash32($"{seed}/{RollKey(layer, cell, list.Id, group)}"))
```

Use `uint` (C# multiplies `uint` modulo 2^32 in an `unchecked` context, which is the default) and format the seed
with `CultureInfo.InvariantCulture`.

## Why it works this way

- **One hash per cell, no shared random stream.** The pick of a cell depends only on the seed and its own key, not on
  how many other cells were rolled before it. Adding a cell somewhere else never changes the rest of the domain, and
  the order cells are visited in does not matter, so the game and the editor cannot drift apart by iterating
  differently.
- **Groups are just a shared key.** Every cell of a group hashes the same string, so they get the same item without
  any bookkeeping.
- **Integer weights and plain modulo** are easy to port exactly. The bias of `mod` is about `total / 2^32`, which is
  negligible: under 0.003 % even for a list whose weights add up to 100 000.

## Test vectors

[`fixtures/`](../fixtures) holds the vectors every implementation must reproduce:

| File | Contents |
|---|---|
| `fixtures/v2-lists.domain.json` | A domain with ungrouped and grouped list cells on two layers |
| `fixtures/lists/*.list.json` | The four lists it uses: one with weights 5/2/1, and `maybe_crate` with an empty choice |
| `fixtures/v2-lists.rolls.json` | `hashes`: `hash32` of a few strings. `results`: for seeds 0, 1, 12345 and 4294967295, the item every list cell must get, `null` where the empty choice was picked |

The editor's tests (`src/resolve.test.ts`) check these vectors; the game's tests must check the same file.
Changing anything on this page changes the vectors, so it is a format change: bump the version and update the game.

## Chances in the editor

The editor shows each entry's chance in percent and lets you set it with a slider or a number; the others are scaled
so the total stays 100 %. Underneath it is still weights: setting a chance rewrites the weights to add up to 1000, so
0.1 % is the smallest step. The roll above only ever sees weights.

## What lists do not do (yet)

- **No map-wide picks as a setting.** "Every weak wall in the whole domain is the same" is done by putting all those
  cells in one group.
