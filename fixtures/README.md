# Format fixtures

Example files that every reader of the format must handle the same way: the editor's tests load them,
and the game's `RecipeDungeon` loader should use the same files in its own tests.

| File | What it checks |
|---|---|
| `v1-basic.domain.json` | A small valid version 1 file with all four layers. Serializing it again must give the identical text. |
| `v2-lists.domain.json` | A version 2 file with random list cells, with and without groups, on two layers. Round-trips byte for byte. |
| `lists/*.list.json` | The lists that file uses. `mixed_floor` has weights 5 / 2 / 1; `maybe_crate` (list format version 2) has an empty choice. |
| `v2-lists.rolls.json` | Test vectors for [randomness.md](../docs/randomness.md): `hash32` of a few strings, and the item every list cell must get for seeds 0, 1, 12345 and 4294967295 (`null`: the empty choice was picked). |

`v2-lists.rolls.json` is the contract between the editor's random preview and the game: both must reproduce it exactly.
If it ever has to change, the roll changed, which is a format change.
