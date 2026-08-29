import type { AgentDefinition } from "../agents.ts";

export const SPEC_REVIEWER_CONSISTENCY: AgentDefinition = {
  id: "spec-reviewer-consistency",
  role: "reviewer",
  specialty: "consistency",
  executor: "claude-code",
  outputs: ["findings"],
  tools: [],
};
