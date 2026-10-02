# Atmosphere in rift domains

> **Status:** the game already gives rift maps breathable air (fixed in the game repository). The editor and the
> domain file format have **no atmosphere setting yet**, so every domain gets the game's default air.
> This page proposes how a domain can choose its own atmosphere. The proposed C# has not been compiled or tested.

## Goal

A domain designer often knows what the air should be: a frozen tomb, a plasma-flooded lab, a room open to space.
The designer should be able to pick that in the editor, save it with the domain, and get it in game. Nobody should
have to edit C# or remember to set it in YAML.

## Overview

```
 Editor                         .domain.json (version 3)          Game
 ──────                         ────────────────────────          ────
 Atmosphere panel ──Save──►  "atmosphere": {                ──►  RecipeDungeon reads it
 preset / gases /              "preset": "custom",                 │
 temperature, checks           "temperature": 233.15,              ▼
                               "gases": { ... } }               applied to the rift map instead of
                                                                the game's default air
```

What wins, from strongest to weakest:

1. `atmosphere` in the Qlippoth's YAML (`dungeon: !type:RecipeDungeon … atmosphere: …`), if set,
2. `atmosphere` in the domain file,
3. the game's default rift air (what rifts get today).

So one domain can be reused by a Qlippoth that needs different air, and old domains keep today's behaviour.

## 1. File format: an `atmosphere` field (format version 3)

Domain files get an optional top-level `atmosphere` object:

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
| `preset` | `"default"`, `"breathable"`, `"vacuum"`, `"custom"` | `default` (or a missing `atmosphere`) keeps the game's own rift air. `breathable` is standard station air at 20 °C. `vacuum` is space. `custom` uses the fields below |
| `temperature` | kelvin, > 0 | Only for `custom`. Default 293.15 (20 °C) |
| `gases` | object of gas name → moles per tile | Only for `custom`. Names are the game's `Gas` enum: `Oxygen`, `Nitrogen`, `CarbonDioxide`, `Plasma`, `Tritium`, `WaterVapor`, `Ammonia`, `NitrousOxide`, `Frezon` |

Rules:

- A missing `atmosphere` is the same as `"preset": "default"`. Version 1 files are read that way, so they behave
  exactly as they do now.
- Moles are per tile, the same unit as the game's `GasMixture`. Standard air is `Oxygen` 21.82 + `Nitrogen` 82.10
  = 103.93 moles at 293.15 K, which is 101.3 kPa in the game's 2500 L tile.
- Unknown gas names are an error in the game reader and a warning in the editor.
- More presets (for example `cold`, `hot`, `plasma`) can be added later without a version bump, as long as old readers treat unknown presets as an error rather than guessing.

