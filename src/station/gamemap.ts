// The gameMap prototype that puts a station into the game's map rotation, and the export package around it.

import { cellKey, createDocument, fromItems, itemsOf, type Brush, type LayerId, type MapDocument } from "../document";
import { findItem, type Palette } from "../palette";
import { createZip } from "../zip";
import { exportStation, newSource } from "./export";
import { newAtlasText, stationId } from "./template";

/** The station id the grid becomes (its BecomesStation id); the gameMap's station key must match it. */
export function stationIdOf(doc: MapDocument): string {
  const source = doc.station;
  const grid = source?.file.byUid.get(source.gridUid);
  if (source && grid) {
    const lines = source.file.lines;
    for (let i = grid.start; i < grid.end; i++) {
      if (lines[i] !== "    - type: BecomesStation") continue;
      for (let j = i + 1; j < grid.end && lines[j].startsWith("      "); j++) {
        if (lines[j].startsWith("      id: ")) return lines[j].slice(10).trim();
      }
    }
  }
  return stationId(doc.name);
}

/** Job slots counted from job spawn points, in the order jobs first appear. */
export function stationJobs(doc: MapDocument, palette: Palette): Map<string, number> {
  const jobs = new Map<string, number>();
  for (const brush of doc.layers.object.values()) {
    for (const item of itemsOf(brush)) {
      const job = findItem(palette, "object", item.id)?.flags?.job;
      if (job) jobs.set(job, (jobs.get(job) ?? 0) + 1);
    }
  }
  return jobs;
}

const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;

export function gameMapYaml(doc: MapDocument, palette: Palette, mapPath: string): string {
  const id = stationIdOf(doc);
  const jobs = [...stationJobs(doc, palette)].sort((a, b) => a[0].localeCompare(b[0]));
  return [
    "- type: gameMap",
    `  id: ${id}`,
    `  mapName: ${quote(doc.name)}`,
    `  mapPath: ${mapPath}`,
    "  minPlayers: 0",
    "  stations:",
    `    ${id}:`,
    "      stationProto: StandardNanotrasenStation",
    "      components:",
    "        - type: StationNameSetup",
    `          mapNameTemplate: ${quote(`{0} ${doc.name} {1}`)}`,
    "          nameGenerator:",
    "            !type:NanotrasenNameGenerator",
    "            prefixCreator: 'QS'",
    "        - type: StationEmergencyShuttle",
    "          emergencyShuttlePath: /Maps/Shuttles/emergency.yml",
    "        - type: StationJobs",
    jobs.length ? "          availableJobs: # counted from the job spawn points on the map" : "          availableJobs: {}",
    ...jobs.map(([job, count]) => `            ${job}: [ ${count}, ${count} ]`),
    "",
  ].join("\n");
}

const pascal = (text: string) => (text.match(/[A-Za-z0-9]+/g) ?? []).map((word) => word[0].toUpperCase() + word.slice(1)).join("");

export interface RoomFiles {
  /** The station with a room marker at the middle of every slot that has rooms. */
  station: MapDocument;
  files: { path: string; text: string }[];
  rooms: number;
}

/**
 * Random room slots for the game's RoomFill: the slots' modules laid out side by side on one atlas map, a
 * dungeonRoom per module (tagged by slot), and per slot a room marker entity whose RoomFill only takes rooms of the
 * slot's exact size and tag. The marker sits at the slot's middle, where RoomFill centres the room it picks.
 */
