# Documentation

| Document | For | Contents |
|---|---|---|
| [user-guide.md](user-guide.md) | Domain makers | Layers, tools, markers, checks, shortcuts, saving |
| [game-integration.md](game-integration.md) | Game developers, domain makers | How a `.domain.json` becomes a rift in the game; `RecipeDungeon` reference implementation, YAML, testing |
| [format.md](format.md) | Anyone reading or writing files | File format reference, version 1 |
| [domain.schema.json](domain.schema.json) | Tools and CI | JSON Schema for version 1 files |
| [palette.md](palette.md) | Editor developers | How the palette is built from the game repository, and the CI that deploys it |
| [architecture.md](architecture.md) | Editor developers | Code layout, data flow, undo, how to add markers, checks and tools |

## Quick path: from editor to game

1. Build the domain in the editor until the **Checks** panel is clean ([user-guide.md](user-guide.md)).
2. **Save** to get `<name>.domain.json`.
3. Put it in the game repository under `Resources/Domains/` ([game-integration.md](game-integration.md#step-1-put-the-file-in-the-game-repository)).
4. Point a Qlippoth at it with `dungeon: !type:RecipeDungeon` ([step 3](game-integration.md#step-3-point-a-qlippoth-at-the-file)).

Step 4 needs the game-side `RecipeDungeon`, which is not in the game yet; [step 2](game-integration.md#step-2-add-recipedungeon-to-the-game) of the integration guide has the code to add it.
