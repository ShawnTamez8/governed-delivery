/**
 * The paths a run may touch and the paths nothing may touch. Extracted from
 * the spec stage because the approval gate is a second real consumer: it
 * recomputes both the scope the operator signs and the risk that sizes the
 * panel (hard rule 4 — the second case exists, so the interface is extracted
 * now and not before).
 */

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { GOVERNANCE_PREFIX } from "./paths.ts";

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
  GOVERNANCE_PREFIX,
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

/**
 * Which declared artifacts name a directory that exists in `commit`'s tree.
 * Delivery (architecture step 8) proves each declared artifact by exact
 * equality with a committed file path, and a directory can never equal one,
 * so the gates refuse the shape before a run pays for it. Called against the
 * starting commit frozen at run start (`profile.startingCommit`), so the
 * answer is stable across every specification revision — the tree never
 * includes this run's own projections. A path that names nothing in the
 * commit is a future file the implementation is expected to create, and
 * passes: its intended type cannot be inferred deterministically, and
 * refusing it would make every new-code run unplannable.
 *
 * `git` failure refuses rather than passing (fail closed): a tree that
 * cannot be read cannot prove a path is not a directory, and the callers
 * are gates.
 */
export function artifactDirectoryRefusals(
  rootDir: string,
  commit: string,
  artifacts: readonly string[]
): { ok: true; directories: string[] } | { ok: false; reason: string } {
  if (artifacts.length === 0) {
    return { ok: true, directories: [] };
  }
  // One spawn per artifact, not one spawn with every path: git's pathspec
  // handling turns a multi-path call containing any slash-carrying path into
  // a traversal that suppresses sibling bare-directory matches (verified:
  // `ls-tree HEAD -- src src/exists.ts` returns only the blob). A declared
  // artifact list is small, so per-path queries cost nothing measurable.
  const directories = new Set<string>();
  for (const artifact of artifacts) {
    let result;
    try {
      // `--literal-pathspecs` is a global git option and must precede the
      // subcommand: a declared artifact is a literal path, never a glob, so
      // `*` and `?` must not be treated as patterns by git.
      result = spawnSync(
        "git",
        ["--literal-pathspecs", "ls-tree", "-z", commit, "--", artifact],
        { cwd: rootDir, encoding: "utf8" }
      );
    } catch (err) {
      return { ok: false, reason: `cannot inspect the starting commit tree: ${(err as Error).message}` };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        reason: `cannot inspect the starting commit tree at ${commit}: ${(result.stderr ?? "").trim()}`,
      };
    }
    // A single literal pathspec yields zero or one record:
    // "<mode> <type> <sha>\t<name>", NUL-terminated. A tree (directory)
    // entry is the only refusal case; a blob or no match passes.
    for (const record of (result.stdout ?? "").split("\0")) {
      if (record === "") continue;
      const tab = record.indexOf("\t");
      const type = tab === -1 ? "" : record.slice(0, tab).split(" ")[1] ?? "";
      if (type === "tree") {
        directories.add(artifact);
      }
    }
  }
  return { ok: true, directories: [...directories].sort() };
}
