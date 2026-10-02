// Editor art that lives in this repository (assets/): list symbols and map effects. Files are picked up by name at
// build time, so adding art needs no code change. See assets/list-symbols/README.md and assets/effects/README.md.

import creditsText from "../assets/credits.json?raw";

export interface ArtCredit {
  /** Path from the repository root, e.g. assets/list-symbols/bricks.svg. */
  source: string;
  license: string;
  copyright: string;
}

/** Author and license of every file in assets/ (CC-BY-SA 3.0, see assets/LICENSE.md). Shown in the Credits dialog. */
export const ART_CREDITS: ArtCredit[] = JSON.parse(creditsText);

/** The only license accepted for files in assets/. */
export const ART_LICENSE = "CC-BY-SA-3.0";

const symbolFiles = import.meta.glob("../assets/list-symbols/*.{png,svg,webp}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const effectFiles = import.meta.glob("../assets/effects/*.{png,svg,webp}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

export interface SymbolInfo {
  /** File name without extension, stored in list files as `icon.symbol`. */
  id: string;
  name: string;
  url: string;
}

const baseName = (path: string) => path.split("/").pop()!.replace(/\.[^.]+$/, "");

/** Every symbol a list can use, sorted by id. */
export const SYMBOLS: SymbolInfo[] = Object.entries(symbolFiles)
  .map(([path, url]) => {
    const id = baseName(path);
    return { id, name: id.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase()), url };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const symbolById = new Map(SYMBOLS.map((symbol) => [symbol.id, symbol]));

export function symbolInfo(id: string | undefined): SymbolInfo | undefined {
  return id ? symbolById.get(id) : undefined;
}

/** The overlay drawn on cells that share a pick ("Same pick for the whole stroke"), if the art exists. */
export const GROUP_EFFECT_URL: string | undefined = Object.entries(effectFiles).find(([path]) => baseName(path) === "group")?.[1];

const images = new Map<string, HTMLImageElement>();

/** Loads every symbol and effect image so the map can draw them synchronously. A file that fails is skipped. */
export async function loadArt(): Promise<void> {
  const urls = [...SYMBOLS.map((symbol) => symbol.url), ...(GROUP_EFFECT_URL ? [GROUP_EFFECT_URL] : [])];
  await Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.addEventListener("load", () => {
            images.set(url, image);
            resolve();
          });
          image.addEventListener("error", () => resolve());
          image.src = url;
        })
    )
  );
}

export function loadedImage(url: string | undefined): HTMLImageElement | undefined {
  return url ? images.get(url) : undefined;
}
