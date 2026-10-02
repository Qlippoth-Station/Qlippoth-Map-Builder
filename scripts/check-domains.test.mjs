import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkDomain, checkList, readBuiltInLists, sameListContent } from "./check-domains.mjs";
import { EDITOR_ROOT } from "./game-dir.mjs";

const fixture = fs.readFileSync(path.join(EDITOR_ROOT, "fixtures/v1-basic.domain.json"), "utf8");
const known = {
  floor: new Set(["FloorSteel"]),
  structure: new Set(["WallSolid"]),
  object: new Set(["Table"]),
  marker: new Set(),
};

function domain(changes) {
  const data = JSON.parse(fixture);
  changes(data);
  return JSON.stringify(data);
}

describe("checkDomain", () => {
  it("passes the fixture", () => {
    expect(checkDomain(fixture, "basic_room.domain.json", known)).toEqual([]);
  });

  it("asks for lowercase snake_case file names", () => {
    expect(checkDomain(fixture, "Basic Room.domain.json", known)).toHaveLength(1);
  });

  it("reports schema errors and stops", () => {
    expect(checkDomain("{}", "a.domain.json", known)[0]).toMatch(/^Schema:/);
    expect(checkDomain("{", "a.domain.json", known)[0]).toMatch(/^Not valid JSON/);
  });

  it("reports cells outside the map, unknown ids and marker problems", () => {
    const text = domain((data) => {
      data.layers.object["9,9"] = { kind: "fixed", id: "Missing" };
      data.layers.marker["0,0"] = { kind: "fixed", id: "Entry" };
      delete data.layers.marker["2,2"];
    });
    expect(checkDomain(text, "a.domain.json", known)).toEqual([
      "object 9,9: outside the 5×4 map.",
      'object: unknown id "Missing" in 1 cell(s), first at 9,9.',
      "Needs exactly one Entry marker, found 2.",
      "Needs at least one QlippothSpot marker.",
      "marker 0,0: not on a floor tile.",
    ]);
  });

  it("skips the id check without a palette", () => {
    const text = domain((data) => (data.layers.object["1,1"] = { kind: "fixed", id: "Missing" }));
    expect(checkDomain(text, "a.domain.json", null)).toEqual([]);
  });
});

describe("random lists", () => {
  const read = (name) => fs.readFileSync(path.join(EDITOR_ROOT, "fixtures", name), "utf8");
  const ids = {
    floor: new Set(["FloorSteel", "FloorSteelDirty", "Plating"]),
    structure: new Set(["WallSolid", "Grille", "Girder", "WallReinforced", "WallPlastitanium"]),
    object: new Set(["CrateGenericSteel", "CratePlastic"]),
    marker: new Set(),
  };
  const lists = new Map(
    ["weak_walls", "strong_walls", "mixed_floor", "maybe_crate"].map((id) => [id, checkList(read(`lists/${id}.list.json`), `${id}.list.json`, ids).list])
  );

  it("passes the list fixtures and the domain that uses them", () => {
    for (const id of lists.keys()) expect(checkList(read(`lists/${id}.list.json`), `${id}.list.json`, ids).problems).toEqual([]);
    expect(checkDomain(read("v2-lists.domain.json"), "random_lists.domain.json", ids, lists)).toEqual([]);
  });

  it("reports a wrong file name, unknown entries and schema errors", () => {
    expect(checkList(read("lists/weak_walls.list.json"), "weak.list.json", { ...ids, structure: new Set() }).problems).toEqual([
      "File name should be weak_walls.list.json (the list id).",
      'unknown structure id "WallSolid".',
      'unknown structure id "Grille".',
      'unknown structure id "Girder".',
    ]);
    expect(checkList("{}", "x.list.json", ids).problems[0]).toMatch(/^Schema:/);
  });

  it("reports missing lists, lists on the wrong layer and lists in a version 1 file", () => {
    const text = JSON.stringify({
      ...JSON.parse(fixture),
      layers: {
        ...JSON.parse(fixture).layers,
        object: { "2,1": { kind: "list", list: "nowhere" } },
        structure: { "0,0": { kind: "list", list: "mixed_floor" } },
      },
    });
    expect(checkDomain(text, "a.domain.json", known, lists)).toEqual([
      'structure 0,0: list "mixed_floor" is for the floor layer.',
      'object 2,1: list "nowhere" not found (add nowhere.list.json under Resources/Domains/Lists/).',
      "Uses random lists, which need format version 2.",
    ]);
  });
});

describe("empty choice and built-in lists", () => {
  const list = (changes) => JSON.stringify({ format: "qlippoth-list", version: 2, id: "x", layer: "object", entries: [{ id: "Table" }], ...changes });

  it("reports an only-empty list, two empty choices and version 1 files using version 2 features", () => {
    expect(checkList(list({ entries: [{ empty: true }] }), "x.list.json", null).problems).toEqual(["The list only has the empty choice."]);
    expect(checkList(list({ entries: [{ id: "Table" }, { empty: true }, { empty: true, weight: 2 }] }), "x.list.json", null).problems).toEqual([
      "A list can have only one empty choice.",
    ]);
    expect(checkList(list({ version: 1, entries: [{ id: "Table" }, { empty: true }] }), "x.list.json", null).problems[0]).toMatch(/^Schema:|version 2/);
  });

  it("compares a game list with the built-in one by content only", () => {
    const builtIn = readBuiltInLists();
    expect(builtIn.size).toBeGreaterThan(0);
    const [id, original] = [...builtIn][0];
    expect(sameListContent({ ...original, name: "Renamed", icon: { glyph: "Z" } }, original)).toBe(true);
    expect(sameListContent({ ...original, entries: original.entries.slice(1) }, original)).toBe(false);
    expect(id).toBe(original.id);
  });
});
