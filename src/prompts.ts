import type { AgentDefinition } from "./agents.ts";

/**
 * The author prompt: role, the design document verbatim, the AgentResult
 * contract with every constrained field stated, and the spec document
 * schema. The revision variant opens with a `## Revision` heading carrying
 * the open material findings. A pure function of its inputs.
 */
export function buildSpecAuthorPrompt(
  agent: AgentDefinition,
  designContent: string,
  context?: { findingsSummary?: string }
): string {
  const revision = context?.findingsSummary
    ? `## Revision

The previous spec was reviewed and these material findings remain open. Address
or dispute each one in the revised spec:

${context.findingsSummary}

`
    : "";
  return `you are the spec author

Produce the specification document for the design below. No git operations
are involved: you are writing a specification document, not code changes.

Return exactly a JSON AgentResult object with this shape:
{"status": "proposed", "agent": "spec-author", "role": "author", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"spec": "<the full specification markdown>"}}

status must be one of proposed, blocked, failed. Output the JSON object
directly, with no surrounding prose, no markdown fences, and no commentary.

The specification document schema is:
- frontmatter with feature and change_kind (one of feature, defect_fix)
- a ## Declared artifacts section: one repo-relative path per line
- an ## Acceptance criteria section: one criterion per list line

${revision}Design document:

${designContent}`;
}

/**
 * The reviewer prompt: role (naming the agent id and its specialty lens),
 * the spec content verbatim, and the finding contract with every
 * constrained field stated — severity values, location, and the intentKey
 * shape (lowercase kebab-case, at most 64 characters). Findings travel in
 * the AgentResult's proposedContentChanges.findings.
 */
export function buildSpecReviewPrompt(agent: AgentDefinition, specContent: string): string {
  return `you are the spec reviewer ${agent.id} with specialty ${agent.specialty ?? "general review"}

Review the specification below through your specialty lens.

Return exactly a JSON AgentResult object with this shape; your findings
travel in the AgentResult's proposedContentChanges.findings:
{"status": "proposed", "agent": "${agent.id}", "role": "reviewer", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"findings": [{"severity": "...", "location": "...", "intentKey": "...", "subject": "..."}]}}

Each finding has:
- severity one of low, medium, high, critical
- location: a section heading or artifact path from the spec
- intentKey: lowercase kebab-case, at most 64 characters, describing the
  concern type
- subject: one sentence naming the concern

Output the JSON object directly, with no surrounding prose, no markdown
fences, and no commentary. Concerns you do not have are represented by an
empty findings array, not by prose.

Specification:

${specContent}`;
}
