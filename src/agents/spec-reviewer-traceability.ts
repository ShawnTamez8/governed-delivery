import type { AgentDefinition } from "../agents.ts";

export const SPEC_REVIEWER_TRACEABILITY: AgentDefinition = {
  id: "spec-reviewer-traceability",
  role: "reviewer",
  specialty: "requirements-traceability",
  executor: "claude-code",
  outputs: ["findings"],
  tools: [],
};
