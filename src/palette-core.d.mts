// Types for palette-core.mjs (plain JavaScript so Node runs it without a build step).

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface PaletteSource {
  /** Every file under a folder of Resources, as paths relative to Resources with "/". */
  list(dir: string): Promise<string[]>;
  has(path: string): boolean;
  text(path: string): Promise<string | null>;
  image(path: string): Promise<RgbaImage | null>;
}

export interface Credit {
  source: string;
  license?: string;
  copyright?: string;
}

export interface BuiltPalette {
  palette: {
    version: number;
    iconSize: number;
    atlasColumns: number;
    items: unknown[];
    migrations: Record<string, string | null>;
    spawnerCarrier: string | null;
  };
  atlas: { width: number; height: number; data: Uint8Array };
  credits: Credit[];
  unreadable: string[];
}

export const ICON: number;
export const PALETTE_VERSION: number;

export function buildPalette(
  source: PaletteSource,
  YAML: { parse(text: string, options?: object): unknown },
  progress?: (stage: string, done: number, total: number) => void
): Promise<BuiltPalette>;
