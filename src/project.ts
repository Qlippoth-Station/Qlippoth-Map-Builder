// Project files: a .zip holding project.yml, the map and the modules of its mode, so a station built from
// departments (or a domain built from rooms) can be shared and picked up again with its module instances.
//
// project.yml:
//   format: qlippoth-project
//   version: 1
//   name: My Station
//   mode: station
//   map: My_Station.yml
//   modules:
//   - name: Medbay
//     file: modules/Medbay.yml
//   instances:
//   - module: Medbay
//     x: 10
//     y: 20
//     width: 24
//     height: 18
//     turns: 1

import { autosaveText, readInstances } from "./autosave";
import { deserialize, serialize, type MapDocument, type ModuleInstance } from "./document";
import type { ModuleLibrary } from "./modules";
import { MODE_INFO, MODES, type ModeId } from "./modes";
import type { Palette } from "./palette";

/** "owner/repo@commit" of the palette a project was made with. */
const codebaseOf = (palette: Palette) => `${palette.codebase.repository}${palette.gameCommit ? `@${palette.gameCommit}` : ""}`;
import { readStationAutosave } from "./station/autosave";
import { exportStation } from "./station/export";
import { importStation } from "./station/import";
import { createZip, readZip } from "./zip";

const FORMAT = "qlippoth-project";

export function slug(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "map";
}

const scalar = (value: string | number) =>
  typeof value === "number" ? String(value) : /^[A-Za-z0-9_./-]+$/.test(value) && !/^\d/.test(value) ? value : `'${value.replaceAll("'", "''")}'`;

export function exportProject(doc: MapDocument, palette: Palette, library: ModuleLibrary): Blob {
  const extension = doc.mode === "station" ? ".yml" : ".json";
  const mapFile = `${slug(doc.name)}${extension}`;
  const modules = library.forMode(doc.mode);
  const names = new Map(modules.map((module) => [module.id, module.name]));
  const lines = [
    `format: ${FORMAT}`,
    "version: 1",
    `name: ${scalar(doc.name)}`,
    `mode: ${doc.mode}`,
    // The game codebase the prototype ids come from.
    `codebase: ${scalar(codebaseOf(palette))}`,
    `map: ${scalar(mapFile)}`,
    // The editor's own state of the map (margins, profile), so the project opens exactly as it was saved.
    `editor: ${scalar("editor.json")}`,
    modules.length ? "modules:" : "modules: []",
    ...modules.flatMap((module) => [`- name: ${scalar(module.name)}`, `  id: ${scalar(module.id)}`, `  file: ${scalar(`modules/${slug(module.name)}${extension}`)}`]),
    doc.instances?.length ? "instances:" : "instances: []",
    ...(doc.instances ?? []).flatMap((instance) => [
      `- module: ${scalar(names.get(instance.module) ?? instance.name)}`,
      `  x: ${instance.x}`,
      `  y: ${instance.y}`,
      `  width: ${instance.width}`,
      `  height: ${instance.height}`,
      `  turns: ${instance.turns}`,
    ]),
    "",
  ];
  return createZip([
    { path: "project.yml", text: lines.join("\n") },
    { path: mapFile, text: doc.mode === "station" ? exportStation(doc, palette).text : serialize(doc) },
    { path: "editor.json", text: autosaveText({ ...doc, instances: undefined }, palette) },
    ...modules.map((module) => ({ path: `modules/${slug(module.name)}${extension}`, text: module.text })),
  ]);
}

export interface OpenedProject {
  doc: MapDocument;
  modules: number;
  /** Set when the project was made with another codebase than the current palette's. */
  otherCodebase: string | null;
}

