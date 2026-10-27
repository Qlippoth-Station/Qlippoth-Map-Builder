// The map a brand-new station is written into: a map entity and one empty station grid, with the components the
// game's own station grids carry (taken from Resources/Maps/reach.yml, data removed). Tiles, atmosphere and entities
// are filled in by the exporter.

/** Station id for BecomesStation and the gameMap prototype: letters and digits of the name, PascalCase. */
export function stationId(name: string): string {
  const words = name.match(/[A-Za-z0-9]+/g) ?? [];
  const id = words.map((word) => word[0].toUpperCase() + word.slice(1)).join("");
  return /^[A-Za-z]/.test(id) ? id : `Station${id}`;
}

/** YAML scalar safe for a single line (quoted when it could be read as something else). */
export function yamlScalar(value: string): string {
  return /^[A-Za-z0-9 _.\-()]+$/.test(value) && !/^[\s\-]|\s$/.test(value) ? value : `'${value.replaceAll("'", "''")}'`;
}

export function newStationText(name: string): string {
  return [
    "meta:",
    "  format: 7",
    "  category: Map",
    "  engineVersion: 272.0.0",
    '  forkId: ""',
    '  forkVersion: ""',
    "  time: 01/01/2026 00:00:00",
    "  entityCount: 2",
    "maps:",
    "- 1",
    "grids:",
    "- 2",
    "orphans: []",
    "nullspace: []",
    "tilemap:",
    "  0: Space",
    "entities:",
    '- proto: ""',
    "  entities:",
    "  - uid: 1",
    "    components:",
    "    - type: MetaData",
    "    - type: Transform",
    "    - type: Map",
    "      mapPaused: True",
    "    - type: GridTree",
    "    - type: Broadphase",
    "    - type: OccluderTree",
    "  - uid: 2",
    "    components:",
    "    - type: MetaData",
    `      name: ${yamlScalar(name)}`,
    "    - type: Transform",
    "      parent: 1",
    "    - type: MapGrid",
    "      chunks: {}",
    "    - type: Broadphase",
    "    - type: Physics",
    "      bodyStatus: InAir",
    "      angularDamping: 0.05",
    "      linearDamping: 0.05",
    "      fixedRotation: False",
    "      bodyType: Dynamic",
    "    - type: Fixtures",
    "      fixtures: {}",
    "    - type: BecomesStation",
    `      id: ${stationId(name)}`,
    "    - type: OccluderTree",
    "    - type: Shuttle",
    "      dampingModifier: 0.25",
    "    - type: GridPathfinding",
    "    - type: Gravity",
    "      gravityShakeSound: !type:SoundPathSpecifier",
    "        path: /Audio/Effects/alert.ogg",
    "    - type: DecalGrid",
    "      chunkCollection:",
    "        version: 2",
    "        nodes: []",
    "    - type: GridAtmosphere",
    "      version: 2",
    "      data:",
    "        tiles: {}",
    "        uniqueMixes:",
    "        - volume: 2500",
    "          immutable: True",
    "          moles: {}",
    "        - volume: 2500",
    "          temperature: 293.15",
    "          moles:",
    "            Oxygen: 21.824879",
    "            Nitrogen: 82.10312",
    "        chunkSize: 4",
    "    - type: GasTileOverlay",
    "    - type: RadiationGridResistance",
    "    - type: SpreaderGrid",
    "    - type: ImplicitRoof",
    "    - type: ExplosionAirtightGrid",
    "    - type: TileHistory",
    "      chunkHistory: {}",
    "...",
    "",
  ].join("\n");
}
