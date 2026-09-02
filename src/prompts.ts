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
 * What an author needs to know to propose a panel the system can actually
 * staff: the frozen size bounds, the lenses configuration always seats, and
 * the lenses the registry can seat at all.
 *
 * All four are frozen configuration read from the run's profile, never live
 * constants (hard rule 6). They travel as one object because they answer one
 * question, and a builder taking four loose values invites a caller to supply
 * three.
 */
export interface PanelPromptBounds {
  sizeMin: number;
  sizeMax: number;
  requiredSpecialties: string[];
  registeredSpecialties: string[];
}

/**
 * The smallest size a request can legally carry.
 *
 * Not `sizeMin`. Required specialties consume seats inside whatever size the
 * author asks for, so `validatePanelRequest` refuses any size their union
 * overflows — and `invalidPolicyReason` permits a policy configuring more
 * required lenses than the floor, provided they fit the maximum. A prompt
 * advertising the bare floor there would name a size guaranteed to be refused,
 * after the draft and self-critique dispatches were already paid for.
 */
function effectiveFloor(panel: PanelPromptBounds): number {
  return Math.max(panel.sizeMin, panel.requiredSpecialties.length);
}

/**
 * How seats are accounted, stated one way or the other and never omitted.
 *
 * With required lenses configured the cap is on the *union* of the author's
 * list and theirs; with none it is on the author's list alone. Stating the
 * plain cap unconditionally was wrong in the first case — an author naming two
 * lenses at size two on the default installation satisfies it and still blocks
 * on a union of three.
 */
function seatAccountingBlock(requiredSpecialties: string[]): string {
  if (requiredSpecialties.length === 0) {
    return `
    You may name no more of them than the size you request.`;
  }
  return `
    These lenses are always seated and already consume seats:
${requiredSpecialties.map((s) => `      - ${s}`).join("\n")}
    Your specialties and those are counted together as one set of unique
    lenses, and that set must fit inside the size you request.`;
}

/**
 * The spec self-critique prompt: the author's own pass over the draft it
 * just wrote, before any independent reviewer sees it.
 *
 * Both governing inputs travel with it. The design is what the author may
 * not exceed and the specification is what it revises, so a prompt carrying
 * only one of them asks for a judgement the model has no basis to make. The
 * Task 1 prototype recorded an author adding an atomicity requirement the
 * design never states; the no-invention sentence is aimed at that, and no
 * mechanical check in this step detects it when the sentence fails.
 *
 * The registered specialties are named for a measured reason. Not told what
 * the registry can seat, the prototype's author requested `data-privacy` —
 * structurally valid, unstaffable, and the run blocked by name. Told the
 * registry, the same author requested `security`, which staffed. The named
 * staffing refusal stays (step 5b Task 5); this keeps it a backstop rather
 * than the ordinary outcome.
 *
 * The size bounds and the always-seated lenses are stated for the same
 * measured reason, and Task 5 is what made them binding. The default
 * installation's only legal size is two, and required specialties consume
 * seats inside it — an author told neither would block a run on arithmetic it
 * was never given (hazard 3: a constrained field is stated in the prompt that
 * requests it).
 */
export function buildSpecSelfCritiquePrompt(
  agent: AgentDefinition,
  designContent: string,
  specContent: string,
  panel: PanelPromptBounds
): string {
  const floor = effectiveFloor(panel);
  return `you are the spec author ${agent.id}

This is your own self-critique pass on the specification you just wrote. No
independent reviewer has seen it yet, and no git operations are involved:
you are revising a specification document, not code changes.

Return exactly a JSON AgentResult object with this shape; your critique, the
revised specification, and your panel request travel together in the
AgentResult's proposedContentChanges.selfCritique:
{"status": "proposed", "agent": "${agent.id}", "role": "author", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"selfCritique": {"critique": ["..."], "artifact": "<the full revised specification markdown>", "panelRequest": {"size": ${floor}, "specialties": ["..."]}}}}

status must be one of proposed, blocked, failed. Output the JSON object
directly, with no surrounding prose, no markdown fences, and no commentary.

The self-critique has:
- critique: one non-empty entry per weakness you found in your own draft
- artifact: the complete revised specification, not a diff. It must satisfy
  the same document schema as the draft:
  - frontmatter with feature and change_kind (one of feature, defect_fix)
  - a ## Declared artifacts section: one repo-relative path per line
  - an ## Acceptance criteria section: one criterion per list line
  A revised specification that does not validate blocks the run. There is no
  fallback to your draft.
- panelRequest: the panel you propose for the independent review
  - size: an integer, the number of reviewers to seat: at least ${floor}
    and at most ${panel.sizeMax}. A size outside that range blocks the run.
  - specialties: the specialty lenses this specification calls for. Unique
    non-empty strings, and never an agent identity — you propose lenses, the
    system picks the reviewers.
    The panel is staffed from these registered specialties:
${panel.registeredSpecialties.map((s) => `      - ${s}`).join("\n")}
    A specialty outside that list cannot be staffed.${seatAccountingBlock(panel.requiredSpecialties)}

You may not add an obligation the design below does not contain. Sharpening
the specification, completing it, and making it consistent is the work;
inventing a requirement the design never states is not, however reasonable
that requirement looks. Where the design leaves a decision open, say that it
is open rather than deciding it yourself.

Design document:

${designContent}

The specification you wrote:

${specContent}`;
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
 * The plan self-critique prompt: the same pass on the plan side.
 *
 * It restates `plan_for` and the approved scope because the revised plan is
 * gated exactly like the draft — the hash binding, the scope gate, and the
 * coverage gate all run again on it. A prompt that asked for a revision
 * without saying what the revision must still satisfy would be asking the
 * model to rediscover the two values the operator's signature bound.
 *
 * The scope block's shape ("name only these:" followed by one `- <path>`
 * line per entry) is the plan author prompt's, deliberately: the fixture
 * executor scrapes that shape, and one document schema stated two ways is
 * two schemas.
 */
