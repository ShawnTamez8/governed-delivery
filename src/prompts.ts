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

/**
 * The plan author prompt: role, the approved specification verbatim, the
 * signed scope as the only paths the plan may name, the AgentResult contract
 * with every constrained field stated, and the plan document schema.
 *
 * `plan_for` is handed to the model rather than left to it to compute: it is
 * the hash of the specification the operator's signature bound, and a model
 * recomputing it would be a second source of truth for the one value that
 * ties the plan to what was authorized.
 *
 * No git operations are mentioned. The step-3 smoke recorded in
 * `.claude/sessions/project-learnings.md` showed that naming patch concepts
 * in a content-write prompt made the model refuse to produce a document at
 * all; this stage is a content write for the same reason the spec stage is.
 */
export function buildPlanAuthorPrompt(
  agent: AgentDefinition,
  specContent: string,
  specHash: string,
  scope: string[],
  context?: { findingsSummary?: string }
): string {
  const revision = context?.findingsSummary
    ? `## Revision

The previous plan was reviewed and these material findings remain open. Address
or dispute each one in the revised plan:

${context.findingsSummary}

`
    : "";
  return `you are the plan author ${agent.id}

Produce the implementation plan for the approved specification below.
No git operations are involved: you are writing a plan document, not code
changes.

Return exactly a JSON AgentResult object with this shape; the plan document
travels in the AgentResult's proposedContentChanges.plan:
{"status": "proposed", "agent": "${agent.id}", "role": "author", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"plan": "<the full plan markdown>"}}

status must be one of proposed, blocked, failed. Output the JSON object
directly, with no surrounding prose, no markdown fences, and no commentary.

The plan document schema is:
- frontmatter with feature and plan_for
- plan_for must be exactly: ${specHash}
- a ## Tasks section: one task per list line
- a ## Coverage section: one line per acceptance criterion, in one of two
  forms:
    <criterion> -> <artifact path>
    <criterion> -> not_applicable: <rationale> / <alternative verification>
  not_applicable requires both a rationale and an alternative verification.
  An entry with only one of them is refused.

Every artifact path you name in ## Coverage must be one of the approved scope
paths below. A plan promising an artifact outside the approved scope is
refused by the gate, so name only these:

${scope.map((p) => `- ${p}`).join("\n")}

${revision}Approved specification:

${specContent}`;
}

/**
 * The plan reviewer prompt: role, both documents, and the finding contract
 * with every constrained field stated.
 *
 * The full envelope shape is spelled out because the step-3 smoke showed a
 * reviewer returns a bare findings object until the prompt states the whole
 * thing.
 */
export function buildPlanReviewPrompt(
  agent: AgentDefinition,
  planContent: string,
  specContent: string
): string {
  return `you are the plan reviewer ${agent.id} with specialty ${agent.specialty ?? "general review"}

Review the plan below against the specification it was written from, through
your specialty lens. Judge whether the plan's tasks and coverage actually
deliver the specification's acceptance criteria.

Return exactly a JSON AgentResult object with this shape; your findings
travel in the AgentResult's proposedContentChanges.findings:
{"status": "proposed", "agent": "${agent.id}", "role": "reviewer", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"findings": [{"severity": "...", "location": "...", "intentKey": "...", "subject": "..."}]}}

Each finding has:
- severity one of low, medium, high, critical
- location: a section heading, task, or artifact path from the plan
- intentKey: lowercase kebab-case, at most 64 characters, describing the
  concern type
- subject: one sentence naming the concern

Output the JSON object directly, with no surrounding prose, no markdown
fences, and no commentary. Concerns you do not have are represented by an
empty findings array, not by prose.

Plan:

${planContent}

Specification:

${specContent}`;
}

/**
 * The implementation author prompt: role, the approved plan and
 * specification verbatim, the signed scope as the only paths a patch may
 * touch, and the AgentResult contract with every constrained field stated.
 *
 * `baseCommit` is handed to the model rather than left to it to compute: it
 * is the branch head the system will verify every proposed patch against,
 * and a model recomputing it would be a second source of truth for the one
 * value that binds the patch to what was authorized — the same reason the
 * plan prompt hands `plan_for`.
 *
 * The scope block shape ("Patch only these paths:" followed by one `- <path>`
 * line per entry) is a contract: the fixture executor in Task 7 scrapes it
 * to build its patches, so changing the shape changes the fixture.
 */
export function buildImplementationAuthorPrompt(
  agent: AgentDefinition,
  planContent: string,
  specContent: string,
  scope: string[],
  baseCommit: string
): string {
  return `you are the implementer ${agent.id}

Propose the code changes that implement the approved plan below. Your
working directory is the repository checkout those changes apply to — read
it to see the code you are patching. Run no git commands: the system applies
and commits the patches you propose.

Return exactly a JSON AgentResult object with this shape:
{"status": "proposed", "agent": "${agent.id}", "role": "author", "executor": "claude-code", "summary": "...", "proposedPatches": [{"baseCommit": "...", "files": [{"path": "...", "action": "add", "content": "<complete new file content>"}]}]}

status must be one of proposed, blocked, failed. Output the JSON object
directly, with no surrounding prose, no markdown fences, and no commentary.

Each patch has:
- baseCommit must be exactly: ${baseCommit}
- files: one entry per file the patch changes, each with path, action, and
  content
- path: a repo-relative path, one of the approved scope paths below
- action one of add, modify — deletion is refused by the system and must not
  be proposed
- content is the complete new file content, not a diff

Patch only these paths:

${scope.map((p) => `- ${p}`).join("\n")}

Approved plan:

${planContent}

Approved specification:

${specContent}`;
}
