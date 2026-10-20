/**
 * The deterministic patch gate (architecture section 8). What this checks:
 * scope and protected-path enforcement for the paths of a computed diff. What
 * it does not check: the git diff itself (`commitWorkspace` in
 * `src/workspace-commit.ts` computes it and refuses deletions and symbolic
 * links), and whether any declared artifact was delivered at all — hazard 5's
 * second half is step 8's delivery check.
 */

import { isAbsolute } from "node:path";
import { normalizePath, touchesProtected } from "./scope.ts";
import { isTaskDocumentPath } from "./task-artifact.ts";

/**
 * Is `path` inside the signed scope?
 *
 * True iff `p === s` or `p` starts with `s + "/"` for some entry `s` — so
 * `src` and `src/` both cover `src/index.ts`, and `src/index.ts` does not
 * cover `src/index.tsx`. Comparison is exact and case-preserving: the
 * operator signs the paths as the spec declared them, and a patch path that
 * differs only in case was never approved — the same rationale
 * `coverageFitsScope` states in `src/plan-gate.ts`. `touchesProtected` folds
 * case because the filesystem compares that way; scope matching deliberately
 * does not.
 */
export function pathFitsScope(path: string, scope: string[]): boolean {
  const p = normalizePath(path);
  return scope.some((s) => {
    // Trailing slashes are dropped so `src` and `src/` cover the same paths —
    // both are directory declarations, not distinct entries.
    const entry = normalizePath(s).replace(/\/+$/, "");
    return p === entry || p.startsWith(entry + "/");
  });
}

/**
 * Apply-time enforcement for one patch's paths: escape refusal, scope, then
 * protection — in that order, one cause per path. Returns every refused path
 * and a reason naming each cause, so the stage's audit event names what was
 * refused rather than only that something was.
 */
export function gatePatchPaths(
  paths: string[],
  scope: string[],
  slug: string
): { ok: true } | { ok: false; refused: string[]; reason: string } {
  const refused: string[] = [];
  const refusals: string[] = [];
  for (const p of paths) {
    if (isAbsolute(p) || normalizePath(p).split("/").includes("..")) {
      refused.push(p);
      refusals.push(`path escapes the repository: ${p}`);
      continue;
    }
    if (isTaskDocumentPath(p)) {
      refused.push(p);
      refusals.push(
        `task artifacts are prohibited; tasks belong in run-state database rows: ${p}`
      );
      continue;
    }
    if (!pathFitsScope(p, scope)) {
      refused.push(p);
      refusals.push(`outside the signed scope: ${p}`);
      continue;
    }
    if (touchesProtected([p], slug)) {
      refused.push(p);
      refusals.push(`touches a protected path: ${p}`);
    }
  }
  return refused.length > 0 ? { ok: false, refused, reason: refusals.join("; ") } : { ok: true };
}
