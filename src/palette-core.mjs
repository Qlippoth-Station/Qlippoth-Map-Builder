// Builds the editor palette from a game's Resources folder, wherever the files come from: a checkout on disk
// (scripts/build-palette.mjs, run by CI) or a GitHub repository fetched in the browser (codebase picker).
//
// Every tile prototype and every non-abstract entity prototype is listed, wherever it lives under Resources/Prototypes
// (forks often use their own folders, and fills live under Catalog/). Entities are sorted into editor layers by their
// components, not their folder. Entities the spawn menu hides are listed but marked hidden: the editor still knows them
// (game maps use them) but does not offer them in the palette until searched for.
// Inheritance is resolved field by field per component, which is close enough to the game for icons and flags.
//
// Plain JavaScript (with core.d.mts for types) so Node can run it without a build step.

export const ICON = 32;
export const PALETTE_VERSION = 2;

// Ids (and their descendants) that are part of the wall line even without a Wall/Window tag or Door component.
const STRUCTURE_ANCESTORS = new Set(["Girder", "Grille", "GrilleBroken", "BaseGirder", "BaseGrille"]);

// Categories the engine defines itself (not in the game's prototypes): hidden, and not passed on to children.
const ENGINE_CATEGORIES = { HideSpawnMenu: { hide: true, inheritable: false } };

// Components whose C# class carries [EntityCategory(...)]: the engine puts every entity with them in that category.
// The C# sources are not read here, so the ones that hide entities are listed by hand (from Content.Shared/Server).
const COMPONENT_CATEGORIES = {
  Action: "Actions",
  InstantAction: "Actions",
  WorldTargetAction: "Actions",
  EntityTargetAction: "Actions",
  TargetAction: "Actions",
  ConfirmableAction: "Actions",
  ActionUpgrade: "Actions",
  GameRule: "GameRules",
  Objective: "Objectives",
  MindRole: "Roles",
  StatusEffect: "StatusEffects",
  StatusEffectAlert: "StatusEffects",
};

/**
 * @param source  files of a game's Resources folder (paths relative to it, with "/"):
 *                list(dir) -> every file under dir, has(path), text(path) -> string | null,
 *                image(path) -> { width, height, data: RGBA bytes } | null
 * @param YAML    the "yaml" package
 * @param progress optional callback (stage, done, total)
 */
