import { spawnSync } from "node:child_process";
import { normalizeText } from "./canonical.ts";
import { upstreamPrefixFor } from "./reconciliation.ts";
import { normalizePath } from "./scope.ts";
import type { DependencyAddition } from "./spec-doc.ts";

/**
 * Dependency policy as code (`docs/features/derived-artifacts-and-dependency-policy/plan.md`,
 * operator decision 2026-10-18). A specification lists every package it adds
 * under `## Dependencies added`; the operator approves or denies that list at
 * the decision pause, before the plan is written; and the implementation is
 * refused when it adds a package the signed specification does not list.
 */

/**
 * The dependency finding's intent key. A reviewer may report the same key, so
 * no reader finds the question by it: the `spec.dependencies.record` event
 * names the finding (`readDependencyRecord`).
 */
export const DEPENDENCY_INTENT = "dependency-additions";

/**
 * The dependency finding's location. The colon after `dependencies` keeps a
 * reviewer's upstream location (the prefix and one kebab-case key) from ever
 * sharing this identity, as the design split's location does.
 */
export const DEPENDENCY_LOCATION = `${upstreamPrefixFor("design")}dependencies:added`;

/** Approve is the recommended option; deny ends the run. */
export const DEPENDENCY_OPTIONS = [
  { label: "Approve", answer: "add the listed packages" },
  { label: "Deny", answer: "add none of them: the run ends blocked so the design can say what to use instead" },
];

export const DEPENDENCY_RECOMMENDED = 0;

export function dependencyKey(addition: DependencyAddition): string {
  return `${addition.manifest}:${addition.name}`;
}

/** The operator question, naming every package and the file it is added to. */
export function dependencyQuestionText(additions: readonly DependencyAddition[]): string {
  return `The reviewed specification adds ${additions.length} package(s) under ## Dependencies added:

${additions.map((a) => `- ${a.manifest}: ${a.name}`).join("\n")}

Approve lets the implementation add exactly these packages to those package.json files; the system refuses a commit that adds any other.
Deny ends this run blocked: state in the design what to use instead, and start a fresh run.
Modify is not accepted for this question.`;
}

export const DEPENDENCY_WHY =
  "The specification's approach depends on these packages, and every package a run adds is the operator's choice. Deny ends the run, because a specification built on them cannot be built without them.";

/** The dependency question the spec stage recorded, read from the run's last `spec.dependencies.record` event. */
export interface DependencyRecord {
  findingId: number;
}

/**
 * The run's recorded dependency question, or null when the reviewed
 * specification added no package. The event is written by the system, so it,
 * not the finding's intent key, says which question is the dependency one.
 */
export function readDependencyRecord(events: readonly { action: string; summary: string }[]): DependencyRecord | null {
  const record = events.filter((e) => e.action === "spec.dependencies.record").at(-1);
  if (record === undefined) return null;
  const match = /^finding=(\d+); /.exec(record.summary);
  const findingId = match === null ? NaN : Number(match[1]);
  if (!Number.isInteger(findingId) || findingId < 1) return null;
  return { findingId };
}

/** Two lists name the same additions, in any order. */
export function sameDependencyAdditions(a: readonly DependencyAddition[], b: readonly DependencyAddition[]): boolean {
  const left = new Set(a.map(dependencyKey));
  const right = new Set(b.map(dependencyKey));
  return left.size === right.size && [...left].every((key) => right.has(key));
}

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

function runGit(
  args: string[],
  cwd: string
): { ok: true; stdout: string } | { ok: false; detail: string } {
  let result;
  try {
    result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
  if (result.status !== 0) {
    const detail = (result.stderr ?? "").trim();
    return { ok: false, detail: detail || `git ${args[0]} exited with code ${result.status}` };
  }
  return { ok: true, stdout: result.stdout ?? "" };
}

/** The package names under every dependency field of one manifest. */
function declaredNames(manifest: unknown): Set<string> {
  const names = new Set<string>();
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) return names;
  for (const field of DEPENDENCY_FIELDS) {
    const entries = (manifest as Record<string, unknown>)[field];
    if (entries !== null && typeof entries === "object" && !Array.isArray(entries)) {
      for (const name of Object.keys(entries)) names.add(name);
    }
  }
  return names;
}

/**
 * Refuse a change that adds a package the signed specification does not list.
 * Every `package.json` the range `base..head` changes is read at both commits
 * (absent at base counts as empty), and every name present at head and absent
 * at base under `dependencies`, `devDependencies`, `optionalDependencies` or
 * `peerDependencies` must be approved for that same manifest. Removals and
 * version changes are not additions and are not checked.
 */
export function unapprovedDependencyAdditions(
  worktreePath: string,
  base: string,
  head: string,
  approved: readonly DependencyAddition[]
): { ok: true } | { ok: false; reason: string } {
  const changed = runGit(["diff", "--name-only", "-z", base, head], worktreePath);
  if (!changed.ok) {
    return { ok: false, reason: `cannot read the changed paths for ${base}..${head}: ${changed.detail}` };
  }
  const manifests = changed.stdout
    .split("\0")
    .filter((p) => p !== "")
    .map(normalizePath)
    .filter((p) => p === "package.json" || p.endsWith("/package.json"));
  const allowed = new Set(approved.map(dependencyKey));
  const refused: string[] = [];
  for (const manifest of manifests) {
    const atHead = runGit(["show", `${head}:${manifest}`], worktreePath);
    if (!atHead.ok) {
      return { ok: false, reason: `cannot read ${manifest} at ${head}: ${atHead.detail}` };
    }
    let headManifest: unknown;
    try {
      headManifest = JSON.parse(normalizeText(atHead.stdout));
    } catch (err) {
      return { ok: false, reason: `${manifest} at ${head} is not valid JSON: ${(err as Error).message}` };
    }
    const atBase = runGit(["show", `${base}:${manifest}`], worktreePath);
    let baseNames = new Set<string>();
    if (atBase.ok) {
      try {
        baseNames = declaredNames(JSON.parse(normalizeText(atBase.stdout)));
      } catch {
        // A base manifest that does not parse declares nothing this check can
        // trust, so every entry at head counts as added.
        baseNames = new Set<string>();
      }
    }
    for (const name of declaredNames(headManifest)) {
      if (baseNames.has(name)) continue;
      const key = `${manifest}:${name}`;
      if (!allowed.has(key)) refused.push(key);
    }
  }
  if (refused.length > 0) {
    return {
      ok: false,
      reason: `the change adds package(s) the approved specification does not list under ## Dependencies added: ${refused.join(", ")}`,
    };
  }
  return { ok: true };
}
