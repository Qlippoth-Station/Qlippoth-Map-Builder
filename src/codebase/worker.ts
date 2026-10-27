// Builds a codebase's palette from a GitHub repository off the main thread.

import YAML from "yaml";
import { buildPalette } from "../palette-core.mjs";
import { githubResources, type RepositoryRef } from "./github";

export type WorkerMessage =
  | { type: "progress"; stage: string; done: number; total: number }
  | { type: "done"; commit: string; ref: string; palette: object; atlas: Blob; credits: object[]; unreadable: string[] }
  | { type: "error"; message: string };

self.onmessage = async (event: MessageEvent<RepositoryRef>) => {
  const post = (message: WorkerMessage) => (self as unknown as Worker).postMessage(message);
  try {
    post({ type: "progress", stage: "listing", done: 0, total: 1 });
    const source = await githubResources(event.data);
    const built = await buildPalette(source, YAML, (stage, done, total) => {
      // Throttled: one message per 2% is plenty for a progress bar.
      if (done === total || done % Math.max(1, Math.floor(total / 50)) === 0) post({ type: "progress", stage, done, total });
    });
    const canvas = new OffscreenCanvas(built.atlas.width, built.atlas.height);
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(built.atlas.data), built.atlas.width, built.atlas.height), 0, 0);
    const atlas = await canvas.convertToBlob({ type: "image/png" });
    post({ type: "done", commit: source.commit, ref: source.ref, palette: built.palette, atlas, credits: built.credits, unreadable: built.unreadable });
  } catch (error) {
    post({ type: "error", message: (error as Error).message });
  }
};
