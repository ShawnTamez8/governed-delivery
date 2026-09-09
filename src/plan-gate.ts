import type { CoverageEntry, PlanDoc } from "./plan-doc.ts";
import type { AcceptanceCriterion } from "./spec-doc.ts";
import type { FindingDecisionRow } from "./store.ts";

/** Every disposition that blocks the run (section 12). */
export const BLOCKING_DISPOSITIONS: readonly string[] = ["cannot_determine", "upstream_blocking"];

/**
 * The deterministic decision gate (section 12, as amended for step 5b):
 * completion is decision completeness, not an open-severity threshold. By
 * the time a decision reaches here it has already passed
 * `validateReconciliation`'s structural and content checks — a content
 * failure was already converted to `cannot_determine` — so this gate asks
 * only whether any decision, across every round this stage ran, still
 * carries a blocking disposition. `cannot_determine` blocks for a human;
 * `upstream_blocking` blocks because filing the missing decision does not
 * make the artifact implementable. Neither this gate nor the checks that
 * feed it independently confirm that an `addressed` decision was
 * semantically cured or that a grounding excerpt logically supports its
 * rejection — see `src/reconciliation.ts`'s module comment.
 *
 * Identical in contract to `specReviewGate`. The duplication is deliberate:
 * hard rule 4 forbids an abstraction before two real implementations exist,
 * and this is the second one appearing. Extraction is a decision for the step
 * that has all the evidence, not a reflex here.
 */
export function planReviewGate(
  decisions: FindingDecisionRow[]
): { pass: true } | { pass: false; blockedFindingIds: number[] } {
  const blocked = decisions.filter((d) => BLOCKING_DISPOSITIONS.includes(d.disposition));
  return blocked.length === 0
    ? { pass: true }
    : { pass: false, blockedFindingIds: blocked.map((d) => d.finding_id) };
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
): { ok: true } | { ok: false; unkeepable: string[]; reason: string } {
  const signed = new Set(scope);
  const offending = doc.coverage.filter(
    // A `not_applicable` entry promises no artifact at all — it carries a
    // rationale and an alternative verification instead, which section 8 says
    // is preferable to a fabricated test. There is nothing to be outside the
    // scope, so it can never be unkeepable.
    (entry): entry is CoverageEntry & { artifact: string } =>
      entry.artifact !== null && !signed.has(entry.artifact)
  );
  if (offending.length === 0) return { ok: true };
  // The criterion is what the operator can act on, so that is what
  // `unkeepable` carries and what the callers' tests pin. The target belongs
  // in the message: an operator told only "AC-008" has to open the plan to
  // find out what AC-008 promised.
  const unkeepable = offending.map((entry) => entry.criterionId);
  const listed = offending.map((entry) => `${entry.criterionId} -> ${entry.artifact}`).join("; ");
  // Measured 2026-09-05, $1.25141: three reviewers said a coverage entry
  // omitted a second implementing artifact, and the author answered by naming
  // both on one line. A coverage entry admits exactly one path, so the pair
  // parsed as a single target no scope entry matches, and the refusal reported
  // it as a scope error — which reads as "you chose the wrong file" when the
  // fault is "that is not one path".
  //
  // The membership rule is stated unconditionally rather than when the target
  // looks like a list. Inferring intent from punctuation is guessing, a path
  // may legally contain any of it, and the check already holds the stronger
  // evidence: this target equals no signed entry. Saying the rule every time
  // is both simpler and true in every case, including the ordinary one where
  // the author simply named a file nobody approved.
  //
  // The machine signal stays typed — `unkeepable` is what callers branch on.
  // Nothing may come to depend on matching this text.
  return {
    ok: false,
    unkeepable,
    reason:
      `plan promises coverage outside the approved scope: ${listed}` +
      "; an artifact-form coverage entry names exactly one path copied from the signed scope",
  };
}

/**
 * Every approved acceptance-criterion ID has exactly one coverage line, and
 * every coverage line names an approved ID.
 *
 * `coverageFitsScope` answers "may the plan promise this artifact". It does
 * not answer "did the plan promise anything for this criterion at all" — a
 * plan covering one of five criteria satisfies scope perfectly and says
 * nothing about the other four. The author prompt states one line per
 * acceptance criterion; this is the gate that holds it to that.
 *
 * IDs replace restated prose at this boundary. Surrounding field whitespace is
 * trimmed, then identity is exact: no case-folding, markdown removal, or
 * semantic comparison can turn one approved obligation into another.
 */
export function coverageMeetsCriteria(
  doc: PlanDoc,
  acceptanceCriteria: AcceptanceCriterion[]
): { ok: true } | { ok: false; missing: string[]; unknown: string[]; duplicate: string[] } {
  const specIds = acceptanceCriteria.map((criterion) => criterion.id.trim());
  const approved = new Set(specIds);
  const counts = new Map<string, number>();
  const unknown: string[] = [];
  const duplicate: string[] = [];
  const seenUnknown = new Set<string>();

  for (const entry of doc.coverage) {
    const id = entry.criterionId.trim();
    const count = (counts.get(id) ?? 0) + 1;
    counts.set(id, count);
    if (count === 2) duplicate.push(id);
    if (!approved.has(id) && !seenUnknown.has(id)) {
      seenUnknown.add(id);
      unknown.push(id);
    }
  }

  const missing = specIds.filter((id) => !counts.has(id));
  return missing.length === 0 && unknown.length === 0 && duplicate.length === 0
    ? { ok: true }
    : { ok: false, missing, unknown, duplicate };
}
