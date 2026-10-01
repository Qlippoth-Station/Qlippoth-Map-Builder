import { describe, expect, it } from "vitest";
import { brushIds, fixedBrush, parseBrush, primaryId, sameBrush } from "./brush";

describe("brush", () => {
  it("compares brushes by value", () => {
    expect(sameBrush(fixedBrush("A"), fixedBrush("A"))).toBe(true);
    expect(sameBrush(fixedBrush("A"), fixedBrush("B"))).toBe(false);
    expect(sameBrush(null, undefined)).toBe(true);
    expect(sameBrush(fixedBrush("A"), null)).toBe(false);
  });

  it("lists the ids a brush places", () => {
    expect(brushIds(fixedBrush("A"))).toEqual(["A"]);
    expect(primaryId(fixedBrush("A"))).toBe("A");
  });

  it("parses valid brushes and rejects everything else", () => {
    expect(parseBrush({ kind: "fixed", id: "A", extra: 1 })).toEqual(fixedBrush("A"));
    for (const raw of [null, "A", {}, { kind: "fixed" }, { kind: "fixed", id: "" }, { kind: "fixed", id: 3 }, { kind: "set", id: "A" }]) {
      expect(parseBrush(raw)).toBeNull();
    }
  });
});
