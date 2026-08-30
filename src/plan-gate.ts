import { SEVERITY_ORDER } from "./finding.ts";
import type { PlanDoc } from "./plan-doc.ts";
import { MATERIAL_THRESHOLD } from "./policy.ts";
import type { FindingRow } from "./store.ts";

/**
 * The deterministic review gate (section 12): a reviewer's verdict is an
 * input, never the gate. Passes iff no material finding remains open.
 *
 * Identical in contract to `specReviewGate`. The duplication is deliberate:
 * hard rule 4 forbids an abstraction before two real implementations exist,
 * and this is the second one appearing. Extraction is a decision for the step
 * that has all the evidence, not a reflex here.
 */
export function planReviewGate(
  findings: FindingRow[]
): { pass: true } | { pass: false; openMaterialIds: number[] } {
  const openMaterial = findings.filter(
    (f) => SEVERITY_ORDER[f.severity] >= SEVERITY_ORDER[MATERIAL_THRESHOLD] && f.disposition === "open"
  );
  return openMaterial.length === 0
    ? { pass: true }
    : { pass: false, openMaterialIds: openMaterial.map((f) => f.id) };
}

/**
 * Section 12's "refuse promises that cannot be kept", for the half that is
 * mechanically decidable.
 *
 * A coverage entry naming an artifact outside the run's signed scope is a
 * promise the approved scope does not cover: the operator authorized a set of
 * paths, and a plan undertaking to deliver something else is asking for work
 * nobody approved. Those criteria come back as `unkeepable`.
 *
 * **What this does not check.** Hazard 6's other half — a criterion whose
 * artifacts can only be produced by a stage that runs *after* the one being
 * planned — is not decidable here. Nothing in the system yet declares which
 * artifacts a stage produces, so there is no ordering to check against. This
 * function covers the scope half only, and saying so is the point: a comment
 * claiming full hazard-6 coverage would be false, and a later reader would
 * trust a guarantee that was never built.
 *
 * The comparison is exact-string against the signed scope entries as
 * declared. `computeScope` deliberately preserves the spelling the operator
 * signed — unlike `touchesProtected`, which folds case because it is asking a
 * filesystem question — so folding here would silently widen what was signed.
 * A path differing only in case is therefore unkeepable, on every platform.
 */
export function coverageFitsScope(
  doc: PlanDoc,
  scope: string[]
): { ok: true } | { ok: false; unkeepable: string[] } {
  const signed = new Set(scope);
  const unkeepable = doc.coverage
    // A `not_applicable` entry promises no artifact at all — it carries a
    // rationale and an alternative verification instead, which section 8 says
    // is preferable to a fabricated test. There is nothing to be outside the
    // scope, so it can never be unkeepable.
    .filter((entry) => entry.artifact !== null && !signed.has(entry.artifact))
    .map((entry) => entry.criterion);
  return unkeepable.length === 0 ? { ok: true } : { ok: false, unkeepable };
}

/**
 * Every acceptance criterion has a coverage line.
 *
 * `coverageFitsScope` answers "may the plan promise this artifact". It does
 * not answer "did the plan promise anything for this criterion at all" — a
 * plan covering one of five criteria satisfies scope perfectly and says
 * nothing about the other four. The author prompt states one line per
 * acceptance criterion; this is the gate that holds it to that.
 *
 * The comparison normalizes case and collapses whitespace, unlike
 * `coverageFitsScope`'s exact-string test. The difference is deliberate: a
 * scope entry is a path the operator signed, so its spelling is load-bearing,
 * while a criterion is prose restated by a model and nobody signs it. Holding
 * restated prose to byte equality would refuse correct plans over a double
 * space.
 */
export function coverageMeetsCriteria(
  doc: PlanDoc,
  acceptanceCriteria: string[]
): { ok: true } | { ok: false; uncovered: string[] } {
  const normalize = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();
  const covered = new Set(doc.coverage.map((entry) => normalize(entry.criterion)));
  const uncovered = acceptanceCriteria.filter((c) => !covered.has(normalize(c)));
  return uncovered.length === 0 ? { ok: true } : { ok: false, uncovered };
}
