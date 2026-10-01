import { describe, expect, it } from "vitest";
import { MIGRATIONS, migrate } from "./migrate";
import { FORMAT_VERSION } from "./document";

describe("migrate", () => {
  it("has one step for every version below the current one", () => {
    for (let version = 1; version < FORMAT_VERSION; version++) expect(MIGRATIONS[version], `missing step ${version} → ${version + 1}`).toBeTypeOf("function");
  });

  it("returns current files unchanged", () => {
    const data = { format: "qlippoth-domain", version: 1, name: "x" };
    expect(migrate(data, 1)).toBe(data);
  });

  it("runs every step in order and sets the version", () => {
    const steps = {
      1: (data: Record<string, unknown>) => ({ ...data, trail: [...(data.trail as number[]), 1] }),
      2: (data: Record<string, unknown>) => ({ ...data, trail: [...(data.trail as number[]), 2] }),
    };
    expect(migrate({ version: 1, trail: [] }, 3, steps)).toEqual({ version: 3, trail: [1, 2] });
    expect(migrate({ version: 2, trail: [] }, 3, steps)).toEqual({ version: 3, trail: [2] });
  });

  it("fails on a missing step, a newer version or an invalid version", () => {
    expect(() => migrate({ version: 1 }, 2, {})).toThrow(/No upgrade from format version 1/);
    expect(() => migrate({ version: 5 }, 2)).toThrow(/only knows up to 2/);
    expect(() => migrate({ version: 1.5 }, 2)).toThrow(/Invalid format version/);
    expect(() => migrate({}, 2)).toThrow(/Invalid format version/);
  });
});
