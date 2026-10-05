import { normalizePath } from "./scope.ts";

/**
 * Pure delivery-coverage logic (step 8, task 3): which of the spec's declared
 * artifacts the run's changed paths actually deliver. The module has no store
 * and no git access — the stage derives the changed set and hands it in — so
 * every branch here is unit-testable against plain arrays.
 *
 * **The changed set's meaning is the range's invariants, stated here because
 * delivery's correctness lives in them.** `runDeliveryStage` diffs
 * `git diff --name-only` over `patchBase..verifiedCommit`, and that net range
 * is what delivery matches against. It holds the paths whose content at the
 * head differs from the base, and that equals the union of the applied patch
 * changes only while: (1) the base is the single anchor the implementation
 * stage read before its first apply — the post-projection commit the first
 * phase's patches bound to, recorded in the gate event (task 2); (2) within one
 * phase the apply-time overlap refusal (`patch-application.ts`) prevents a
 * later patch from touching a path an earlier patch of that phase moved; and
 * (3) nothing but the system's patch commits lands between base and head.
 *
 * Invariant 2 is narrower than it was. The implementation stage now runs one
 * phase per slice of the plan's tasks (hazard 20), each proposing against the
 * head the previous phase committed, so a later phase may modify a path an
 * earlier phase added: that path appears once in the net diff, and delivery
 * counts it. What a later phase can still do is put a path that existed at the
 * base back to its base content, which removes it from the net diff. Delivery
 * then reports a declared artifact for that path as missing and blocks the
 * run: it fails closed, never open, and nothing prevents it. Deletion is
 * refused, so a path a phase added cannot leave the range. A future change to
 * how patches are applied that drops any of these must fail here, not silently
 * change what "delivered" means.
 *
 * Matching is exact equality after normalization. A declared artifact is
 * delivered only when its normalized form equals a changed path — a
 * directory-prefix containment result never satisfies delivery, and scope
 * permission ("may this stage write here") and delivery ("did anyone write it
 * at all") stay different questions. Comparisons are case-sensitive: git
 * trees are case-sensitive, the operator signs the scope as declared, and
 * delivery refuses rather than guesses when a case mismatch means the wrong
 * file was committed.
 */
export interface DeliveryCoverage {
  /** Declared artifacts: normalized, deduplicated, sorted (as signed). */
  declared: string[];
  /** Changed paths: normalized, deduplicated, sorted. */
  changed: string[];
  /** Declared artifacts present in the changed set, sorted. */
  delivered: string[];
  /** Declared artifacts absent from the changed set, sorted. */
  missing: string[];
}

export function deliveryCoverage(
  declaredArtifacts: readonly string[],
  changedPaths: readonly string[]
): DeliveryCoverage {
  const declared = [...new Set(declaredArtifacts.map(normalizePath))].sort();
  const changed = [...new Set(changedPaths.map(normalizePath))].sort();
  const changedSet = new Set(changed);
  const delivered = declared.filter((path) => changedSet.has(path));
  const missing = declared.filter((path) => !changedSet.has(path));
  return { declared, changed, delivered, missing };
}
