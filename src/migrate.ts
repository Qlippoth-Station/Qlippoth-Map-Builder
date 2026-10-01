// Upgrades older domain files to the current format version.
//
// Every format change bumps FORMAT_VERSION (document.ts) and adds one step here that turns a file of the
// previous version into the new one. Steps only ever touch raw JSON data, so old files keep opening forever.

export type FileData = Record<string, unknown>;
export type Migration = (data: FileData) => FileData;

/** MIGRATIONS[n] upgrades a version n file to version n + 1. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

/** Runs the steps from the file's version up to `target`. Throws for versions it cannot read. */
export function migrate(data: FileData, target: number, migrations: Readonly<Record<number, Migration>> = MIGRATIONS): FileData {
  const version = data.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new Error(`Invalid format version ${JSON.stringify(version)}.`);
  if (version > target) throw new Error(`This file uses format version ${version}; this editor only knows up to ${target}. Reload to get the latest editor.`);

  let current = data;
  for (let from = version; from < target; from++) {
    const step = migrations[from];
    if (!step) throw new Error(`No upgrade from format version ${from} to ${from + 1}.`);
    current = { ...step(current), version: from + 1 };
  }
  return current;
}
