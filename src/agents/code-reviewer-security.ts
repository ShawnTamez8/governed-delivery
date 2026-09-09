import type { AgentDefinition } from "../agents.ts";

export const CODE_REVIEWER_SECURITY: AgentDefinition = {
  id: "code-reviewer-security",
  role: "reviewer",
  specialty: "security",
  executor: "claude-code",
  outputs: ["code-findings"],
  tools: [],
  codeReviewInstructions:
    "Find concrete trust-boundary, injection, authorization, secret-handling, unsafe-input, and data-integrity defects. Trace attacker-controlled inputs and privilege or data transitions through the changed code and report only defects the current code can fix.",
};
