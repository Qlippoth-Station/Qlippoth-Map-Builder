// The lists folder: a folder on the user's computer the editor saves list files into and loads them from, normally
// Resources/Domains/Lists/ of the game checkout next to this editor. Uses the File System Access API (Chrome, Edge);
// other browsers download files instead. The chosen folder is remembered in IndexedDB; the browser asks for permission
// again after a reload, which needs a click.

import { listFileName, serializeList, type TileList } from "./lists";

/** The parts of FileSystemDirectoryHandle the editor uses (declared here because TypeScript's DOM types lack some). */
export interface FolderHandle {
  readonly kind: "directory";
  readonly name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  values(): AsyncIterable<{ kind: "file" | "directory"; name: string }>;
  queryPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
}

interface FileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

type DirectoryPicker = (options: { id?: string; mode?: "readwrite" }) => Promise<FolderHandle>;

export function folderSupported(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker === "function";
}

/** Asks the user for a folder. Returns null when they cancel. */
export async function pickFolder(): Promise<FolderHandle | null> {
  try {
    return await (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker({ id: "qlippoth-lists", mode: "readwrite" });
  } catch {
    return null;
  }
}

/** Whether the editor may write to the folder now; with `ask` it asks the browser (only works from a click). */
export async function hasPermission(folder: FolderHandle, ask: boolean): Promise<boolean> {
  try {
    if (!folder.queryPermission) return true;
    if ((await folder.queryPermission({ mode: "readwrite" })) === "granted") return true;
    return ask && !!folder.requestPermission && (await folder.requestPermission({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}

/** Writes a list as <id>.list.json. Returns false when the file already had exactly this content. */
export async function writeList(folder: FolderHandle, list: TileList): Promise<boolean> {
  const text = serializeList(list);
  const handle = await folder.getFileHandle(listFileName(list), { create: true });
  if ((await (await handle.getFile()).text()) === text) return false;
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  return true;
}

/** Every *.list.json directly in the folder. */
export async function readListFiles(folder: FolderHandle): Promise<File[]> {
  const files: File[] = [];
  for await (const entry of folder.values()) {
    if (entry.kind === "file" && entry.name.endsWith(".list.json")) files.push(await (await folder.getFileHandle(entry.name)).getFile());
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

// ---- Remembering the folder (IndexedDB; folder handles cannot go into localStorage) -------------------------------

const DB_NAME = "qlippoth-domain-builder";
const STORE = "handles";
const KEY = "listFolder";

function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        try {
          const request = action(open.result.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      };
    } catch {
      resolve(undefined);
    }
  });
}

export async function rememberFolder(folder: FolderHandle | null): Promise<void> {
  await withStore<unknown>("readwrite", (store) => (folder ? store.put(folder, KEY) : store.delete(KEY)) as IDBRequest<unknown>);
}

export async function rememberedFolder(): Promise<FolderHandle | null> {
  const folder = await withStore<FolderHandle>("readonly", (store) => store.get(KEY));
  return folder && typeof folder.getFileHandle === "function" ? folder : null;
}

// ---- The connection the editor keeps ---------------------------------------------------------------------------------

export interface SaveReport {
  written: string[];
  unchanged: string[];
  /** Built-in lists are not written: they reach the game through `npm run lists:sync`. */
  builtIn: string[];
}

/** The connected lists folder, if any, and whether the editor may write to it right now. */
export class ListFolderLink {
  folder: FolderHandle | null = null;
  ready = false;
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  /** Restores the folder chosen in an earlier visit. Writing may still need a click on Reconnect. */
  async restore(): Promise<void> {
    if (!folderSupported()) return;
    this.folder = await rememberedFolder();
    this.ready = this.folder ? await hasPermission(this.folder, false) : false;
    this.changed();
  }

  async connect(): Promise<boolean> {
    const folder = await pickFolder();
    if (!folder) return false;
    this.folder = folder;
    this.ready = await hasPermission(folder, true);
    await rememberFolder(folder);
    this.changed();
    return true;
  }

  async reconnect(): Promise<void> {
    if (!this.folder) return;
    this.ready = await hasPermission(this.folder, true);
    this.changed();
  }

  async disconnect(): Promise<void> {
    this.folder = null;
    this.ready = false;
    await rememberFolder(null);
    this.changed();
  }

  async saveLists(lists: TileList[]): Promise<SaveReport> {
    const report: SaveReport = { written: [], unchanged: [], builtIn: [] };
    if (!this.folder || !this.ready) return report;
    for (const list of lists) {
      if (list.builtIn) report.builtIn.push(listFileName(list));
      else if (await writeList(this.folder, list)) report.written.push(listFileName(list));
      else report.unchanged.push(listFileName(list));
    }
    return report;
  }
}

/** One line for the user about a SaveReport. */
export function describeSave(report: SaveReport, folderName: string): string {
  const parts: string[] = [];
  if (report.written.length) parts.push(`Saved ${report.written.join(", ")} to "${folderName}".`);
  if (report.unchanged.length) parts.push(`Already up to date: ${report.unchanged.join(", ")}.`);
  if (report.builtIn.length) parts.push(`Built-in lists are already in the game: ${report.builtIn.join(", ")}.`);
  return parts.join(" ") || "Nothing to save.";
}
