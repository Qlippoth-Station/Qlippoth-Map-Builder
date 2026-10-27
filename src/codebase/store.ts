// Which game codebase the palette comes from.
//
// - The default (Qlippoth Station) and the codebases listed in codebases.json are built by CI and served with the
//   site (palette/codebases.json lists them with their folders).
// - Codebases added from a GitHub link are built in the browser and kept in IndexedDB.

import { loadValue, saveValue } from "../storage";

export interface CodebaseInfo {
  id: string;
  name: string;
  /** owner/repo on GitHub. */
  repository: string;
  ref: string;
  commit: string | null;
}

export interface RegisteredCodebase extends CodebaseInfo {
  /** Folder of its palette files, relative to the site. */
  path: string;
  default?: boolean;
}

export interface CustomCodebase extends CodebaseInfo {
  palette: Record<string, unknown>;
  atlas: Blob;
  credits: object[];
  built: number;
}

const CUSTOM_KEY = "codebases";
const CURRENT_KEY = "currentCodebase";

export const DEFAULT_CODEBASE: RegisteredCodebase = {
  id: "qlippoth",
  name: "Qlippoth Station",
  repository: "Qlippoth-Station/Qlippoth-station-14",
  ref: "",
  commit: null,
  path: "palette/",
  default: true,
};

export async function registeredCodebases(): Promise<RegisteredCodebase[]> {
  try {
    const response = await fetch("palette/codebases.json");
    if (!response.ok) return [DEFAULT_CODEBASE];
    const list = (await response.json()) as RegisteredCodebase[];
    return list.length ? list : [DEFAULT_CODEBASE];
  } catch {
    return [DEFAULT_CODEBASE];
  }
}

export async function customCodebases(): Promise<CustomCodebase[]> {
  return (await loadValue<CustomCodebase[]>(CUSTOM_KEY).catch(() => null)) ?? [];
}

export async function saveCustomCodebase(codebase: CustomCodebase): Promise<boolean> {
  const list = (await customCodebases()).filter((other) => other.id !== codebase.id);
  return saveValue(CUSTOM_KEY, [...list, codebase]);
}

export async function removeCustomCodebase(id: string): Promise<void> {
  await saveValue(CUSTOM_KEY, (await customCodebases()).filter((other) => other.id !== id));
}

export async function currentCodebaseId(): Promise<string | null> {
  return (await loadValue<string>(CURRENT_KEY).catch(() => null)) ?? null;
}

export async function setCurrentCodebase(id: string | null): Promise<void> {
  await saveValue(CURRENT_KEY, id);
}

/** The id a codebase added from GitHub gets. */
export function customId(repository: string, ref: string): string {
  return `${repository}${ref ? `@${ref}` : ""}`;
}
