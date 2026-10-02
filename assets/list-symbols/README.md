# List symbols

Icons a random list can show on the map instead of a letter. Every image file in this folder is a symbol; its file
name without the extension is the symbol id that list files store (`"icon": { "symbol": "bricks", ... }`).

## Adding symbols

1. Draw the symbol at **32 × 32 px** (PNG) or as an **SVG** with a 32 × 32 view box.
2. Draw it **white or light on a transparent background**. The editor puts it on the list's color, so one symbol works
   for lists of any color. Leave about 4 px of margin; the editor draws dice dots in the bottom-left corner and the
   group number in the top-right corner.
3. Name the file in lowercase with `-` or `_` between words: `weak-wall.png`, `crate.svg`. The name is the id, so do not
   rename a symbol once lists use it (those lists fall back to their letter).
4. Supported: `.png`, `.svg`, `.webp`. No code change is needed; the editor picks the files up when it is built.

`bricks.svg`, `crate.svg` and `floor-tiles.svg` are placeholders. Replace or delete them when the real set is ready,
and update their entries in `../credits.json`.

## License

Symbols are licensed under **CC-BY-SA 3.0** ([../LICENSE.md](../LICENSE.md)). Add every new file to
[`../credits.json`](../credits.json) with its author; `npm test` checks this. Do not copy game sprites here: they are
already shown through the palette and keep their own credits there.
