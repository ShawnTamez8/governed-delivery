import { CODE_REVIEWER_CORRECTNESS } from "./agents/code-reviewer-correctness.ts";
import { CODE_REVIEWER_SECURITY } from "./agents/code-reviewer-security.ts";
import { CODE_REVIEWER_STATE_INTEGRITY } from "./agents/code-reviewer-state-integrity.ts";
import { IMPLEMENTER } from "./agents/implementer.ts";
import { PLAN_AUTHOR } from "./agents/plan-author.ts";
import { SPEC_AUTHOR } from "./agents/spec-author.ts";
import { SPEC_REVIEWER_CONSISTENCY } from "./agents/spec-reviewer-consistency.ts";
import { SPEC_REVIEWER_SECURITY } from "./agents/spec-reviewer-security.ts";
import { SPEC_REVIEWER_TRACEABILITY } from "./agents/spec-reviewer-traceability.ts";

export interface AgentDefinition {
  id: string;
  role: "author" | "reviewer";
  specialty: string | null;
  executor: string;
  outputs: string[];
  tools: string[];
  /** Required only for reviewers that emit `code-findings`. */
  codeReviewInstructions?: string;
}

/**
 * The agent registry: one file per agent under src/agents/, assembled here.
 * Version-controlled protected content — no write path touches these files.
 * `executor` and `tools` are carried because the architecture's definition
 * shape requires them; enforcement arrives with executor binding.
 *
 * Two reviewer output kinds partition the registry into two candidate sets:
 * `findings` seats a spec or plan panel through `selectReviewers`, and
 * `code-findings` seats the code-review panel through `codeReviewPanel`. The
 * output kind is what keeps them apart — a specialty name may appear in both
 * sets, because a specialty is a lens and not an eligibility.
 */
export const AGENTS: readonly AgentDefinition[] = [
  SPEC_AUTHOR,
  PLAN_AUTHOR,
  IMPLEMENTER,
  SPEC_REVIEWER_TRACEABILITY,
  SPEC_REVIEWER_SECURITY,
  SPEC_REVIEWER_CONSISTENCY,
  CODE_REVIEWER_CORRECTNESS,
  CODE_REVIEWER_SECURITY,
  CODE_REVIEWER_STATE_INTEGRITY,
];

export function agentById(id: string): AgentDefinition | undefined {
  return AGENTS.find((a) => a.id === id);
}
