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
}

/**
 * The agent registry: one file per agent under src/agents/, assembled here.
 * Version-controlled protected content — no write path touches these files.
 * `executor` and `tools` are carried because the architecture's definition
 * shape requires them; enforcement arrives with executor binding.
 */
export const AGENTS: readonly AgentDefinition[] = [
  SPEC_AUTHOR,
  PLAN_AUTHOR,
  SPEC_REVIEWER_TRACEABILITY,
  SPEC_REVIEWER_SECURITY,
  SPEC_REVIEWER_CONSISTENCY,
];

export function agentById(id: string): AgentDefinition | undefined {
  return AGENTS.find((a) => a.id === id);
}
