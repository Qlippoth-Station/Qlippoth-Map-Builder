# Map effects

Overlays the editor draws on the map. Files are picked up by name when the editor is built; when a file is missing,
the editor falls back to its built-in drawing, so every file here is optional.

| File | Drawn on | Fallback |
|---|---|---|
| `group.png` (or `.svg`, `.webp`) | Every random list cell that belongs to a group ("Same pick for the whole stroke", `L`), on top of the list icon | Nothing extra; groups still get their colored outline and number |

## `group.png`

- **32 × 32 px**, scaled with the zoom (nearest neighbour, so pixel art stays sharp).
- **Transparent or semi-transparent**: the list icon under it must stay readable. A hatch, a sheen or a soft frame works
  well; a solid fill does not.
- Every group also gets an outline around its cells in its own color, so the effect does not need to show where a
  group ends.
