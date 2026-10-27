// Autosave in IndexedDB: one slot per mode, plus the last used mode.
// localStorage is too small for station maps (~5 MB per site). Browser storage can be missing or throw
// (private mode, blocked site data), so every call fails soft and the editor works without it.

import { MODES, type ModeId } from "./modes";

const DB_NAME = "qlippoth-map-builder";
const STORE = "autosave";
const LAST_MODE_KEY = "lastMode";
/** Autosave key of the editor before modes existed; moved into the domain slot once. */
const LEGACY_KEY = "qlippoth-domain-builder.autosave";

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export interface Autosaves {
  documents: Partial<Record<ModeId, string>>;
  lastMode: ModeId | null;
}

export async function loadAutosaves(): Promise<Autosaves> {
  const documents: Autosaves["documents"] = {};
  for (const mode of MODES) {
    const text = await run("readonly", (store) => store.get(mode));
    if (typeof text === "string") documents[mode] = text;
  }
  const last = await run("readonly", (store) => store.get(LAST_MODE_KEY));

  const legacy = readLegacy();
  if (legacy !== null) {
    if (documents.domain === undefined) {
      documents.domain = legacy;
      if (await saveAutosave("domain", legacy)) removeLegacy();
    } else {
      removeLegacy();
    }
  }
  return { documents, lastMode: MODES.includes(last as ModeId) ? (last as ModeId) : null };
}

/** Resolves to false when the browser refused to store it. */
export async function saveAutosave(mode: ModeId, text: string): Promise<boolean> {
  return (await run("readwrite", (store) => store.put(text, mode))) !== null;
}

export function saveLastMode(mode: ModeId): void {
  void run("readwrite", (store) => store.put(mode, LAST_MODE_KEY));
}

function readLegacy(): string | null {
  try {
    return localStorage.getItem(LEGACY_KEY);
  } catch {
    return null;
  }
}

function removeLegacy(): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Ignored: the old copy is harmless.
  }
}
