import { describe, expect, it } from "vitest";
import Ajv from "ajv/dist/2020";
import weakText from "../fixtures/lists/weak_walls.list.json?raw";
import crateText from "../fixtures/lists/maybe_crate.list.json?raw";
import schemaText from "../docs/list.schema.json?raw";
import {
  CHANCE_SCALE,
  chances,
  createList,
  equalChances,
  hasEmptyChoice,
  itemEntries,
  listIdFromName,
  parseList,
  requiredListVersion,
  serializeList,
  setEntryChance,
  uniqueListId,
  type ListEntry,
} from "./lists";
import { loadBuiltInLists } from "./builtinLists";

const validate = new Ajv({ allErrors: true }).compile(JSON.parse(schemaText));

describe("list files", () => {
  it("round-trip the fixtures byte for byte", () => {
    expect(serializeList(parseList(weakText))).toBe(weakText);
    expect(serializeList(parseList(crateText))).toBe(crateText);
  });

  it("match the list schema", () => {
    for (const text of [weakText, crateText, serializeList(createList("x", "X", "floor")), serializeList({ ...createList("y", "Y", "floor"), symbol: "bricks" })]) {
      expect(validate(JSON.parse(text)), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it("read the empty choice and the symbol, and use version 2 only when needed", () => {
    const crate = parseList(crateText);
    expect(hasEmptyChoice(crate)).toBe(true);
    expect(itemEntries(crate).map((entry) => entry.id)).toEqual(["CrateGenericSteel", "CratePlastic"]);
    expect(requiredListVersion(crate)).toBe(2);
    expect(requiredListVersion(parseList(weakText))).toBe(1);
    const withSymbol = parseList(serializeList({ ...parseList(weakText), symbol: "bricks" }));
    expect([withSymbol.symbol, requiredListVersion(withSymbol)]).toEqual(["bricks", 2]);
  });

  it("make ids from names", () => {
    expect(listIdFromName("Weak walls")).toBe("weak_walls");
    expect(listIdFromName("  Güçlü Duvarlar! ")).toBe("guclu_duvarlar");
    expect(listIdFromName("Kırık ışık")).toBe("kirik_isik");
    expect(listIdFromName("!!!")).toBe("list");
    expect(uniqueListId("Weak walls", ["weak_walls", "weak_walls_2"])).toBe("weak_walls_3");
  });

  it("reject invalid files with a readable message", () => {
    const valid = JSON.parse(weakText);
    const text = (changes: Record<string, unknown>) => JSON.stringify({ ...valid, ...changes });
    expect(() => parseList("nope")).toThrow(/JSON/);
    expect(() => parseList(text({ format: "qlippoth-domain" }))).toThrow(/Not a Qlippoth list/);
    expect(() => parseList(text({ version: 3 }))).toThrow(/newer than this editor/);
    expect(() => parseList(text({ version: 0 }))).toThrow(/Unsupported/);
    expect(() => parseList(text({ id: "Weak Walls" }))).toThrow(/snake_case/);
    expect(() => parseList(text({ layer: "marker" }))).toThrow(/floor, structure or object/);
    expect(() => parseList(text({ entries: [{ id: "A", weight: 0 }] }))).toThrow(/Weight/);
    expect(() => parseList(text({ entries: [{ weight: 1 }] }))).toThrow(/needs an id/);
    expect(() => parseList(text({ entries: [{ empty: true }] }))).toThrow(/version 2/);
    expect(() => parseList(text({ version: 2, entries: [{ empty: true }, { empty: true }] }))).toThrow(/only one empty/);
    expect(() => parseList(text({ version: 2, entries: [{ empty: true, id: "A" }] }))).toThrow(/not both/);
    expect(() => parseList(text({ icon: { symbol: "bricks" } }))).toThrow(/version 2/);
  });

  it("fill in a missing weight, name and icon", () => {
    const list = parseList(JSON.stringify({ format: "qlippoth-list", version: 1, id: "x", layer: "floor", entries: [{ id: "A" }] }));
    expect(list).toEqual({ ...createList("x", "x", "floor"), glyph: "?", entries: [{ id: "A", weight: 1 }] });
  });
});

describe("chances", () => {
  const entries = (...weights: number[]): ListEntry[] => weights.map((weight, i) => ({ id: `E${i}`, weight }));
  const sum = (list: ListEntry[]) => list.reduce((total, entry) => total + entry.weight, 0);

  it("are the weights in percent", () => {
    expect(chances(entries(3, 1))).toEqual([75, 25]);
    expect(chances([])).toEqual([]);
  });

  it("setting one keeps the total at 100 % and the others in proportion", () => {
    const result = setEntryChance(entries(1, 1, 2), 0, 50);
    expect(sum(result)).toBe(CHANCE_SCALE);
    expect(chances(result)[0]).toBe(50);
    expect(Math.abs(result[2].weight / result[1].weight - 2)).toBeLessThan(0.02);
  });

  it("keeps every entry at least 0.1 % and rounds to 0.1 %", () => {
    const high = setEntryChance(entries(1, 1, 1), 1, 100);
    expect(high.map((entry) => entry.weight)).toEqual([1, 998, 1]);
    const low = setEntryChance(entries(1, 1), 0, 0);
    expect(low.map((entry) => entry.weight)).toEqual([1, 999]);
    expect(chances(setEntryChance(entries(1, 1, 1), 2, 33.33))[2]).toBeCloseTo(33.3, 5);
  });

  it("adds up exactly for awkward splits", () => {
    for (let n = 2; n <= 12; n++) {
      for (const percent of [0.1, 7.7, 33.3, 50, 99.9]) {
        const result = setEntryChance(entries(...Array.from({ length: n }, (_, i) => i + 1)), n - 1, percent);
        expect(sum(result)).toBe(CHANCE_SCALE);
        expect(result.every((entry) => entry.weight >= 1)).toBe(true);
      }
    }
  });

  it("does nothing for a single entry and can be evened out", () => {
    const single = entries(5);
    expect(setEntryChance(single, 0, 30)).toBe(single);
    expect(equalChances(entries(5, 1, 900)).map((entry) => entry.weight)).toEqual([1, 1, 1]);
  });
});

describe("built-in lists", () => {
  it("are all valid, named after their id and unique", () => {
    const { lists, problems } = loadBuiltInLists();
    expect(problems).toEqual([]);
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.every((list) => list.builtIn)).toBe(true);
  });
});
