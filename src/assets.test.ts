import { describe, expect, it } from "vitest";
import { ART_CREDITS, ART_LICENSE } from "./assets";

// Every image in assets/, by path from the repository root.
const artFiles = Object.keys(import.meta.glob("../assets/**/*.{png,svg,webp,jpg,jpeg,gif}")).map((path) => path.replace(/^\.\.\//, "")).sort();

describe("art credits (assets/LICENSE.md)", () => {
  it("credit every image in assets/", () => {
    const credited = new Set(ART_CREDITS.map((credit) => credit.source));
    expect(artFiles.filter((file) => !credited.has(file)), "add these to assets/credits.json").toEqual([]);
  });

  it("only list files that exist, once each", () => {
    const sources = ART_CREDITS.map((credit) => credit.source);
    expect(sources.filter((source) => !artFiles.includes(source)), "remove these from assets/credits.json").toEqual([]);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("use CC-BY-SA 3.0 and name an author", () => {
    for (const credit of ART_CREDITS) {
      expect(credit.license, credit.source).toBe(ART_LICENSE);
      expect(credit.copyright?.trim(), credit.source).toBeTruthy();
    }
  });
});
