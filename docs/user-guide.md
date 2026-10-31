# User guide

This guide explains how to use the Qlippoth Map Builder, step by step. You do not need to know any programming.
It covers making a map, saving it, opening it again, putting maps together, and getting a station into the game.

- [What the tool does](#what-the-tool-does)
- [The screen](#the-screen)
- [Making a map](#making-a-map)
- [Changing what you made](#changing-what-you-made)
- [Saving, opening and autosave](#saving-opening-and-autosave)
- [Putting maps together (Add)](#putting-maps-together-add)
- [Modules: parts you reuse](#modules-parts-you-reuse)
- [Getting a station into the game](#getting-a-station-into-the-game)
- [Common problems](#common-problems)

## What the tool does

The Map Builder is a website where you draw Space Station 14 maps, a bit like a paint program. Instead of colours
you paint with the game's own floors, walls, doors and objects, with their real pictures. When you are done, you save
a file the game can read.

It has two **modes**, switched with the buttons in the top left corner:

| Mode | What you make | The saved file |
|---|---|---|
| **Domain** | Rift domains for the Q-Gate | a `.domain.json` file |
| **Station** | Whole stations, or parts of one (a department, a room) | a `.yml` file, the same kind the game uses for its own maps |

Each mode remembers its own map. Switching modes does not lose anything.

Everything happens in your browser. Nothing is uploaded; your work stays on your computer.

## The screen

| Where | What is there |
|---|---|
| **Top bar** | Mode switch, the map's name and size, **New**, **Open**, **Add**, **Save**, **Undo**/**Redo**, **Game**, **Codebase**, **?** (shortcuts), **Guide** (a step-by-step tour of the screen), **Credits** |
| **Left side** | **Tools** (what the mouse does), **Layers**, **View** options and the **Checks** list (problems in the map) |
| **Middle** | The map |
| **Right side** | Three tabs: **Palette** (things to paint with), **Modules** (saved map parts), **Random** (random choices) |
| **Bottom** | Status bar: which codebase the pictures come from, the cell under the mouse |

Moving around the map:

- **Mouse wheel**: zoom in and out.
- **Hold Space and drag**, or drag with the **middle mouse button**: move the view.
- **0**: fit the whole map on the screen.

## Making a map

### 1. Start a new map

Press **New**, type a name, choose a width and height (in tiles), and press **Create**. You can change the size later in
the top bar.

To start from an existing game map instead, see [Opening](#opening) below.

### 2. Pick a layer

A map is made of layers stacked on top of each other, like sheets of glass:

| Layer | What goes on it |
|---|---|
| **Floor** | Floor tiles (steel floor, carpet, grass…). Where there is no floor, there is space. |
| **Structure** | Walls, windows, doors, grilles, girders |
| **Object** | Everything else: furniture, machines, lights, pipes, cables, items |
| **Marker** | Domain mode only: Entry points and Qlippoth spots |

Click a layer in the **Layers** panel on the left (or press **1**, **2**, **3**, **4**). The eye button next to a layer
hides or shows it.

### 3. Pick something to paint with

The **Palette** tab on the right shows everything for the chosen layer. Type in the search box to find something by
name (press **/** to jump there), or choose a category. Click an item to pick it.

Some items the game hides from its own spawn menu; they only show up when you search for them.

### 4. Choose an action and a shape

In the **Tools** panel you choose two things: an **action** (what happens) and a **shape** (where it happens).
Every action works with every shape.

| Action | Key | What it does |
|---|---|---|
| **Brush** | B | Paints the picked item |
| **Erase** | E | Clears cells on the current layer |
| **Select** | M | Marks cells, so you can move, fill or erase them |

| Shape | Key | How you use it |
|---|---|---|
| **Single** | S | Click one cell, or drag to make a line |
| **Rectangle** | R | Drag a box |
| **Fill** | F | Click, and the whole connected area of the same thing changes (like a paint bucket) |

So, for example, **Brush + Rectangle** paints a box of floor, **Erase + Fill** clears a whole room's floor, and
**Select + Rectangle** selects a box.

**Right click** a cell to pick what is in it (like an eyedropper) and to see everything in that cell.

In station mode, a cell can hold several things at once, like in the game (a table with a lamp on it). Painting adds
to what is already there; erasing clears the cell.

### 5. Turn things

Press **T** to turn what you are about to place a quarter turn clockwise, **Shift+T** for counter-clockwise. The
picture on the map shows the direction.

### 6. Look at the checks

The **Checks** list on the left tells you about problems: unknown items, items the game renamed or removed, missing
spawn points, and so on. Click a problem to jump to it.

Problems are listed in groups (spawn points, power & gravity, atmosphere, lighting, construction, game data), each with
its own colour on the left edge. Inside a group the critical ones come first, and two levels tell them apart:

- **Critical (red !)**: the game will not load the map, or the map cannot really be played. For example an unknown
  item (the game refuses the whole map), a domain without an Entry marker or with a marker in space or in a wall, or
  an exportable station without power, gravity, late-join or job spawn points, or with a module edge open to space.
  Exporting to the game asks you to confirm while there are red problems.
- **Warning (yellow dot)**: the map works, but something is odd or missing. For example no lights (the station is pitch
  black), a renamed or removed item, no air vents, or entities standing in space.

Stations have two **profiles**, switched above the Checks list:

- **Draft** (normal): only the basic checks (unknown, renamed or removed items, lights). Use it while you work and for quick tests.
- **Exportable**: also checks what a playable station needs (job spawn points, power, air, gravity, nothing standing
  in space). Use it before you hand in a finished station.

Stations also have two **submodes**, switched at the top of the Checks list:

- **Station** (normal): a whole station, with the station-wide checks.
- **Department**: one department, built on its own to be added to a station later. Station-wide problems (gravity
  generator, SMES, late-join spawn, ...) are not listed. Choose the department, then tick the parts it has, for
  example *Engineering*, *Engine & power storage*, *Atmospherics*. The checks then ask for what that department has in
  a normal station: its job spawn points, lockers, vendors and machines. The department's problems are shown first,
  in the department's colour.

## Changing what you made

### Selecting and moving

1. Choose **Select**, then drag a box over what you want to move. **Shift**+click adds to the selection,
   **Alt**+click removes from it. **Ctrl+A** selects everything.
2. Drag the selection with the mouse, or use the **arrow keys** (Shift+arrow moves 10 cells).
3. Press **T** to turn it.
4. Press **Enter** (or **Place**) to put it down, or **Esc** (or **Cancel**) to put it back where it was.

While something is selected, the **Selection** panel can **Fill** it with the picked item or **Erase** it. The
**All layers** box decides whether moving and erasing takes every layer or only the current one.

### Changing one thing in a cell

Right click a cell: the **Cell** panel lists everything in it. **⟳** turns one item, **✕** removes it.

### Undo

**Undo** and **Redo** in the top bar (or **Ctrl+Z** / **Ctrl+Y**) take back or redo your last steps.

## Saving, opening and autosave

### Autosave

The tool saves your work in the browser by itself, a moment after every change. If you close the tab and come back,
your map is still there. This is only a safety net: it lives in that one browser on that one computer. Use **Save**
to keep a real copy.

### Saving

Press **Save** (or **Ctrl+S**). The browser downloads the file:

- a **station** becomes a `.yml` map file, ready for the game;
- a **domain** becomes a `.domain.json` file.

Keep these files; they are your map. You can send them to others, put them in the game, or open them again later.

### Opening

Press **Open** (or **Ctrl+O**) and choose a file. The tool switches to the right mode by itself. You can open:

- files you saved from this tool;
- **the game's own maps**: any `.yml` file from the game's `Resources/Maps` folder (for example `box.yml`);
- maps saved from inside the game with `savemap` (see [Getting a station into the game](#getting-a-station-into-the-game)).

Opening replaces the map you have open. If it has unsaved changes, the tool asks first.

When you open a game map and save it without changing anything, the file comes out exactly the same. When you change
something, only that part of the file changes. Things the tool does not show (the contents of lockers, wiring between
buttons and doors, decals) are kept as they were.

## Putting maps together (Add)

**Add** (or **Ctrl+Shift+O**) brings another file **into** the map you have open, instead of replacing it. This is how
you build a station department by department: make medical in one map, security in another, then add them all into
the main station.

1. Press **Add** and choose a file.
2. The added map appears in the middle of the screen, floating above your map.
3. Drag it (or use the arrow keys) to where it should go. Press **T** to turn it.
4. Press **Enter** or **Place** to put it down. **Esc** or **Cancel** throws it away.

Good to know:

- You can only add a station to a station and a domain to a domain. Mixing them is refused with a message.
- If the added map is bigger than yours, the tool offers to make your map bigger.
- Things brought in with Add are placed new, the way you would place them by hand. Locker contents and wiring from
  the other file do not come along.

## Modules: parts you reuse

A **module** is a saved piece of a map (a room, a department, a corridor) kept in the **Modules** tab, ready to place
again and again.

1. Select an area, open the **Modules** tab and press **Save selection**. Give it a name.
2. To use it, press **Place** next to it. It floats like an added map: move it, turn it with **T**, put it down with
   **Enter**.
3. If you save a module again under the same name, it gets a new version. Maps that use an older version show an
   **Update** button: it replaces every placed copy with the new version in one step.

**Save project** downloads one `.zip` with the map and all its modules, to share a whole project with someone.
**Open project** reads it back.

Modules live in your browser. Use **Export** on a module, or **Save project**, to keep a copy as a file.

## Getting a station into the game

There are three ways, from quickest to most complete.

### Way 1: quick test with the Game button (Chrome or Edge)

This is the fastest way to try a station on a game server running on your own computer. The tool writes the map
straight into the server's folder, so there is nothing to download or copy.

**Why it works:** the game server has a data folder. The game's `loadmap` command reads maps from that folder, and its
`savemap` command writes maps into it. The **Game** button lets the tool use that same folder.

**First time only, link the folder:**

1. Press **Game** in the top bar, then **Link folder…**.
2. Choose the server's data folder. For a server you built yourself from the game's code, it is
   `bin/Content.Server/data` inside the game folder.
3. The browser asks whether the site may view and change files in that folder. Allow it.

The browser remembers the folder. Next time it may only ask you to allow it again.

**Every time you want to test:**

1. Start the game server and join it. You need admin rights; on your own local server you have them.
2. In the tool, press **Game**, then **Export station here**. The station is written into the folder.
3. The Game window shows the commands to type in the game's console. Each has a **Copy** button:

   | Command | What it does |
   |---|---|
   | `loadmap 10 /your-station.yml` | Loads the station as a new map, number 10. Any unused number works. |
   | `mapinit 10` | Starts the map. A loaded map is paused: nothing on it moves, you included, until it is started. |
   | `tp -22 -22 10` | Takes you to the station on map 10: to its observer spawn point (`SpawnPointObserver`) if it has one, else to the floor tile nearest the middle of what you painted. The tool works out the numbers. |
   | `togglelight` | Turns lighting off on your screen, so a station without lights is not all black. Run it again to turn it back on. |
   | `savemap 10 /your-station.yml true` | Saves what you changed in the game back into the folder. `true` is needed because the map was started. |

4. Walk around and check it.

A started map is saved as it is at that moment: random spawners have already picked their items, and things that
only appear when a round starts are there. For changes you want to keep, make them in the tool.

**Bringing in-game changes back to the tool:** after `savemap`, open **Game** again (press **Refresh** if needed).
The file is in the **Maps in the folder** list. **Open** opens it; **Add** adds it into the map you have open.

### Way 2: quick test without Chrome or Edge

Other browsers cannot link folders, but the steps are almost the same:

1. Press **Save**. The station's `.yml` file is downloaded.
2. Copy that file into the game server's data folder yourself.
3. Use the same `loadmap`, `mapinit` and `tp` commands in the game's console. The **Game** window still shows them.
4. After `savemap`, open the saved file from the data folder with **Open**.

### Way 3: adding the station to the game for real

To make the station part of the game, so it can be voted for and played in normal rounds:

1. Switch the profile to **Exportable** and fix what the **Checks** list shows.
2. Press **Export package**. You get a `.zip` file.
3. Unzip it. Inside are a `Resources` folder and a `README.txt`. Copy the `Resources` folder into the game's code
   folder. It only adds new files, nothing is replaced:
   - `Resources/Maps/your-station.yml`: the station map;
   - `Resources/Prototypes/Maps/your-station.yml`: the station's entry for the game (its name, and how many of each
     job it has, counted from the job spawn points you placed).
4. Open that second file and check the job numbers.
5. To play it once: type `forcemap` and the station's id (shown in `README.txt`) in the server console, then restart
   the round.
6. To put it in the normal map rotation, add the station's id to the maps list in
   `Resources/Prototypes/Maps/Pools/default.yml`.

If the station uses random rooms (from the **Random** tab), the package also has the rooms and explains them in
`README.txt`.

## Using another game codebase

The palette's names and pictures come from one game codebase, Qlippoth Station by default. **Codebase** in the top bar lists the codebases served with the editor and lets you build the palette of any public SS14 fork from its GitHub link.

Press **Use…** next to a codebase to see what changes before you switch: how many objects it removes and adds, listed by the prototype file they are defined in (click a file to see its objects). It also warns when objects placed in the open map would be missing in the other codebase. **Use** switches; **Back** keeps the current one.

## Common problems

| Problem | What to do |
|---|---|
| A cell shows a **?** | The item's id is unknown to the palette. The Checks list says which one. It can come from an older map or another codebase. |
| `loadmap` says the file does not exist | The linked folder is not the server's data folder. Link the right one, and start the path with `/`, as in `/your-station.yml`. |
| The **Game** button cannot link a folder | Your browser does not support it. Use Chrome or Edge, or [Way 2](#way-2-quick-test-without-chrome-or-edge). |
| `savemap` refuses to save | The map was started with `mapinit`; add `true` at the end: `savemap 10 /your-station.yml true`. |
| After `tp` I see only space | Use the `tp` command from the **Game** window: it points at the station (its observer spawn point, or the floor nearest its middle), which is not always at `0 0`. |
| I cannot move on the loaded map | The map is still paused. Run `mapinit 10` (with your map number). |
| Everything is black | The station has no lights. Type `togglelight` to see it anyway, or place lights (Object layer). |
| My work is gone after clearing the browser | Autosave lives in the browser. Keep important maps with **Save**, and modules with **Save project**. |
| Add says the file is the wrong kind | A domain cannot be added to a station, or the other way round. Switch mode first. |

Press **?** in the tool for the full list of keyboard shortcuts.
