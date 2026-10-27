// Builds the palettes of the codebases listed in codebases.json, for the editor's Codebase dialog.
//
//   node scripts/build-codebases.mjs
//
// The default codebase's palette is built by `npm run palette` into public/palette/ (CI does that first). Every other
// entry is cloned (sparse, only Resources/Prototypes, Textures and Locale/en-US) and built into
// public/palette/codebases/<id>/. public/palette/codebases.json then lists all of them for the editor.
//
// codebases.json entries: { "id", "name", "repository": "owner/repo", "ref": branch or tag ("" = default branch),
// "default": true for the one in public/palette/ }.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const registry = JSON.parse(fs.readFileSync("codebases.json", "utf8"));
const listed = [];

for (const entry of registry) {
  if (!/^[A-Za-z0-9_-]+$/.test(entry.id) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(entry.repository)) {
    console.error(`Skipping invalid entry ${JSON.stringify(entry)}`);
    continue;
  }
  if (entry.default) {
    const palette = path.join("public", "palette", "palette.json");
    const commit = fs.existsSync(palette) ? JSON.parse(fs.readFileSync(palette, "utf8")).gameCommit ?? null : null;
    listed.push({ ...entry, commit, path: "palette/" });
    continue;
  }
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), `codebase-${entry.id}-`));
  try {
    const git = (...args) => execFileSync("git", args, { cwd: checkout, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
    const clone = ["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--sparse"];
    if (entry.ref) clone.push("--branch", entry.ref);
    git(...clone, `https://github.com/${entry.repository}.git`, ".");
    git("sparse-checkout", "set", "Resources/Prototypes", "Resources/Textures", "Resources/Locale/en-US");
    const out = path.join("public", "palette", "codebases", entry.id);
    execFileSync("node", ["scripts/build-palette.mjs", "--game", checkout, "--out", out], { stdio: "inherit" });
    listed.push({ ...entry, commit: git("rev-parse", "HEAD"), path: `palette/codebases/${entry.id}/` });
  } catch (error) {
    // One broken fork must not stop the site from deploying.
    console.error(`Could not build ${entry.repository}: ${error.message}`);
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
}

fs.mkdirSync(path.join("public", "palette"), { recursive: true });
fs.writeFileSync(path.join("public", "palette", "codebases.json"), JSON.stringify(listed, null, 2));
console.log(`Codebases: ${listed.map((entry) => entry.id).join(", ")}`);
