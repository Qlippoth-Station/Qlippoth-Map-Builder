// Reads a game's Resources folder straight from a public GitHub repository, for building its palette in the browser.
// The file list comes from GitHub's API (3-4 requests, well inside the 60 per hour allowed without signing in); the
// files themselves from raw.githubusercontent.com.

import type { PaletteSource, RgbaImage } from "../palette-core.mjs";

export interface RepositoryRef {
  owner: string;
  repo: string;
  /** Branch, tag or commit; the repository's default branch when empty. */
  ref: string;
}

/** Reads "owner/repo", "https://github.com/owner/repo" or ".../tree/branch". */
export function parseRepository(text: string): RepositoryRef | null {
  const match = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/tree\/([^?#]+))?\/?$/.exec(text.trim());
  return match ? { owner: match[1], repo: match[2], ref: match[3] ?? "" } : null;
}

const API = "https://api.github.com";

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: { Accept: "application/vnd.github+json" } });
  if (response.status === 403 || response.status === 429) throw new Error("GitHub's request limit for this network is used up; try again in an hour.");
  if (response.status === 404) throw new Error("Repository, branch or folder not found (it must be public).");
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  return response.json() as Promise<T>;
}

interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  sha: string;
}

export interface GithubResources extends PaletteSource {
  commit: string;
  ref: string;
}

/** Locates the repository's Resources folder at a commit and lists it. */
export async function githubResources({ owner, repo, ref }: RepositoryRef): Promise<GithubResources> {
  const branch = ref || (await api<{ default_branch: string }>(`/repos/${owner}/${repo}`)).default_branch;
  const commit = (await api<{ sha: string }>(`/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`)).sha;
  const root = await api<{ tree: TreeEntry[] }>(`/repos/${owner}/${repo}/git/trees/${commit}`);
  const resources = root.tree.find((entry) => entry.path === "Resources" && entry.type === "tree");
  if (!resources) throw new Error("The repository has no Resources folder at its top.");

  // One recursive listing of Resources, or (when GitHub cuts it short) one per folder the palette reads.
  const files = new Set<string>();
  const listTree = async (sha: string, prefix: string) => {
    const tree = await api<{ tree: TreeEntry[]; truncated: boolean }>(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
    for (const entry of tree.tree) if (entry.type === "blob") files.add(prefix + entry.path);
    return tree.truncated;
  };
  if (await listTree(resources.sha, "")) {
    files.clear();
    const top = await api<{ tree: TreeEntry[] }>(`/repos/${owner}/${repo}/git/trees/${resources.sha}`);
    for (const entry of top.tree) {
      if (entry.type === "blob") files.add(entry.path);
      else if (["Prototypes", "Textures", "Locale"].includes(entry.path)) await listTree(entry.sha, `${entry.path}/`);
    }
  }

  const raw = (path: string) => `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/Resources/${path.split("/").map(encodeURIComponent).join("/")}`;
  const sorted = [...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    commit,
    ref: branch,
    list: async (dir) =>
      sorted.filter(
        (path) =>
          path.startsWith(`${dir}/`) &&
          // Of the translations only tile names are used; reading only those files saves hundreds of requests.
          (!dir.startsWith("Locale") || /tile/i.test(path))
      ),
    has: (path) => files.has(path),
    text: async (path) => {
      if (!files.has(path)) return null;
      const response = await fetch(raw(path));
      return response.ok ? response.text() : null;
    },
    image: async (path) => {
      if (!files.has(path)) return null;
      const response = await fetch(raw(path));
      if (!response.ok) return null;
      return decodeImage(await response.blob());
    },
  };
}

async function decodeImage(blob: Blob): Promise<RgbaImage | null> {
  try {
    const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    return { width, height, data };
  } catch {
    return null;
  }
}
