import { LAYERS, type LayerId } from "./document";

/** What the game data says about an entity, read when the palette is built (see scripts/build-palette.mjs). */
export interface ItemFlags {
  /** Hidden from the game's spawn menu: known to the editor but only listed when searched for. */
  hidden?: boolean;
  /** In the DoNotMap category: the game does not want it placed on maps. */
  noMap?: boolean;
  /** Spawn menu placement mode, e.g. "SnapgridCenter" for things that sit in the middle of a tile. */
  placement?: string;
  /** Sprite directions (4 or 8) when the sprite turns with the entity. */
  directions?: number;
  wallMount?: boolean;
  /** IconSmooth key: neighbours with the same key join up visually (walls, windows, tables). */
  smooth?: string;
}

export interface PaletteItem {
  id: string;
  name: string;
  layer: LayerId;
  category: string;
  /** Index into the atlas, or null: markers are drawn from color + glyph, entities without a sprite as a placeholder. */
  icon: number | null;
  color?: string;
  glyph?: string;
  description?: string;
  flags?: ItemFlags;
}

export interface Palette {
  gameCommit: string | null;
  iconSize: number;
  atlasColumns: number;
  atlasUrl: string;
  atlas: HTMLImageElement;
  items: PaletteItem[];
  byLayer: Record<LayerId, Map<string, PaletteItem>>;
  /** The game's renamed entity ids: old id -> new id, or null when the game deletes it on load. */
  migrations: Map<string, string | null>;
}

/** Editor-only markers. They are not game entities; the runtime generator reads them. */
export const MARKERS: PaletteItem[] = [
  { id: "Entry", name: "Entry", layer: "marker", category: "Markers", icon: null, color: "#3fb27f", glyph: "E", description: "Where the Q-Gate drops players. Place one or more; the Entries panel sets their order." },
  { id: "QlippothSpot", name: "Qlippoth spot", layer: "marker", category: "Markers", icon: null, color: "#a871e0", glyph: "Q", description: "Where the Qlippoth is spawned." },
  { id: "Objective", name: "Objective", layer: "marker", category: "Markers", icon: null, color: "#e0a63a", glyph: "O", description: "A rift objective (QGateDungeonObjective) is placed here." },
  { id: "Connection", name: "Connection", layer: "marker", category: "Markers", icon: null, color: "#3ab0e0", glyph: "C", description: "A doorway other templates can attach to." },
];

const BASE = "palette/";

export async function loadPalette(): Promise<Palette> {
  const response = await fetch(`${BASE}palette.json`);
  if (!response.ok) throw new Error(`palette.json: HTTP ${response.status}`);
  const data = await response.json();

  const atlasUrl = `${BASE}atlas.png`;
  const atlas = new Image();
  atlas.src = atlasUrl;
  await atlas.decode();

  const items: PaletteItem[] = [...data.items, ...MARKERS];
  const byLayer = Object.fromEntries(LAYERS.map((layer) => [layer, new Map<string, PaletteItem>()])) as Palette["byLayer"];
  for (const item of items) byLayer[item.layer]?.set(item.id, item);

  return {
    gameCommit: data.gameCommit ?? null,
    iconSize: data.iconSize,
    atlasColumns: data.atlasColumns,
    atlasUrl,
    atlas,
    items,
    byLayer,
    migrations: new Map(Object.entries(data.migrations ?? {})),
  };
}

/** The palette item for an id on a layer, following the game's renames. */
export function findItem(palette: Palette, layer: LayerId, id: string): PaletteItem | undefined {
  const item = palette.byLayer[layer].get(id);
  if (item) return item;
  const renamed = palette.migrations.get(id);
  return renamed ? palette.byLayer[layer].get(renamed) : undefined;
}

/** Short notes about an item for the palette panel. */
export function itemNotes(item: PaletteItem): string[] {
  const flags = item.flags ?? {};
  return [
    flags.directions ? `${flags.directions} directions` : null,
    flags.wallMount ? "Wall mount" : null,
    flags.smooth ? `Joins with "${flags.smooth}"` : null,
    flags.hidden ? "Hidden in the spawn menu" : null,
    flags.noMap ? "Do not map" : null,
    item.layer !== "marker" && item.icon === null ? "No sprite" : null,
  ].filter((note): note is string => note !== null);
}

export function iconOrigin(palette: Palette, icon: number): [number, number] {
  return [(icon % palette.atlasColumns) * palette.iconSize, Math.floor(icon / palette.atlasColumns) * palette.iconSize];
}
