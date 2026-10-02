# Built-in lists

**This folder is the source of truth for built-in lists.** The game gets copies (`npm run lists:sync`); change a list
here, never only in the game.

The `.list.json` files here ship with the editor. Everyone sees them in the palette, and they **cannot be changed or
removed in the editor**: they are part of the game, and domains rely on them staying the same. To change one, edit the
file here in a pull request.

## Adding a built-in list

1. Make the list in the editor (**Lists → New list**) and **Export .list.json**, or copy a user's list from a pull request.
2. Put the file here. The file name must be the list id: `weak_walls.list.json` for `"id": "weak_walls"`.
3. Run `npm test`: it fails if a file is not a valid list, its name does not match its id, or two files share an id.
4. Copy it to the game as well (`Resources/Domains/Lists/`), or run `npm run lists:sync` with the game checked out
   next to this repository. `npm run domains` reports a game list that differs from the built-in one.

Users cannot import or create a list with a built-in id, so a built-in id always means this file.

## Changing a built-in list

A pull request that changes the entries (or their order or weights) of an existing list here fails the
**Built-in lists guard** check (`.github/workflows/lists-guard.yml`) until a maintainer adds the
`list-change-approved` label. New lists and changes to only the name or icon pass. The run summary lists what changed.

Changing a built-in list changes every domain that uses it the next time a rift is built, so prefer adding a new list
over changing the entries of one that domains already use.

`weak_walls`, `strong_walls` and `mixed_floor` are starter lists (the same as the test fixtures). Check their entries
against the game design before relying on them.