export function roomFiles(doc: MapDocument, palette: Palette, baseName: string, readModule: (id: string) => MapDocument | null): RoomFiles {
  const station = stationIdOf(doc);
  const slots = (doc.roomSlots ?? [])
    .map((slot) => ({
      slot,
      rooms: slot.modules.map(readModule).filter((room): room is MapDocument => !!room && room.width === slot.width && room.height === slot.height),
    }))
    .filter(({ rooms }) => rooms.length > 0);
  if (slots.length === 0) return { station: doc, files: [], rooms: 0 };

  const all = slots.flatMap(({ slot, rooms }) => rooms.map((room) => ({ slot, room })));
  const atlas = createDocument("station", `${doc.name} rooms`, all.reduce((sum, { room }) => sum + room.width + 1, 0), Math.max(...all.map(({ room }) => room.height)));
  const { originX, originY } = newSource(atlas, newAtlasText());
  const atlasPath = `/Maps/Dungeon/${baseName}_rooms.yml`;
  const prototypes: string[] = [];
  let cursor = 0;
  slots.forEach(({ slot, rooms }) => {
    const tag = `${station}${pascal(slot.name)}Room`;
    prototypes.push(`- type: Tag`, `  id: ${tag}`, "");
    rooms.forEach((room, index) => {
      for (const layer of ["floor", "structure", "object"] as LayerId[]) {
        for (const [key, brush] of room.layers[layer]) {
          const [x, y] = key.split(",").map(Number);
          atlas.layers[layer].set(cellKey(cursor + x, y), fromItems(itemsOf(brush).map(({ uid, ...item }) => item)) as Brush);
        }
      }
      prototypes.push(
        "- type: dungeonRoom",
        `  id: ${tag}${index + 1}`,
        `  size: ${room.width},${room.height}`,
        `  atlas: ${atlasPath}`,
        `  offset: ${cursor + originX},${originY}`,
        "  tags:",
        `  - ${tag}`,
        ""
      );
      cursor += room.width + 1;
    });
    prototypes.push(
      "- type: entity",
      `  id: ${tag}Marker`,
      "  parent: BaseRoomMarker",
      `  name: ${slot.name} room marker`,
      "  components:",
      "  - type: RoomFill",
      "    rotation: false",
      `    minSize: ${slot.width}, ${slot.height}`,
      `    maxSize: ${slot.width}, ${slot.height}`,
      "    roomWhitelist:",
      "      tags:",
      `      - ${tag}`,
      ""
    );
  });

  // The station gets the markers on its Object layer; the doc itself stays untouched.
  const object = new Map(doc.layers.object);
  for (const { slot } of slots) {
    const key = cellKey(slot.x + Math.floor(slot.width / 2), slot.y + Math.floor(slot.height / 2));
    object.set(key, fromItems([...itemsOf(object.get(key)), { kind: "fixed", id: `${station}${pascal(slot.name)}RoomMarker` }])!);
  }
  return {
    station: { ...doc, layers: { ...doc.layers, object } },
    files: [
      { path: `Resources${atlasPath}`, text: exportStation(atlas, palette, newAtlasText()).text },
      { path: `Resources/Prototypes/Maps/${baseName}_rooms.yml`, text: prototypes.join("\n") },
    ],
    rooms: all.length,
  };
}

/** Map .yml, gameMap prototype, random rooms and a short README, laid out like the game repository. */
export function exportPackage(doc: MapDocument, palette: Palette, baseName: string, readModule: (id: string) => MapDocument | null = () => null): Blob {
  const mapPath = `/Maps/${baseName}.yml`;
  const id = stationIdOf(doc);
  const rooms = roomFiles(doc, palette, baseName, readModule);
  const readme = [
    `${doc.name} — exported by the Qlippoth Map Builder`,
    "",
    "1. Copy the Resources folder into the game repository (it only adds files):",
    `   Resources/Maps/${baseName}.yml                 the station map`,
    `   Resources/Prototypes/Maps/${baseName}.yml      its gameMap prototype (id ${id})`,
    "2. Check the job slots in the gameMap prototype; they were counted from the job spawn points.",
    `3. To put it in the rotation, add ${id} to the maps list of Resources/Prototypes/Maps/Pools/default.yml.`,
    `4. To play it once: forcemap ${id} in the server console, then restart the round.`,
    ...(rooms.rooms
      ? [
          "",
          `Random rooms: ${rooms.rooms} room(s) for ${doc.roomSlots?.length ?? 0} slot(s). The rooms are laid out on`,
          `Resources/Maps/Dungeon/${baseName}_rooms.yml; Resources/Prototypes/Maps/${baseName}_rooms.yml holds their`,
          "dungeonRoom prototypes, tags and the room markers placed on the station map. At round start every marker",
          "clears its slot and puts one of its rooms there.",
        ]
      : []),
    "",
  ].join("\n");
  return createZip([
    { path: `Resources/Maps/${baseName}.yml`, text: exportStation(rooms.station, palette).text },
    { path: `Resources/Prototypes/Maps/${baseName}.yml`, text: gameMapYaml(doc, palette, mapPath) },
    ...rooms.files,
    { path: "README.txt", text: readme },
  ]);
}
