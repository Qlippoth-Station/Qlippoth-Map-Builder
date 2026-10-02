# License of the editor art

Everything in `assets/` (list symbols, map effects and any other images added here) is licensed under the
**Creative Commons Attribution-ShareAlike 3.0 Unported** license (CC-BY-SA 3.0):
https://creativecommons.org/licenses/by-sa/3.0/ (legal code: https://creativecommons.org/licenses/by-sa/3.0/legalcode).

This is the same license most Space Station 14 sprites use, so the art can also be used in the game.

You may share and adapt it, also commercially, as long as you:

- **give credit**: name the authors listed in [`credits.json`](credits.json) and link this license,
- **share alike**: release your changed versions under CC-BY-SA 3.0 too.

The editor's **Credits** dialog shows the author and license of every file.

The source code of this repository is MIT licensed (see [`../LICENSE`](../LICENSE)); this file only covers `assets/`.

## Adding art

1. Add the image (see the README in its folder for sizes and style).
2. Add an entry for it to [`credits.json`](credits.json):

   ```json
   { "source": "assets/list-symbols/weak-wall.png", "license": "CC-BY-SA-3.0", "copyright": "Drawn by <your name> (<GitHub user>)" }
   ```

   For a changed version of someone else's file, keep their name: `"Drawn by <original>, modified by <you>"`.
3. Only add art you made yourself or that is already CC-BY-SA 3.0 (or compatible: CC-BY 3.0, CC0) with its original
   credit. By adding a file you agree to release it under CC-BY-SA 3.0.

`npm test` fails when an image in `assets/` has no `credits.json` entry, an entry points to a missing file, or an entry
has another license or no copyright.
