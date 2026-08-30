import type { AgentDefinition } from "../agents.ts";

export const IMPLEMENTER: AgentDefinition = {
  id: "implementer",
  role: "author",
  specialty: null,
  executor: "claude-code",
  outputs: ["patches"],
  tools: [],
};
