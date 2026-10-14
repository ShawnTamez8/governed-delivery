import { collapseWhitespace, groundingTextuallyFails } from "./reconciliation.ts";
import { validateSpecDoc } from "./spec-doc.ts";

/**
 * The code-review reconciler's reply check and agreement rule
 * (`docs/features/code-review-reconciler/plan.md`). Before each code-review
 * remediation, the operator chose on 2026-10-13 ("before fixes only") to drop
 * findings that ask for more than the approved specification states, so the
 * implementer does not add obligations nobody asked for (run 6: #200, then
 * #211). The final panel is never reconciled and its gate still counts every
 * finding.
 *
 * Every rule here is the `check` function of the measured replays,
 * `test/fixtures/recorded/code-review-reconciler-replay-crew-chatter-run-6.json`
 * and `test/fixtures/recorded/code-review-reconciler-test-5-crew-chatter-run-6.json`,
 * plus a non-empty rationale on a reject. A failed check means keep: a reply
 * that is not usable for a finding leaves that finding in the remediation.
 *
 * Hazard 16's limit applies: the excerpt check proves the quoted words occur
 * in the specification, not that they support the rejection. Test 5 recorded
 * one exact quote that did not (#213), which is why a rejection needs every
 * call to agree (`agreedRejections`).
 */

/** The fixed keep bases a reply may name besides a criterion ID or a plan task. */
export const KEEP_BASES = ["crash", "data-loss", "wrong-result", "unauthorized-access"] as const;

export type ReconcilerDecision =
  | { disposition: "keep"; basis: string; basisValid: boolean }
  | { disposition: "reject"; rationale: string; excerpt: string }
  | { disposition: "unusable"; reason: string };

export interface ReconcilerReplyInput {
  /** The finding ids the prompt listed, in prompt order. */
  findingIds: number[];
  spec: string;
  plan: string;
  /** The approved spec's output reference, recorded as the grounding location. */
  specLocation: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Check one reconciler reply against the listed findings. Every listed finding
 * gets exactly one decision; `problems` names each defect found, in order.
 */
export function validateReconcilerReply(
  value: unknown,
  input: ReconcilerReplyInput
): { problems: string[]; decisions: Map<number, ReconcilerDecision> } {
  const problems: string[] = [];
  const decisions = new Map<number, ReconcilerDecision>();
  const entries = isRecord(value) ? value.decisions : undefined;
  if (!Array.isArray(entries)) {
    const reason = "the reply has no decisions array";
    problems.push(reason);
    for (const id of input.findingIds) decisions.set(id, { disposition: "unusable", reason });
    return { problems, decisions };
  }

  const criteria = (() => {
    const parsed = validateSpecDoc(input.spec);
    return new Set(parsed.ok ? parsed.value.acceptanceCriteria.map((criterion) => criterion.id) : []);
  })();
  const planFlat = collapseWhitespace(input.plan);
  const listed = new Set(input.findingIds);
  for (const entry of entries) {
    const id = isRecord(entry) ? entry.findingId : undefined;
    if (typeof id !== "number" || !listed.has(id)) {
      problems.push(`unknown finding ${JSON.stringify(id)}`);
    }
  }

  for (const id of input.findingIds) {
    const mine = entries.filter((entry) => isRecord(entry) && entry.findingId === id) as Record<string, unknown>[];
    if (mine.length !== 1) {
      const reason = `finding ${id} has ${mine.length} decisions`;
      problems.push(reason);
      decisions.set(id, { disposition: "unusable", reason });
      continue;
    }
    const entry = mine[0]!;
    if (entry.disposition === "reject") {
      const rationale = entry.rationale;
      const excerpt = entry.excerpt;
      if (typeof rationale !== "string" || rationale.trim() === "") {
        const reason = `finding ${id} reject has no rationale`;
        problems.push(reason);
        decisions.set(id, { disposition: "unusable", reason });
        continue;
      }
      const grounding = groundingTextuallyFails(
        { source: "specification", location: input.specLocation, excerpt: excerpt as string },
        "specification",
        input.spec
      );
      // `groundingTextuallyFails` refuses a missing or non-string excerpt as empty.
      if (grounding !== null) {
        const reason = `finding ${id} reject excerpt not in spec: ${grounding}`;
        problems.push(reason);
        decisions.set(id, { disposition: "unusable", reason });
        continue;
      }
      decisions.set(id, { disposition: "reject", rationale, excerpt: excerpt as string });
    } else if (entry.disposition === "keep") {
      const basis = String(entry.basis ?? "");
      const taskWords = /^plan task: (.+)$/.exec(basis)?.[1];
      const basisValid =
        (/^AC-\d{3,}$/.test(basis) && criteria.has(basis)) ||
        (taskWords !== undefined && planFlat.includes(collapseWhitespace(taskWords))) ||
        (KEEP_BASES as readonly string[]).includes(basis);
      if (!basisValid) problems.push(`finding ${id} keep basis invalid: ${basis}`);
      decisions.set(id, { disposition: "keep", basis, basisValid });
    } else {
      const reason = `finding ${id} disposition ${JSON.stringify(entry.disposition)}`;
      problems.push(reason);
      decisions.set(id, { disposition: "unusable", reason });
    }
  }
  return { problems, decisions };
}

/**
 * The finding ids every one of exactly `required` calls rejected validly, in
 * the first call's order. A failed call (null), or fewer or more calls than
 * `required`, rejects nothing: a rejection must be agreed by every call the
 * frozen policy names.
 */
export function agreedRejections(
  calls: ReadonlyArray<ReadonlyMap<number, ReconcilerDecision> | null>,
  required: number
): number[] {
  if (required < 1 || calls.length !== required || calls.some((call) => call === null)) return [];
  const [first, ...rest] = calls as ReadonlyMap<number, ReconcilerDecision>[];
  return [...first!.entries()]
    .filter(([id, decision]) =>
      decision.disposition === "reject" && rest.every((call) => call.get(id)?.disposition === "reject"))
    .map(([id]) => id);
}
