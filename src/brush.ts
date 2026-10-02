// Everything that depends on the shape of a brush lives here, so new brush kinds only have to be taught to this
// module; the type checker points at every switch below that has to handle them.

import { LIST_ID_PATTERN, type TileList } from "./lists";

/**
 * What a cell becomes in the game.
 * - fixed: always the same tile or entity.
 * - list: one entry of a random list, picked when the domain is built. Cells of the same list with the same `group`
 *   always get the same entry; cells without a group roll on their own. See docs/randomness.md.
 */
export type Brush = { kind: "fixed"; id: string } | { kind: "list"; list: string; group?: number };

export type ListBrush = Extract<Brush, { kind: "list" }>;

/** Looks up a loaded list by id. */
export type ListLookup = (id: string) => TileList | undefined;

export function fixedBrush(id: string): Brush {
  return { kind: "fixed", id };
}

export function listBrush(list: string, group?: number): Brush {
  return group === undefined ? { kind: "list", list } : { kind: "list", list, group };
}

export function sameBrush(a: Brush | null | undefined, b: Brush | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  switch (a.kind) {
    case "fixed":
      return b.kind === "fixed" && a.id === b.id;
    case "list":
      return b.kind === "list" && a.list === b.list && a.group === b.group;
  }
}

/** The same brush without its group: what the palette shows as selected and Pick picks up. */
export function baseBrush(brush: Brush): Brush {
  switch (brush.kind) {
    case "fixed":
      return brush;
    case "list":
      return listBrush(brush.list);
  }
}

/** Every prototype id the brush can place. A list that is not loaded places nothing we know of. */
export function brushIds(brush: Brush, lists: ListLookup): string[] {
  switch (brush.kind) {
    case "fixed":
      return [brush.id];
    case "list":
      return lists(brush.list)?.entries.flatMap((entry) => (entry.id === null ? [] : [entry.id])) ?? [];
  }
}

/** Reads a brush from file data. Returns null for anything that is not a valid brush. */
export function parseBrush(raw: unknown): Brush | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  switch (data.kind) {
    case "fixed":
      return typeof data.id === "string" && data.id !== "" ? fixedBrush(data.id) : null;
    case "list": {
      if (typeof data.list !== "string" || !LIST_ID_PATTERN.test(data.list)) return null;
      if (data.group === undefined) return listBrush(data.list);
      return Number.isInteger(data.group) && (data.group as number) >= 1 ? listBrush(data.list, data.group as number) : null;
    }
    default:
      return null;
  }
}
