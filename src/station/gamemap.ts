// The gameMap prototype that puts a station into the game's map rotation, and the export package around it.

import { itemsOf, type MapDocument } from "../document";
import { findItem, type Palette } from "../palette";
import { createZip } from "../zip";
import { exportStation } from "./export";
import { stationId } from "./template";

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

/** Map .yml, gameMap prototype and a short README, laid out like the game repository. */
export function exportPackage(doc: MapDocument, palette: Palette, baseName: string): Blob {
  const mapPath = `/Maps/${baseName}.yml`;
  const id = stationIdOf(doc);
  const readme = [
    `${doc.name} — exported by the Qlippoth Map Builder`,
    "",
    "1. Copy the Resources folder into the game repository (it only adds files):",
    `   Resources/Maps/${baseName}.yml                 the station map`,
    `   Resources/Prototypes/Maps/${baseName}.yml      its gameMap prototype (id ${id})`,
    "2. Check the job slots in the gameMap prototype; they were counted from the job spawn points.",
    `3. To put it in the rotation, add ${id} to the maps list of Resources/Prototypes/Maps/Pools/default.yml.`,
    `4. To play it once: forcemap ${id} in the server console, then restart the round.`,
    "",
  ].join("\n");
  return createZip([
    { path: `Resources/Maps/${baseName}.yml`, text: exportStation(doc, palette).text },
    { path: `Resources/Prototypes/Maps/${baseName}.yml`, text: gameMapYaml(doc, palette, mapPath) },
    { path: "README.txt", text: readme },
  ]);
}
