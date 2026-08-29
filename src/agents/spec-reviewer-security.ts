import type { AgentDefinition } from "../agents.ts";

export const SPEC_REVIEWER_SECURITY: AgentDefinition = {
  id: "spec-reviewer-security",
  role: "reviewer",
  specialty: "security",
  executor: "claude-code",
  outputs: ["findings"],
  tools: [],
};
