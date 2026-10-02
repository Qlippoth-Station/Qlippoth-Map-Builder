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
| Select | `S` | Drag to select a rectangle. Drag from inside it to move the area with its contents on **every** layer |

Tools always act on the **active layer**. Picking an item from the palette or with Pick switches to its layer and back to Brush.

### Selections

With a selection active:

- drag from inside it, or press the arrow keys (`Shift` + arrow for 5 cells), to move it together with everything inside it on all four layers,
- `Delete` or `Backspace` clears the selected area on every layer,
- `Esc` drops the selection.

A move is one undo step. Moves stop at the edge of the map, so nothing is pushed off it. The status bar shows the size and position of the selection.

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

## Random lists

Some cells should not always be the same thing. A **random list** is a named list of items, for example:

- *Weak walls*: walls players can break through,
- *Strong walls*: walls that can never be passed,
- *Mixed floor*: mostly steel, sometimes dirty steel or plating.

Paint with a list instead of an item, and the game picks one entry of the list for that cell every time it builds the
rift. On the map, list cells show the list's **icon** (its symbol or letter on its color, with two dice dots) instead
of an item.

### Built-in lists and your lists

- **Built-in lists** (🔒) ship with the editor. They are part of the game, so they cannot be changed or deleted, and
  no other list can take their id. **Duplicate as my list** makes an editable copy with a new id.
- **Your lists** are kept in this browser, are not tied to a domain, and every domain you make can use them.

### Making a list

1. Click **Lists** in the top bar (or **Manage…** above the palette).
2. A list belongs to one layer (Floor, Structure or Object). New lists take the active layer; change **Layer** while
   the list is still empty if needed.
3. **New list**, give it a name. Its id (`weak_walls`) and file name (`weak_walls.list.json`) come from the name.
4. Choose a **symbol** (or keep the **letter**, one or two characters) and a **color**. Symbols come from the editor's
   symbol set ([assets/list-symbols](../assets/list-symbols/README.md)).
5. Search for items under the entry table and click them to add them.
6. Set the **chances**: drag an entry's bar or type its percentage. The other entries are adjusted automatically so
   everything adds up to 100 %, keeping their proportions to each other. **Equal chances** gives every entry the same
   share. The smallest step is 0.1 %; to drop an entry completely, remove it (✕).
7. **Add empty choice** adds a "Nothing" entry: when it is picked, the cell stays empty. Use it for things that should
   only be there sometimes, for example a list of crates plus *Nothing* at 50 %. A list can have one empty choice.

### Painting with a list

On the Floor, Structure or Object layer, the palette shows your lists for that layer under **Random lists**. Pick one
and paint with Brush, Rectangle or Fill as usual. Pick (`I` or right click) on a list cell selects the list again.

By default **every cell rolls on its own**: five weak walls in a row can become five different walls.

### Same pick for a group of cells

Sometimes cells should be random but **the same**: a whole wall segment that is either all solid or all grille.

- Tick **Same pick for the whole stroke** under the selected list. Every stroke you paint after that (one brush drag,
  one rectangle, one fill) becomes one **group**: the game picks once for the group and all its cells get that item.
  If the empty choice comes up, the whole group stays empty.
- Each group gets an **outline in its own color** around its cells, the group number in the corner and, when the
  editor has the art for it, a group effect over its cells.
- For cells that are already painted: select them with **Select** (`S`) and press `L`. The list cells in the selection
  become one group (per list). `Shift+L` removes the group again, so every cell rolls on its own.

### Random preview

Tick **Random preview** (`P`) in the View panel to see what the list cells become, rolled exactly the way the game
rolls them; cells whose empty choice came up stay empty. **Reroll** (`N`) tries another seed. The game logs the seed of every rift it builds; type it into **Seed**
to see exactly that rift. Turn the preview off to see and edit the list icons again.

### Sharing lists

A domain only refers to its lists by id; the lists themselves are separate `.list.json` files. In the game they all
live in one place: `Resources/Domains/Lists/`.

**The lists folder (Chrome, Edge).** In the Lists dialog, **Connect lists folder…** and choose
`Resources/Domains/Lists/` of your game checkout (the one next to this editor). From then on:

- **Save to lists folder** writes a list there directly, and **Save lists used by this domain** writes all of them,
- **Save** (`Ctrl+S`) on a domain also writes the lists of yours it uses into the folder,
- **Load lists from folder** imports every list in it, for example after pulling the game.

The editor remembers the folder; after a reload the browser asks once more (**Reconnect**). Built-in lists are never
written: they reach the game separately. In other browsers lists are downloaded instead; move them into
`Resources/Domains/Lists/` yourself. **Save** on a domain then reminds you when it uses lists of yours.

- **Export**: in the Lists dialog, **Export .list.json** saves one list, and **Export lists used by this domain**
  saves every list the open domain uses. Add those files to the pull request next to the domain.
- **Import**: **Import…** in the Lists dialog, or simply **Open** the domain together with its list files (select them
  all in the file picker). If a different list with the same id is already loaded, the editor asks before replacing it.
  A file with the id of a built-in list is not imported unless it is identical.
- A domain whose list is not loaded shows `List "…" is not loaded` in Checks; its cells show a red `?`.

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
- **Open** (`Ctrl+O`) loads a `.domain.json` file, and any `.list.json` files selected with it. The editor asks before throwing away unsaved changes.
- Your random lists are stored in this browser separately from the domain and are kept when you open or create domains.
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
| List not loaded | The domain uses a list this browser does not have. Import its `.list.json` |
| List used on the wrong layer / empty list / list with only the empty choice / unknown id in a list | The game could not place anything sensible for those cells |

A clean Checks panel is expected for files submitted to the game. If a warning is intentional, explain it in the pull request.

## Keyboard shortcuts

Press `?` in the editor (top bar) to see this list.

| Key | Action |
|---|---|
| `B` `R` `F` `E` `I` `S` | Brush, Rectangle, Fill, Erase, Pick, Select |
| `1` `2` `3` `4` | Floor, Structure, Object, Marker layer |
| Right click | Pick item under cursor |
| Drag inside selection | Move the selection and its contents |
| Arrows / `Shift` + arrows | Move the selection by 1 / 5 cells |
| `Delete` | Clear the selected area on every layer |
| `Esc` | Drop the selection |
| `L` / `Shift+L` | Same pick for all list cells in the selection / remove that |
| `P` / `N` | Random preview on/off / new preview seed |
| `Space` + drag / middle drag | Pan |
| Wheel | Zoom |
| `0` | Fit to view |
| `G` / `D` | Toggle grid / dim other layers |
| `/` | Search palette |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+S` / `Ctrl+O` | Save / open |

## Sharing a domain

There is no server. To share a domain, send the `.domain.json` file or add it to a pull request in the game repository,
together with the `.list.json` files of any random lists it uses (**Lists → Export lists used by this domain**).
[game-integration.md](game-integration.md) explains where it goes and how the game uses it.

## Credits

The **Credits** button lists the source, license and copyright of every sprite in the palette. Sprites come from the
game repository and keep their original licenses, mostly CC-BY-SA 3.0.
