import type { AgentDefinition } from "../agents.ts";

export const CODE_REVIEWER_CORRECTNESS: AgentDefinition = {
  id: "code-reviewer-correctness",
  role: "reviewer",
  specialty: "correctness",
  executor: "claude-code",
  outputs: ["code-findings"],
  tools: [],
};
