# Contributing

## Adding domains or templates

1. Build it in the editor and **Save** the `.domain.json` file.
2. Open a pull request in the game repository with the file under `Resources/Domains/`. See [docs/game-integration.md](docs/game-integration.md) for how the game loads it.
3. If it uses random lists, add their `.list.json` files directly under `Resources/Domains/Lists/` in the same PR.
   With the lists folder connected (Chrome, Edge) **Save** puts them there; otherwise use **Lists → Export lists used
   by this domain**. Reuse existing lists where you can; a new list needs an id that is not taken yet.
   Changing an existing list changes every domain that uses it: CI fails such a PR until a maintainer adds the
   `list-change-approved` label, so prefer a new list.
4. Make sure the *Checks* panel is clean, or explain in the PR why a warning is fine.
5. With the game and this repository side by side in one folder, `npm run domains` checks every domain file in the game
   checkout the same way.

## Changing the editor

- Keep the editor fully client-side: no backend, no tracking, no external requests besides its own files.
- Any change to the file format needs, in the same pull request:
  - a `version` bump (`FORMAT_VERSION` in `src/document.ts`),
  - an upgrade step from the previous version in `src/migrate.ts`, with a test,
  - updates to `docs/format.md`, `docs/domain.schema.json` and, where useful, a new file in `fixtures/`.
- A new brush kind is added in `src/brush.ts`; the type checker then points at every switch that has to handle it.
- Built-in lists (`lists/`) and editor art (`assets/`) are added by dropping files in; see the README in each folder.
  Art in `assets/` is CC-BY-SA 3.0: add an entry with your name to `assets/credits.json`
  ([assets/LICENSE.md](assets/LICENSE.md)). Contributing art means releasing it under that license.
  `npm test` validates the built-in lists.
- Run `npm test` and `npm run build` before opening a pull request; CI runs the same commands.
- Do not commit `public/palette/`; it is generated from the game repository.
