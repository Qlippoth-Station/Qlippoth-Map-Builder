// The game server's data folder, linked through the browser's File System Access API (Chrome and Edge).
//
// The game's loadmap / loadgrid commands read from that folder first and savemap / savegrid write into it, so with
// the folder linked a station goes editor -> game -> editor without downloads: export writes the .yml there, and
// maps saved in the game show up in the list to open.

import { loadValue, saveValue } from "./storage";

// Only the parts of the API used here; typed locally because not every TypeScript DOM library has them.
interface FileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

interface DirectoryHandle {
  kind: "directory";
  name: string;
  entries(): AsyncIterable<[string, FileHandle | DirectoryHandle]>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
}

type Picker = (options: { id?: string; mode?: "readwrite" }) => Promise<DirectoryHandle>;

const STORAGE_KEY = "gameFolder";

export interface FolderFile {
  /** Path inside the folder, as the game's commands take it ("/name.yml"). */
  path: string;
  modified: number;
  size: number;
  handle: FileHandle;
}

export class GameFolder {
  private handle: DirectoryHandle | null = null;

  static get supported(): boolean {
    return typeof (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker === "function";
  }

  get linked(): boolean {
    return this.handle !== null;
  }

  get name(): string {
    return this.handle?.name ?? "";
  }

  /** Brings back the folder linked in an earlier visit (permission is asked again when it is used). */
  async restore(): Promise<void> {
    try {
      this.handle = await loadValue<DirectoryHandle>(STORAGE_KEY);
    } catch {
      this.handle = null;
    }
  }

  async link(): Promise<void> {
    const picker = (window as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker;
    this.handle = await picker({ id: "ss14-server-data", mode: "readwrite" });
    // Storing can fail (private mode); the folder then stays linked for this visit only.
    await saveValue(STORAGE_KEY, this.handle).catch(() => false);
  }

  async unlink(): Promise<void> {
    this.handle = null;
    await saveValue(STORAGE_KEY, null).catch(() => false);
  }

  /** Makes sure the browser lets the editor read and write the folder; must run from a click. */
  async allowed(): Promise<boolean> {
    if (!this.handle) return false;
    if ((await this.handle.queryPermission({ mode: "readwrite" })) === "granted") return true;
    return (await this.handle.requestPermission({ mode: "readwrite" })) === "granted";
  }

  /** Map files in the folder and its subfolders (up to three levels), newest first. */
  async list(): Promise<FolderFile[]> {
    if (!this.handle || !(await this.allowed())) return [];
    const files: FolderFile[] = [];
    const walk = async (directory: DirectoryHandle, prefix: string, depth: number) => {
      for await (const [name, entry] of directory.entries()) {
        if (entry.kind === "directory") {
          if (depth < 3) await walk(entry, `${prefix}${name}/`, depth + 1);
        } else if (/\.ya?ml$/i.test(name)) {
          const file = await entry.getFile();
          files.push({ path: `/${prefix}${name}`, modified: file.lastModified, size: file.size, handle: entry });
        }
      }
    };
    await walk(this.handle, "", 0);
    return files.sort((a, b) => b.modified - a.modified);
  }

  async read(file: FolderFile): Promise<string> {
    return (await file.handle.getFile()).text();
  }

  /** Writes a file at the top of the folder; returns its path for the game's commands. */
  async write(name: string, text: string): Promise<string> {
    if (!this.handle || !(await this.allowed())) throw new Error("The game folder is not linked or not allowed.");
    const handle = await this.handle.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return `/${name}`;
  }
}
