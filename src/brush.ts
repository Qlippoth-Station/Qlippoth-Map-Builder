// Everything that depends on the shape of a brush lives here, so new brush kinds
// (tile sets, random modes) only have to be taught to this module.

/**
 * What a cell becomes in the game. Only fixed brushes exist for now;
 * tile sets and random modes (weak/default/full/chance) will extend this union.
 */
export type Brush = { kind: "fixed"; id: string };

export function fixedBrush(id: string): Brush {
  return { kind: "fixed", id };
}

export function sameBrush(a: Brush | null | undefined, b: Brush | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  switch (a.kind) {
    case "fixed":
      return b.kind === "fixed" && a.id === b.id;
  }
}

/** Every prototype id the brush can place. Used by checks and palette lookups. */
export function brushIds(brush: Brush): string[] {
  switch (brush.kind) {
    case "fixed":
      return [brush.id];
  }
}

/** The id used to draw the brush, pick it back up and name it in the UI. */
export function primaryId(brush: Brush): string {
  switch (brush.kind) {
    case "fixed":
      return brush.id;
  }
}

/** Reads a brush from file data. Returns null for anything that is not a valid brush. */
export function parseBrush(raw: unknown): Brush | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  switch (data.kind) {
    case "fixed":
      return typeof data.id === "string" && data.id !== "" ? fixedBrush(data.id) : null;
    default:
      return null;
  }
}
