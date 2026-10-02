import { describe, expect, it } from "vitest";
import domainText from "../fixtures/v2-lists.domain.json?raw";
import rollsText from "../fixtures/v2-lists.rolls.json?raw";
import weak from "../fixtures/lists/weak_walls.list.json?raw";
import strong from "../fixtures/lists/strong_walls.list.json?raw";
import mixed from "../fixtures/lists/mixed_floor.list.json?raw";
import { LAYERS, cellKey, createDocument, deserialize } from "./document";
import { fixedBrush, listBrush } from "./brush";
import { createList, parseList } from "./lists";
import { hash32, normalizeSeed, pickEntry, resolveDocument } from "./resolve";

const lists = new Map([weak, strong, mixed].map((text) => parseList(text)).map((list) => [list.id, list]));
const lookup = (id: string) => lists.get(id);
const vectors: {
  hashes: { text: string; hash: number }[];
  results: { seed: number; rolls: Record<string, Record<string, string>> }[];
} = JSON.parse(rollsText);

describe("resolve (test vectors shared with the game)", () => {
  it("hashes like the reference", () => {
    for (const { text, hash } of vectors.hashes) expect(hash32(text), text).toBe(hash);
  });

  it("rolls every list cell of the fixture like the reference, for every seed", () => {
    const doc = deserialize(domainText);
    for (const { seed, rolls } of vectors.results) {
      const resolved = resolveDocument(doc, lookup, seed);
      for (const layer of LAYERS) {
        for (const [key, id] of Object.entries(rolls[layer] ?? {})) expect(resolved[layer].get(key), `seed ${seed} ${layer} ${key}`).toBe(id);
      }
    }
  });
});

describe("resolve", () => {
  it("gives every cell of a group the same pick and keeps fixed cells", () => {
    const doc = deserialize(domainText);
    for (let seed = 0; seed < 200; seed++) {
      const structure = resolveDocument(doc, lookup, seed).structure;
      expect(new Set(["2,0", "3,0", "4,0"].map((key) => structure.get(key))).size).toBe(1);
      expect(structure.get("5,3")).toBe("WallSolid");
    }
  });

  it("only picks entries of the list, roughly by weight", () => {
    const doc = createDocument("Weights", 100, 100);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) doc.layers.floor.set(cellKey(x, y), listBrush("mixed_floor"));
    const counts = new Map<string, number>();
    for (const id of resolveDocument(doc, lookup, 7).floor.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(["FloorSteel", "FloorSteelDirty", "Plating"]);
    // Weights 5 : 2 : 1 over 10 000 cells.
    expect(counts.get("FloorSteel")! / 10000).toBeCloseTo(5 / 8, 1);
    expect(counts.get("Plating")! / 10000).toBeCloseTo(1 / 8, 1);
  });

  it("leaves out cells whose list is missing or empty", () => {
    const doc = createDocument("Missing", 2, 1);
    doc.layers.floor.set("0,0", listBrush("not_loaded"));
    doc.layers.floor.set("1,0", fixedBrush("FloorSteel"));
    expect([...resolveDocument(doc, lookup, 1).floor]).toEqual([["1,0", "FloorSteel"]]);
    expect(pickEntry(createList("empty", "Empty", "floor"), 5)).toBeNull();
  });

  it("keeps seeds in the unsigned 32-bit range", () => {
    expect(normalizeSeed(-1)).toBe(4294967295);
    expect(normalizeSeed(2 ** 32 + 5)).toBe(5);
    expect(normalizeSeed(3.9)).toBe(3);
  });
});
