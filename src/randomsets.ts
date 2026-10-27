// Random sets: lists of tiles or entities to draw from, kept in the browser per mode.
//
// Painting with a set picks one entry per cell, weighted, so what you see is what the map gets (tiles always work
// this way, the game has no random tiles). On a station's Structure and Object layers a set can instead become a
// random spawner: the map gets one RandomSpawner entity and the game picks what spawns there every round.

import type { LayerId, SpawnerData } from "./document";
import type { ModeId } from "./modes";
import { loadValue, saveValue } from "./storage";

export interface RandomEntry {
  id: string;
  weight: number;
}

export interface RandomSet {
  id: string;
  name: string;
  mode: ModeId;
  layer: LayerId;
  entries: RandomEntry[];
  /** "paint": picked while painting; "game": a RandomSpawner the game rolls each round (station entities only). */
  resolve: "paint" | "game";
  /** Game sets: chance that anything spawns at all (0-1). */
  chance: number;
}

const KEY = "randomSets";
export const SET_PREFIX = "set:";
const MAX_WEIGHT = 20;

export class RandomSetLibrary {
  sets: RandomSet[] = [];
  private listeners = new Set<() => void>();

  async load(): Promise<void> {
    this.sets = (await loadValue<RandomSet[]>(KEY).catch(() => null)) ?? [];
    this.changed();
  }

  subscribe(listener: () => void): void {
    this.listeners.add(listener);
  }

  forMode(mode: ModeId): RandomSet[] {
    return this.sets.filter((set) => set.mode === mode).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): RandomSet | undefined {
    return this.sets.find((set) => set.id === id);
  }

  create(name: string, mode: ModeId, layer: LayerId): RandomSet {
    const set: RandomSet = { id: crypto.randomUUID(), name, mode, layer, entries: [], resolve: mode === "station" && layer !== "floor" ? "game" : "paint", chance: 1 };
    this.sets = [...this.sets, set];
    this.persist();
    return set;
  }

  update(id: string, change: Partial<Omit<RandomSet, "id" | "mode" | "layer">>): void {
    this.sets = this.sets.map((set) => (set.id === id ? { ...set, ...change } : set));
    this.persist();
  }

  remove(id: string): void {
    this.sets = this.sets.filter((set) => set.id !== id);
    this.persist();
  }

  private persist(): void {
    void saveValue(KEY, this.sets).catch(() => false);
    this.changed();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}

export function clampWeight(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_WEIGHT, Math.max(1, Math.round(value))) : 1;
}

/** One entry id, picked by weight. */
export function pickEntry(set: RandomSet, random = Math.random): string | null {
  const total = set.entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;
  let roll = random() * total;
  for (const entry of set.entries) {
    roll -= entry.weight;
    if (roll < 0) return entry.id;
  }
  return set.entries.at(-1)!.id;
}

/** The game's RandomSpawner picks uniformly, so weights become repeated entries. */
export function spawnerData(set: RandomSet): SpawnerData {
  return {
    name: set.name,
    prototypes: set.entries.flatMap((entry) => Array<string>(entry.weight).fill(entry.id)),
    chance: Math.min(1, Math.max(0, set.chance)),
    rarePrototypes: [],
    rareChance: 0,
  };
}
