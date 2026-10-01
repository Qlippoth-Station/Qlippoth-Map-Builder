import { LAYERS, type LayerId } from "./document";

export interface PaletteItem {
  id: string;
  name: string;
  layer: LayerId;
  category: string;
  /** Index into the atlas. Markers have no icon and are drawn from color + glyph instead. */
  icon: number | null;
  color?: string;
  glyph?: string;
  description?: string;
}

export interface Palette {
  gameCommit: string | null;
  iconSize: number;
  atlasColumns: number;
  atlasUrl: string;
  atlas: HTMLImageElement;
  items: PaletteItem[];
  byLayer: Record<LayerId, Map<string, PaletteItem>>;
}

/** Editor-only markers. They are not game entities; the runtime generator reads them. */
export const MARKERS: PaletteItem[] = [
  { id: "Entry", name: "Entry", layer: "marker", category: "Markers", icon: null, color: "#3fb27f", glyph: "E", description: "Where the Q-Gate drops players. Exactly one." },
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
  };
}

export function iconOrigin(palette: Palette, icon: number): [number, number] {
  return [(icon % palette.atlasColumns) * palette.iconSize, Math.floor(icon / palette.atlasColumns) * palette.iconSize];
}
