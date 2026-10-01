# Atmosphere in rift domains

> **Status: not implemented.** Neither the editor nor the domain file format has any atmosphere setting, and the
> game does not give rift maps any air today. This page records what happens now, what should happen, and a proposed
> design for both sides. The proposed C# has not been compiled or tested.

## What happens today

This section comes from reading the game code at commit `f2e572d`. Nobody has checked it in game yet.

1. `QGateSystem.CreateRiftDungeon` creates a new map with `_mapManager.CreateMap()` and one grid on it.
   It does **not** call `AtmosphereSystem.SetMapAtmosphere`, so the map has no `MapAtmosphereComponent`
   and counts as space (vacuum, 2.7 K).
2. When the dungeon places floor tiles, `AutomaticAtmosSystem` gives the grid a `GridAtmosphereComponent` once it is
   larger than about 7 tiles. New tiles in a grid atmosphere start **without gas**.
3. Tiles next to space leak into the map's vacuum. `ArenaDungeon` leaves a gap in its south wall, so the arena is open to space anyway.

The likely result: **rifts are vacuum.** Players without internals and a hardsuit take pressure and suffocation damage.
If that is not intended, the game needs a fix whatever the editor does.

Compare `ContainmentDimensionSystem.EnsureContainmentDimensionCreated`, which does set up its map:

```csharp
var mapUid = _maps.CreateMap(out var mapId);
var moles = new float[Atmospherics.AdjustedNumberOfGases];
moles[(int) Gas.Oxygen] = 21.824779f;
moles[(int) Gas.Nitrogen] = 82.10312f;
_atmosphere.SetMapAtmosphere(mapUid, false, new GasMixture(moles, Atmospherics.T20C));
var gravity = EnsureComp<GravityComponent>(mapUid);
gravity.Enabled = true;
gravity.Inherent = true;
```

**How to check it in game:** open a rift with `qgate_spawn <phase> immediate`, walk in and use a gas analyzer, or
turn on the atmos debug overlay as an admin. Note the pressure and gases on a floor tile in the middle of the domain.

## Why a map atmosphere fits rifts

The game has two ways to give a place air:

| Way | How it works | Fit for rifts |
|---|---|---|
| **Map atmosphere** (`SetMapAtmosphere(map, space: false, mixture)`) | The whole map counts as filled with an unchanging mixture. Tiles open to it are refilled from it | **Good.** A domain needs no sealed walls and the air never runs out. Same approach as the containment dimension |
| **Grid atmosphere** (gas in each tile) | Each tile holds its own gas; open edges leak | Domains would need sealed walls, and the gas would have to be put into every tile |

So the proposal is: **every rift map gets a map atmosphere, chosen per domain**, with breathable air as the default.
Tile-level gas (for example a plasma-filled room inside a breathable domain) is a later, separate feature.

## Proposed design

### 1. Game: give every rift map an atmosphere (no editor change needed)

This fixes today's behaviour for `ArenaDungeon` too, and can ship before anything else on this page.

Add an atmosphere setting to the dungeon base class:

```csharp
// Content.Server/Qlippoth/QlippothRiftAtmosphere.cs
using Content.Shared.Atmos;

namespace Content.Server.Qlippoth;

/// <summary>The air that fills a rift map. Applied as a map atmosphere, so domains do not need sealed walls.</summary>
[DataDefinition]
public sealed partial class QlippothRiftAtmosphere
{
    /// <summary>True makes the rift vacuum. Gases and temperature are then ignored.</summary>
    [DataField]
    public bool Space { get; set; }

    [DataField]
    public float Temperature { get; set; } = Atmospherics.T20C;

    /// <summary>Moles per tile for each gas. The default is standard station air.</summary>
    [DataField]
    public Dictionary<Gas, float> Gases { get; set; } = new()
    {
        [Gas.Oxygen] = Atmospherics.OxygenMolesStandard,
        [Gas.Nitrogen] = Atmospherics.NitrogenMolesStandard,
    };

    public GasMixture ToMixture()
    {
        var moles = new float[Atmospherics.AdjustedNumberOfGases];
        foreach (var (gas, amount) in Gases)
            moles[(int) gas] = amount;
        return new GasMixture(moles, Temperature);
    }
}
```

```csharp
// QlippothDungeon.cs, in the abstract base class
/// <summary>Air of the rift map. Breathable station air unless set.</summary>
[DataField]
public QlippothRiftAtmosphere Atmosphere { get; set; } = new();

/// <summary>Whether the rift map has gravity.</summary>
[DataField]
public bool Gravity { get; set; } = true;
```

Then apply it in `QGateSystem.CreateRiftDungeon`, before `Build` so tiles are filled as they are placed:

```csharp
var mapUid = _maps.CreateMap(out var mapId);
var atmosphere = definition.Atmosphere;
_atmosphere.SetMapAtmosphere(mapUid, atmosphere.Space, atmosphere.ToMixture());
if (definition.Gravity)
{
    var gravity = EnsureComp<GravityComponent>(mapUid);
    gravity.Enabled = true;
    gravity.Inherent = true;
    Dirty(mapUid, gravity);
}

var gridEntity = _mapManager.CreateGridEntity(mapId);
// ... unchanged
```

