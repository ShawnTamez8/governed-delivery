import type { AgentDefinition } from "../agents.ts";

export const SPEC_AUTHOR: AgentDefinition = {
  id: "spec-author",
  role: "author",
  specialty: null,
  executor: "claude-code",
  outputs: ["spec", "spec-revision"],
  tools: [],
};
