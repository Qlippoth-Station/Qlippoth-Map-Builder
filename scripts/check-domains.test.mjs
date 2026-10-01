import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkDomain } from "./check-domains.mjs";
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
