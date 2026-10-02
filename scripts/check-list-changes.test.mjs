import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { compareLists, describeChange, formatReport } from "./check-list-changes.mjs";
import { EDITOR_ROOT } from "./game-dir.mjs";

const list = (id, entries, extra = {}) => ({ format: "qlippoth-list", version: 1, id, name: id, layer: "structure", entries, ...extra });
const files = (...lists) => new Map(lists.map((data) => [`${data.id}.list.json`, data]));
const domain = (name, listIds) => ({ name, data: { layers: { structure: Object.fromEntries(listIds.map((id, x) => [`${x},0`, { kind: "list", list: id }])) } } });

const weak = list("weak_walls", [{ id: "WallSolid", weight: 3 }, { id: "Grille", weight: 1 }]);

describe("compareLists", () => {
  it("accepts new lists and name or icon changes", () => {
    const result = compareLists(files(weak), files({ ...weak, name: "Weak", icon: { glyph: "X" } }, list("new_one", [{ id: "A" }])));
    expect(result.added.map((item) => item.id)).toEqual(["new_one"]);
    expect(result.cosmetic.map((item) => item.id)).toEqual(["weak_walls"]);
    expect(result.blocking).toEqual([]);
  });

  it("blocks changed entries and names the domains that use the list", () => {
    const changed = { ...weak, entries: [{ id: "WallSolid", weight: 1 }, { id: "Girder", weight: 1 }] };
    const result = compareLists(files(weak), files(changed), [domain("a.domain.json", ["weak_walls"]), domain("b.domain.json", ["other"])]);
    expect(result.blocking).toHaveLength(1);
    expect(result.changed[0]).toMatchObject({ id: "weak_walls", usedBy: ["a.domain.json"], details: "added Girder; removed Grille; new chances for WallSolid" });
  });

  it("blocks removing a list that is still used, not one that is unused", () => {
    expect(compareLists(files(weak), files(), [domain("a.domain.json", ["weak_walls"])]).blocking).toHaveLength(1);
    expect(compareLists(files(weak), files(), []).blocking).toEqual([]);
  });

  it("treats a reorder as a change, because it changes what a seed picks", () => {
    const reordered = { ...weak, entries: [...weak.entries].reverse() };
    expect(describeChange(weak, reordered)).toMatch(/reordered/);
    expect(compareLists(files(weak), files(reordered)).blocking).toHaveLength(1);
  });

  it("describes the empty choice", () => {
    expect(describeChange(weak, { ...weak, entries: [...weak.entries, { empty: true, weight: 2 }] })).toBe("added (nothing)");
  });
});

describe("report and exit code", () => {
  it("asks for approval, and shows it once given", () => {
    const changed = { ...weak, entries: [{ id: "WallSolid", weight: 1 }] };
    const result = compareLists(files(weak), files(changed));
    expect(formatReport(result)).toMatch(/needs approval[\s\S]*list-change-approved/);
    expect(formatReport(result, { approved: true })).toMatch(/approved/);
    expect(formatReport(compareLists(files(weak), files(weak)))).toMatch(/No list changes/);
  });

  it("fails without approval, passes with it, and never passes removing a used list", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lists-"));
    const write = (dir, data) => {
      fs.mkdirSync(path.join(tmp, dir), { recursive: true });
      fs.writeFileSync(path.join(tmp, dir, `${data.id}.list.json`), JSON.stringify(data));
    };
    write("base", weak);
    write("head", { ...weak, entries: [{ id: "WallSolid", weight: 1 }] });
    fs.mkdirSync(path.join(tmp, "empty"));
    fs.mkdirSync(path.join(tmp, "domains"));
    fs.writeFileSync(path.join(tmp, "domains", "a.domain.json"), JSON.stringify(domain("a", ["weak_walls"]).data));
    const run = (...args) => {
      try {
        execFileSync("node", [path.join(EDITOR_ROOT, "scripts/check-list-changes.mjs"), ...args], { stdio: "pipe" });
        return 0;
      } catch (error) {
        return error.status;
      }
    };
    const base = path.join(tmp, "base");
    expect(run("--base", base, "--head", path.join(tmp, "head"))).toBe(1);
    expect(run("--base", base, "--head", path.join(tmp, "head"), "--approved")).toBe(0);
    expect(run("--base", base, "--head", path.join(tmp, "empty"), "--domains", path.join(tmp, "domains"), "--approved")).toBe(1);
    const summary = path.join(tmp, "summary.md");
    run("--base", base, "--head", base, "--summary", summary);
    expect(fs.readFileSync(summary, "utf8")).toMatch(/No list changes/);
    fs.rmSync(tmp, { recursive: true });
  });
});
