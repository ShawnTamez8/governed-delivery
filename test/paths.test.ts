import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GOVERNANCE_DIR,
  GOVERNANCE_PREFIX,
  lockDir,
  profileDir,
  profilePath,
  proposalEvidenceDir,
  rawOutputDir,
  rawOutputRef,
  stateDbPath,
  verificationEvidenceDir,
  worktreePath,
} from "../src/paths.ts";

const SRC = join(fileURLToPath(new URL("..", import.meta.url)), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : e.name.endsWith(".ts")
        ? [join(dir, e.name)]
        : []
  );
}

/**
 * The lines of a TypeScript file that are code rather than comment.
 *
 * Deliberately line-oriented instead of a real lexer. A lexer is what you
 * need when a comment opener appears inside a string, and this repository has
 * exactly that — the executor's sandbox glob ends in `/**` — so treating a
 * block-comment opener as an opener only when it starts a line is what keeps
 * that string visible to the scan below. The bias is toward reporting a
 * mention the scan cannot classify: a trailing comment on a code line still
 * counts as code, which fails the test rather than hiding a path
 * construction behind a comment marker.
 */
function codeLines(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split(/\r?\n/)) {
    let line = raw.trim();
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      inBlock = false;
      line = line.slice(end + 2).trim();
    }
    if (line === "" || line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      const end = line.indexOf("*/", 2);
      if (end === -1) {
        inBlock = true;
        continue;
      }
      line = line.slice(end + 2).trim();
      if (line === "" || line.startsWith("//")) continue;
    }
    out.push(line);
  }
  return out;
}

test("the governance directory name is written in exactly one production module", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    if (file === join(SRC, "paths.ts")) continue;
    for (const line of codeLines(readFileSync(file, "utf8"))) {
      if (line.includes(GOVERNANCE_DIR)) {
        offenders.push(`${relative(SRC, file)}: ${line}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `only src/paths.ts may spell the governance directory; build the path there and import it:\n${offenders.join("\n")}`
  );
});

test("src/paths.ts does spell it, so the scan above is testing something", () => {
  const lines = codeLines(readFileSync(join(SRC, "paths.ts"), "utf8"));
  assert.ok(lines.some((l) => l.includes(GOVERNANCE_DIR)));
});

/**
 * The values themselves, pinned against the layout as shipped. This task
 * moved where the name is written, not where anything is stored, and a
 * refactor that quietly renamed a subdirectory would strand every run whose
 * state is already on disk.
 */
test("every location is the one shipped before the module existed", () => {
  const root = join("C:", "repo");
  const p = (...parts: string[]) => join(root, ".governance", ...parts);
  assert.equal(GOVERNANCE_DIR, ".governance");
  assert.equal(GOVERNANCE_PREFIX, ".governance/");
  assert.equal(lockDir(root), p());
  assert.equal(stateDbPath(root), p("state.db"));
  assert.equal(rawOutputDir(root, 7), p("raw", "7"));
  assert.equal(rawOutputRef(7, "a.json"), join(".governance", "raw", "7", "a.json"));
  assert.equal(profileDir(root, 7), p("profiles", "7"));
  assert.equal(profilePath(root, 7), p("profiles", "7", "profile.json"));
  assert.equal(verificationEvidenceDir(root, 7), p("verification", "7"));
  assert.equal(worktreePath(root, 7), p("worktrees", "7"));
  assert.equal(proposalEvidenceDir(root, 7), p("proposals", "7"));
});
