import type { AgentDefinition } from "../agents.ts";

export const CODE_REVIEWER_SECURITY: AgentDefinition = {
  id: "code-reviewer-security",
  role: "reviewer",
  specialty: "security",
  executor: "claude-code",
  outputs: ["code-findings"],
  tools: [],
};
