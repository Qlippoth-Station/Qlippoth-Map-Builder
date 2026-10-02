# Game-side work, step by step

This is the to-do list for the code that has to be written in the **game repository**
([Qlippoth-station-14](https://github.com/Qlippoth-Station/Qlippoth-station-14)) so the game can load domain files.
It covers roadmap stage **4a** (reading domains) and **4b** (random lists) in full, and lists what later stages will add.

[game-integration.md](game-integration.md) explains *how* domain files plug into the game and holds the reference C#.
This page says *in which order* to do the work, what each step is done with, and how to tell it is finished.

> The reference C# has not been compiled yet. Expect small fixes while doing steps 2 and 4; the list of things to
> check is in each step.

## Overview

| # | Step | Where (game repository) | Done when |
|---|---|---|---|
| 0 | Set up the workspace | – | Both repositories side by side, palette builds |
| 1 | Add the domains folder and a first domain | `Resources/Domains/` | `npm run domains` passes |
| 2 | Add the file reader | `Content.Server/Qlippoth/QlippothDomainFile.cs` | Compiles |
| 3 | Unit-test the reader with the shared fixtures | `Content.Tests/Server/Qlippoth/` | Tests pass |
| 4 | Add the dungeon builder | `Content.Server/Qlippoth/RecipeDungeon.cs` | Compiles |
| 5 | Add the integration test for all domain files | `Content.IntegrationTests/Tests/Qlippoth/` | Test passes, fails on a broken file |
| 6 | Point a Qlippoth at the domain | `Resources/Prototypes/Entities/Qlippoths/` | Prototype loads |
| 7 | Test in game | – | Checklist in step 7 holds |
| 8 | Optional: run the editor's check in the game CI | `.github/workflows/` | CI job green |
| 9 | Open the PR, then close the loop in the editor repository | both | 4a marked done |

## Step 0: set up the workspace

Both repositories live in the same parent folder. The editor's scripts find the game there without any path.

```
<any folder>/
  Qlippoth-station-14/    the game
  Qlippoth-Map-Builder/   the editor
```

1. Clone the game next to the editor (or the editor next to the game).
2. In the game repository, create a branch, for example `recipe-dungeon`.
3. In the editor repository run `npm install` and `npm run palette`. The status bar of `npm run dev` shows
   `palette @ <commit>`, which must be the game commit you are working on.

## Step 1: add the domains folder and a first domain

1. Create `Resources/Domains/` in the game. Domain files always live here (subfolders are fine). The game reads them
   by content path: `Resources/Domains/test_room.domain.json` is `/Domains/test_room.domain.json`.
2. In the editor, build a small test domain with real ids from the palette: a floor area, a wall ring with a door,
   a few objects, one `Entry`, one `QlippothSpot` and at least one `Objective` marker. The Checks panel must be clean.
3. Save it as `Resources/Domains/test_room.domain.json` (lowercase snake_case; content paths are case sensitive).
4. From the editor repository run `npm run domains`. It must print `ok` for the file.

Nothing in the game reads the file yet; the step only fixes the location and gives later steps something real to load.

## Step 2: add the file reader

Create `Content.Server/Qlippoth/QlippothDomainFile.cs` from
[game-integration.md → QlippothDomainFile.cs](game-integration.md#contentserverqlippothqlippothdomainfilecs).
It parses a file into four dictionaries and has `Validate(...)`, which both the builder and the tests use.

Check while compiling:

- `Vector2i` comes from `Robust.Shared.Maths`; add the `using` if the project does not have it globally.
- The rules must match [format.md](format.md#rules-for-readers): reject an unknown `format`, reject a `version`
  other than 1, reject cells outside the size and unknown brush kinds. Unknown ids are not fatal (`Validate` reports
  them).
- Only version 1 is read. The editor upgrades old files itself; the game only ever has to read the version the
  editor currently writes, plus older ones if old files are still in `Resources/Domains/` (see stage 4b below).

## Step 3: unit-test the reader with the shared fixtures

The editor repository has example files in [`fixtures/`](../fixtures). The editor's own tests load them, and the game
reader must treat them the same way. Use them here so the two readers cannot drift apart.

1. Copy `fixtures/*.domain.json` from the editor into the game test project, for example
   `Content.Tests/Server/Qlippoth/Fixtures/`, as embedded resources or copied test data.
   Keep the file names identical, and copy them again whenever `fixtures/` changes in the editor.
2. Add `QlippothDomainFileTest` (an NUnit test in `Content.Tests`, no server needed; `Parse` takes a `JsonElement`):

   | Test | Input | Expected |
   |---|---|---|
   | Fixture parses | `v1-basic.domain.json` | Width 5, height 4, 6 floor cells, 4 structure, 1 object, 3 markers; `Entry` at (1,1) |
   | Wrong format | `"format": "other"` | `InvalidDataException` |
   | Newer version | `"version": 2` | `InvalidDataException` mentioning the version |
   | Cell outside the map | `"9,9"` in a 5×4 file | `InvalidDataException` |
   | Bad key | `"a,1"` | `InvalidDataException` |
   | Unknown brush kind | `{ "kind": "set" }` | `InvalidDataException` |
   | Missing layer | no `object` key | Parses, empty `Object` |
   | Marker order | Objective markers at (3,1), (0,2), (1,0) | `MarkersOf("Objective")` gives (1,0), (3,1), (0,2) |

   `Validate` needs prototype managers, so it is covered by the integration test in step 5 instead.

## Step 4: add the dungeon builder

Create `Content.Server/Qlippoth/RecipeDungeon.cs` from
[game-integration.md → RecipeDungeon.cs](game-integration.md#contentserverqlippothrecipedungeoncs).
It is a second `QlippothDungeon` implementation next to `ArenaDungeon`; `QGateSystem` does not change.

Check while compiling:

- **Logging.** If `Logger.GetSawmill` is obsolete in the engine version used, resolve `ILogManager` and call
  `GetSawmill("qlippoth.domain")` on it.
- **Objective detection.** The reference code uses `prototype.Components.ContainsKey("QGateDungeonObjective")`.
  Prefer the typed form `prototype.HasComponent<QGateDungeonObjectiveComponent>(componentFactory)` if the component
  class is reachable from `Content.Server`; a string key breaks silently if the component is renamed.
- **`ResPath` data field.** `[DataField(required: true)] public ResPath Path` must deserialize from
  `path: /Domains/...` in YAML. If the serializer complains, use `string` and wrap it in `new ResPath(...)`.
- **Fallback.** `Fallback` defaults to `new ArenaDungeon()`. Check that `ArenaDungeon`'s default field values build a
  usable arena, because that is what a broken file turns into.
- **Behaviour must match the translation table** in
  [game-integration.md → How each layer and marker is translated](game-integration.md#how-each-layer-and-marker-is-translated):
  cell `(x, y)` is grid index `(x, y)` with no flipping, entities spawn at the cell centre, `Connection` markers are
  ignored for now.

## Step 5: add the integration test for all domain files

Create `Content.IntegrationTests/Tests/Qlippoth/DomainFilesTest.cs` from
[game-integration.md → Step 5](game-integration.md#step-5-guard-it-with-an-integration-test).
It loads every `/Domains/**/*.domain.json` and fails on any `Validate` problem (unknown tile or entity, marker
without floor, wrong number of `Entry` or `QlippothSpot`).

1. Run it: it passes with `test_room.domain.json`.
2. Break the file on purpose (rename an id to something that does not exist) and run it again: it must fail and name
   the cell. Undo the change.
3. Recommended second test: for every Qlippoth whose `dungeon` is a `RecipeDungeon`, open a rift on a test map and
   assert that the returned layout's `Entry` and `QlippothSpot` are on floor tiles. This exercises `Build` itself.

## Step 6: point a Qlippoth at the domain

In `Resources/Prototypes/Entities/Qlippoths/qlippoths.yml`, change one Qlippoth from `ArenaDungeon` to
`RecipeDungeon` (see [game-integration.md → Step 3](game-integration.md#step-3-point-a-qlippoth-at-the-file)):

```yaml
dungeon: !type:RecipeDungeon
  path: /Domains/test_room.domain.json
```

Pick a Qlippoth that is fine to change for everyone, or keep the change on the branch until step 7 has been done.
The prototype must load without YAML errors (the game's YAML linter and the integration tests check this).

## Step 7: test in game

Follow [game-integration.md → Step 4](game-integration.md#step-4-test-it-in-game) (`qgate_spawn <phase> immediate`).
The step is done when all of these hold:

- [ ] Players arrive on the `Entry` marker.
- [ ] The Qlippoth spawns on the `QlippothSpot` marker.
- [ ] Floors, walls, doors and objects are where they were painted, not mirrored or shifted.
- [ ] Each `Objective` marker has an objective, and completing them all closes the rift.
- [ ] Editing the file in the editor and saving it over the game file shows up in the next rift (rebuild once if not).
- [ ] Renaming the file's `path` to a missing file gives the plain arena and a `Could not load rift domain` error in
      the server log, not an exception.

## Step 8 (optional): run the editor's check in the game CI

The game's integration test already blocks broken files. A faster job can run the editor's check on every PR that
touches `Resources/Domains/`, with the same side-by-side layout as on a developer machine:

```yaml
on:
  pull_request:
    paths: ["Resources/Domains/**"]

jobs:
  domains:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { path: Qlippoth-station-14 }
      - uses: actions/checkout@v4
        with: { repository: Qlippoth-Station/Qlippoth-Map-Builder, path: Qlippoth-Map-Builder }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci && npm run palette && npm run domains
        working-directory: Qlippoth-Map-Builder
```

It catches file-name and schema problems in seconds instead of after a full game build.

## Step 9: open the PR, then close the loop in the editor

1. Open the PR in the game repository with steps 1–6 (and 8 if done). Mention the editor commit and the
   `palette @ <commit>` the test domain was made with.
2. After it is merged, in this repository (`roadmap-progressions` branch):
   - mark stage 4a ✅ in the README roadmap,
   - remove the "not in the game yet" notes from `README.md`, `docs/README.md` and `docs/game-integration.md`,
     and replace the reference C# there with a link to the merged files so there is only one copy of the code,
   - in `CONTRIBUTING.md`, describe adding a domain as a game PR that touches only `Resources/Domains/` and a
     Qlippoth prototype.

**Stage 4a is done** when a Qlippoth in the game's `main` branch builds its rift from a domain file and the
integration test guards every file in `Resources/Domains/`.

## Stage 4b: random lists

The editor side is done (roadmap stage 2): cells can hold `{ "kind": "list", "list": "weak_walls", "group": 1 }`,
lists are `.list.json` files, and the roll is specified in [randomness.md](randomness.md) with test vectors in
[`fixtures/`](../fixtures). Start after 4a is merged; nothing in 4a has to be undone.

| # | Step | Where (game repository) | Done when |
|---|---|---|---|
| 1 | Add the lists folder | `Resources/Domains/Lists/` | `npm run domains` passes for the lists |
| 2 | Read list files | `Content.Server/Qlippoth/QlippothDomainList.cs` | Unit tests pass |
| 3 | Read version 2 domains | `QlippothDomainFile.cs` | Unit tests pass, version 1 still reads |
| 4 | Port the roll | `Content.Server/Qlippoth/QlippothDomainRandom.cs` | Matches `fixtures/v2-lists.rolls.json` |
| 5 | Roll in `RecipeDungeon` | `RecipeDungeon.cs` | A domain with lists builds |
| 6 | Check lists in `Validate` and the integration test | `QlippothDomainFile.cs`, `DomainFilesTest.cs` | Test fails on a missing or wrong list |
| 7 | Test in game against the editor preview | – | Same seed, same layout |

### 1. Add the lists folder

Put the lists the domains use in `Resources/Domains/Lists/<id>.list.json`, exported from the editor with
**Lists → Export lists used by this domain**. The file name must be the list id; ids are unique across the folder.
The editor's **built-in lists** (`lists/` in the editor repository) belong here too: `npm run lists:sync` copies them,
and `npm run domains` fails when a game copy differs from the built-in one.

### 2. Read list files

A small class with `Id`, `Layer` and `Entries` (`(string Id, int Weight)` in file order), and a loader that reads
every `*.list.json` under `/Domains/` once. Reject (with the file name in the message): a `format` other than
`"qlippoth-list"`, a `version` other than 1 or 2, an id that does not match the file name, a layer other than
`floor` / `structure` / `object`, a weight outside 1–1000 (missing means 1), and two files with the same id.
An entry is either `{ "id", "weight" }` or, in version 2, the **empty choice** `{ "empty": true, "weight" }` (at most
one per list); keep it in the entry list with a null id, because its weight takes part in the roll.
Ignore `name` and `icon`; they are for the editor. Test it with `fixtures/lists/*.list.json` (`maybe_crate` has an
empty choice).

### 3. Read version 2 domains

- Accept `version` 1 and 2; still reject anything newer.
- A cell is now either a fixed id or a list reference `(list, group?)`. A small record type keeps the dictionaries
  simple, for example `record DomainCell(string? Id, string? List, int? Group)`.
- Reject list brushes on the `marker` layer, a `group` below 1, and a list id that is not lowercase snake_case.
- Unit tests: `fixtures/v2-lists.domain.json` parses (12 list cells on the floor, 11 on structure, groups on
  `2,0`–`4,0`); the step 3 tests of 4a still pass for `v1-basic.domain.json`.

### 4. Port the roll

Copy `Hash32`, `RollKey` and `Pick` from [randomness.md](randomness.md#the-roll). Then copy
`fixtures/v2-lists.rolls.json` into the test project and assert:

- `Hash32(text)` equals every `hashes[].hash`,
- for every `results[]` seed, rolling every list cell of `v2-lists.domain.json` with the fixture lists gives exactly
  the ids in `rolls` (`null` means the empty choice was rolled and the cell stays empty).

If one value differs, the port is wrong; do not change the vectors. Common mistakes: signed `int` instead of `uint`,
formatting the seed with the current culture, rolling a group cell with its cell key instead of its group key.

### 5. Roll in `RecipeDungeon`

- Pick a seed per rift: `(uint) random.Next()` from `IRobustRandom`, or a fixed `seed` from a new optional YAML field
  (useful for testing a layout).
- Log it: `qlippoth.domain` info `"{Path} built with seed {seed}"`. Entering that seed in the editor's random preview
  shows the same rift, which makes bug reports reproducible.
- Before placing anything, turn every list cell into its rolled id; then build exactly as in 4a (floor grouped by
  tile, entities at cell centres). When the empty choice is rolled, place nothing there; that is normal, not a
  warning. Missing lists or lists without entries: skip the cell and log a warning, like an unknown id.

### 6. Check lists in `Validate` and the integration test

`Validate` reports: a list that is not loaded, a list used on another layer than its own, a list without entries or
with only the empty choice, and list entries that are not real tiles or entities. The integration test from 4a step 5 then covers lists automatically;
also make it load every list file once so a broken list fails even if no domain uses it yet.

### 7. Test in game against the editor preview

1. Give a test Qlippoth `seed: 12345` in YAML and open a rift.
2. In the editor, open the same domain with its lists, turn on **Random preview** and type `12345` into **Seed**.
3. Every random cell must match. Then remove the fixed seed.

**Stage 4b is done** when a domain with random lists builds in the game, its rolls match the editor preview for the
same seed, and the integration test guards every list file.

## Later stages

These depend on editor work that has not been done yet. They are listed so the 4a and 4b code does not block them.

| Stage | Game-side work | Waits for |
|---|---|---|
| – | Apply a per-domain atmosphere from the file ([atmosphere.md](atmosphere.md)) | Format version 3 with an `atmosphere` field |
| 3 | A new `QlippothDungeon` implementation (for example `TemplateSetDungeon`) that joins templates at their `Connection` markers | Stage 3 in the editor |
| 5 | Fully random domains from the template library | Stages 3 and 4b |

The extension point stays `QlippothDungeon`, so later stages add new readers and dungeon types next to the 4a and 4b
code instead of rewriting it.
