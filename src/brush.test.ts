import { describe, expect, it } from "vitest";
import { baseBrush, brushIds, fixedBrush, listBrush, parseBrush, sameBrush } from "./brush";
import { createList } from "./lists";

const weak = { ...createList("weak_walls", "Weak walls", "structure"), entries: [{ id: "WallSolid", weight: 2 }, { id: "Grille", weight: 1 }] };
const lookup = (id: string) => (id === weak.id ? weak : undefined);

describe("brush", () => {
  it("compares brushes by value, including the group", () => {
    expect(sameBrush(fixedBrush("A"), fixedBrush("A"))).toBe(true);
    expect(sameBrush(fixedBrush("A"), fixedBrush("B"))).toBe(false);
    expect(sameBrush(null, undefined)).toBe(true);
    expect(sameBrush(fixedBrush("A"), null)).toBe(false);
    expect(sameBrush(listBrush("a"), listBrush("a"))).toBe(true);
    expect(sameBrush(listBrush("a", 1), listBrush("a", 1))).toBe(true);
    expect(sameBrush(listBrush("a", 1), listBrush("a"))).toBe(false);
    expect(sameBrush(listBrush("a"), fixedBrush("a"))).toBe(false);
  });

  it("lists the ids a brush can place", () => {
    expect(brushIds(fixedBrush("A"), lookup)).toEqual(["A"]);
    expect(brushIds(listBrush("weak_walls", 3), lookup)).toEqual(["WallSolid", "Grille"]);
    expect(brushIds(listBrush("not_loaded"), lookup)).toEqual([]);
  });

  it("drops the group for the palette selection", () => {
    expect(baseBrush(listBrush("a", 4))).toEqual(listBrush("a"));
    expect(baseBrush(fixedBrush("A"))).toEqual(fixedBrush("A"));
  });

  it("parses valid brushes and rejects everything else", () => {
    expect(parseBrush({ kind: "fixed", id: "A", extra: 1 })).toEqual(fixedBrush("A"));
    expect(parseBrush({ kind: "list", list: "weak_walls" })).toEqual(listBrush("weak_walls"));
    expect(parseBrush({ kind: "list", list: "weak_walls", group: 2 })).toEqual(listBrush("weak_walls", 2));
    for (const raw of [
      null,
      "A",
      {},
      { kind: "fixed" },
      { kind: "fixed", id: "" },
      { kind: "fixed", id: 3 },
      { kind: "set", id: "A" },
      { kind: "list", list: "Weak Walls" },
      { kind: "list", list: "weak_walls", group: 0 },
      { kind: "list", list: "weak_walls", group: 1.5 },
    ]) {
      expect(parseBrush(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});
