import type { AgentDefinition } from "../agents.ts";

export const PLAN_AUTHOR: AgentDefinition = {
  id: "plan-author",
  role: "author",
  specialty: null,
  executor: "claude-code",
  outputs: ["plan", "plan-revision", "plan-self-critique"],
  tools: [],
};
