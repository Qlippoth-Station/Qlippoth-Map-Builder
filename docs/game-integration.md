# Using domain files in the game

This guide explains how `.domain.json` files made in the editor become rift dimensions in Qlippoth Station.

> **Status:** the editor side (stage 1) is done. The game side (stage 4 in the roadmap) does **not exist yet**:
> the game cannot load `.domain.json` files today. This page explains how the game builds rifts now, where
> domain files plug in, and gives a reference implementation (`RecipeDungeon`) to add to the game repository.
> The C# below follows the game code at commit `f2e572d`, but it has not been compiled or tested yet. Treat it as
> a starting point for the game-side pull request, not as finished code.

## Contents

1. [How rifts are built today](#how-rifts-are-built-today)
2. [The plan in one picture](#the-plan-in-one-picture)
3. [Step 1: put the file in the game repository](#step-1-put-the-file-in-the-game-repository)
4. [Step 2: add `RecipeDungeon` to the game](#step-2-add-recipedungeon-to-the-game)
5. [Step 3: point a Qlippoth at the file](#step-3-point-a-qlippoth-at-the-file)
6. [Step 4: test it in game](#step-4-test-it-in-game)
7. [Step 5: guard it with an integration test](#step-5-guard-it-with-an-integration-test)
8. [How each layer and marker is translated](#how-each-layer-and-marker-is-translated)
9. [Keeping editor and game in sync](#keeping-editor-and-game-in-sync)
10. [Troubleshooting](#troubleshooting)
11. [What changes in later stages](#what-changes-in-later-stages)

## How rifts are built today

Everything below is in the [game repository](https://github.com/Qlippoth-Station/Qlippoth-station-14).

1. A **Q-Gate** spawns on the station (`Content.Server/Qlippoth/Systems/QGateSystem.cs`).
2. When the rift opens (`OpenRift`), the gate picks a Qlippoth for its phase and reads that Qlippoth's
   `QlippothComponent.Dungeon` field.
3. `CreateRiftDungeon` makes a new map with one empty grid and calls `dungeon.Build(...)` on it.
4. `Build` places tiles and entities and returns a `QlippothDungeonLayout`:
   - `Entry`: where the gate drops players,
   - `QlippothSpot`: where the Qlippoth is spawned,
   - `ObjectiveCount`: how many objectives the crew must complete to close the rift.
5. When the rift closes, players are moved back to the station and the map is deleted.

`QlippothDungeon` (`Content.Server/Qlippoth/QlippothDungeon.cs`) is an abstract data class. It is chosen in YAML
with `!type:`. The only implementation today is `ArenaDungeon`: a walled rectangle with a gap in the south wall.

```yaml
# Resources/Prototypes/Entities/Qlippoths/qlippoths.yml
- type: Qlippoth
  gatePhases: [Phase1Rift]
  dungeon: !type:ArenaDungeon
    width: 20
    height: 15
    floor: FloorSteel
    wall: WallReinforced
```

`QGateSystem` already has the helpers a dungeon builds with:

| Helper | What it does |
|---|---|
| `PlaceFloor(gridUid, grid, tileId, positions)` | Sets many tiles to one tile prototype |
| `PlaceEntity(gridUid, prototype, position)` | Spawns an entity at a position in grid coordinates |
| `PlaceObjective(gridUid, gate, prototype, position)` | Spawns an objective entity and links it to the gate |

So **domain files plug in as a second `QlippothDungeon` implementation.** Nothing else in the gate logic has to change.

## The plan in one picture

```
 Domain Builder (browser)               Game repository
 ────────────────────────               ───────────────────────────────────────────────
 paint domain ──Save──► yellow_palace.domain.json
                                │
                                ▼
                        Resources/Domains/yellow_palace.domain.json
                                │
            qlippoths.yml:  dungeon: !type:RecipeDungeon
                                       path: /Domains/yellow_palace.domain.json
                                │
                                ▼
          QGateSystem.OpenRift ─► RecipeDungeon.Build ─► tiles, walls, objects,
                                                          objectives, Entry, QlippothSpot
```

## Step 1: put the file in the game repository

1. In the editor, make sure the **Checks** panel is clean, then press **Save** (`Ctrl+S`).
2. Copy the downloaded file into the game repository at:

   ```
   Resources/Domains/<snake_case_name>.domain.json
   ```

   `Resources/Domains/` is a suggested location. It does not exist yet; the first game-side PR creates it.
   Any folder under `Resources/` works, because the game reads it by its content path (`/Domains/...`).
3. Use lowercase file names with underscores (`yellow_palace.domain.json`). Content paths are case sensitive on Linux servers.

Commit the file as is. The editor writes cells sorted by `y`, then `x`, so later edits produce small diffs.

## Step 2: add `RecipeDungeon` to the game

This is a one-time change in the game repository. It adds two files next to the existing `QlippothDungeon.cs`.

### `Content.Server/Qlippoth/QlippothDomainFile.cs`

This file reads and checks a `.domain.json` file. It is separate from the builder so the integration test can use it too.

```csharp
using System.IO;
using System.Text.Json;
using Robust.Shared.ContentPack;
using Robust.Shared.Map;
using Robust.Shared.Prototypes;
using Robust.Shared.Utility;

namespace Content.Server.Qlippoth;

/// <summary>
/// A rift domain made with the Qlippoth Domain Builder (https://github.com/Qlippoth-Station/Qlippoth-Map-Builder).
/// See docs/format.md in that repository for the file format.
/// </summary>
public sealed class QlippothDomainFile
{
    public const string FormatId = "qlippoth-domain";
    public const int FormatVersion = 1;
    public const int MaxSize = 256;

    public string Name = string.Empty;
    public int Width;
    public int Height;

    /// <summary>Cell -> tile prototype id.</summary>
    public readonly Dictionary<Vector2i, string> Floor = new();
    /// <summary>Cell -> entity prototype id (walls, doors, windows).</summary>
    public readonly Dictionary<Vector2i, string> Structure = new();
    /// <summary>Cell -> entity prototype id (everything else).</summary>
    public readonly Dictionary<Vector2i, string> Object = new();
    /// <summary>Cell -> marker id: Entry, QlippothSpot, Objective or Connection.</summary>
    public readonly Dictionary<Vector2i, string> Marker = new();

    public static QlippothDomainFile Load(IResourceManager resources, ResPath path)
    {
        using var stream = resources.ContentFileRead(path);
        using var json = JsonDocument.Parse(stream);
        return Parse(json.RootElement, path.ToString());
    }

    public static QlippothDomainFile Parse(JsonElement root, string source)
    {
        if (!root.TryGetProperty("format", out var format) || format.GetString() != FormatId)
            throw new InvalidDataException($"{source}: not a Qlippoth domain file.");

        // Readers must reject versions they do not know (docs/format.md).
        var version = root.GetProperty("version").GetInt32();
        if (version != FormatVersion)
            throw new InvalidDataException($"{source}: unsupported domain format version {version}.");

        var domain = new QlippothDomainFile
        {
            Name = root.TryGetProperty("name", out var name) ? name.GetString() ?? string.Empty : string.Empty,
            Width = root.GetProperty("width").GetInt32(),
            Height = root.GetProperty("height").GetInt32(),
        };

        if (domain.Width is < 1 or > MaxSize || domain.Height is < 1 or > MaxSize)
            throw new InvalidDataException($"{source}: size {domain.Width}x{domain.Height} is outside 1..{MaxSize}.");

        var layers = root.GetProperty("layers");
        domain.ReadLayer(layers, "floor", domain.Floor, source);
        domain.ReadLayer(layers, "structure", domain.Structure, source);
        domain.ReadLayer(layers, "object", domain.Object, source);
        domain.ReadLayer(layers, "marker", domain.Marker, source);
        return domain;
    }

    private void ReadLayer(JsonElement layers, string layer, Dictionary<Vector2i, string> into, string source)
    {
        if (!layers.TryGetProperty(layer, out var cells))
            return;

        foreach (var cell in cells.EnumerateObject())
        {
            // Keys are "x,y" with the origin at the bottom-left and y growing upwards, the same as grid indices.
            var parts = cell.Name.Split(',');
            if (parts.Length != 2 || !int.TryParse(parts[0], out var x) || !int.TryParse(parts[1], out var y))
                throw new InvalidDataException($"{source}: bad cell key \"{cell.Name}\" in {layer}.");
            if (x < 0 || y < 0 || x >= Width || y >= Height)
                throw new InvalidDataException($"{source}: cell {cell.Name} in {layer} is outside the domain.");

            var kind = cell.Value.GetProperty("kind").GetString();
            if (kind != "fixed")
                throw new InvalidDataException($"{source}: unknown brush kind \"{kind}\" at {cell.Name} in {layer}.");

            into[new Vector2i(x, y)] = cell.Value.GetProperty("id").GetString()!;
        }
    }

    public IEnumerable<Vector2i> MarkersOf(string id)
    {
        // Sorted so objective markers are filled in the same order every time.
        return Marker.Where(pair => pair.Value == id)
            .Select(pair => pair.Key)
            .OrderBy(cell => cell.Y)
            .ThenBy(cell => cell.X);
    }

    /// <summary>Problems that would make the domain build wrong. Empty when the file is fine.</summary>
    public List<string> Validate(IPrototypeManager prototypes, ITileDefinitionManager tiles)
    {
        var problems = new List<string>();

        foreach (var (cell, id) in Floor)
        {
            if (!tiles.TryGetDefinition(id, out _))
                problems.Add($"floor {cell}: unknown tile \"{id}\"");
        }

        foreach (var (layer, cells) in new[] { ("structure", Structure), ("object", Object) })
        {
            foreach (var (cell, id) in cells)
            {
                if (!prototypes.HasIndex<EntityPrototype>(id))
                    problems.Add($"{layer} {cell}: unknown entity \"{id}\"");
            }
        }

        foreach (var (cell, id) in Marker)
        {
            if (id is not ("Entry" or "QlippothSpot" or "Objective" or "Connection"))
                problems.Add($"marker {cell}: unknown marker \"{id}\"");
            if (!Floor.ContainsKey(cell))
                problems.Add($"marker {cell}: {id} has no floor tile");
        }

        var entries = MarkersOf("Entry").Count();
        if (entries != 1)
            problems.Add($"expected exactly one Entry marker, found {entries}");
        if (!MarkersOf("QlippothSpot").Any())
            problems.Add("no QlippothSpot marker");

        return problems;
    }
}
```

### `Content.Server/Qlippoth/RecipeDungeon.cs`

This is the `QlippothDungeon` implementation that the YAML points at.

```csharp
using System.Numerics;
using Content.Server.Qlippoth.Systems;
using Robust.Shared.ContentPack;
using Robust.Shared.Map;
using Robust.Shared.Map.Components;
using Robust.Shared.Prototypes;
using Robust.Shared.Utility;

namespace Content.Server.Qlippoth;

/// <summary>
/// Builds the rift from a .domain.json file made with the Qlippoth Domain Builder.
///
/// YAML:
///   dungeon: !type:RecipeDungeon
///     path: /Domains/yellow_palace.domain.json
///     objectives: [QGateObjectiveStabilize, QGateObjectiveData, QGateObjectiveSeal]
///
/// If the file is missing or broken, the rift falls back to a plain ArenaDungeon so the round goes on.
/// </summary>
[DataDefinition]
public sealed partial class RecipeDungeon : QlippothDungeon
{
    /// <summary>Content path of the domain file, e.g. /Domains/yellow_palace.domain.json.</summary>
    [DataField(required: true)]
    public ResPath Path { get; set; }

    /// <summary>
    /// Objective prototypes for the Objective markers, in marker order (bottom row first, left to right).
    /// If there are more markers than prototypes, the list repeats.
    /// </summary>
    [DataField]
    public List<EntProtoId> Objectives { get; set; } = new()
    {
        "QGateObjectiveStabilize",
        "QGateObjectiveData",
        "QGateObjectiveSeal",
    };

    /// <summary>Used when the file cannot be loaded.</summary>
    [DataField]
    public QlippothDungeon Fallback { get; set; } = new ArenaDungeon();

    public override QlippothDungeonLayout Build(QGateSystem gates, EntityUid gridUid, MapGridComponent grid, EntityUid gate)
    {
        var log = Logger.GetSawmill("qlippoth.domain");
        var resources = IoCManager.Resolve<IResourceManager>();
        var prototypes = IoCManager.Resolve<IPrototypeManager>();
        var tiles = IoCManager.Resolve<ITileDefinitionManager>();

        QlippothDomainFile domain;
        try
        {
            domain = QlippothDomainFile.Load(resources, Path);
        }
        catch (Exception e)
        {
            log.Error($"Could not load rift domain {Path}, using the fallback dungeon: {e.Message}");
            return Fallback.Build(gates, gridUid, grid, gate);
        }

        foreach (var problem in domain.Validate(prototypes, tiles))
            log.Warning($"{Path}: {problem}");

        // Floor first, grouped by tile so each tile type is one SetTiles call.
        foreach (var group in domain.Floor.GroupBy(pair => pair.Value))
        {
            if (!tiles.TryGetDefinition(group.Key, out _))
                continue;
            gates.PlaceFloor(gridUid, grid, group.Key, group.Select(pair => pair.Key).ToList());
        }

        // Entities stand in the middle of their cell.
        static Vector2 Center(Vector2i cell) => new(cell.X + 0.5f, cell.Y + 0.5f);

        foreach (var (cell, id) in domain.Structure)
        {
            if (prototypes.HasIndex<EntityPrototype>(id))
                gates.PlaceEntity(gridUid, id, Center(cell));
        }

        var objectiveCount = 0;
        foreach (var (cell, id) in domain.Object)
        {
            if (!prototypes.TryIndex<EntityPrototype>(id, out var prototype))
                continue;

            // Objective entities painted directly on the object layer still have to be linked to the gate.
            if (prototype.Components.ContainsKey("QGateDungeonObjective"))
            {
                gates.PlaceObjective(gridUid, gate, id, Center(cell));
                objectiveCount++;
            }
            else
            {
                gates.PlaceEntity(gridUid, id, Center(cell));
            }
        }

        if (Objectives.Count > 0)
        {
            var index = 0;
            foreach (var cell in domain.MarkersOf("Objective"))
            {
                gates.PlaceObjective(gridUid, gate, Objectives[index % Objectives.Count], Center(cell));
                objectiveCount++;
                index++;
            }
        }

        // Validate() already warned about a missing marker; fall back to the middle of the domain.
        var middle = new Vector2(domain.Width / 2f, domain.Height / 2f);
        var entry = domain.MarkersOf("Entry").Select(Center).DefaultIfEmpty(middle).First();
        var qlippothSpot = domain.MarkersOf("QlippothSpot").Select(Center).DefaultIfEmpty(middle).First();

        return new QlippothDungeonLayout(entry, qlippothSpot, objectiveCount);
    }
}
```

Notes on the implementation:

- **Fail soft, not hard.** A broken file logs an error and builds the `Fallback` dungeon. A rift that opens
  with the plain arena is better than a server exception in the middle of a round. Wrong files should be
  caught before merging, by the test in [Step 5](#step-5-guard-it-with-an-integration-test).
- **Unknown ids are skipped with a warning.** This happens when a prototype is renamed or removed after the domain was made.
- **`ObjectiveCount` of 0** keeps the gate's default `RequiredObjectives` (see `OpenRift`). A domain with no objectives
  therefore still needs objectives to close; add at least one `Objective` marker or objective entity.
- The file is read every time a rift opens. Domain files are small, and this means an edited file is picked up
  without a server restart while testing. Add a cache later if profiling ever shows it.

## Step 3: point a Qlippoth at the file

In the Qlippoth's prototype, replace the `ArenaDungeon` with a `RecipeDungeon`:

```yaml
# Resources/Prototypes/Entities/Qlippoths/qlippoths.yml
- type: entity
  id: MobQlippothExample   # your Qlippoth
  parent: QlippothMobBase
  components:
  - type: Qlippoth
    gatePhases: [Phase2Rift]
    dungeon: !type:RecipeDungeon
      path: /Domains/yellow_palace.domain.json
      objectives:
      - QGateObjectiveStabilize
      - QGateObjectiveSeal
```

Optional fields:

| Field | Default | Meaning |
|---|---|---|
| `path` | required | Content path of the `.domain.json` file |
| `objectives` | Stabilize, Data, Seal | Prototypes for `Objective` markers, in marker order, repeating if there are more markers |
| `fallback` | `!type:ArenaDungeon` | Dungeon to build if the file cannot be loaded |

Several Qlippoths can use the same domain file.

## Step 4: test it in game

1. Build and start a local server and client as usual for the game repository.
2. As an admin with the Debug flag, stand somewhere on the station and run `qgate_spawn <phase 1-5> immediate`,
   using a phase your Qlippoth lists in `gatePhases`. `immediate` skips the arrival countdown.
   If several Qlippoths share that phase, one is picked by `spawnWeight`, so you may need a few gates.
3. Walk through the gate. Check:
   - you arrive on the `Entry` marker,
   - the Qlippoth stands on the `QlippothSpot` marker,
   - walls, doors and objects are where you painted them,
   - completing all objectives closes the rift.
4. Look at the server log for `qlippoth.domain` warnings.

Because the file is read on every rift, you can edit it in the editor, save it over the file in `Resources/Domains/`,
and open a new gate to see the change. Content files are copied into the build output, so if the change does not show up, rebuild once.

## Step 5: guard it with an integration test

Add a test to `Content.IntegrationTests` so CI fails when a domain file is broken or refers to a prototype that no
longer exists. This is the safety net that lets `RecipeDungeon` fail soft at runtime.

```csharp
using Content.Server.Qlippoth;
using Robust.Shared.ContentPack;
using Robust.Shared.Map;
using Robust.Shared.Prototypes;
using Robust.Shared.Utility;

namespace Content.IntegrationTests.Tests.Qlippoth;

[TestFixture]
public sealed class DomainFilesTest
{
    [Test]
    public async Task AllDomainFilesAreValid()
    {
        await using var pair = await PoolManager.GetServerClient();
        var server = pair.Server;
        var resources = server.ResolveDependency<IResourceManager>();
        var prototypes = server.ResolveDependency<IPrototypeManager>();
        var tiles = server.ResolveDependency<ITileDefinitionManager>();

        await server.WaitAssertion(() =>
        {
            var files = resources.ContentFindFiles(new ResPath("/Domains/"))
                .Where(path => path.Filename.EndsWith(".domain.json"));

            Assert.Multiple(() =>
            {
                foreach (var path in files)
                {
                    var domain = QlippothDomainFile.Load(resources, path);
                    foreach (var problem in domain.Validate(prototypes, tiles))
                        Assert.Fail($"{path}: {problem}");
                }
            });
        });

        await pair.CleanReturnAsync();
    }
}
```

It is also worth adding a test that opens a rift for every Qlippoth whose dungeon is a `RecipeDungeon`, so the build
path itself is exercised.

## How each layer and marker is translated

| Editor | Game |
|---|---|
| Cell `"x,y"` | Grid tile index `(x, y)`; no flipping is needed, both use bottom-left origin with `y` up |
| `floor` id | Tile prototype id, set with `PlaceFloor` |
| `structure` id | Entity spawned at the cell center `(x + 0.5, y + 0.5)` with `PlaceEntity` |
| `object` id | Same as structure. Entities with a `QGateDungeonObjective` component go through `PlaceObjective` and count as objectives |
| `Entry` marker | `QlippothDungeonLayout.Entry`, cell center |
| `QlippothSpot` marker | `QlippothDungeonLayout.QlippothSpot`, cell center |
| `Objective` marker | Next prototype from `objectives`, placed with `PlaceObjective` |
| `Connection` marker | Ignored in stage 1; used by templates in stage 3 |

Things that are **not** stored in version 1 files and therefore not built: entity rotation, cells outside the
domain (space around the grid), lighting settings, atmosphere. Entities spawn with their prototype defaults.
The grid is created empty by `CreateRiftDungeon`, so cells without a floor tile are space.

## Keeping editor and game in sync

- **Prototype ids.** The editor palette is rebuilt from the game's `main` branch every day (see [palette.md](palette.md)).
  If an id is renamed in the game, open the domain in the editor: the Checks panel lists it as unknown. Repaint those
  cells and save again. The integration test catches the same problem on the game side.
- **Format version.** The game reader and the editor must agree on `version`. When the editor bumps the version
  (stage 2), update `QlippothDomainFile` in the same release and keep reading the old version if old files exist.
- **Which game commit was used?** The editor status bar shows `palette @ <commit>`, the game commit the palette was
  built from. Mention it in the PR if a domain uses new prototypes.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Rift is the plain arena | The file failed to load. Look for `Could not load rift domain` in the server log: wrong `path`, wrong case, or bad JSON |
| `unknown tile` / `unknown entity` warnings | Prototype renamed or removed in the game. Fix the file in the editor |
| Players arrive in space | `Entry` marker missing or on a cell without floor. The editor's Checks panel warns about both |
| Rift cannot be closed | No objectives were placed, so the gate kept its default objective count. Add `Objective` markers |
| Objective entity does nothing | It was spawned without a gate link. Make sure the `RecipeDungeon` code above uses `PlaceObjective` for it |
| `unsupported domain format version` | The file was saved by a newer editor than the game reader supports |

## What changes in later stages

- **Stage 2 (random brushes):** cells can hold a set brush instead of a fixed id. `QlippothDomainFile` gets a
  second brush kind, and `RecipeDungeon` resolves randomness with a seeded RNG. The editor's preview must use the same RNG
  algorithm so the preview matches the game.
- **Stage 3 (templates):** smaller domains with `Connection` markers are combined. A new `QlippothDungeon`
  implementation (for example `TemplateSetDungeon`) chains templates by their connections.
- **Stage 5 (fully random domains):** built from the same template library.

The `QlippothDungeon` extension point stays the same through all stages, so Qlippoth prototypes only change their `!type:`.
