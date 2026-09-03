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
 * equals the union of the applied patch changes only while: (1) the base is
 * the single anchor the implementation stage read before its first apply —
 * the post-projection commit the implementer's patches bound to, recorded in
 * the gate event (task 2); (2) the apply-time overlap refusal
 * (`implementation-stage.ts`) prevents a later patch from touching a path an
 * earlier patch moved, so no applied path can be reverted inside the range;
 * and (3) nothing but the system's patch commits lands between base and
 * head. A future multi-commit apply that drops any of these must fail here,
 * not silently change what "delivered" means.
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
