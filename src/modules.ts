// The module library: saved parts of maps (departments, rooms) kept in the browser, per mode.
// A module's text is a normal map file of its mode (station .yml or domain .json), so it can be exported,
// tested in the game on its own and imported again.

import type { ModeId } from "./modes";
import { loadValue, saveValue } from "./storage";

export interface ModuleRecord {
  id: string;
  name: string;
  mode: ModeId;
  width: number;
  height: number;
  text: string;
  /** Changes on every save; placed instances remember the version they show. */
  updated: number;
}

const KEY = "modules";

export class ModuleLibrary {
  modules: ModuleRecord[] = [];
  private listeners = new Set<() => void>();

  async load(): Promise<void> {
    this.modules = (await loadValue<ModuleRecord[]>(KEY).catch(() => null)) ?? [];
    this.changed();
  }

  subscribe(listener: () => void): void {
    this.listeners.add(listener);
  }

  forMode(mode: ModeId): ModuleRecord[] {
    return this.modules.filter((module) => module.mode === mode).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): ModuleRecord | undefined {
    return this.modules.find((module) => module.id === id);
  }

  /** Adds a module, or replaces the one with the same name and mode (a new version). */
  put(module: Omit<ModuleRecord, "id" | "updated">): ModuleRecord {
    const existing = this.modules.find((other) => other.mode === module.mode && other.name === module.name);
    // Strictly increasing so two saves in the same millisecond still count as two versions.
    const updated = Math.max(Date.now(), (existing?.updated ?? 0) + 1);
    const record: ModuleRecord = { ...module, id: existing?.id ?? crypto.randomUUID(), updated };
    this.modules = [...this.modules.filter((other) => other.id !== record.id), record];
    this.persist();
    return record;
  }

  remove(id: string): void {
    this.modules = this.modules.filter((module) => module.id !== id);
    this.persist();
  }

  private persist(): void {
    void saveValue(KEY, this.modules).catch(() => false);
    this.changed();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