Adding the field is a format change, so `FORMAT_VERSION` goes to 3 (version 2 added random lists; see
[format.md](format.md#versioning)). The editor keeps opening older files through `src/migrate.ts`, and only writes
version 3 when a domain actually sets an atmosphere.

## 2. Editor

### Atmosphere panel

A new **Atmosphere** section in the left sidebar, under **View**:

- **Preset** dropdown: *Game default*, *Breathable*, *Vacuum*, *Custom*.
- With *Custom*:
  - temperature in °C (stored in kelvin),
  - one moles field per gas, empty meaning 0,
  - a "Start from breathable air" button that fills in standard air to edit from.
- A live summary next to it: total pressure in kPa and, for custom air, the oxygen partial pressure. Pressure is
  `P = n · R · T / V` with `R = 8.314462618` and `V = 2500` L, the game's constants, so designers read
  "101 kPa, 21 kPa O₂" instead of raw moles.

Changing the atmosphere is one undoable edit, like rename and resize, and marks the document as unsaved.

### Map hint

Tint the map background (or show a small badge in the status bar) when the preset is not *Game default*, for example
blue-white for cold, dark for vacuum, so the setting is not forgotten.

### Checks

New entries in the Checks panel. These are warnings: hostile air can be the point of a domain, but it should be a choice.

| Check | Condition |
|---|---|
| Air is not breathable | Oxygen partial pressure under 16 kPa, or any plasma, tritium, frezon, or more than about 1 kPa of CO₂ |
| Extreme temperature | Under 0 °C or above 50 °C |
| Very high pressure | Total over 1000 kPa, probably a typo |
| Vacuum | Preset is *Vacuum*: remind that players need hardsuits |
| Unknown gas | Gas name not in the list above |

### Code changes

| File | Change |
|---|---|
| `src/document.ts` | `Atmosphere` type, `atmosphere` on `DomainDocument`, `FORMAT_VERSION = 2`, read v1 and v2, write v2 |
| `src/editor.ts` | `setAtmosphere()` as an undoable change (new `Change` type), new checks in `validate()` |
| `src/ui.ts` | Atmosphere section in the left sidebar |
| `src/view.ts` | Optional background tint |
| `docs/format.md`, `docs/domain.schema.json` | Document and validate the new field |

## 3. Game

### Reading the field

`QlippothDomainFile` (see [game-integration.md](game-integration.md)) reads `atmosphere` into a small data class:

```csharp
// Content.Server/Qlippoth/QlippothRiftAtmosphere.cs
using Content.Shared.Atmos;

namespace Content.Server.Qlippoth;

/// <summary>Air a dungeon asks for. Null on a dungeon means "use the game's default rift air".</summary>
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

The presets map onto it: `breathable` is a default instance, `vacuum` is `Space = true`, `custom` fills in
`Temperature` and `Gases`, and `default` is `null`.

### Applying it

The dungeon tells the gate system which air it wants. One way is to add it to the layout `Build` already returns:

```csharp
public readonly record struct QlippothDungeonLayout(
    Vector2 Entry, Vector2 QlippothSpot, int ObjectiveCount, QlippothRiftAtmosphere? Atmosphere = null);
```

and give every dungeon an optional YAML field on the `QlippothDungeon` base class:

```csharp
/// <summary>Air of the rift map. Null keeps the game's default rift air.</summary>
[DataField]
public QlippothRiftAtmosphere? Atmosphere { get; set; }
```

`ArenaDungeon` returns `Atmosphere` in its layout. `RecipeDungeon` returns `Atmosphere` if it is set in YAML, else
the one from the file, else `null`.

Then, where the game now sets up the default rift air, use the dungeon's choice when there is one:

```csharp
if (layout.Atmosphere is { } air)
    _atmosphere.SetMapAtmosphere(mapUid, air.Space, air.ToMixture());
// else: keep the game's existing default rift air, unchanged
```

**Align this with how the game's existing fix works.** The snippet assumes the default air is a *map atmosphere*
(`SetMapAtmosphere`, as the containment dimension does). With a map atmosphere the whole map counts as filled with an
unchanging mixture, so domains do not need sealed walls and the air never runs out. If the game's fix instead fills
each tile of the grid atmosphere, the domain's air should be applied the same way, after `Build` has placed the tiles.
Either way, the override goes in the same place as the default, so there is one code path for rift air.

### YAML override

The same class can be set from YAML, overriding the file:

```yaml
dungeon: !type:RecipeDungeon
  path: /Domains/frozen_tomb.domain.json
  atmosphere:
    temperature: 233.15        # -40 °C
    gases:
      Oxygen: 21.82
      Nitrogen: 82.10
```

```yaml
dungeon: !type:RecipeDungeon
  path: /Domains/yellow_palace.domain.json
  atmosphere:
    space: true                # this Qlippoth's rift is vacuum on purpose
```

### Integration test

The domain file test in [game-integration.md](game-integration.md#step-5-guard-it-with-an-integration-test) also checks
that gas names are known and that temperature and pressure are within sane bounds.

## 4. Later: atmosphere zones

Some ideas need different air in different parts of one domain, such as a plasma-flooded room behind an airlock.
That would be a fifth layer, `atmos`, painted like the others, with brushes that name a gas mixture. The game would put
that gas into the grid atmosphere of those tiles after building, and the room would need sealed walls and doors to keep it.

This is much more work on both sides. It should wait until whole-domain atmosphere is in use and there is a real need.

## Suggested order of work

| Step | Where | Size | Depends on |
|---|---|---|---|
| 1. `atmosphere` field in the format (version 3), schema, editor panel and checks | Editor | Medium | — |
| 2. `QlippothRiftAtmosphere`, layout field, override where rift air is set up | Game | Small | — |
| 3. `RecipeDungeon` reads `atmosphere` from the file, YAML override | Game | Small | 1, 2, stage 4 of the roadmap |
| 4. Atmosphere zones (`atmos` layer) | Both | Large | 3 |

Steps 1 and 2 can be done in parallel. Step 2 is useful on its own: with it, `ArenaDungeon` Qlippoths can get custom air from YAML too.