export async function buildPalette(source, YAML, progress = () => {}) {
  const unreadable = [];
  const parseDocs = (path, text) => {
    // Game YAML uses custom tags (!type:Foo); they are irrelevant here and parsed as plain values.
    // Some files start with a BOM, which the parser does not accept.
    try {
      const doc = YAML.parse(text.replace(/^﻿/, ""), { logLevel: "silent", uniqueKeys: false });
      return Array.isArray(doc) ? doc : [];
    } catch {
      unreadable.push(path);
      return [];
    }
  };

  // ---- Prototypes (read once) ----
  const prototypeFiles = (await source.list("Prototypes")).filter((path) => path.endsWith(".yml"));
  const texts = await mapLimit(prototypeFiles, 32, (path) => source.text(path), (done) => progress("prototypes", done, prototypeFiles.length));
  const documents = prototypeFiles.map((path, i) => ({ path, docs: texts[i] === null ? [] : parseDocs(path, texts[i]) }));

  // ---- Locale (tile names) ----
  const locale = new Map();
  const localeFiles = (await source.list("Locale/en-US")).filter((path) => path.endsWith(".ftl"));
  for (const text of await mapLimit(localeFiles, 32, (path) => source.text(path))) {
    for (const line of (text ?? "").split(/\r?\n/)) {
      const match = /^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/.exec(line);
      if (match && !match[2].includes("{")) locale.set(match[1], match[2].trim());
    }
  }

  // ---- Tiles ----
  const tileProtos = new Map();
  for (const { path, docs } of documents) {
    if (!path.startsWith("Prototypes/Tiles/")) continue;
    for (const proto of docs) if (proto?.type === "tile" && proto.id) tileProtos.set(proto.id, proto);
  }
  const resolveTile = (id, seen = new Set()) => {
    const proto = tileProtos.get(id);
    if (!proto || seen.has(id)) return {};
    seen.add(id);
    const merged = {};
    for (const parent of parents(proto)) Object.assign(merged, resolveTile(parent, seen));
    const { abstract, parent, ...own } = proto;
    return Object.assign(merged, own);
  };
  const tileCredits = new Map();
  const attributions = await source.text("Textures/Tiles/attributions.yml");
  for (const entry of attributions ? parseDocs("Textures/Tiles/attributions.yml", attributions) : []) {
    for (const name of entry?.files ?? []) tileCredits.set(name, { license: entry.license, copyright: entry.copyright });
  }
  const tiles = [];
  for (const [id, proto] of tileProtos) {
    if (proto.abstract) continue;
    const tile = resolveTile(id);
    if (!tile.sprite) continue;
    const image = tile.sprite.replace(/^\//, "");
    tiles.push({
      id,
      name: locale.get(tile.name) ?? tile.name ?? id,
      layer: "floor",
      category: tile.isSubfloor ? "Subfloor" : "Floor",
      image,
      // Number of sprite variants; new tiles in exported maps get one of them, like the game does.
      flags: Number(tile.variants) > 1 ? { variants: Number(tile.variants) } : undefined,
      credit: { source: image, ...(tileCredits.get(image.split("/").pop()) ?? {}) },
    });
  }

  // ---- Entities ----
  const categoryInfo = { ...ENGINE_CATEGORIES };
  const entityProtos = new Map();
  for (const { path, docs } of documents) {
    const relative = path.slice("Prototypes/".length);
    for (const proto of docs) {
      if (proto?.type === "entityCategory" && proto.id) {
        categoryInfo[proto.id] = { hide: proto.hideSpawnMenu === true, inheritable: proto.inheritable !== false };
      } else if (proto?.type === "entity" && proto.id) {
        entityProtos.set(proto.id, { proto, relative });
      }
    }
  }

  const cache = new Map();
  const resolve = (id, seen = new Set()) => {
    if (cache.has(id)) return cache.get(id);
    const entry = entityProtos.get(id);
    if (!entry || seen.has(id)) return { components: {}, categories: new Set(), ancestors: new Set() };
    seen.add(id);
    const result = { components: {}, categories: new Set(), ancestors: new Set() };
    for (const parent of parents(entry.proto)) {
      const inherited = resolve(parent, seen);
      result.name ??= inherited.name;
      result.suffix ??= inherited.suffix;
      result.placement ??= inherited.placement;
      result.ancestors.add(parent);
      for (const ancestor of inherited.ancestors) result.ancestors.add(ancestor);
      for (const category of inherited.categories) if (categoryInfo[category]?.inheritable !== false) result.categories.add(category);
      for (const [type, fields] of Object.entries(inherited.components)) result.components[type] = { ...result.components[type], ...fields };
    }
    if (entry.proto.name) result.name = entry.proto.name;
    if (entry.proto.suffix) result.suffix = entry.proto.suffix;
    if (entry.proto.placement) result.placement = entry.proto.placement;
    for (const category of entry.proto.categories ?? []) result.categories.add(category);
    for (const component of entry.proto.components ?? []) {
      if (!component?.type) continue;
      const { type, ...fields } = component;
      result.components[type] = { ...result.components[type], ...fields };
    }
    cache.set(id, result);
    return result;
  };

  // RSI metadata, read once per sprite folder.
  const metas = new Map();
  const readMeta = async (rsi) => {
    if (!metas.has(rsi)) {
      metas.set(
        rsi,
        source.text(`Textures/${rsi}/meta.json`).then((text) => {
          try {
            return text ? JSON.parse(text.replace(/^﻿/, "")) : null;
          } catch {
            return null;
          }
        })
      );
    }
    return metas.get(rsi);
  };

  const entities = [];
  // The simplest concrete RandomSpawner entity carries the editor's random sets in exported maps.
  let spawnerCarrier = null;
  const ids = [...entityProtos.keys()].filter((id) => !entityProtos.get(id).proto.abstract);
  const icons = await mapLimit(ids, 32, (id) => findIcon(resolve(id).components, readMeta, source), (done) => progress("sprites", done, ids.length));
  ids.forEach((id, i) => {
    const { relative } = entityProtos.get(id);
    const resolved = resolve(id);
    const components = resolved.components;
    if ("RandomSpawner" in components) {
      // Every RandomSpawner field is written per placement; prefer a plain random marker for readable maps.
      const score = [relative.includes("Spawners/Random") ? 0 : 1, Object.keys(components).length, id.length];
      if (!spawnerCarrier || compareScores(score, spawnerCarrier.score) < 0) spawnerCarrier = { id, score };
    }
    const tags = new Set(components.Tag?.tags ?? []);
    const categories = [...resolved.categories, ...Object.keys(components).map((type) => COMPONENT_CATEGORIES[type]).filter(Boolean)];
    const icon = icons[i];
    const name = stripMarkup(resolved.name ?? "") || id;
    entities.push({
      id,
      name: resolved.suffix ? `${name} (${resolved.suffix})` : name,
      layer: entityLayer(id, components, tags, resolved.ancestors),
      category: displayCategory(relative),
      ...(icon ?? {}),
      flags: compact({
        hidden: categories.some((category) => categoryInfo[category]?.hide) || undefined,
        noMap: categories.includes("DoNotMap") || undefined,
        // Spawn menu placement: SnapgridCenter means it sits in the middle of a tile (anchored structures, machines).
        placement: typeof resolved.placement?.mode === "string" ? resolved.placement.mode : undefined,
        directions: icon?.directions > 1 ? icon.directions : undefined,
        wallMount: "WallMount" in components || undefined,
        smooth: typeof components.IconSmooth?.key === "string" ? components.IconSmooth.key : undefined,
        // Job spawn points name their job; a station's gameMap job slots are counted from them.
        job: typeof components.SpawnPoint?.job_id === "string" ? components.SpawnPoint.job_id : undefined,
      }),
    });
  });

  // ---- Atlas ----
  const sortKey = (a, b) => a.layer.localeCompare(b.layer) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
  const items = [...tiles, ...entities].sort(sortKey);
  const imagePaths = [...new Set(items.map((item) => item.image).filter(Boolean))];
  const images = new Map();
  const loaded = await mapLimit(imagePaths, 16, (path) => source.image(path).catch(() => null), (done) => progress("images", done, imagePaths.length));
  imagePaths.forEach((path, i) => images.set(path, loaded[i]));

  const withIcon = items.filter((item) => item.image && images.get(item.image)).length;
  const columns = Math.max(1, Math.ceil(Math.sqrt(withIcon)));
  const rows = Math.max(1, Math.ceil(withIcon / columns));
  const atlas = { width: columns * ICON, height: rows * ICON, data: new Uint8Array(columns * ICON * rows * ICON * 4) };
  const placed = [];
  let index = 0;
  for (const item of items) {
    const { image, frame, directions, ...rest } = item;
    const sprite = image ? images.get(image) : null;
    if (!sprite) {
      // Items without a readable sprite are kept (the editor must still know their ids) with icon: null.
      placed.push({ ...rest, icon: null });
      continue;
    }
    // First frame (south direction, frame 0) is the top-left cell of the sheet.
    const fw = Math.min(frame?.x ?? ICON, sprite.width);
    const fh = Math.min(frame?.y ?? ICON, sprite.height);
    blitScaled(sprite, fw, fh, atlas, (index % columns) * ICON, Math.floor(index / columns) * ICON);
    placed.push({ ...rest, icon: index++ });
  }

  // ---- Migrations ----
  const migrations = {};
  const migrationText = await source.text("migration.yml");
  if (migrationText) {
    let data = {};
    try {
      data = YAML.parse(migrationText.replace(/^﻿/, ""), { logLevel: "silent" }) ?? {};
    } catch {
      unreadable.push("migration.yml");
    }
    for (const [from, to] of Object.entries(data)) migrations[from] = typeof to === "string" && to.trim() !== "" && to !== "null" ? to : null;
  }

  const credits = new Map();
  for (const item of placed) if (item.credit?.source) credits.set(item.credit.source, item.credit);

  return {
    palette: {
      version: PALETTE_VERSION,
      iconSize: ICON,
      atlasColumns: columns,
      items: placed.map(({ credit, ...item }) => item),
      migrations,
      spawnerCarrier: spawnerCarrier?.id ?? null,
    },
    atlas,
    credits: [...credits.values()].sort((a, b) => a.source.localeCompare(b.source)),
    unreadable,
  };
}

/** Runs fn over items with at most `limit` in flight, keeping the order of results. */
async function mapLimit(items, limit, fn, onProgress = () => {}) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function parents(proto) {
  if (!proto.parent) return [];
  return Array.isArray(proto.parent) ? proto.parent : [proto.parent];
}

function compareScores(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Walls, windows, doors, grilles and girders form the structure layer; everything else is an object. */
function entityLayer(id, components, tags, ancestors) {
  if (tags.has("Wall") || tags.has("Window") || "Door" in components) return "structure";
  if (STRUCTURE_ANCESTORS.has(id) || [...ancestors].some((ancestor) => STRUCTURE_ANCESTORS.has(ancestor))) return "structure";
  return "object";
}

/**
 * Category shown in the palette: the first two folders under Prototypes, without a fork's own top folder
 * (e.g. "_Fork/Entities/Structures/Walls/x.yml" becomes "Structures/Walls") and without the "Entities/" prefix.
 */
function displayCategory(relative) {
  let folders = relative.split("/").slice(0, -1);
  if (folders[0]?.startsWith("_")) folders = folders.slice(1);
  if (folders[0] === "Entities") folders = folders.slice(1);
  return folders.slice(0, 2).join("/") || "Other";
}

/** Names may carry rich text tags such as [color=green]...[/color]. */
function stripMarkup(text) {
  return String(text).replace(/\[\/?[a-z]+(=[^\]]*)?\]/gi, "").trim();
}

function compact(object) {
  const entries = Object.entries(object).filter(([, value]) => value !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

// Icon component wins over Sprite; a state that is missing falls back to the first layer, then to the first RSI state.
async function findIcon(components, readMeta, source) {
  const icon = components.Icon ?? {};
  const sprite = components.Sprite ?? {};
  const firstLayer = (sprite.layers ?? []).find((layer) => layer && (layer.state || layer.sprite)) ?? {};
  const rsi = icon.sprite ?? sprite.sprite ?? firstLayer.sprite;
  if (!rsi) return null;
  const meta = await readMeta(rsi);
  if (!meta) return null;
  const states = (meta.states ?? []).map((state) => state.name);
  let state = icon.state ?? sprite.state ?? firstLayer.state;
  if (!state || !states.includes(state)) state = states[0];
  if (!state) return null;
  const image = `Textures/${rsi}/${state}.png`;
  if (!source.has(image)) return null;
  return {
    image,
    directions: meta.states.find((entry) => entry.name === state)?.directions ?? 1,
    frame: meta.size ?? { x: ICON, y: ICON },
    credit: { source: `Textures/${rsi}`, license: meta.license, copyright: meta.copyright },
  };
}

// Nearest-neighbour fit of the frame into a 32x32 cell, keeping aspect ratio and centering it.
function blitScaled(source, fw, fh, target, tx, ty) {
  const scale = Math.min(1, ICON / fw, ICON / fh);
  const dw = Math.max(1, Math.round(fw * scale));
  const dh = Math.max(1, Math.round(fh * scale));
  const ox = tx + Math.floor((ICON - dw) / 2);
  const oy = ty + Math.floor((ICON - dh) / 2);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(fw - 1, Math.floor(x / scale));
      const sy = Math.min(fh - 1, Math.floor(y / scale));
      const si = (sy * source.width + sx) * 4;
      const di = ((oy + y) * target.width + (ox + x)) * 4;
      for (let c = 0; c < 4; c++) target.data[di + c] = source.data[si + c];
    }
  }
}
