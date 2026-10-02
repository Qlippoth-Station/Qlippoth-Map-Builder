import { describe, expect, it } from "vitest";
import Ajv from "ajv/dist/2020";
import weakText from "../fixtures/lists/weak_walls.list.json?raw";
import schemaText from "../docs/list.schema.json?raw";
import { createList, listIdFromName, parseList, serializeList, uniqueListId } from "./lists";

describe("list files", () => {
  it("round-trip the fixture byte for byte", () => {
    expect(serializeList(parseList(weakText))).toBe(weakText);
  });

  it("match the list schema", () => {
    const validate = new Ajv({ allErrors: true }).compile(JSON.parse(schemaText));
    expect(validate(JSON.parse(weakText)), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(JSON.parse(serializeList(createList("x", "X", "floor"))))).toBe(true);
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
    expect(() => parseList(text({ version: 2 }))).toThrow(/version/);
    expect(() => parseList(text({ id: "Weak Walls" }))).toThrow(/snake_case/);
    expect(() => parseList(text({ layer: "marker" }))).toThrow(/floor, structure or object/);
    expect(() => parseList(text({ entries: [{ id: "A", weight: 0 }] }))).toThrow(/Weight/);
    expect(() => parseList(text({ entries: [{ weight: 1 }] }))).toThrow(/needs an id/);
  });

  it("fill in a missing weight, name and icon", () => {
    const list = parseList(JSON.stringify({ format: "qlippoth-list", version: 1, id: "x", layer: "floor", entries: [{ id: "A" }] }));
    expect(list).toEqual({ ...createList("x", "x", "floor"), glyph: "?", entries: [{ id: "A", weight: 1 }] });
  });
});
