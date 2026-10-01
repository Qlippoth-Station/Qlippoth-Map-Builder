# User guide

How to build a rift domain in the Qlippoth Domain Builder, from an empty grid to a file ready for the game.

## What you are making

A **domain** is the rift dimension players walk into through a Q-Gate. It is a rectangular grid of cells, 1 to 256
cells wide and high. Each cell can hold one item on each of four layers:

| Layer | Key | What goes here | Examples |
|---|---|---|---|
| Floor | `1` | Tiles | `FloorSteel`, `FloorBasalt` |
| Structure | `2` | Walls, doors, windows | `WallReinforced`, `AirlockGlass` |
| Object | `3` | Every other entity: furniture, machines, lights, objective consoles | `Table`, `QGateObjectiveSeal` |
| Marker | `4` | Editor-only points the game reads | `Entry`, `QlippothSpot`, `Objective`, `Connection` |

Cells without a floor tile are **space** in the game.

## The screen

```
┌──────────────────────────────── Top bar: name · W/H · Undo/Redo · New/Open/Save · ? · Credits ┐
│ Tools     │                                                          │ Palette of the active │
│ Layers    │                    Map (canvas)                          │ layer: selected item, │
│ View      │                                                          │ search, category,     │
│ Checks    │                                                          │ items                 │
└──────────────────── Status bar: hovered cell and contents · save state · palette @ commit ──┘
```

## Step by step

1. **New** (top bar): give the domain a name and size. The default is 20 × 15.
2. **Floor:** press `1`, pick a tile in the palette, then use **Rectangle** (`R`) to cover the area.
3. **Walls:** press `2`, pick a wall and paint the outline with **Brush** (`B`). Leave gaps for doors and paint door entities into them.
4. **Objects:** press `3` and place furniture, lights and machines.
5. **Markers:** press `4` and place:
   - exactly one **Entry**: where the Q-Gate drops players,
   - one **Qlippoth spot**: where the Qlippoth spawns,
   - one or more **Objective** markers: the game puts an objective console on each (see below),
   - **Connection** markers are for templates (stage 3) and are ignored by the game for now.
6. Check the **Checks** panel. Click a warning that has a position to jump to that cell.
7. **Save** (`Ctrl+S`) downloads `<name>.domain.json`.

### Objectives: marker or entity?

You can add objectives in two ways:

- An **Objective marker** says "an objective goes here". Which objective it is (Stabilize, Data, Seal…) is chosen in the
  Qlippoth's YAML, so the same domain can be reused by different Qlippoths.
- An objective **entity** (for example `QGateObjectiveSeal`) on the Object layer fixes exactly which objective it is.

Both count towards the number of objectives the crew must complete. See [game-integration.md](game-integration.md).

## Tools

| Tool | Key | Use |
|---|---|---|
| Brush | `B` | Click or drag to paint the selected item. Fast drags leave no gaps |
| Rectangle | `R` | Drag from one corner to the other and release to fill the rectangle |
| Fill | `F` | Fills the connected area (4 directions) that holds the same thing as the clicked cell. Empty cells count as "the same thing", so filling an empty area fills all empty cells around it |
| Erase | `E` | Click or drag to clear cells on the active layer only |
| Pick | `I` | Click a cell to select the item under it. **Right click** does the same with any tool |

Tools always act on the **active layer**. Picking an item from the palette or with Pick switches to its layer and back to Brush.

Pick looks at the active layer first, then the other visible layers from top (Marker) to bottom (Floor).

## Layers and view

- Click a layer name or press `1`–`4` to make it active. The number next to the name is how many cells it fills.
- The eye button hides or shows a layer. Hidden layers are still saved.
- **Grid** (`G`) toggles grid lines.
- **Dim other layers** (`D`) fades every layer except the active one.
- **Fit to view** (`0`) zooms so the whole domain fits on screen.

## Moving around

| Action | Input |
|---|---|
| Pan | Hold `Space` and drag, or drag with the middle mouse button |
| Zoom | Mouse wheel (zooms towards the cursor, 25 % to 400 %) |
| Fit | `0` |

The status bar shows the coordinates of the hovered cell and what each layer holds there. Coordinates start at the
**bottom-left** cell `(0, 0)` and `y` grows upwards, the same as in the game.

## Palette

The right panel lists the items of the active layer.

- Type in the search box (`/` jumps there) to filter by name or id.
- The category list narrows by folder in the game prototypes, for example `Structures/Walls`.
- At most 400 items are shown at once; search to find the rest.
- The selected item shows its name and its id. The id is what is saved in the file.

The palette is built from the game repository and follows it automatically. See [palette.md](palette.md).

## Resizing

Change **W** or **H** in the top bar. Resizing keeps the bottom-left corner fixed. Cells that end up outside the new
size are removed. Undo brings them back.

## Undo, redo and saving

- `Ctrl+Z` undoes, `Ctrl+Y` or `Ctrl+Shift+Z` redoes. A whole drag is one undo step. Up to 500 steps are kept.
- Renaming and resizing can be undone too.
- **Autosave:** your work is stored in this browser (`localStorage`) about half a second after each change and restored
  when you open the editor again. It is a safety net, not a replacement for **Save**: it is lost if you clear site
  data, and it only keeps one domain. Private windows may not keep it at all.
- **Save** (`Ctrl+S`) downloads the file. The status bar says whether there are unsaved changes since the last save.
- **Open** (`Ctrl+O`) loads a `.domain.json` file. The editor asks before throwing away unsaved changes.
- Undo history is cleared when you open or create a domain.

## Checks

The Checks panel updates as you paint. It reports:

| Check | Why it matters |
|---|---|
| No Entry marker / more than one Entry marker | The game needs exactly one place to drop players |
| No Qlippoth spot marker | The game needs a place for the Qlippoth |
| Marker without a floor tile | Players or objectives would end up in space |
| Marker inside a wall | Players would spawn stuck in a wall |
| Unknown id | The id is not in the current palette, usually because it was renamed or removed in the game |

A clean Checks panel is expected for files submitted to the game. If a warning is intentional, explain it in the pull request.

## Keyboard shortcuts

Press `?` in the editor (top bar) to see this list.

| Key | Action |
|---|---|
| `B` `R` `F` `E` `I` | Brush, Rectangle, Fill, Erase, Pick |
| `1` `2` `3` `4` | Floor, Structure, Object, Marker layer |
| Right click | Pick item under cursor |
| `Space` + drag / middle drag | Pan |
| Wheel | Zoom |
| `0` | Fit to view |
| `G` / `D` | Toggle grid / dim other layers |
| `/` | Search palette |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+S` / `Ctrl+O` | Save / open |

## Sharing a domain

There is no server. To share a domain, send the `.domain.json` file or add it to a pull request in the game repository.
[game-integration.md](game-integration.md) explains where it goes and how the game uses it.

## Credits

The **Credits** button lists the source, license and copyright of every sprite in the palette. Sprites come from the
game repository and keep their original licenses, mostly CC-BY-SA 3.0.
