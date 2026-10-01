import { describe, expect, it } from "vitest";
import Ajv from "ajv/dist/2020";
import basicFixture from "../fixtures/v1-basic.domain.json?raw";
import schemaText from "../docs/format.schema.json?raw";
import { FORMAT_VERSION, cellKey, createDocument, deserialize, parseDocument, serialize } from "./document";
import { fixedBrush } from "./brush";

const validate = new Ajv({ allErrors: true }).compile(JSON.parse(schemaText));

function file(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: "qlippoth-domain",
    version: 1,
    name: "Test",
    width: 4,
    height: 3,
    layers: { floor: {}, structure: {}, object: {}, marker: {} },
    ...overrides,
  });
}

describe("serialize / deserialize", () => {
  it("round-trips the fixture byte for byte", () => {
    expect(serialize(deserialize(basicFixture))).toBe(basicFixture);
  });

  it("writes files that match the JSON schema", () => {
    const doc = createDocument("Schema", 3, 3);
    doc.layers.floor.set(cellKey(0, 0), fixedBrush("FloorSteel"));
    doc.layers.marker.set(cellKey(1, 2), fixedBrush("Entry"));
    expect(validate(JSON.parse(serialize(doc))), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(JSON.parse(basicFixture)), JSON.stringify(validate.errors)).toBe(true);
  });

  it("sorts cells by y, then x", () => {
    const doc = createDocument("Order", 3, 3);
    for (const [x, y] of [[2, 1], [0, 2], [1, 0], [0, 1]]) doc.layers.floor.set(cellKey(x, y), fixedBrush("F"));
    expect(Object.keys(JSON.parse(serialize(doc)).layers.floor)).toEqual(["1,0", "0,1", "2,1", "0,2"]);
  });

  it("writes the current format version", () => {
    expect(JSON.parse(serialize(createDocument("V", 1, 1))).version).toBe(FORMAT_VERSION);
  });
});

describe("parseDocument", () => {
  it("rejects files that are not domain files", () => {
    expect(() => parseDocument("not json")).toThrow(/JSON/);
    expect(() => parseDocument("null")).toThrow(/Not a Qlippoth domain file/);
    expect(() => parseDocument(file({ format: "something-else" }))).toThrow(/Not a Qlippoth domain file/);
  });

  it("rejects newer and invalid versions", () => {
    expect(() => parseDocument(file({ version: FORMAT_VERSION + 1 }))).toThrow(/only knows up to/);
    expect(() => parseDocument(file({ version: 0 }))).toThrow(/Invalid format version/);
    expect(() => parseDocument(file({ version: "1" }))).toThrow(/Invalid format version/);
  });

  it("reports what it drops instead of losing it silently", () => {
    const { document, problems } = parseDocument(
      file({
        layers: {
          floor: { "0,0": { kind: "fixed", id: "A" }, "9,9": { kind: "fixed", id: "B" } },
          structure: { "1,1": { kind: "mystery" }, "01,1": { kind: "fixed", id: "C" } },
          object: {},
          marker: {},
          extra: {},
        },
      })
    );
    expect([...document.layers.floor.keys()]).toEqual(["0,0"]);
    expect(document.layers.structure.size).toBe(0);
    expect(problems).toEqual([
      "1 floor cell(s) outside the map were dropped.",
      "2 structure cell(s) with an unknown key or brush were dropped.",
      'Unknown layer "extra" was skipped.',
    ]);
  });

  it("clamps an invalid size and says so", () => {
    const { document, problems } = parseDocument(file({ width: 1000, height: 0 }));
    expect([document.width, document.height]).toEqual([256, 1]);
    expect(problems).toHaveLength(1);
  });

  it("accepts files with missing layers", () => {
    const { document, problems } = parseDocument(file({ layers: { floor: { "0,0": { kind: "fixed", id: "A" } } } }));
    expect(document.layers.floor.size).toBe(1);
    expect(problems).toEqual([]);
  });
});
