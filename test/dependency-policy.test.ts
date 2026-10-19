import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  readDependencyRecord,
  sameDependencyAdditions,
  unapprovedDependencyAdditions,
} from "../src/dependency-policy.ts";
import type { DependencyAddition } from "../src/spec-doc.ts";

/**
 * Crew-chatter run 4's recorded evidence: the base `frontend/package.json` at
 * 8f539e5, and the four packages its reviewed specification adds "each at
 * `^3`" (test/fixtures/recorded/spec-crew-chatter-run-4-dependency-in-prose.json).
 */
const RUN_4 = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "spec-crew-chatter-run-4-dependency-in-prose.json"), "utf8")
) as { frontendPackageJson: string; provenance: { packagesAdded: string[] } };

const MANIFEST = "frontend/package.json";
const APPROVED: DependencyAddition[] = RUN_4.provenance.packagesAdded.map((name) => ({ manifest: MANIFEST, name }));

/** The recorded base manifest with the recorded packages added under npm's `dependencies`. */
function withRecordedPackages(): string {
  const manifest = JSON.parse(RUN_4.frontendPackageJson) as { dependencies: Record<string, string> };
  for (const name of RUN_4.provenance.packagesAdded) manifest.dependencies[name] = "^3";
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return (result.stdout ?? "").trim();
}

function commit(cwd: string, files: Record<string, string>, message: string): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
  git(cwd, ["add", "-A"]);
  git(cwd, ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

/** A repository whose base commit holds the recorded frontend manifest. */
function withRepository(fn: (root: string, base: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "bw-dependency-"));
  try {
    git(root, ["init", "-q"]);
    fn(root, commit(root, { [MANIFEST]: RUN_4.frontendPackageJson }, "base"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a head adding the four recorded packages passes when all four are approved", () => {
  withRepository((root, base) => {
    const head = commit(root, { [MANIFEST]: withRecordedPackages() }, "add");
    assert.deepEqual(unapprovedDependencyAdditions(root, base, head, APPROVED), { ok: true });
  });
});

test("the same head with nothing approved is refused, naming all four against their manifest", () => {
  withRepository((root, base) => {
    const head = commit(root, { [MANIFEST]: withRecordedPackages() }, "add");
    assert.deepEqual(unapprovedDependencyAdditions(root, base, head, []), {
      ok: false,
      reason: `the change adds package(s) the approved specification does not list under ## Dependencies added: ${RUN_4.provenance.packagesAdded.map((n) => `${MANIFEST}:${n}`).join(", ")}`,
    });
  });
});

test("names approved for a different manifest do not approve an addition to this one", () => {
  withRepository((root, base) => {
    const head = commit(root, { [MANIFEST]: withRecordedPackages() }, "add");
    const elsewhere = APPROVED.map((a) => ({ manifest: "backend/package.json", name: a.name }));
    const result = unapprovedDependencyAdditions(root, base, head, elsewhere);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /frontend\/package\.json:@tiptap\/react/);
  });
});

test("a version change of the recorded react entry is not an addition", () => {
  withRepository((root, base) => {
    const manifest = JSON.parse(RUN_4.frontendPackageJson) as { dependencies: Record<string, string> };
    manifest.dependencies.react = "^19.1.0";
    const head = commit(root, { [MANIFEST]: `${JSON.stringify(manifest, null, 2)}\n` }, "bump");
    assert.deepEqual(unapprovedDependencyAdditions(root, base, head, []), { ok: true });
  });
});

test("a package.json created at head counts every entry as added", () => {
  withRepository((root, base) => {
    const head = commit(root, { "tools/package.json": '{ "devDependencies": { "eslint": "^9" } }\n' }, "new");
    assert.deepEqual(unapprovedDependencyAdditions(root, base, head, APPROVED), {
      ok: false,
      reason: "the change adds package(s) the approved specification does not list under ## Dependencies added: tools/package.json:eslint",
    });
  });
});

test("a head manifest that is not JSON is refused by name", () => {
  withRepository((root, base) => {
    const head = commit(root, { [MANIFEST]: "{ not json\n" }, "broken");
    const result = unapprovedDependencyAdditions(root, base, head, APPROVED);
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, new RegExp(`^frontend/package\\.json at ${head} is not valid JSON: `));
  });
});

test("a head manifest saved with a UTF-8 byte-order mark parses", () => {
  withRepository((root, base) => {
    const head = commit(root, { [MANIFEST]: `﻿${withRecordedPackages()}` }, "bom");
    assert.deepEqual(unapprovedDependencyAdditions(root, base, head, APPROVED), { ok: true });
  });
});

test("the dependency record is the last spec.dependencies.record event, and two lists compare as sets", () => {
  assert.equal(readDependencyRecord([{ action: "spec.split.record", summary: "finding=3; pieces=2" }]), null);
  assert.deepEqual(
    readDependencyRecord([
      { action: "spec.dependencies.record", summary: "finding=4; packages=a:b" },
      { action: "spec.dependencies.record", summary: "finding=9; packages=a:c" },
    ]),
    { findingId: 9 }
  );
  assert.equal(sameDependencyAdditions(APPROVED, [...APPROVED].reverse()), true);
  assert.equal(sameDependencyAdditions(APPROVED, APPROVED.slice(1)), false);
  assert.equal(sameDependencyAdditions([], []), true);
});
