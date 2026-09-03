/**
 * The implementation-to-verification handoff (step 8, task 2): the two
 * commits that bound what a run's branch delivered, carried as one typed
 * shape on the `implementation.gate.pass` audit event.
 *
 * Before this module the implementation stage wrote `head=<final>` into the
 * event summary and the verification stage read it back through its own
 * anchored regex, coupling two stages through an ad-hoc string. The shape is
 * now one canonical format with one parser, so the format and its consumers
 * change together.
 *
 * `base` is the branch head the implementer's patches bound to: the head the
 * implementation stage read after committing the run's projections and
 * before its first apply (`headAtProposal`). `head` is the branch tip after
 * the last applied patch — the commit verification proves. The range
 * `base..head` is exactly the applied patch changes: projections predate the
 * base, and the apply-time overlap refusal prevents a later patch from
 * reverting an earlier one's path.
 */
export interface ImplementationHandoff {
  base: string;
  head: string;
}

const COMMIT = "([0-9a-f]{40}|[0-9a-f]{64})";

/** The canonical summary format: `base=<sha>; head=<sha>`. */
export function formatImplementationGate(handoff: ImplementationHandoff): string {
  return `base=${handoff.base}; head=${handoff.head}`;
}

/**
 * Strict parse of the summary, refusing any shape the formatter did not
 * produce — including the pre-step-8 `head=`-only form. Nothing has shipped,
 * so a legacy shape is refused by name, never defaulted.
 */
export function parseImplementationGate(
  summary: string
): { ok: true; value: ImplementationHandoff } | { ok: false; reason: string } {
  const m = new RegExp(`^base=${COMMIT}; head=${COMMIT}$`).exec(summary.trim());
  if (!m) {
    return {
      ok: false,
      reason: `does not record the implementation handoff as base=<commit>; head=<commit>: ${JSON.stringify(summary)}`,
    };
  }
  return { ok: true, value: { base: m[1], head: m[2] } };
}
