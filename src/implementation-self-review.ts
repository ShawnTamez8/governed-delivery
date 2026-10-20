import { WORKSPACE_REPLY_SCHEMA, validateWorkspaceReply, type WorkspaceReply } from "./agent-result.ts";

/**
 * The implementation self-review result
 * (`docs/features/implementation-self-review/plan.md`): the implementer's own
 * pass over the complete change after the last phase, before verification.
 * The same dispatch makes its fixes in the workspace through the tool server;
 * this is the critique that travels beside the workspace reply.
 *
 * Not `SelfCritique` (`src/self-critique.ts`). That shape carries a revised
 * document and a panel request, neither of which a code change has, and one
 * schema per thing (hard rule 3) rules out a union that makes them optional.
 */
export interface ImplementationSelfReview {
  critique: string[];
}

/**
 * Structure only, with every refusal named (hazard 1). The critique is never
 * empty, for the reason `validateSelfCritique` gives: "nothing found" is still
 * a statement of what was checked, and an empty list says nothing at all.
 * Unknown fields are ignored, as `validateAgentResult` ignores them.
 */
export function validateImplementationSelfReview(
  raw: unknown
): { ok: true; value: ImplementationSelfReview } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "self-review must be an object" };
  }
  const r = raw as { [key: string]: unknown };
  if (!("critique" in r)) {
    return { ok: false, reason: "self-review has no critique" };
  }
  if (!Array.isArray(r.critique)) {
    return { ok: false, reason: "self-review critique must be an array" };
  }
  if (r.critique.length === 0) {
    return { ok: false, reason: "self-review critique must not be empty: say what was checked when nothing was found" };
  }
  for (const entry of r.critique) {
    if (typeof entry !== "string" || entry.trim() === "") {
      return { ok: false, reason: "every self-review critique entry must be a non-empty string" };
    }
  }
  return { ok: true, value: { critique: r.critique as string[] } };
}

/**
 * The self-review's reply in tool mode (docs/features/sandboxed-implementer/plan.md):
 * the workspace reply plus the critique, bounded as
 * `validateImplementationSelfReview` bounds it (at least one entry, none
 * empty). Fixes are made through the tool server, so no patch travels in the
 * reply. Built from `WORKSPACE_REPLY_SCHEMA`, so the shared half cannot drift
 * from it. `minLength` cannot express the validator's whitespace-only refusal;
 * the validator still makes that check.
 */
export const SELF_REVIEW_REPLY_SCHEMA = {
  ...WORKSPACE_REPLY_SCHEMA,
  required: [...WORKSPACE_REPLY_SCHEMA.required, "critique"],
  properties: {
    ...WORKSPACE_REPLY_SCHEMA.properties,
    critique: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
  },
};

/** The workspace reply and the critique, every refusal named. */
export function validateSelfReviewReply(
  raw: unknown
): { ok: true; value: WorkspaceReply & ImplementationSelfReview } | { ok: false; reason: string } {
  const reply = validateWorkspaceReply(raw);
  if (!reply.ok) return reply;
  const critique = validateImplementationSelfReview(raw);
  if (!critique.ok) return critique;
  return { ok: true, value: { ...reply.value, critique: critique.value.critique } };
}

/** The longest critique entry the audit log records whole. */
export const SELF_REVIEW_AUDIT_ENTRY_CHARS = 2000;

/** The most critique entries the audit log records for one self-review. */
export const SELF_REVIEW_AUDIT_MAX_ENTRIES = 50;

/**
 * The critique as audit-event summaries: at most
 * `SELF_REVIEW_AUDIT_MAX_ENTRIES`, in critique order, each longer entry cut at
 * `SELF_REVIEW_AUDIT_ENTRY_CHARS` with a marker naming its full length.
 *
 * The bounds limit an audit record and change no run outcome, so they are code
 * constants, not settings frozen into a run's profile. The retained raw output
 * (`dispatchOnce`) keeps the whole critique with its hash.
 */
export function critiqueAuditEntries(critique: string[]): string[] {
  return critique.slice(0, SELF_REVIEW_AUDIT_MAX_ENTRIES).map((entry) =>
    entry.length > SELF_REVIEW_AUDIT_ENTRY_CHARS
      ? `${entry.slice(0, SELF_REVIEW_AUDIT_ENTRY_CHARS)} (cut at ${SELF_REVIEW_AUDIT_ENTRY_CHARS} of ${entry.length} characters)`
      : entry
  );
}
