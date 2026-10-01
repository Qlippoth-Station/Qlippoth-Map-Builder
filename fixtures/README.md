# Format fixtures

Example domain files that every reader of the format must handle the same way: the editor's tests load them,
and the game's `RecipeDungeon` loader should use the same files in its own tests.

| File | What it checks |
|---|---|
| `v1-basic.domain.json` | A small valid version 1 file with all four layers. Serializing it again must give the identical text. |

Once random brushes exist (roadmap stage 2), this folder will also hold seeded test vectors:
a file, a seed and the expected resolved grid, so the editor preview and the game resolve randomness identically.
