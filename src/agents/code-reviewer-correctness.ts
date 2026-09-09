import type { AgentDefinition } from "../agents.ts";

export const CODE_REVIEWER_CORRECTNESS: AgentDefinition = {
  id: "code-reviewer-correctness",
  role: "reviewer",
  specialty: "correctness",
  executor: "claude-code",
  outputs: ["code-findings"],
  tools: [],
  codeReviewInstructions:
    "Find concrete behavioral defects, incorrect state transitions, broken error paths, and failures of approved acceptance criteria or plan tasks. Trace ordinary and boundary-case execution through the changed code and report only defects the current code can fix.",
};
