// Editor modes. The whole site stays the same; a mode decides which layers exist, the file format and the checks.

import type { LayerId } from "./document";

export const MODES = ["domain", "station"] as const;
export type ModeId = (typeof MODES)[number];

export interface ModeInfo {
  id: ModeId;
  name: string;
  /** Shown in the browser tab, e.g. "Domain Builder". */
  title: string;
  /** Layers this mode edits, bottom to top. Shortcuts 1..n follow this order. */
  layers: readonly LayerId[];
  defaultName: string;
  defaultSize: [number, number];
  fileSuffix: string;
  hint: string;
}

export const MODE_INFO: Record<ModeId, ModeInfo> = {
  domain: {
    id: "domain",
    name: "Domain",
    title: "Domain Builder",
    layers: ["floor", "structure", "object", "marker"],
    defaultName: "Untitled domain",
    defaultSize: [20, 15],
    fileSuffix: ".domain.json",
    hint: "Rift domains for the Q-Gate",
  },
  station: {
    id: "station",
    name: "Station",
    title: "Station Builder",
    layers: ["floor", "structure", "object"],
    defaultName: "Untitled station",
    defaultSize: [64, 64],
    fileSuffix: ".station.json",
    hint: "Station maps and station parts",
  },
};