export function buildPlanSelfCritiquePrompt(
  agent: AgentDefinition,
  specContent: string,
  planContent: string,
  specHash: string,
  scope: string[],
  panel: PanelPromptBounds
): string {
  const floor = effectiveFloor(panel);
  return `you are the plan author ${agent.id}

This is your own self-critique pass on the plan you just wrote. No
independent reviewer has seen it yet, and no git operations are involved:
you are revising a plan document, not code changes.

Return exactly a JSON AgentResult object with this shape; your critique, the
revised plan, and your panel request travel together in the AgentResult's
proposedContentChanges.selfCritique:
{"status": "proposed", "agent": "${agent.id}", "role": "author", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"selfCritique": {"critique": ["..."], "artifact": "<the full revised plan markdown>", "panelRequest": {"size": ${floor}, "specialties": ["..."]}}}}

status must be one of proposed, blocked, failed. Output the JSON object
directly, with no surrounding prose, no markdown fences, and no commentary.

The self-critique has:
- critique: one non-empty entry per weakness you found in your own draft
- artifact: the complete revised plan, not a diff. It must satisfy the same
  document schema as the draft:
  - frontmatter with feature and plan_for
  - plan_for must be exactly: ${specHash}
  - a ## Tasks section: one task per list line
  - a ## Coverage section: one line per acceptance criterion, in one of two
    forms:
      <criterion> -> <artifact path>
      <criterion> -> not_applicable: <rationale> / <alternative verification>
    not_applicable requires both a rationale and an alternative verification.
    An entry with only one of them is refused.
  A revised plan that does not validate, drops a criterion's coverage, or
  promises an artifact outside the approved scope blocks the run. There is no
  fallback to your draft.
- panelRequest: the panel you propose for the independent review
  - size: an integer, the number of reviewers to seat: at least ${floor}
    and at most ${panel.sizeMax}. A size outside that range blocks the run.
  - specialties: the specialty lenses this plan calls for. Unique non-empty
    strings, and never an agent identity — you propose lenses, the system
    picks the reviewers.
    The panel is staffed from these registered specialties:
${panel.registeredSpecialties.map((s) => `      - ${s}`).join("\n")}
    A specialty outside that list cannot be staffed.${seatAccountingBlock(panel.requiredSpecialties)}

Every artifact path you name in ## Coverage must be one of the approved scope
paths below. A plan promising an artifact outside the approved scope is
refused by the gate, so name only these:

${scope.map((p) => `- ${p}`).join("\n")}

You may not add an obligation the approved specification below does not
contain. Sharpening the plan, completing it, and making it consistent is the
work; inventing a requirement the specification never states is not, however
reasonable that requirement looks.

Approved specification:

${specContent}

The plan you wrote:

${planContent}`;
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
  // The read-only sentence is UX, not a guard: enforcement is the
  // invocation boundary (the read-only executor command) and the stage's
  // clean-tree assertions. It must not tell the model about the backstop —
  // that would invite "they'll discard it anyway" readings.
  return `you are the implementer ${agent.id}

Propose the code changes that implement the approved plan below. Your
working directory is the repository checkout those changes apply to — read
it to see the code you are patching. Run no git commands: the system applies
and commits the patches you propose. This checkout is read-only for you: do
not create, modify, or delete any file. Only the patch content you return
is considered.

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
