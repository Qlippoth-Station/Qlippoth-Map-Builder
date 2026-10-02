// Guards random lists in pull requests: compares the list files of a PR with its base branch.
//
//   node scripts/check-list-changes.mjs --base <lists dir> --head <lists dir> [--domains <dir>] [--approved] [--summary <file>]
//
// A list id is shared by every domain that uses it, so:
//   - a new list is fine,
//   - changing the entries of an existing list changes every domain using it: blocked unless the PR is approved for it
//     (--approved, set by CI from the `list-change-approved` label),
//   - removing a list that a domain still uses is blocked,
//   - changing only the name or icon is fine (the game ignores them).
// Two PRs adding the same new id meet as a git conflict, because a list's path is its id (see check-domains.mjs).
//
// The report is printed and, with --summary, appended as Markdown (CI passes $GITHUB_STEP_SUMMARY).
// Used by .github/workflows/lists-guard.yml (built-in lists in this repository) and
// .github/workflows/check-game-domains.yml (the game's Resources/Domains/Lists/).

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { domainsUsing, readDomains, readListDir, sameListContent } from "./lists-common.mjs";

/**
 * Compares two sets of list files (file name -> parsed JSON or null).
 * Returns what changed and which changes block the PR.
 */
export function compareLists(base, head, domains = []) {
  const result = { added: [], changed: [], cosmetic: [], removed: [], blocking: [] };
  for (const [file, data] of head) {
    const id = data?.id ?? file.replace(/\.list\.json$/, "");
    if (!base.has(file)) {
      result.added.push({ id, file });
      continue;
    }
    const before = base.get(file);
    if (!before || !data) continue; // Unreadable files are reported by `npm run domains`.
    if (JSON.stringify(before) === JSON.stringify(data)) continue;
    if (sameListContent(before, data)) {
      result.cosmetic.push({ id, file });
      continue;
    }
    const change = { id, file, usedBy: domainsUsing(domains, id), details: describeChange(before, data) };
    result.changed.push(change);
    result.blocking.push(change);
  }
  for (const [file, data] of base) {
    if (head.has(file)) continue;
    const id = data?.id ?? file.replace(/\.list\.json$/, "");
    const removal = { id, file, usedBy: domainsUsing(domains, id) };
    result.removed.push(removal);
    if (removal.usedBy.length) result.blocking.push(removal);
  }
  return result;
}

/** Short text of what changed in a list's content. */
export function describeChange(before, after) {
  const key = (entry) => (entry.empty ? "(nothing)" : entry.id);
  const weights = (list) => new Map((list.entries ?? []).map((entry) => [key(entry), entry.weight ?? 1]));
  const a = weights(before);
  const b = weights(after);
  const parts = [];
  if (before.layer !== after.layer) parts.push(`layer ${before.layer} → ${after.layer}`);
  const added = [...b.keys()].filter((id) => !a.has(id));
  const removed = [...a.keys()].filter((id) => !b.has(id));
  const reweighted = [...b.keys()].filter((id) => a.has(id) && a.get(id) !== b.get(id));
  if (added.length) parts.push(`added ${added.join(", ")}`);
  if (removed.length) parts.push(`removed ${removed.join(", ")}`);
  if (reweighted.length) parts.push(`new chances for ${reweighted.join(", ")}`);
  if (!parts.length) parts.push("entries reordered (changes which item a seed picks)");
  return parts.join("; ");
}

/** Markdown report for the PR (also readable as plain text). */
export function formatReport(result, { approved = false, domainsChecked = true } = {}) {
  const lines = ["## Random lists in this pull request", ""];
  const used = (usedBy) =>
    !domainsChecked ? "domains in the game; check them" : usedBy.length ? `${usedBy.length} domain(s): ${usedBy.join(", ")}` : "no domain";
  if (!result.added.length && !result.changed.length && !result.cosmetic.length && !result.removed.length) {
    lines.push("No list changes.");
    return lines.join("\n") + "\n";
  }
  lines.push("| List | Change | Used by | |", "|---|---|---|---|");
  for (const { id } of result.added) lines.push(`| \`${id}\` | new list | | ✅ |`);
  for (const { id } of result.cosmetic) lines.push(`| \`${id}\` | name or icon only | | ✅ |`);
  for (const { id, details, usedBy } of result.changed) lines.push(`| \`${id}\` | ${details} | ${used(usedBy)} | ${approved ? "✅ approved" : "⛔ needs approval"} |`);
  for (const { id, usedBy } of result.removed) {
    const blocked = usedBy.length > 0;
    lines.push(`| \`${id}\` | removed | ${used(usedBy)} | ${blocked ? "⛔ still used" : "✅"} |`);
  }
  lines.push("");
  if (result.changed.length && !approved) {
    lines.push(
      "Changing an existing list changes **every domain that uses it**, including domains made by other people. " +
        "Prefer a new list with a new id. If the change is intended, a maintainer adds the `list-change-approved` label."
    );
  }
  if (result.removed.some(({ usedBy }) => usedBy.length)) {
    lines.push("A removed list is still used by a domain: update those domains first or keep the list.");
  }
  return lines.join("\n") + "\n";
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const baseDir = argument("--base");
  const headDir = argument("--head");
  if (!baseDir || !headDir) {
    console.error("Usage: node scripts/check-list-changes.mjs --base <lists dir> --head <lists dir> [--domains <dir>] [--approved] [--summary <file>]");
    process.exit(2);
  }
  const domainsDir = argument("--domains");
  const approved = process.argv.includes("--approved");
  const result = compareLists(readListDir(baseDir), readListDir(headDir), readDomains(domainsDir));
  const report = formatReport(result, { approved, domainsChecked: !!domainsDir });
  console.log(report);
  const summary = argument("--summary");
  if (summary) fs.appendFileSync(summary, report);

  const unapproved = result.blocking.filter((item) => !(approved && result.changed.includes(item)));
  if (unapproved.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
