# Contributing

## Adding domains or templates

1. Build it in the editor and **Save** the `.domain.json` file.
2. Open a pull request in the game repository with the file (location will be documented once the game side exists).
3. Make sure the *Checks* panel is clean, or explain in the PR why a warning is fine.

## Changing the editor

- Keep the editor fully client-side: no backend, no tracking, no external requests besides its own files.
- Any change to the file format needs a `version` bump in `src/document.ts` and an update to `docs/format.md`.
- Run `npm run build` before opening a pull request; CI runs the same command.
- Do not commit `public/palette/`; it is generated from the game repository.
