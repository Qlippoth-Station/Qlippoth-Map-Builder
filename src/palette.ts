import { LAYERS, type LayerId } from "./document";
import { currentCodebaseId, customCodebases, DEFAULT_CODEBASE, registeredCodebases, setCurrentCodebase, type CodebaseInfo } from "./codebase/store";

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
  /** Tiles: number of sprite variants. */
  variants?: number;
  /** Job spawn points: the job id players of that job spawn at. */
  job?: string;
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
  /** The game codebase the palette was built from. */
  codebase: CodebaseInfo;
  /** License and copyright of every sprite used. */
  credits(): Promise<{ source: string; license?: string; copyright?: string }[]>;
  iconSize: number;
  atlasColumns: number;
  atlasUrl: string;
  atlas: HTMLImageElement;
  items: PaletteItem[];
  byLayer: Record<LayerId, Map<string, PaletteItem>>;
  /** The game's renamed entity ids: old id -> new id, or null when the game deletes it on load. */
  migrations: Map<string, string | null>;
  /** A RandomSpawner entity that random sets are exported as (its spawn list is overridden per placement). */
  spawnerCarrier: string | null;
}

/** Editor-only markers. They are not game entities; the runtime generator reads them. */
export const MARKERS: PaletteItem[] = [
  { id: "Entry", name: "Entry", layer: "marker", category: "Markers", icon: null, color: "#3fb27f", glyph: "E", description: "Where the Q-Gate drops players. Place one or more; the Entries panel sets their order." },
  { id: "QlippothSpot", name: "Qlippoth spot", layer: "marker", category: "Markers", icon: null, color: "#a871e0", glyph: "Q", description: "Where the Qlippoth is spawned." },
  { id: "Objective", name: "Objective", layer: "marker", category: "Markers", icon: null, color: "#e0a63a", glyph: "O", description: "A rift objective (QGateDungeonObjective) is placed here." },
  { id: "Connection", name: "Connection", layer: "marker", category: "Markers", icon: null, color: "#3ab0e0", glyph: "C", description: "A doorway other templates can attach to." },
];

const BASE = "palette/";

/** The palette of the codebase chosen in the Codebase dialog; the default codebase when that one is gone. */
export async function loadPalette(): Promise<Palette> {
  const id = await currentCodebaseId();
  if (id && id !== DEFAULT_CODEBASE.id) {
    try {
      const custom = (await customCodebases()).find((codebase) => codebase.id === id);
      if (custom) {
        const atlasUrl = URL.createObjectURL(custom.atlas);
        const palette = createPalette(custom.palette as Parameters<typeof createPalette>[0], atlasUrl, await loadImage(atlasUrl));
        const { palette: _, atlas: __, credits, built: ___, ...info } = custom;
        return { ...palette, gameCommit: custom.commit, codebase: info, credits: async () => credits as Awaited<ReturnType<Palette["credits"]>> };
      }
      const registered = (await registeredCodebases()).find((codebase) => codebase.id === id);
      if (registered) return await loadServedPalette(registered.path, registered);
    } catch {
      // Fall back to the default codebase below.
    }
    await setCurrentCodebase(null);
  }
  const registered = (await registeredCodebases()).find((codebase) => codebase.default) ?? DEFAULT_CODEBASE;
  return loadServedPalette(BASE, registered);
}

async function loadServedPalette(base: string, info: CodebaseInfo): Promise<Palette> {
  const response = await fetch(`${base}palette.json`);
  if (!response.ok) throw new Error(`palette.json: HTTP ${response.status}`);
  const data = await response.json();
  const atlasUrl = `${base}atlas.png`;
  const palette = createPalette(data, atlasUrl, await loadImage(atlasUrl));
  return {
    ...palette,
    codebase: { ...info, commit: data.gameCommit ?? info.commit },
    credits: async () => (await fetch(`${base}credits.json`)).json(),
  };
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

/** Builds the palette from palette.json data (also used by Node scripts, with no atlas image). */
export function createPalette(
  data: { gameCommit?: string; iconSize: number; atlasColumns: number; items: PaletteItem[]; migrations?: Record<string, string | null>; spawnerCarrier?: string | null },
  atlasUrl: string,
  atlas: HTMLImageElement
): Palette {
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
    spawnerCarrier: data.spawnerCarrier ?? null,
    codebase: { ...DEFAULT_CODEBASE, commit: data.gameCommit ?? null },
    credits: async () => [],
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
    flags.job ? `Spawn point: ${flags.job}` : null,
    item.layer !== "marker" && item.icon === null ? "No sprite" : null,
  ].filter((note): note is string => note !== null);
}

export function iconOrigin(palette: Palette, icon: number): [number, number] {
  return [(icon % palette.atlasColumns) * palette.iconSize, Math.floor(icon / palette.atlasColumns) * palette.iconSize];
}
