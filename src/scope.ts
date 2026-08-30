/**
 * The paths a run may touch and the paths nothing may touch. Extracted from
 * the spec stage because the approval gate is a second real consumer: it
 * recomputes both the scope the operator signs and the risk that sizes the
 * panel (hard rule 4 — the second case exists, so the interface is extracted
 * now and not before).
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Resolve `p` through any symlink or junction, tolerating a path that does
 * not exist yet: walk up to the nearest existing ancestor, resolve that, and
 * rejoin the unresolved tail. `keygen --out` names a directory that is
 * usually about to be created, so requiring the whole path to exist would
 * make the containment check unusable exactly where it matters most.
 *
 * A `realpathSync` that throws (a permission error, a race) falls back to the
 * lexical resolution, which is what the callers did before this existed — no
 * worse than the previous behaviour, never silently more permissive than it.
 */
export function resolveExisting(p: string): string {
  let current = resolve(p);
  const tail: string[] = [];
  for (;;) {
    if (existsSync(current)) {
      try {
        return join(realpathSync(current), ...tail.reverse());
      } catch {
        return resolve(p);
      }
    }
    const parent = dirname(current);
    if (parent === current) return resolve(p);
    tail.push(basename(current));
    current = parent;
  }
}

/**
 * Is `child` inside `parent` once both are resolved through the filesystem?
 *
 * The lexical test this replaces compared strings, so a junction or symlink
 * outside the repository pointing back into it read as "outside" and signing
 * material was accepted into a tracked tree — which section 17 forbids. The
 * question is where the bytes actually live, and only the filesystem answers
 * that.
 *
 * Shared by `src/approval.ts` and `scripts/sign-approval.mjs` so the two
 * tools cannot drift into enforcing different rules.
 */
export function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolveExisting(parent), resolveExisting(child));
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return true;
  // Spelling-independent backstop. `realpathSync` does not expand 8.3
  // short-name segments on Windows ("SHAWN-~1" for "Shawn-work"), so a child
  // spelled through an alias of the parent's own name compares as unrelated
  // even though the bytes are inside it. Directory identity does not care
  // about spelling: if any existing ancestor of the child *is* the parent
  // directory, the child is inside it. This arm can only add refusals; on
  // filesystems where inode identity is unavailable it declines and leaves
  // the resolved comparison above as the answer.
  let parentIno: bigint;
  try {
    parentIno = statSync(parent, { bigint: true }).ino;
  } catch {
    return false;
  }
  if (parentIno === 0n) return false;
  let current = resolve(child);
  for (;;) {
    if (!existsSync(current)) {
      const parentDir = dirname(current);
      if (parentDir === current) return false;
      current = parentDir;
      continue;
    }
    try {
      if (statSync(current, { bigint: true }).ino === parentIno) return true;
    } catch {
      return false;
    }
    const parentDir = dirname(current);
    if (parentDir === current) return false;
    current = parentDir;
  }
}

export const PROTECTED_PATH_PREFIXES: readonly string[] = [
  "src/agents/",
  "src/executor.ts",
  "governed.yaml",
  ".governance/",
];

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * The comparison is case-folded. On Windows and macOS `Src/Agents/x.ts` and
 * `src/agents/x.ts` name the same file, so an exact-case prefix test lets a
 * declared artifact evade the guard and take the risk score down with it.
 * Folding costs nothing on a case-sensitive filesystem: it can only ever
 * protect a path that would not have been protected, never the reverse.
 * `computeScope` deliberately does not fold — the operator signs the paths
 * as the spec declared them.
 */
export function touchesProtected(artifacts: string[], slug: string): boolean {
  const designPath = `docs/features/${slug}/design.md`.toLowerCase();
  return artifacts.some((a) => {
    const p = normalizePath(a).toLowerCase();
    return (
      PROTECTED_PATH_PREFIXES.some((prefix) => p.startsWith(prefix.toLowerCase())) ||
      p === designPath
    );
  });
}

/**
 * The scope the operator signs (architecture section 12): the set of paths
 * the spec declares, normalized, deduplicated, and ordered. Sorting is what
 * makes the signed payload independent of the order the author happened to
 * list them in.
 */
export function computeScope(declaredArtifacts: string[]): string[] {
  return [...new Set(declaredArtifacts.map(normalizePath))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0
  );
}
