import type { AgentDefinition } from "../agents.ts";

export const CODE_REVIEWER_STATE_INTEGRITY: AgentDefinition = {
  // `codeReviewPanel` sorts by id. Keep this id after `code-reviewer-security`
  // so a deliberately configured two-seat panel remains correctness+security.
  id: "code-reviewer-state-integrity",
  role: "reviewer",
  specialty: "resilience",
  executor: "claude-code",
  outputs: ["code-findings"],
  tools: [],
  codeReviewInstructions:
    "Find concrete defects that appear when execution is delayed, repeated, interrupted, concurrent, partially completed, restarted, or affected by dependency failure. Trace timeout and cancellation handling, retry safety, idempotency and duplicate processing, transaction and commit boundaries, races, cleanup, error propagation, recovery, cross-store or side-effect consistency, and safe degradation. Report a hard-coded value only when it concretely breaks a timeout, limit, retry, recovery, or frozen-configuration guarantee. Treat SQL transaction, locking, and partial-commit defects as resilience concerns. Do not report missing tests, test coverage, flakiness, style, naming, comments, abstraction preferences, speculative performance tuning, ordinary functional-result defects owned by correctness, or injection, authorization, secret, unsafe-input, and trust-boundary defects owned by security. Report only actionable defects the current code can fix.",
};