/** Reads a project .zip: the modules go into the library (as new versions), the map comes back with its instances. */
export async function openProject(data: ArrayBuffer, palette: Palette, library: ModuleLibrary): Promise<OpenedProject> {
  const files = new Map((await readZip(data)).map((file) => [file.path, file.text]));
  const project = parseProject(files.get("project.yml") ?? "");
  if (project.format !== FORMAT) throw new Error("Not a Qlippoth project (no project.yml).");
  const mode = MODES.find((id) => id === project.mode);
  if (!mode) throw new Error(`Unknown mode "${project.mode}".`);

  const ids = new Map<string, { id: string; updated: number }>();
  // Module ids in the saved map (room slots) -> ids in this browser's library.
  const renamed = new Map<string, string>();
  for (const module of project.modules) {
    const text = files.get(module.file);
    if (!text) continue;
    const doc = readMap(text, mode, module.name, palette);
    const record = library.put({ name: module.name, mode, width: doc.width, height: doc.height, text });
    ids.set(module.name, { id: record.id, updated: record.updated });
    if (module.id) renamed.set(module.id, record.id);
  }

  const mapText = files.get(project.map);
  if (!mapText) throw new Error(`The project's map ${project.map} is missing.`);
  const editorState = files.get(project.editor);
  const doc = (editorState && readStationAutosave(editorState, palette)) || readMap(mapText, mode, project.name, palette);
  doc.name = project.name || doc.name;
  doc.roomSlots = doc.roomSlots?.map((slot) => ({ ...slot, modules: slot.modules.map((id) => renamed.get(id) ?? id) }));
  doc.instances = readInstances(
    project.instances
      .filter((instance) => ids.has(instance.module))
      .map((instance) => ({ ...instance, name: instance.module, module: ids.get(instance.module)!.id, version: ids.get(instance.module)!.updated }))
  );
  const made = project.codebase.split("@")[0];
  return { doc, modules: ids.size, otherCodebase: made && made !== palette.codebase.repository ? project.codebase : null };
}

function readMap(text: string, mode: ModeId, name: string, palette: Palette): MapDocument {
  const doc = mode === "station" && text.startsWith("meta:") ? importStation(text, palette, name) : deserialize(text);
  if (doc.mode !== mode) throw new Error(`${name} is not a ${MODE_INFO[mode].name.toLowerCase()} file.`);
  return doc;
}

interface ProjectFile {
  format: string;
  name: string;
  mode: string;
  map: string;
  editor: string;
  codebase: string;
  modules: { name: string; id: string; file: string }[];
  instances: (Omit<ModuleInstance, "name" | "version"> & { module: string })[];
}

/** Reads the small YAML subset project.yml is written in (scalars, and lists of flat mappings). */
function parseProject(text: string): ProjectFile {
  const value = (raw: string): string | number => {
    const trimmed = raw.trim();
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'");
    return /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
  };
  const top: Record<string, unknown> = {};
  let list: Record<string, unknown>[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const item = /^- (\w+): (.*)$/.exec(line);
    const field = /^  (\w+): (.*)$/.exec(line);
    const key = /^(\w+):(?: (.*))?$/.exec(line);
    if (item && list) list.push({ [item[1]]: value(item[2]) });
    else if (field && list?.length) list[list.length - 1][field[1]] = value(field[2]);
    else if (key) {
      if (key[2] === undefined || key[2] === "[]") top[key[1]] = list = [];
      else {
        top[key[1]] = value(key[2]);
        list = null;
      }
    }
  }
  return {
    format: String(top.format ?? ""),
    name: String(top.name ?? ""),
    mode: String(top.mode ?? ""),
    map: String(top.map ?? ""),
    editor: String(top.editor ?? ""),
    codebase: String(top.codebase ?? ""),
    modules: ((top.modules as Record<string, unknown>[]) ?? []).map((module) => ({ name: String(module.name), id: String(module.id ?? ""), file: String(module.file) })),
    instances: ((top.instances as Record<string, unknown>[]) ?? []).map((instance) => ({
      module: String(instance.module),
      x: Number(instance.x),
      y: Number(instance.y),
      width: Number(instance.width),
      height: Number(instance.height),
      turns: Number(instance.turns) || 0,
    })),
  };
}
