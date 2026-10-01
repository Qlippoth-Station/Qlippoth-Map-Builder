import { describe, expect, it } from "vitest";
import { Editor } from "./editor";
import { LAYERS, createDocument } from "./document";
import { fixedBrush } from "./brush";
import { MARKERS, type Palette, type PaletteItem } from "./palette";

function testPalette(): Palette {
  const items: PaletteItem[] = [
    { id: "FloorSteel", name: "Steel floor", layer: "floor", category: "Floor", icon: 0 },
    { id: "WallSolid", name: "Solid wall", layer: "structure", category: "Structures/Walls", icon: 1 },
    { id: "Table", name: "Table", layer: "object", category: "Structures/Furniture", icon: 2 },
    ...MARKERS,
  ];
  const byLayer = Object.fromEntries(LAYERS.map((layer) => [layer, new Map<string, PaletteItem>()])) as Palette["byLayer"];
  for (const item of items) byLayer[item.layer].set(item.id, item);
  return { gameCommit: null, iconSize: 32, atlasColumns: 16, atlasUrl: "", atlas: null as unknown as HTMLImageElement, items, byLayer };
}

const floor = fixedBrush("FloorSteel");
const wall = fixedBrush("WallSolid");

function editor(width = 5, height = 5): Editor {
  return new Editor(testPalette(), createDocument("Test", width, height));
}

describe("editing", () => {
  it("sets cells, ignores out of bounds and no-op changes", () => {
    const e = editor();
    e.set("floor", 1, 1, floor);
    e.set("floor", 1, 1, floor);
    e.set("floor", 9, 9, floor);
    expect(e.doc.layers.floor.size).toBe(1);
    expect(e.canUndo).toBe(true);
    e.undo();
    expect(e.canUndo).toBe(false);
  });

  it("undoes and redoes a whole stroke at once", () => {
    const e = editor();
    e.beginStroke();
    e.set("floor", 0, 0, floor);
    e.set("floor", 1, 0, floor);
    e.endStroke();
    e.undo();
    expect(e.doc.layers.floor.size).toBe(0);
    e.redo();
    expect(e.doc.layers.floor.size).toBe(2);
  });

  it("fills rectangles clamped to the map", () => {
    const e = editor(4, 4);
    e.fillRect("floor", -2, 1, 1, 10, floor);
    expect(e.doc.layers.floor.size).toBe(2 * 3);
  });

  it("flood fills only the connected area of the same content", () => {
    const e = editor(5, 5);
    for (let y = 0; y < 5; y++) e.set("structure", 2, y, wall);
    e.floodFill("structure", 0, 0, fixedBrush("Table"));
    expect(e.doc.layers.structure.size).toBe(5 + 2 * 5);
    expect(e.get("structure", 4, 4)).toBeNull();
  });

  it("restores cells removed by a resize on undo", () => {
    const e = editor(5, 5);
    e.set("floor", 4, 4, floor);
    e.resize(3, 3);
    expect([e.doc.width, e.doc.height, e.doc.layers.floor.size]).toEqual([3, 3, 0]);
    e.undo();
    expect([e.doc.width, e.doc.height, e.doc.layers.floor.size]).toEqual([5, 5, 1]);
  });

  it("tracks unsaved changes", () => {
    const e = editor();
    expect(e.dirty).toBe(false);
    e.set("floor", 0, 0, floor);
    expect(e.dirty).toBe(true);
    e.markSaved();
    expect(e.dirty).toBe(false);
  });
});

describe("checks", () => {
  const messages = (e: Editor) => e.validate().map((warning) => warning.message);

  it("asks for an entry and a Qlippoth spot", () => {
    expect(messages(editor())).toEqual(["No Entry marker.", "No Qlippoth spot marker."]);
  });

  it("is clean for a valid domain", () => {
    const e = editor();
    e.fillRect("floor", 0, 0, 4, 4, floor);
    e.set("marker", 1, 1, fixedBrush("Entry"));
    e.set("marker", 3, 3, fixedBrush("QlippothSpot"));
    expect(messages(e)).toEqual([]);
  });

  it("flags duplicate entries, markers off floor or in walls and unknown ids", () => {
    const e = editor();
    e.set("marker", 0, 0, fixedBrush("Entry"));
    e.set("marker", 1, 0, fixedBrush("Entry"));
    e.set("marker", 2, 0, fixedBrush("QlippothSpot"));
    e.fillRect("floor", 1, 0, 2, 0, floor);
    e.set("structure", 2, 0, wall);
    e.set("object", 4, 4, fixedBrush("Missing"));
    expect(messages(e)).toEqual([
      "More than one Entry marker.",
      "Marker without a floor tile.",
      "Marker inside a wall.",
      'Unknown object id "Missing" (not in the current palette).',
    ]);
  });
});
