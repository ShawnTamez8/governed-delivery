import type { AgentDefinition } from "../agents.ts";

/**
 * The acceptance test author (docs/features/protected-acceptance-tests/plan.md):
 * one dispatch before the first implementation phase, writing browser tests
 * from the approved acceptance criteria through the tool server. The system
 * commits only its suite directory. It is an author, never a `code-findings`
 * reviewer, so the code-review panel's staffing does not count it.
 */
export const ACCEPTANCE_TEST_AUTHOR: AgentDefinition = {
  id: "acceptance-test-author",
  role: "author",
  specialty: null,
  executor: "claude-code",
  outputs: ["acceptance-tests"],
  tools: [],
};