(`QGateSystem` needs `[Dependency] private AtmosphereSystem _atmosphere` for this.)

YAML then looks like this. Leaving `atmosphere` out gives breathable air:

```yaml
dungeon: !type:ArenaDungeon
  width: 24
  height: 18
  atmosphere:
    temperature: 233.15        # -40 °C
    gases:
      Oxygen: 21.82
      Nitrogen: 82.10
      CarbonDioxide: 5
```

```yaml
dungeon: !type:RecipeDungeon
  path: /Domains/yellow_palace.domain.json
  atmosphere:
    space: true                # this rift is vacuum on purpose
  gravity: false
```

### 2. Editor and file format: store the atmosphere with the domain

A domain designer usually knows what the air should be ("a frozen tomb", "a plasma-flooded lab"). Storing it in the
file keeps the domain self-contained. Proposed **format version 2** addition: an optional top-level `atmosphere`
object.

```json
{
  "format": "qlippoth-domain",
  "version": 2,
  "name": "Frozen Tomb",
  "width": 20,
  "height": 15,
  "atmosphere": {
    "preset": "custom",
    "temperature": 233.15,
    "gases": { "Oxygen": 21.82, "Nitrogen": 82.10 }
  },
  "layers": { "...": "..." }
}
```

| Field | Values | Meaning |
|---|---|---|
| `preset` | `"breathable"` (default), `"vacuum"`, `"custom"` | `breathable` is standard station air at 20 °C. `vacuum` is space. `custom` uses the fields below |
| `temperature` | kelvin, > 0 | Only for `custom`. Default 293.15 |
| `gases` | object of gas name → moles per tile | Only for `custom`. Names are the game's `Gas` enum: `Oxygen`, `Nitrogen`, `CarbonDioxide`, `Plasma`, `Tritium`, `WaterVapor`, `Ammonia`, `NitrousOxide`, `Frezon` |

Rules:

- A missing `atmosphere` means `breathable`. Version 1 files are read as `breathable`.
- Unknown gas names are an error in the game reader and a warning in the editor.
- Moles are per tile, the same unit as the game's `GasMixture`. For reference, standard air is
  `Oxygen` 21.82 + `Nitrogen` 82.10 = 103.92 moles at 293.15 K, which is 101.3 kPa.

**Which value wins:** the Qlippoth's YAML `atmosphere` (if set) overrides the file, and the file overrides the default.
This lets one domain be reused by a Qlippoth that needs different air.

Because the format changes, the version goes to 2 (see [format.md](format.md#versioning)). The editor must keep opening
version 1 files, and the game reader in [game-integration.md](game-integration.md) must read both versions.

#### Editor UI

- An **Atmosphere** section in the left sidebar: preset dropdown. With `custom`: temperature in °C (stored in kelvin)
  and one moles field per gas. Show the resulting pressure in kPa next to it, using `P = n·R·T / V` with the game's
  tile volume of 2500 L, so designers see "101 kPa" instead of raw moles.
- Changing the atmosphere is an undoable edit, like rename and resize.
- New checks in the Checks panel:
  - *Atmosphere is not breathable*: oxygen partial pressure under about 16 kPa, temperature under 0 °C or above 50 °C,
    or any plasma, tritium, CO₂ or frezon. This is a notice, not an error: hostile air can be intended, but it
    should be a choice.
  - *Total pressure above 1000 kPa*: probably a typo.
  - *Unknown gas*.
- The status bar or map background can be tinted for `vacuum` and `custom` so the setting is noticed.

#### Game reader

`QlippothDomainFile` gets an `Atmosphere` property (`QlippothRiftAtmosphere?`). `RecipeDungeon` exposes it so
`CreateRiftDungeon` can apply it. The integration test checks gas names and that the values are sane.

### 3. Later: atmosphere zones

Some ideas need different air in different parts of one domain (a flooded room behind an airlock). This would be a
fifth layer, `atmos`, painted like the others with brushes that name a gas mixture. The game would put that gas into
the grid atmosphere of those tiles after building, and the room would need sealed walls and doors to keep it. This is
much more work on both sides and should wait until whole-map atmosphere is used and there is a real need.

## Suggested order of work

| Step | Where | Size | Depends on |
|---|---|---|---|
| 1. Check the current behaviour in game | Game | Small | — |
| 2. Map atmosphere + gravity per dungeon, default breathable | Game | Small | 1 |
| 3. `atmosphere` in the file format (version 2), editor UI and checks | Editor | Medium | — |
| 4. Read `atmosphere` from domain files in `RecipeDungeon` | Game | Small | 2, 3, stage 4 of the roadmap |
| 5. Atmosphere zones (`atmos` layer) | Both | Large | 4 |

Step 2 is worth doing first and on its own: it fixes the rifts that exist today.

Version 2 is also planned for random brushes (roadmap stage 2). If both are being worked on, ship them in the same
format version, so files do not go through 2 and 3 in quick succession.
