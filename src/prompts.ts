import type { AgentDefinition } from "./agents.ts";
import type { VerificationConfig } from "./governed-config.ts";
import type { PlanPhase } from "./plan-doc.ts";

export const SPEC_AUTHOR_PROMPT_PREFIX = "you are the spec author";
export const SPEC_REVIEW_PROMPT_PREFIX = "you are the spec reviewer";
export const PLAN_AUTHOR_PROMPT_PREFIX = "you are the plan author";
export const PLAN_REVIEW_PROMPT_PREFIX = "you are the plan reviewer";
export const IMPLEMENTATION_PROMPT_PREFIX = "you are the implementer";
export const CODE_REVIEW_PROMPT_PREFIX = "you are the code reviewer";
export const CODE_REVIEW_REMEDIATION_PROMPT_PREFIX = "you are the code-review remediator";
export const CODE_REVIEW_RECONCILER_PROMPT_PREFIX = "you are the code-review reconciler";
// "Reviewed", not "approved": the split is proposed after spec review and
// before the operator signs anything.
export const DESIGN_SPLIT_PROMPT_PREFIX = "you are dividing a reviewed specification into separately built features";

/**
 * How the three patch-producing dispatches (each implementation phase, the
 * implementation self-review, code-review remediation) return their answer: they
 * run with `--json-schema`, and only the structured output is read
 * (`docs/features/structured-patch-output/plan.md`). It replaces the free-text
 * prompts' "Output the JSON object directly" sentence for those three. Under that
 * sentence the 2026-10-14 large probe wrote its whole 67,514-character answer as
 * text and then again through the tool, at 81,781 output tokens against 53,154
 * (`test/fixtures/recorded/json-schema-probe-gate.json`). One source line, so the
 * constraint scan in `test/prompts.test.ts` matches it.
 */
const STRUCTURED_OUTPUT_RULE = `Submit the JSON object once, through the structured output tool, and do not also write it out as text before or after: only the structured output is read.`;

/**
 * The author prompt: role, the design document verbatim, the AgentResult
 * contract with every constrained field stated, and the spec document
 * schema. The draft only — revision is the reconciliation dispatch's job
 * (step 5b Task 6), which carries the findings with their reports and asks
 * for typed decisions rather than a bare rewrite. A pure function of its
 * inputs. The frozen verification commands and the rule for them travel with
 * the schema (`verificationCommandsBlock`, `specVerificationRule`).
 */
export function buildSpecAuthorPrompt(
  agent: AgentDefinition,
  designContent: string,
  verification: VerificationConfig
): string {
  return `${SPEC_AUTHOR_PROMPT_PREFIX}

Produce the specification document for the design below. No git operations
are involved: you are writing a specification document, not code changes.

Return exactly a JSON AgentResult object with this shape:
{"status": "proposed", "agent": "spec-author", "role": "author", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"spec": "<the full specification markdown>"}}

status must be one of proposed, blocked, failed. Output the JSON object
directly, with no surrounding prose, no markdown fences, and no commentary.

The specification document schema is:
- frontmatter with feature and change_kind (one of feature, defect_fix)
- a ## Declared artifacts section: one concrete, exact, repo-relative file
  path per line — never a directory scope or a glob, and never a document
  the run itself writes (the design, spec, or plan under docs/features/):
  delivery proves each declared artifact by its exact committed path.
  Never declare a tasks.md file: task execution and status belong in run-state
  database rows. Every non-blank line in this section is one path and nothing
  else, and a path contains no whitespace
- an ## Acceptance criteria section: one criterion per list line in exactly
  this form: \`- AC-001: <criterion text>\`. Criterion IDs must match
  \`AC-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})\`. Mint them here, beginning at AC-001 and increasing monotonically; never reuse an ID for a different
  criterion. Every non-blank line in this section is
  one criterion and nothing else: no heading, no note, no explanation, and
  never one criterion wrapped across two lines; put an explanation of a
  numbering decision in your summary or an ordinary prose section,
  not inside this section.
${criterionQualityRule("")}
${openDecisionsSchema("")}

${verificationCommandsBlock(verification)}

${specVerificationRule()}

Design document:

${designContent}`;
}

/**
 * What an acceptance criterion may say, stated once for the draft and the
 * self-critique so the two cannot drift (hazard 3). The format rules above it
 * fix a criterion's shape; this fixes its content. A design's subjective term
 * becomes an open decision rather than an invented threshold (hazard 13):
 * team-notes run 3 copied "meaningful content change" into a criterion.
 */
function criterionQualityRule(indent: string): string {
  return `${indent}  Every acceptance criterion must be decidable by one objective pass/fail check: a specific input, action, value, or observable outcome, never a subjective or unquantified term such as fast, meaningful, intuitive, or clean.
${indent}  Where the design states a behavior in subjective or unquantified terms, write only its checkable part as a criterion, and record the undecided part under ## Open decisions instead of choosing a threshold the design does not state.
${indent}  Guidance with no checkable part, such as visual tone or typographic feel, belongs in an Out of scope note, not in a criterion.`;
}

/**
 * The `## Open decisions` schema, stated once and indented to match each
 * caller's list (hazard 3: the constrained section is stated wherever a
 * specification is requested). Entries are recorded as round-1 findings by
 * `runSpecStage`; the final sentence tells the author so, without naming a
 * stage the draft prompt must not mention (the harness emitter routes on it).
 * The only-place sentence answers crew-chatter run 2, where a split feature's
 * self-critique listed the parent specification's open decisions under a heading
 * of its own (docs/features/open-decisions-outside-section/plan.md).
 */
function openDecisionsSchema(indent: string): string {
  return `${indent}- an optional ## Open decisions section: one question the design leaves open per list line, in exactly this form: \`- OD-001 (high): <the question the design leaves open>\`.
${indent}  Open decision IDs must match \`OD-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})\`, and the parenthesized severity is one of low, medium, high, critical: how much the feature is at risk while the question stays open.
${indent}  List only a decision the design needs and does not make: one without which a behavior the design states cannot be written as a testable acceptance criterion.
${indent}  Protection, limits, or policy beyond what the design asks for is not an open decision; leave it out.
${indent}  Every non-blank line in this section is one open decision and nothing else.
${indent}  This section is the only place an open question is listed, including one another specification already records, such as the specification this feature was split from: never list one under another heading or by its ID in another section.
${indent}  Record a question here instead of deciding it yourself or leaving it only in prose: each entry is recorded as a finding that must receive a typed decision before approval.`;
}

/**
 * The frozen verification commands, stated once for every prompt that writes
 * something they judge (hazard 21: no agent was told what would judge its
 * work, and team-notes run 10 spent $7.30 on a layout its own `npm run build`
 * could not accept). The commands come from the frozen profile, never the
 * working copy of `governed.yaml` (hard rule 6). Command tokens carry no space
 * or shell metacharacter (`TOKEN` in `src/governed-config.ts`), so joining them
 * with a space loses nothing.
 *
 * Every fact is one the system computes: the lifecycle is
 * `src/verification-stage.ts` and the remediation loop in
 * `src/code-review-stage.ts`, and the pass conditions are
 * `src/commit-verification.ts` (exit code, time and output limits, and a
 * checkout that `git status --porcelain` shows unchanged). Each rule is one
 * source line so the constraint scan in `test/prompts.test.ts` matches it
 * (hazard 3). The block's size is set by `governed.yaml` and has no bound of
 * its own: an oversize one is refused by the existing prompt ceiling in
 * `src/dispatch.ts`, never truncated.
 */
function verificationCommandsBlock(verification: VerificationConfig): string {
  const commands = verification.commands.map((c) => `- ${c.name}: ${c.command.join(" ")}`).join("\n");
  return `After the implementation is committed, and again after each code-review remediation commit, the system runs these verification commands in this order in a checkout of the delivered code:

${commands}

A command passes only if it exits 0 within its time and output limits and leaves the checkout exactly as committed: git must show no new or changed file, so build output must be ignored by git.
The first command that fails blocks the run, and no repair round follows.`;
}

/**
 * What the spec author may do with the verification commands, stated once for
 * the draft and the self-critique so the two cannot drift (hazard 3).
 *
 * The spec dispatches run in the target root (`invocation.cwd` in
 * `src/spec-stage.ts` and `src/spec-decision-stage.ts`), so the author can read
 * what each command runs. Before that they inherited the directory the operator
 * launched from, which was the BuildWorks checkout in run 10. The rule names the
 * working tree, not a commit: the operator can commit while the run waits at a
 * decision or approval pause, and uncommitted files are visible too, so a file
 * is still evidence only if it belongs to the repository the design describes.
 * A commands-as-obligations misreading is the hazard 13 risk, so the rule
 * forbids it.
 *
 * The question begins `Verification:` so the reconciliation and fold prompts can
 * recognize it by its text; no code reads the word.
 */
function specVerificationRule(): string {
  return [
    `Your working directory is the target repository's working tree; read what each command runs there.`,
    `Treat a file as evidence of what a command runs only if it belongs to the repository the design describes; if you cannot tell, what the command requires is not established.`,
    `The commands are not obligations the design states: never restate a command as an acceptance criterion, and never declare an artifact only because a command exists.`,
    `A command that only reports a tool version depends on nothing and needs no decision.`,
    `If neither the design nor files you can read establish that the declared artifacts satisfy every other command, even when the design names a stack, record exactly one open decision in the form stated above, with severity high and a question that begins \`Verification:\`, asking what each such command requires and which declared artifact paths that needs.`,
    `That is the one further kind of open decision this section admits.`,
  ].join("\n");
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
  panel: PanelPromptBounds,
  verification: VerificationConfig
): string {
  const floor = effectiveFloor(panel);
  return `${SPEC_AUTHOR_PROMPT_PREFIX} ${agent.id}

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
  - a ## Declared artifacts section: one concrete, exact, repo-relative
    file path per line — never a directory scope or a glob, and never a
    document the run itself writes (the design, spec, or plan under
    docs/features/): delivery proves each declared artifact by its exact
    committed path. Never declare a tasks.md file: task execution and status
    belong in run-state database rows. Every non-blank line in this section
    is one path and nothing else, and a path contains no whitespace
  - an ## Acceptance criteria section: one criterion per list line in exactly
    this form: \`- AC-001: <criterion text>\`. Criterion IDs must match
    \`AC-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})\`. Preserve each existing ID
    when wording or reordering criteria; mint a greater unused ID only for a
    genuinely new criterion, and never reuse an ID for a different criterion,
    and never renumber criteria to close a gap. Every non-blank line here is
    one criterion and nothing else: no heading, no note, no explanation, and
    never one criterion wrapped across two lines; put an explanation of a
    numbering decision in your summary or an ordinary prose section,
    not inside this section.
${criterionQualityRule("  ")}
${openDecisionsSchema("  ")}
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
that requirement looks. Where the design needs a decision it does not make, record it under ## Open decisions rather than deciding it yourself.
Check every acceptance criterion against the pass/fail rule stated with the ## Acceptance criteria schema above and rewrite, split, or move any criterion that fails it.

${verificationCommandsBlock(verification)}

${specVerificationRule()}

Design document:

${designContent}

The specification you wrote:

${specContent}`;
}

/**
 * The reviewer prompt: role (naming the agent id and its specialty lens),
 * both governing documents verbatim, and the finding contract with every
 * constrained field stated — severity values, classification, the
 * classification-dependent location syntax, and the intentKey shape
 * (lowercase kebab-case, at most 64 characters). Findings travel in the
 * AgentResult's proposedContentChanges.findings.
 *
 * The specialty boundary is stated as a report-only rule, not a lens hint:
 * a reviewer told to read "through" its lens still reports everything it
 * notices, and the panel's independence claim is per-specialty. The
 * reconciler's ability to reject an out-of-specialty report is the
 * backstop, not the primary control (step 5b Task 6).
 */
export function buildSpecReviewPrompt(
  agent: AgentDefinition,
  designContent: string,
  specContent: string
): string {
  return `${SPEC_REVIEW_PROMPT_PREFIX} ${agent.id} with specialty ${agent.specialty ?? "general review"}

Report only findings within your specialty: ${agent.specialty ?? "general review"}. Judge the specification below against the design document it was written from. A concern outside your specialty must not be reported; other lenses will review it. An empty findings array is a valid result when you have no findings within your specialty.

Return exactly a JSON AgentResult object with this shape; your findings
travel in the AgentResult's proposedContentChanges.findings:
{"status": "proposed", "agent": "${agent.id}", "role": "reviewer", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"findings": [{"severity": "...", "classification": "...", "location": "...", "intentKey": "...", "subject": "..."}]}}

Each finding has:
- severity one of low, medium, high, critical
- classification: current_artifact when the defect is in the specification
  below; upstream when the specification cannot be corrected because its
  governing design leaves the decision unmade
- location, by classification:
  - current_artifact: a real section heading or declared artifact path from
    the specification below. When the finding targets an acceptance
    criterion, use that criterion's AC ID as the location
  - upstream: exactly upstream:design:<decision-key>, where <decision-key>
    is lowercase kebab-case within 64 characters and names the absent
    decision or obligation — never require or invent a heading for an
    omission, and never use an upstream location for a current_artifact
    concern
- intentKey: lowercase kebab-case, at most 64 characters, describing the
  concern type
- subject: one sentence naming the concern

Criterion IDs are stable identifiers, not a sequence: an obligation removed
from the specification keeps its ID out of use afterwards, and every surviving
criterion keeps the ID it was minted with, so the numbering is expected to
carry gaps. A gap in the numbering is not by itself a finding. A finding about
coverage names the design obligation the specification is missing, never a
missing number.

The specification's ## Open decisions section lists questions its author says the design leaves open.
Each entry is already recorded as a finding and will receive a decision, so you need not report it again.
Report a decision the design needs but does not make that the section omits as an upstream finding, and an entry the design actually decides as a current_artifact finding at ## Open decisions.

Output the JSON object directly, with no surrounding prose, no markdown
fences, and no commentary. Concerns within your specialty that you do not
have are represented by an empty findings array, not by prose.

Design document:

${designContent}

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
 *
 * The frozen verification commands follow the scope list, with one rule: write no
 * task that runs them. The system runs them itself after the last phase, and a
 * trailing "run the build" task changes no scope file, so its phase has nothing to
 * return and blocks the run (hazard 20). The scope block the fixture scrapes still
 * ends at its first blank line.
 */
export function buildPlanAuthorPrompt(
  agent: AgentDefinition,
  specContent: string,
  specHash: string,
  scope: string[],
  verification: VerificationConfig
): string {
  return `${PLAN_AUTHOR_PROMPT_PREFIX} ${agent.id}

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
- a ## Tasks section: one plain task per list line. Checkbox prefixes such as
  [ ] and [x] are forbidden because completion state belongs in the run
  database
- a ## Coverage section: one line per acceptance criterion ID, in one of two
  forms:
    - AC-001 -> <artifact path>
    - AC-001 -> not_applicable: <rationale> / <alternative verification>
  Copy each canonical AC ID from the approved specification exactly. Put only
  the ID to the left of \`->\`; do not copy or paraphrase criterion prose there.
  not_applicable requires both a rationale and an alternative verification.
  An entry with only one of them is refused.

Every artifact path you name in ## Coverage must be one of the approved scope
paths below, and each coverage line that names an artifact
names exactly one of them, copied verbatim. That path is the criterion's
representative delivery anchor, not an exhaustive list of every contributing
file: when several files contribute, name the declared artifact
most directly responsible for the criterion's observable outcome, and state
the work on the others as tasks.
A list of paths is not a path, and blocks the run. A criterion with no artifact
at all takes the not_applicable form above; it is never answered by naming a
file that does not implement it. Several criteria may name the same path. A plan
promising an artifact outside the approved scope is refused by the gate, so
name only these:

${scope.map((p) => `- ${p}`).join("\n")}

${verificationCommandsBlock(verification)}
The system runs these commands itself: never write a task that runs, repeats or checks them, because a task that changes no file in the approved scope can leave an implementation phase with nothing to return, and that blocks the run.

Approved specification:

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
 *
 * It carries the same verification commands and the same no-command-task rule as
 * the draft, so the revision cannot undo what the draft was told (hazard 21).
 */
export function buildPlanSelfCritiquePrompt(
  agent: AgentDefinition,
  specContent: string,
  planContent: string,
  specHash: string,
  scope: string[],
  panel: PanelPromptBounds,
  verification: VerificationConfig
): string {
  const floor = effectiveFloor(panel);
  return `${PLAN_AUTHOR_PROMPT_PREFIX} ${agent.id}

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
  - a ## Tasks section: one plain task per list line. Checkbox prefixes such as
    [ ] and [x] are forbidden because completion state belongs in the run database
  - a ## Coverage section: one line per acceptance criterion ID, in one of two
    forms:
      - AC-001 -> <artifact path>
      - AC-001 -> not_applicable: <rationale> / <alternative verification>
    Copy each canonical AC ID from the approved specification exactly. Put
    only the ID to the left of \`->\`; do not copy or paraphrase criterion prose
    there.
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
paths below, and each coverage line that names an artifact
names exactly one of them, copied verbatim. That path is the criterion's
representative delivery anchor, not an exhaustive list of every contributing
file: when several files contribute, name the declared artifact
most directly responsible for the criterion's observable outcome, and state
the work on the others as tasks.
A list of paths is not a path, and blocks the run. A criterion with no artifact
at all takes the not_applicable form above; it is never answered by naming a
file that does not implement it. Several criteria may name the same path. A plan
promising an artifact outside the approved scope is refused by the gate, so
name only these:

${scope.map((p) => `- ${p}`).join("\n")}

When a critique or a finding says a criterion
needs a second artifact, the coverage line cannot carry it. Keep the
representative delivery anchor and put the other contributing files in the task
that builds them, or say why the concern does not hold.

You may not add an obligation the approved specification below does not
contain. Sharpening the plan, completing it, and making it consistent is the
work; inventing a requirement the specification never states is not, however
reasonable that requirement looks.

${verificationCommandsBlock(verification)}
The system runs these commands itself: never write a task that runs, repeats or checks them, because a task that changes no file in the approved scope can leave an implementation phase with nothing to return, and that blocks the run.

Approved specification:

${specContent}

The plan you wrote:

${planContent}`;
}

/**
 * The plan reviewer prompt: role, both documents, and the finding contract
 * with every constrained field stated — severity values, classification, the
 * classification-dependent location syntax, and the intentKey shape.
 *
 * The full envelope shape is spelled out because the step-3 smoke showed a
 * reviewer returns a bare findings object until the prompt states the whole
 * thing. The specialty boundary is the same report-only rule the spec
 * reviewer prompt states, for the same reason.
 */
export function buildPlanReviewPrompt(
  agent: AgentDefinition,
  planContent: string,
  specContent: string
): string {
  return `${PLAN_REVIEW_PROMPT_PREFIX} ${agent.id} with specialty ${agent.specialty ?? "general review"}

Report only findings within your specialty: ${agent.specialty ?? "general review"}. Review the plan below against the specification it was written from, and judge whether the plan's tasks and coverage actually deliver the specification's acceptance criteria. A concern outside your specialty must not be reported; other lenses will review it. An empty findings array is a valid result when you have no findings within your specialty.

Return exactly a JSON AgentResult object with this shape; your findings
travel in the AgentResult's proposedContentChanges.findings:
{"status": "proposed", "agent": "${agent.id}", "role": "reviewer", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"findings": [{"severity": "...", "classification": "...", "location": "...", "intentKey": "...", "subject": "..."}]}}

Each finding has:
- severity one of low, medium, high, critical
- classification: current_artifact when the defect is in the plan below;
  upstream when the plan cannot be corrected because its governing
  specification leaves the decision unmade
- location, by classification:
  - current_artifact: a real section heading, task, or artifact path from
    the plan below. When the finding targets a coverage entry, use that entry's AC ID as the location
  - upstream: exactly upstream:specification:<decision-key>, where
    <decision-key> is lowercase kebab-case within 64 characters and names
    the absent decision or obligation — never require or invent a heading
    for an omission, and never use an upstream location for a
    current_artifact concern
- intentKey: lowercase kebab-case, at most 64 characters, describing the
  concern type
- subject: one sentence naming the concern

Coverage is one line per criterion: every acceptance criterion has exactly one
coverage line, and a line that names an artifact names exactly one path. That
path is the criterion's representative delivery anchor, not an exhaustive list
of every contributing file. A
criterion with no artifact of its own instead says not_applicable with a
rationale and an alternative verification — that is a legitimate entry, not a
defect. Several criteria may name the same artifact, which is also not a
defect: the uniqueness required is one line per criterion, never one criterion
per file. "This criterion also touches another file" is therefore
not a coverage finding — the document cannot express it, so no revision can
answer it. Report missing implementation work against the plan's tasks
instead, where it can be fixed. A coverage finding
names a criterion the plan does not deliver at all, a coverage line naming
the wrong artifact, or a coverage line promising a path outside the approved
scope.

Output the JSON object directly, with no surrounding prose, no markdown
fences, and no commentary. Concerns within your specialty that you do not
have are represented by an empty findings array, not by prose.

Plan:

${planContent}

Specification:

${specContent}`;
}

/**
 * The findings a reconciliation dispatch answers: the canonical finding id
 * and every immutable per-reviewer report that sits on it, with each
 * report's severity and classification intact. The stage builds this from
 * the round's panel output; the builder renders it.
 */
export interface ReconciliationFindingInput {
  findingId: number;
  reports: {
    reviewerId: string;
    severity: string;
    classification: string;
    location: string;
    intentKey: string;
    subject: string;
  }[];
}

/**
 * The findings block both reconciliation prompts carry. The block shape is a
 * contract: the harness fixtures scrape `finding <id>` and the per-report
 * `severity <x>, classification <y>` pairs out of it, so a rendering change
 * changes the fixtures. An empty round renders the none-line, which the
 * fixtures read the same way they read zero ids.
 */
function renderFindingsBlock(findings: ReconciliationFindingInput[]): string {
  if (findings.length === 0) {
    return `none were reported this round.`;
  }
  return findings
    .map(
      (finding) =>
        `- finding ${finding.findingId}\n${finding.reports
          .map(
            (report) =>
              `  - report from ${report.reviewerId}: severity ${report.severity}, classification ${report.classification}, location ${report.location}, intentKey ${report.intentKey}, subject ${report.subject}`
          )
          .join("\n")}`
    )
    .join("\n");
}

/**
 * The decision contract both reconciliation prompts state, parameterized by
 * the governing source's name and the artifact's normative nodes. One block,
 * two callers — the two prompts differ in which document they reconcile, not
 * in what a decision is. Hazard 3: every constrained field the validator
 * enforces is stated where it is requested, including which fields are
 * forbidden on which dispositions.
 *
 * `exampleDecisions` is rendered from the round's own findings — an example
 * `"findingId": 1` in a round whose canonical ids do not include 1 is a value
 * the validator is guaranteed to refuse, which is the same defect the panel
 * size example carried until Task 5 fixed it. One entry is advertised per
 * canonical finding: an array showing only the first id in a multi-finding
 * round would be an incomplete envelope the validator refuses for every
 * omitted id, and the model copies the array it is shown. A round with no
 * findings advertises an empty decisions list, which is the only envelope
 * that validates against zero canonical ids.
 *
 * The envelope proves id completeness; the shape block closing the contract
 * proves per-disposition validity. Each disposition has one complete shape,
 * and each validates once its placeholders are filled (hazard 3's second
 * sentence). Two paid runs on 2026-09-26 blocked on upstream decisions, one
 * missing `changedLocations` and one missing `proposal`, while the prompt
 * advertised only an addressed-like entry.
 *
 * `asksOperator` is the spec caller's: its `upstream_blocking` and
 * `cannot_determine` decisions carry a question the operator answers
 * (architecture section 12, `spec_decision`), so those two shapes and the
 * field matrix gain it. The plan caller passes false and its contract is
 * unchanged.
 */
function reconciliationDecisionContract(
  sourceName: string,
  normativeNodes: string,
  nodeForm: string,
  exampleDecisions: string,
  asksOperator: boolean
): string {
  const questionShape = asksOperator
    ? `, "question": {"text": "<the question the operator answers>", "options": [{"label": "<short name>", "answer": "<the decision this option makes>"}, {"label": "<short name>", "answer": "<the decision this option makes>"}], "recommended": 0, "why": "<why you recommend that option>"}`
    : "";
  const questionContract = asksOperator
    ? `

For disposition upstream_blocking or cannot_determine you must also supply a
question for the operator, who answers it before approval:
- question: {"text": "...", "options": [{"label": "...", "answer": "..."}], "recommended": 0, "why": "..."}
  options holds 2 to 4 entries, each with a non-empty label and a non-empty
  answer; each answer is the decision that option makes, written so it can be
  folded into the specification as it stands.
  recommended is the zero-based integer index of the option you recommend (0 is the first option).
  text and why are non-empty. The operator approves your recommended option,
  denies it and leaves the question open, or writes their own answer.
question is allowed only on upstream_blocking and cannot_determine.`
    : "";
  return `The decisions list has exactly one entry per finding id listed below, no
more and no fewer. Each decision has:
- findingId: the finding id it answers
- disposition: one of addressed, rejected_with_rationale, upstream_follow_up,
  upstream_blocking, cannot_determine
- rationale: what artifact change addresses the finding, or why the cited
  source defeats it. The system checks your citations textually and the
  artifact mechanically; your explanation is retained as evidence of the
  judgement those checks cannot make.
- changedLocations: the locations in the revised artifact you changed to
  answer this finding (section headings, task lines, or artifact paths).
  When a changed location is an acceptance criterion or coverage entry, cite its AC ID.
  changedLocations is required on every decision, whatever its disposition.
  When you change nothing, send an empty array, "changedLocations": [], and never omit the field.
  An upstream_follow_up, upstream_blocking, or cannot_determine decision usually changes nothing and still sends it.

For disposition rejected_with_rationale you must also supply:
- grounding: {"source": "${sourceName}", "location": "<heading in the ${sourceName} document>", "excerpt": "<that document's exact words>"}
  source is always ${sourceName} — the artifact under review cannot ground
  its own rejection. The system checks that the excerpt occurs verbatim in
  the ${sourceName} document below; it does not check whether the excerpt
  logically supports your rejection.

For disposition addressed you must also supply, for every ${normativeNodes}
your revision adds, replaces, or removes, exactly one entry in:
- normativeChanges: [{"artifactLocation": "<the section heading>", "artifactText": "<the exact text of the added or removed node>", "grounding": {...}}]
  The system derives both sets itself — the nodes your revision added and the
  nodes it removed — and one entry claims one node in either direction; you
  never say which direction an entry is for. A node that is missing,
  duplicated, in neither set, or whose grounding does not occur in the
  ${sourceName} document, makes the decision cannot_determine. The added half
  of a replacement counts as an added node, and the
  superseded half counts as a removed node needing its own entry,
  which may cite the same excerpt.
  Each added or removed node across the entire revision must be claimed in
  normativeChanges by exactly one decision across the whole decisions list.
  Never duplicate or repeat the same node across multiple decisions: doing so
  makes the duplicate decision cannot_determine. If multiple findings are
  addressed by the same document change, or if an addressed finding changes
  only non-normative explanatory prose, place the normativeChanges entries on
  only one decision and supply an empty array (normativeChanges: []) on the
  other addressed decision(s).
  Deleting an obligation is not a way to answer a finding. Where the
  obligation itself is wrong, the two honest routes are rejected_with_rationale
  grounded in the ${sourceName} document, or an upstream disposition carrying a
  proposal candidate.
  artifactText is the node's own text, not the artifact line it sits on:
  ${nodeForm} Leave off the list marker.

For disposition upstream_follow_up or upstream_blocking you must also supply:
- proposal: {"title": "...", "problem": "...", "whyUpstream": "..."}
  A concern whose cause is the ${sourceName} document goes upstream. The
  system derives the impact from your disposition: ${asksOperator ? "upstream_blocking pauses the run until the operator answers its question" : "upstream_blocking blocks the run"}, upstream_follow_up does not. Do not return an impact field.
  The proposal is required even when your revised artifact, its summary, or an out-of-scope note already describes the same open decision: prose in the document is not a proposal candidate, and a decision without its proposal object blocks the run.

grounding is allowed only on rejected_with_rationale; normativeChanges is
allowed only on addressed; proposal is allowed only on upstream_follow_up and
upstream_blocking. Return none of those fields on any other disposition, and
return no field at all that your disposition does not list.${questionContract}

cannot_determine carries none of grounding, normativeChanges, or proposal.

Each decision takes exactly one of these complete shapes. Replace every <...> placeholder; <id> is the id of the finding the decision answers:
- addressed: {"findingId": <id>, "disposition": "addressed", "rationale": "<why>", "changedLocations": ["<location you changed>"], "normativeChanges": [{"artifactLocation": "<the section heading>", "artifactText": "<the exact text of the added or removed node>", "grounding": {"source": "${sourceName}", "location": "<heading in the ${sourceName} document>", "excerpt": "<that document's exact words>"}}]}
- rejected_with_rationale: {"findingId": <id>, "disposition": "rejected_with_rationale", "rationale": "<why>", "changedLocations": [], "grounding": {"source": "${sourceName}", "location": "<heading in the ${sourceName} document>", "excerpt": "<that document's exact words>"}}
- upstream_follow_up: {"findingId": <id>, "disposition": "upstream_follow_up", "rationale": "<why>", "changedLocations": [], "proposal": {"title": "<title>", "problem": "<problem>", "whyUpstream": "<why upstream>"}}
- upstream_blocking: {"findingId": <id>, "disposition": "upstream_blocking", "rationale": "<why>", "changedLocations": [], "proposal": {"title": "<title>", "problem": "<problem>", "whyUpstream": "<why upstream>"}${questionShape}}
- cannot_determine: {"findingId": <id>, "disposition": "cannot_determine", "rationale": "<why>", "changedLocations": []${questionShape}}
An addressed decision's normativeChanges holds one entry per normative node it adds or removes, as described above; send "normativeChanges": [] only when the change touches no normative node or another decision already claims it.`;
}

/**
 * The example decisions array both reconciliation prompts advertise: one
 * entry per canonical finding id of the round, or an empty array when the
 * round has none. The envelope carries id completeness only — every id it
 * names is one the validator accepts, and no canonical id is omitted. Each
 * entry points at the contract's shape block rather than showing fields of
 * its own: a decision's required fields depend on its disposition, and one
 * addressed-like skeleton advertised a shape no upstream decision can take
 * (measured 2026-09-26, hazard 3).
 */
function exampleDecisionsFor(findings: ReconciliationFindingInput[]): string {
  return findings.length > 0
    ? `[${findings
        .map(
          (finding) =>
            `{"findingId": ${finding.findingId}, <the remaining fields of one shape listed below>}`
        )
        .join(", ")}]`
    : `[]`;
}

/**
 * The spec reconciliation prompt: the governing design, the complete
 * specification, the round's canonical finding ids with every immutable
 * per-reviewer report, and the decision contract. The author's answer is the
 * revised artifact plus one typed decision per finding.
 *
 * The no-invention rule is aimed at the measured defect: the Task 1
 * prototype's author answered a current_artifact finding by adding an
 * acceptance criterion the design never states, and passed the artifact
 * gate. The normative-delta grounding contract is the deterministic
 * mitigation (operator finding E), and this prompt is where the author
 * learns what it must supply for the checks to accept the answer.
 *
 * It states the frozen verification commands and the one exception to the
 * blocking rule: the `Verification:` open decision the draft prompt asks for
 * routes `upstream_blocking`, so it opens the operator question (hazard 21). That
 * is a prompt rule, not a check: the model may still choose `upstream_follow_up`.
 * The reconciler writes the question's text, and the fold prompt can only
 * recognize a `Verification:` question by that text, so this prompt asks for it.
 * Each rule is one source line so the constraint scan matches it (hazard 3).
 */
export function buildSpecReconcilePrompt(
  agent: AgentDefinition,
  designContent: string,
  specContent: string,
  findings: ReconciliationFindingInput[],
  verification: VerificationConfig
): string {
  const exampleDecisions = exampleDecisionsFor(findings);
  return `${SPEC_AUTHOR_PROMPT_PREFIX} ${agent.id}

Reconcile the findings below against the specification you wrote. No git
operations are involved: you are revising a specification document, not code
changes.

Return exactly a JSON AgentResult object with this shape; the revised
specification and your decisions travel together in the AgentResult's
proposedContentChanges:
{"status": "proposed", "agent": "${agent.id}", "role": "author", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"spec": "<the full revised specification markdown>", "decisions": ${exampleDecisions}}}

status must be one of proposed, blocked, failed. Output the JSON object
directly, with no surrounding prose, no markdown fences, and no commentary.

${reconciliationDecisionContract(
    "design",
    "declared artifact or acceptance criterion",
    'an acceptance criterion\'s node text is `AC-001: <criterion text>` and a declared artifact\'s is the bare path, so write "AC-001: the display announces results", never "- AC-001: the display announces results".',
    exampleDecisions,
    true
  )}

You may address a finding only by a change whose added normative nodes you
can ground in the design below. A reviewer calling a concern current_artifact
does not authorize you to add an obligation the design does not contain.
Sharpening the specification, completing it, and making it consistent is the
work; inventing a requirement the design never states is not, however
reasonable that requirement looks. Where the design leaves a decision open,
route the concern upstream with a complete proposal candidate, or return
cannot_determine.
When a change answers a finding, update every other part of the specification that change affects, such as another acceptance criterion, a declared artifact, or an open decision, so the revised specification stays consistent; each normative node that update adds or removes is claimed in normativeChanges like any other.

A finding whose report comes from ${agent.id} is an open decision you disclosed under ## Open decisions.
Answer it like any other finding: upstream_follow_up or upstream_blocking with a complete proposal when the design must decide it, addressed only when you can ground the resolution in the design, or cannot_determine.

Choosing between the two upstream routes, for every finding whoever reported it:
choose upstream_blocking only when the design states a behavior and leaves a decision without which no acceptance criterion for that behavior can be written, so the design as written cannot be implemented.
When the design already states a workable baseline and the question is whether to add protection, limits, or policy beyond it, the design is implementable as written: choose upstream_follow_up.
A report's severity, or how serious a risk sounds, does not by itself make a finding blocking.

${verificationCommandsBlock(verification)}

A finding whose subject reads \`OD-<n>: Verification: <question>\` is an open decision you disclosed about the verification commands, and it is the one exception to the upstream_blocking test above: choose upstream_blocking for it, because the commands decide whether the delivered code is accepted at all.
For that finding, begin the question's text with \`Verification:\` and make each option name the stack or layout the commands would then accept and the declared artifact paths that needs, each path written exactly as it would be declared, as an answer that can be folded into the specification as it stands.
Never restate a command as an acceptance criterion.

The revised specification must satisfy the same document schema as before:
- frontmatter with feature and change_kind (one of feature, defect_fix)
- a ## Declared artifacts section: one concrete, exact, repo-relative file
  path per line — never a directory scope or a glob, and never a document
  the run itself writes (the design, spec, or plan under docs/features/):
  delivery proves each declared artifact by its exact committed path.
  Never declare a tasks.md file: task execution and status belong in run-state
  database rows. Every non-blank line in this section is one path and nothing
  else, and a path contains no whitespace
- an ## Acceptance criteria section: one criterion per list line in exactly
  this form: \`- AC-001: <criterion text>\`. Criterion IDs must match
  \`AC-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})\`. Preserve each existing ID
  when wording or reordering criteria; mint a greater unused ID only for a
  genuinely new criterion, and never reuse an ID for a different criterion,
  and never renumber criteria to close a gap. Every non-blank line here is
  one criterion and nothing else: no heading, no note, no explanation, and
  never one criterion wrapped across two lines; put an explanation of a
  numbering decision in your summary or an ordinary prose section,
  not inside this section
${openDecisionsSchema("")}
  You may keep, reword, or remove an existing entry, but never add a new entry during this revision; a question you now find open is answered through the decision on the finding that raised it.
A revised specification that does not validate blocks the run.

Design document:

${designContent}

The specification under review:

${specContent}

Findings to reconcile:

${renderFindingsBlock(findings)}`;
}

/** One answered spec_review question, as the decision fold presents it. */
export interface FoldQuestionInput {
  findingId: number;
  text: string;
  action: "approve" | "deny" | "modify";
  /** The recorded answer text; empty for deny. */
  answer: string;
}

/** The heading the fold prompt lists answers under; the harness fixture routes on it. */
export const SPEC_DECISION_FOLD_MARKER = "Operator answers to fold:";

/**
 * The spec decision fold prompt (architecture section 12, `spec_decision`):
 * the design, the reviewed specification, and every answered question. The
 * author folds each approved or modified answer into the specification and
 * returns one `addressed` decision per folded answer, grounded in the design
 * or in that same question's recorded answer (hazard 13: an answer is the
 * operator's decision, so it may ground an obligation; nothing else new may).
 * A denied question is listed so the author knows to leave it open, and gets
 * no decision. The wording avoids the words the harness fixture routes the
 * earlier prompts on, so the fold is recognized by its own heading.
 *
 * It states the frozen verification commands, because the fold rewrites the
 * specification those commands will judge (hazard 21), and tells the author to
 * fold only the artifact paths an answer to a `Verification:` question names.
 * Each rule is one source line so the constraint scan matches it (hazard 3).
 */
export function buildSpecDecisionFoldPrompt(
  agent: AgentDefinition,
  designContent: string,
  specContent: string,
  questions: FoldQuestionInput[],
  verification: VerificationConfig
): string {
  const folded = questions.filter((q) => q.action !== "deny");
  const denied = questions.filter((q) => q.action === "deny");
  const exampleDecisions = folded.length > 0
    ? `[${folded.map((q) => `{"findingId": ${q.findingId}, <the remaining fields of the shape below>}`).join(", ")}]`
    : "[]";
  const renderedFolded = folded.length > 0
    ? folded
        .map((q) => `- finding ${q.findingId}\n  question: ${q.text}\n  operator answer (${q.action}): ${q.answer}`)
        .join("\n")
    : "none.";
  const renderedDenied = denied.length > 0
    ? denied.map((q) => `- finding ${q.findingId}\n  question: ${q.text}`).join("\n")
    : "none.";
  return `${SPEC_AUTHOR_PROMPT_PREFIX} ${agent.id}

The operator has answered the open questions your specification raised. Fold
each answer listed under "${SPEC_DECISION_FOLD_MARKER}" into the specification.
No git operations are involved: you are revising a specification document, not
code changes.

Return exactly a JSON AgentResult object with this shape; the revised
specification and your decisions travel together in the AgentResult's
proposedContentChanges:
{"status": "proposed", "agent": "${agent.id}", "role": "author", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"spec": "<the full revised specification markdown>", "decisions": ${exampleDecisions}}}

status must be one of proposed, blocked, failed. Output the JSON object
directly, with no surrounding prose, no markdown fences, and no commentary.

The decisions list has exactly one entry per finding id listed under
"${SPEC_DECISION_FOLD_MARKER}", no more and no fewer, and no entry for a denied
question. Every decision takes exactly this shape; replace every <...>
placeholder, and <id> is the finding id whose answer the decision folds:
{"findingId": <id>, "disposition": "addressed", "rationale": "<how the specification now reflects the answer>", "changedLocations": ["<location you changed>"], "normativeChanges": [{"artifactLocation": "<the section heading>", "artifactText": "<the exact text of the added or removed node>", "grounding": {"source": "operator_decision", "location": "finding <id>", "excerpt": "<exact words of the operator's answer to that finding>"}}]}
disposition is always addressed. changedLocations is required; send [] when you
changed nothing.

normativeChanges holds exactly one entry for every declared artifact or
acceptance criterion your revision adds or removes, across the whole decisions
list. The system derives the added and removed nodes itself; one entry claims
one node in either direction. The added half of a replacement is an added node
and the superseded half is a removed node needing its own entry. Send
"normativeChanges": [] when a decision touches no normative node.
artifactText is the node's own text: an acceptance criterion's node text is
\`AC-001: <criterion text>\` and a declared artifact's is the bare path, never
with the list marker.
Each entry's grounding cites either the operator's answer to the same finding
the decision folds — source operator_decision, whose excerpt must occur
verbatim in that finding's answer below, never in another finding's answer —
or the design — {"source": "design", "location": "<heading in the design>", "excerpt": "<the design's exact words>"}.
A node you cannot ground in one of those two blocks the run: fold only what
the operator decided.

Denied questions stay open. Add nothing about them. An entry under
## Open decisions for a denied question stays exactly as written: the same ID,
the same severity, and the same text. You may remove the ## Open decisions
entry for a question whose answer you folded. Never add a new ## Open decisions
entry.

The revised specification must satisfy the same document schema as before:
- frontmatter with feature and change_kind (one of feature, defect_fix)
- a ## Declared artifacts section: one concrete, exact, repo-relative file
  path per line — never a directory scope or a glob, and never a document
  the run itself writes (the design, spec, or plan under docs/features/).
  Every non-blank line in this section is one path and nothing else,
  and a path contains no whitespace
- an ## Acceptance criteria section: one criterion per list line in exactly
  this form: \`- AC-001: <criterion text>\`. Criterion IDs must match
  \`AC-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})\`. Preserve each existing ID;
  mint a greater unused ID only for a genuinely new criterion, and never
  reuse or renumber an ID. Every non-blank line here is one criterion and
  nothing else
- an optional ## Open decisions section: one entry per list line in exactly
  this form: \`- OD-001 (high): <the question the design leaves open>\`
A revised specification that does not validate blocks the run.

${verificationCommandsBlock(verification)}

An answer to a question that begins \`Verification:\` may name a stack, a layout and declared artifact paths: fold exactly the paths it names into ## Declared artifacts, grounded in that answer, and nothing the answer does not state.
Never restate a command as an acceptance criterion.

Design document:

${designContent}

The specification to revise:

${specContent}

${SPEC_DECISION_FOLD_MARKER}

${renderedFolded}

Denied questions (leave open):

${renderedDenied}`;
}

/**
 * The design split prompt (`docs/features/design-split-into-features/plan.md`):
 * the spec author proposes how to divide a reviewed specification that declares
 * more files than the frozen threshold into features built one after another.
 * Every rule `validateDesignSplit` enforces is stated here, in its order and with
 * the run's own numbers (hazard 3), and the literal example validates against the
 * two-criterion specification it describes (`test/prompts.test.ts`).
 *
 * The wording avoids every word the stand-in spec emitter routes the other spec
 * prompts on, and its own leading role line is the route.
 */
export function buildDesignSplitPrompt(
  agent: AgentDefinition,
  designContent: string,
  specContent: string,
  ctx: { threshold: number; declaredCount: number; slugsInUse: string[]; runSlug: string }
): string {
  const forbidden = [ctx.runSlug, ...ctx.slugsInUse.filter((s) => s !== ctx.runSlug)];
  return `${DESIGN_SPLIT_PROMPT_PREFIX}
You are ${agent.id}.

The reviewed specification below declares ${ctx.declaredCount} files. One run is estimated to build at most ${ctx.threshold} declared files within its plan ceiling, so the design is to be built as several features, one run each, in order. Propose that division. You are dividing an existing specification, not writing a new one: no git operations are involved, and you change no document.

Return exactly a JSON AgentResult object with this shape; the split travels in the AgentResult's proposedContentChanges.split:
{"status": "proposed", "agent": "${agent.id}", "role": "author", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"split": {"pieces": [{"slug": "...", "title": "...", "criteria": ["AC-001"], "declaredArtifacts": ["<declared file path>"], "dependsOn": []}], "rationale": "..."}}}

status must be one of proposed, blocked, failed. Output the JSON object
directly, with no surrounding prose, no markdown fences, and no commentary.
Every JSON string must use JSON-standard escaping. Use literal UTF-8 for non-ASCII characters or valid \`\\uXXXX\` escapes.
Write every line break inside a JSON string as \`\\n\` and every tab as \`\\t\`; never put a raw line break or tab inside a string literal.

The split must satisfy every one of these rules, checked in this order; the first rule it breaks ends the run:
- The split object has only the keys pieces and rationale, and each piece only slug, title, criteria, declaredArtifacts and dependsOn.
- pieces lists at least 2 features, in the order they will be built.
- Each slug is lowercase kebab-case matching \`[a-z0-9]+(-[a-z0-9]+)*\`, differs from every other piece's slug, and is none of these slugs already in use: ${forbidden.join(", ")}.
- Each title is one non-empty line.
- Each piece lists at least one acceptance criterion ID and at least one declared file.
- Every acceptance criterion ID of the specification is in exactly one piece, and no piece lists an ID the specification does not have.
- Every declared file of the specification is in at least one piece, written exactly as the specification declares it, and no piece lists a file the specification does not declare. A file may be listed in several pieces when several features change it.
- Each piece lists at most ${ctx.threshold} distinct declared files.
- dependsOn lists the 1-based positions of earlier pieces this piece builds on: only numbers from 1 to the piece's own position minus 1, each at most once. The first piece's dependsOn is [].
- rationale is a non-empty string saying why the features are divided and ordered this way.

Order the features so that each one builds only on features before it: a feature's criteria must be buildable with the code of the features before it and its own files, never with code a later feature writes. The system checks coverage and order of the lists above; it cannot check that, so the operator who approves the split will.

For example, for a specification whose criteria are AC-001 and AC-002 and whose declared files are src/a.ts and src/b.ts, this split is valid:
{"pieces": [{"slug": "example-core", "title": "The core behaviour", "criteria": ["AC-001"], "declaredArtifacts": ["src/a.ts"], "dependsOn": []}, {"slug": "example-extras", "title": "The extras built on the core", "criteria": ["AC-002"], "declaredArtifacts": ["src/b.ts"], "dependsOn": [1]}], "rationale": "The extras use the core module, so the core is built first."}

Design document:

${designContent}

The reviewed specification to divide:

${specContent}`;
}

/**
 * The plan reconciliation prompt: the approved specification, the complete
 * plan, the findings, and the same decision contract with the plan's
 * governing source and normative nodes. It restates `plan_for` and the
 * approved scope for the same reason the self-critique prompt does — the
 * reconciled plan is gated exactly like the draft.
 *
 * It states the frozen verification commands and forbids adding a task that runs
 * them: a finding could otherwise be answered with a trailing verify-only task
 * after the draft and the self-critique obeyed the rule (hazard 20). The rule
 * forbids an addition; it never tells the reconciler to remove a task.
 */
export function buildPlanReconcilePrompt(
  agent: AgentDefinition,
  specContent: string,
  planContent: string,
  specHash: string,
  scope: string[],
  findings: ReconciliationFindingInput[],
  verification: VerificationConfig
): string {
  const exampleDecisions = exampleDecisionsFor(findings);
  return `${PLAN_AUTHOR_PROMPT_PREFIX} ${agent.id}

Reconcile the findings below against the plan you wrote. No git operations
are involved: you are revising a plan document, not code changes.

Return exactly a JSON AgentResult object with this shape; the revised plan
and your decisions travel together in the AgentResult's
proposedContentChanges:
{"status": "proposed", "agent": "${agent.id}", "role": "author", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"plan": "<the full revised plan markdown>", "decisions": ${exampleDecisions}}}

status must be one of proposed, blocked, failed. Output the JSON object
directly, with no surrounding prose, no markdown fences, and no commentary.

${reconciliationDecisionContract(
    "specification",
    "task or coverage line",
    'a task\'s node text is the task itself and a coverage entry\'s is `AC-001 -> <artifact path>` or `AC-001 -> not_applicable: <rationale> / <alternative verification>`, so write "AC-001 -> src/a.ts" or the full not_applicable line, never "- AC-001 -> src/a.ts".',
    exampleDecisions,
    false
  )}

You may address a finding only by a change whose added normative nodes you
can ground in the approved specification below. A reviewer calling a concern
current_artifact does not authorize you to add an obligation the
specification does not contain. Sharpening the plan, completing it, and
making it consistent is the work; inventing a requirement the specification
never states is not, however reasonable that requirement looks. Where the
specification leaves a decision open, route the concern upstream with a
complete proposal candidate, or return cannot_determine.
When a change answers a finding, update every other part of the plan that change affects, such as another task or a coverage line, so the revised plan stays consistent; each normative node that update adds or removes is claimed in normativeChanges like any other.

Every task in ## Tasks and every line in ## Coverage is a normative node.
Do not casually edit, polish, or rephrase coverage entries (whether naming an
artifact or marked not_applicable) when addressing findings in ## Tasks.
If a coverage line is changed, replaced, or added, it is a normative change:
the exact new line is an added node and the replaced line is a removed node,
and both must be claimed in normativeChanges by an addressed decision
grounded in the specification. Unclaimed coverage line changes will cause
reconciliation validation to fail.

The revised plan must satisfy the same document schema as before:
- frontmatter with feature and plan_for
- plan_for must be exactly: ${specHash}
- a ## Tasks section: one plain task per list line. Checkbox prefixes such as
  [ ] and [x] are forbidden because completion state belongs in the run
  database
- a ## Coverage section: one line per acceptance criterion ID, in one of two
  forms:
    - AC-001 -> <artifact path>
    - AC-001 -> not_applicable: <rationale> / <alternative verification>
  Copy each canonical AC ID from the approved specification exactly. Put only
  the ID to the left of \`->\`; do not copy or paraphrase criterion prose there.
  not_applicable requires both a rationale and an alternative verification.
Every artifact path you name in ## Coverage must be one of the approved scope
paths below, and each coverage line that names an artifact
names exactly one of them, copied verbatim. That path is the criterion's
representative delivery anchor, not an exhaustive list of every contributing
file: when several files contribute, name the declared artifact
most directly responsible for the criterion's observable outcome, and state
the work on the others as tasks.
A list of paths is not a path, and blocks the run. A criterion with no artifact
at all takes the not_applicable form above; it is never answered by naming a
file that does not implement it. Several criteria may name the same path. A plan
promising an artifact outside the approved scope is refused by the gate, so
name only these:

${scope.map((p) => `- ${p}`).join("\n")}

When a critique or a finding says a criterion
needs a second artifact, the coverage line cannot carry it. Keep the
representative delivery anchor and put the other contributing files in the task
that builds them — that is a change you can claim. If the concern cannot be
answered inside the plan at all, route it upstream with a complete proposal
candidate rather than rejecting it on a rule the specification never states.

${verificationCommandsBlock(verification)}
The system runs these commands itself: never add a task that runs, repeats or checks them, because a task that changes no file in the approved scope can leave an implementation phase with nothing to return, and that blocks the run.

Approved specification:

${specContent}

The plan under review:

${planContent}

Findings to reconcile:

${renderFindingsBlock(findings)}`;
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
 * to build its patches, so changing the shape changes the fixture. So is the
 * sentence `This is phase K of N.`, which the same fixture scrapes to know which
 * phase it is answering.
 *
 * The implementation stage dispatches once per phase of the plan's tasks
 * (hazard 20), so every call carries one `PlanPhase`; a plan of at most one
 * phase's tasks is phase 1 of 1, not a second code path. The whole plan and the
 * specification still travel with every phase, because a task refers to
 * decisions made elsewhere in the plan. The model keeps no memory between
 * phases: what earlier phases built reaches it only through the checkout.
 *
 * `existingPaths` is the subset of `scope` that exists in the worktree at
 * `baseCommit`, computed by the stage with the same existence test the patch
 * applier uses, and the prompt splits the scope into the paths that take
 * `modify` and the paths that take `add`. Without it the model guesses which
 * scope paths an earlier phase created: team-notes run 7 proposed `modify` for
 * a file no phase had created, and phase 4 was refused after $2.37 of
 * implementation spend (hazard 20).
 *
 * The frozen verification commands follow the two lists and precede the phase's
 * tasks, so the scope block and both lists the fixture scrapes still end at their
 * first blank line. The implementer is the one agent that can read the
 * repository the commands will run against, so it is told to read what each
 * command runs. It is not given a way to refuse: the scope is signed before it
 * runs, and a false refusal is terminal (hazard 21).
 *
 * Each rule below is one source line so that the constraint scan in
 * `test/prompts.test.ts` matches it: a phrase wrapped across a template line
 * does not match (hazard 3).
 */
export function buildImplementationAuthorPrompt(
  agent: AgentDefinition,
  planContent: string,
  specContent: string,
  scope: string[],
  baseCommit: string,
  phase: PlanPhase,
  existingPaths: readonly string[],
  verification: VerificationConfig
): string {
  const lastTask = phase.firstTask + phase.tasks.length - 1;
  const existing = new Set(existingPaths);
  const renderPaths = (paths: string[]): string => (paths.length > 0 ? paths.map((p) => `- ${p}`).join("\n") : "none.");
  const phaseRules = [
    `This is phase ${phase.index} of ${phase.count}.`,
    `Implement only the tasks listed under "Tasks for this phase" below: tasks ${phase.firstTask} through ${lastTask} of the approved plan.`,
    ...(phase.index > 1
      ? [`Earlier phases are already committed in this checkout, so the files they created exist: read them before patching and build on them.`]
      : []),
    `A file that already exists in the checkout takes action modify with its complete new file content; use action add only for a file that does not exist yet.`,
    `The two lists after the scope list name which scope paths exist in the checkout right now: take the action each list states, and never modify a path listed as not existing yet.`,
    ...(phase.index < phase.count
      ? [`Later phases will implement the remaining tasks, so do not implement a task outside this phase.`]
      : []),
    `Return at least one file: a phase that changes nothing blocks the run.`,
    `Before you return, read back each task of this phase, and each acceptance criterion whose line in the plan's Coverage section names a file you return, against the files you return, and correct any file that leaves one unmet.`,
  ].join("\n");
  // The read-only sentence is UX, not a guard: enforcement is the
  // invocation boundary (the read-only executor command) and the stage's
  // clean-tree assertions. It must not tell the model about the backstop —
  // that would invite "they'll discard it anyway" readings.
  return `${IMPLEMENTATION_PROMPT_PREFIX} ${agent.id}

Propose the code changes that implement the approved plan below. Your
working directory is the repository checkout those changes apply to — read
it to see the code you are patching. Run no git commands: the system applies
and commits the patches you propose. This checkout is read-only for you: do
not create, modify, or delete any file. Only the patch content you return
is considered.

${phaseRules}

Return exactly a JSON AgentResult object with this shape:
{"status": "proposed", "agent": "${agent.id}", "role": "author", "executor": "claude-code", "summary": "...", "proposedPatches": [{"baseCommit": "...", "files": [{"path": "...", "action": "add", "content": "<complete new file content>"}]}]}

status must be one of proposed, blocked, failed.
${STRUCTURED_OUTPUT_RULE}
Every JSON string, including file content, must use JSON-standard escaping.
Use literal UTF-8 for non-ASCII characters or valid \`\\uXXXX\` escapes (two
UTF-16 surrogate escapes for a character above U+FFFF). Never use Python's
\`\\UXXXXXXXX\` escape syntax; it is not valid JSON.
Write every line break inside a JSON string, including each line break of a file's content, as \`\\n\` and every tab as \`\\t\`; never put a raw line break or tab inside a string literal.

Each patch has:
- baseCommit must be exactly: ${baseCommit}
- files: one entry per file the patch changes, each with path, action, and
  content
- path: a repo-relative path, one of the approved scope paths below.
  A tasks.md path is prohibited because task execution and status belong in
  run-state database rows
- action one of add, modify — deletion is refused by the system and must not
  be proposed
- content is the complete new file content, not a diff

Patch only these paths:

${scope.map((p) => `- ${p}`).join("\n")}

Of those paths, these exist in the checkout now, so each takes action modify:

${renderPaths(scope.filter((p) => existing.has(p)))}

Of those paths, these do not exist yet, so each takes action add:

${renderPaths(scope.filter((p) => !existing.has(p)))}

${verificationCommandsBlock(verification)}
These commands first run after the last phase, and again after any code-review remediation, so a phase that leaves one of them failing is not by itself a defect.
Before you choose a file's content, read what each command runs (for an npm command, its entry under scripts in package.json) and write files that command will accept.

Tasks for this phase (tasks ${phase.firstTask} through ${lastTask} of the approved plan):

${phase.tasks.map((task) => `- ${task}`).join("\n")}

Approved plan:

${planContent}

Approved specification:

${specContent}`;
}

/**
 * The implementation self-review prompt (`docs/features/implementation-self-review/plan.md`,
 * operator decisions 2026-10-13 and 2026-10-14): one dispatch after the last
 * phase, in which the implementer reads its own complete change against the
 * plan and specification and returns a critique and any fixes together, the
 * shape the spec and plan self-critique take.
 *
 * It opens with the phase prompt's role line, so the stand-in executor routes it
 * to the implementation emitter, then a marker sentence the emitter checks before
 * it looks for a phase; the marker never contains `This is phase`. The patch
 * contract, the scope block and the two existence lists are the phase prompt's,
 * in the shape the emitter scrapes, with the stage's last commit as the base.
 *
 * It is the author's own pass, not review (hazard 14): code review remains the
 * independent check. The frozen verification commands are stated because they
 * run straight after it (hazard 21). The prompt states no other consequence:
 * it never says what happens to a reply the system cannot use. Each rule is one
 * source line so the constraint scan in `test/prompts.test.ts` matches it.
 */
export function buildImplementationSelfReviewPrompt(
  agent: AgentDefinition,
  planContent: string,
  specContent: string,
  scope: string[],
  head: string,
  existingPaths: readonly string[],
  changedPaths: string[],
  diff: string,
  verification: VerificationConfig
): string {
  const existing = new Set(existingPaths);
  const renderPaths = (paths: string[]): string => (paths.length > 0 ? paths.map((p) => `- ${p}`).join("\n") : "none.");
  return `${IMPLEMENTATION_PROMPT_PREFIX} ${agent.id}

This is your own self-review of the complete change, after the last phase.

Your working directory is the repository checkout at commit ${head}, which holds
the complete change — read it to see the code. Run no git commands: the system
applies and commits the patches you propose.
This checkout is read-only for you: do not create, modify, or delete any file.
Only the patch content you return is considered.

Read back every task in the approved plan and every acceptance criterion in the approved specification against the code at this commit, and fix any that the code leaves unmet.
Look for wrong results, unchecked input, races between requests, state left inconsistent after a failure, and errors that are caught and ignored, and fix each one you find.
When you fix a defect, look for the same defect in every other file of the approved scope and fix it there too.
A fix that breaks a task or an acceptance criterion is not a fix: find a change that keeps both.
Fix only with behavior the approved specification already requires; never add an obligation the specification does not state, however reasonable it looks.

Return exactly a JSON AgentResult object with this shape:
{"status": "proposed", "agent": "${agent.id}", "role": "author", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"selfReview": {"critique": ["..."]}}, "proposedPatches": []}

critique holds one entry per problem you found and what you did about it, or one entry saying what you checked when you found nothing.
proposedPatches holds only the files whose content you change, each with its complete new content, and is [] when nothing needs fixing.
Never return a file whose content you did not change.

status must be one of proposed, blocked, failed.
${STRUCTURED_OUTPUT_RULE}
Every JSON string, including file content, must use JSON-standard escaping.
Use literal UTF-8 for non-ASCII characters or valid \`\\uXXXX\` escapes (two
UTF-16 surrogate escapes for a character above U+FFFF). Never use Python's
\`\\UXXXXXXXX\` escape syntax; it is not valid JSON.
Write every line break inside a JSON string, including each line break of a file's content, as \`\\n\` and every tab as \`\\t\`; never put a raw line break or tab inside a string literal.

Each patch has:
- baseCommit must be exactly: ${head}
- files: one entry per file the patch changes, each with path, action, and
  content
- path: a repo-relative path, one of the approved scope paths below.
  A tasks.md path is prohibited because task execution and status belong in
  run-state database rows
- action one of add, modify — deletion is refused by the system and must not
  be proposed
- content is the complete new file content, not a diff

Patch only these paths:

${scope.map((p) => `- ${p}`).join("\n")}

Of those paths, these exist in the checkout now, so each takes action modify:

${renderPaths(scope.filter((p) => existing.has(p)))}

Of those paths, these do not exist yet, so each takes action add:

${renderPaths(scope.filter((p) => !existing.has(p)))}

${verificationCommandsBlock(verification)}
These commands run right after this review, and the first that fails blocks the run.

Changed paths:

${changedPaths.map((p) => `- ${p}`).join("\n")}

Approved plan:

${planContent}

Approved specification:

${specContent}

Complete diff of the change through ${head}:

${diff}`;
}

/**
 * The code reviewer prompt: role (naming the agent id and its specialty
 * lens), the approved specification and plan verbatim, the changed paths,
 * and the complete unified diff of the range the run verified — plus the
 * finding contract with every constrained field stated.
 *
 * The severity rubric is stated because the gate compares a reviewer's
 * severity against a threshold frozen in the profile (hazard 3): a threshold
 * over an unstated scale is a comparison against nothing, and two reviewers
 * grading the same defect `low` and `high` would be one gate decided by
 * whichever lens happened to be seated. One sentence per level is the
 * smallest statement that makes the scale shared.
 *
 * The `Changed paths:` block shape — that heading, a blank line, then one
 * `- <path>` line per entry — is a contract, exactly as the implementation
 * prompt's scope block is: the harness fixture in the stage tests scrapes it
 * to build findings from the prompt it actually received rather than from a
 * literal it carries, so changing the shape changes the fixture.
 *
 * **No consequence is stated.** The prompt never names the threshold, never
 * says which severity blocks, and never mentions a gate. The two review
 * prompts state no consequences for the same reason: a reviewer writing to a
 * gate grades to clear it, which is the bias section 12 keeps out of a
 * deterministic gate by making the reviewer's verdict an input to it.
 */
export function buildCodeReviewPrompt(
  agent: AgentDefinition,
  specContent: string,
  planContent: string,
  changedPaths: string[],
  diff: string,
  verifiedCommit: string
): string {
  if (
    !agent.outputs.includes("code-findings") ||
    typeof agent.codeReviewInstructions !== "string" ||
    agent.codeReviewInstructions.trim() === ""
  ) {
    throw new Error(`code reviewer ${agent.id} carries no code-review instructions`);
  }
  // The read-only sentence is UX, not a guard, exactly as it is in the
  // implementation prompt: enforcement is the read-only executor command and
  // the stage's clean-tree assertions before and after every dispatch.
  return `${CODE_REVIEW_PROMPT_PREFIX} ${agent.id} with specialty ${agent.specialty ?? "general review"}

Specialist instructions: ${agent.codeReviewInstructions}

Report only findings within your specialty: ${agent.specialty ?? "general review"}. Judge the committed change below against the approved specification and plan it was written from. A concern outside your specialty must not be reported; other lenses will review it. Report only actionable defects with a reproducible impact that can be corrected in the current changed code. Do not report style, preference, optional refactoring, speculative hardening, questions, or a concern that requires changing the approved specification or plan. An empty findings array is a valid result when you have no actionable finding within your specialty. Conduct an exhaustive audit across the entire diff and all changed paths within your specialty. Do not stop after finding the first few defects or return only a sample of issues: report every actionable defect you identify across all declared acceptance criteria and plan tasks so that all issues can be addressed together.

Your working directory is the repository checkout at commit ${verifiedCommit}.
Read it to see the code surrounding the change. Run no git commands: the
diff below is the complete statement of what changed, and no git tool is
available to you. This checkout is read-only for you: do not create, modify,
or delete any file. Only the findings you return are considered.

Return exactly a JSON AgentResult object with this shape; your findings
travel in the AgentResult's proposedContentChanges.findings:
{"status": "proposed", "agent": "${agent.id}", "role": "reviewer", "executor": "claude-code", "summary": "...", "proposedContentChanges": {"findings": [{"severity": "...", "classification": "...", "location": "...", "intentKey": "...", "subject": "..."}]}}

Each finding has:
- severity one of low, medium, high, critical, meaning:
  - critical: the change is unsafe, or destroys data or state, in ordinary use
  - high: the change fails to implement an acceptance criterion or a plan
    task it claims to cover, or behaves incorrectly in ordinary use
  - medium: a concrete defect that does not fail an acceptance criterion
  - low: a small but concrete defect with localized impact
- classification: exactly current_artifact; omit any concern whose correction
  belongs in the approved specification or plan
- location: one of the changed paths below, written exactly as it is listed,
  optionally followed by :<line> where <line> is a positive integer line
  number. Never a section heading, never a description, and never a path that
  is not listed below
- intentKey: lowercase kebab-case, at most 64 characters, describing the
  concern type
- subject: one sentence naming both the concrete defect and its reproducible
  impact

Output the JSON object directly, with no surrounding prose, no markdown
fences, and no commentary. Concerns within your specialty that you do not
have are represented by an empty findings array, not by prose.

Changed paths:

${changedPaths.map((p) => `- ${p}`).join("\n")}

Approved specification:

${specContent}

Approved plan:

${planContent}

Diff:

${diff}`;
}

export interface CodeReviewRemediationFindingInput {
  findingId: number;
  location: string;
  intentKey: string;
  reports: Array<{
    reviewerId: string;
    severity: string;
    classification: "current_artifact";
    subject: string;
  }>;
}

/**
 * One code-only repair request containing every report from one panel.
 *
 * The two rules after the escaping lines come from crew-chatter run 6
 * (`test/fixtures/recorded/code-review-crew-chatter-run-6.json`,
 * `docs/features/implementation-self-review/plan.md`). The task and criterion
 * re-read answers #208/#210: the round-1 fix for #199 put back the
 * one-request-in-flight rule the plan reconciler had removed for AC-015. The
 * same-defect sweep answers #209: the fix for the NUL byte in the notes route
 * (#201) left the same defect in the email field. The prompt has no rule for
 * declining a finding, because the code-review reconciler decides that before
 * remediation, with a checked quote from the specification.
 */
export function buildCodeReviewRemediationPrompt(
  agent: AgentDefinition,
  specContent: string,
  planContent: string,
  scope: string[],
  baseCommit: string,
  changedPaths: string[],
  diff: string,
  findings: CodeReviewRemediationFindingInput[]
): string {
  const renderedFindings = findings
    .map((finding) => {
      const reports = finding.reports
        .map(
          (report) =>
            `  - reviewer ${report.reviewerId}; severity ${report.severity}; classification ${report.classification}; subject ${report.subject}`
        )
        .join("\n");
      return `- finding ${finding.findingId}; location ${finding.location}; intentKey ${finding.intentKey}\n${reports}`;
    })
    .join("\n");
  return `${CODE_REVIEW_REMEDIATION_PROMPT_PREFIX} ${agent.id}

Fix every actionable finding below in the current code. Your working directory
is the repository checkout at commit ${baseCommit}. Read the surrounding code,
but run no git commands and do not create, modify, or delete files. The system
applies and commits only the patches you return.

Return exactly a JSON AgentResult object with this shape:
{"status": "proposed", "agent": "${agent.id}", "role": "author", "executor": "claude-code", "summary": "...", "proposedPatches": [{"baseCommit": "${baseCommit}", "files": [{"path": "${scope[0] ?? "approved/path"}", "action": "modify", "content": "<complete new file content>"}]}]}

Return one or more proposedPatches. baseCommit must be exactly ${baseCommit}.
Each file path must be one approved scope path below; action is add or modify,
never deletion; content is the complete new file content, not a diff. Fix the
code. Do not return finding dispositions, proposals, waivers, questions, or
edits to the approved specification, plan, governance policy, or agent
definitions.
${STRUCTURED_OUTPUT_RULE}
Every JSON string, including file content, must use JSON-standard escaping.
Use literal UTF-8 for non-ASCII characters or valid \`\\uXXXX\` escapes (two
UTF-16 surrogate escapes for a character above U+FFFF).
Never use Python's \`\\UXXXXXXXX\` escape syntax; it is not valid JSON.
Write every line break inside a JSON string, including each line break of a file's content, as \`\\n\` and every tab as \`\\t\`; never put a raw line break or tab inside a string literal.
Before you return, re-read every task in the approved plan and every acceptance criterion in the approved specification that governs the code you change: a fix that breaks one of them is not a fix, so find a change that keeps both.
When you fix a defect, look for the same defect in every other file of the approved scope and fix it there too.

Approved scope:

${scope.map((path) => `- ${path}`).join("\n")}

Findings to remediate:

${renderedFindings}

Complete changed paths at the current head:

${changedPaths.map((path) => `- ${path}`).join("\n")}

Approved specification:

${specContent}

Approved plan:

${planContent}

Complete diff from the original patch base through ${baseCommit}:

${diff}`;
}

/**
 * The code-review reconciler prompt (`docs/features/code-review-reconciler/plan.md`):
 * before a remediation, decide for each finding of the panel whether the
 * implementer must fix it, or whether it asks for more than the approved
 * specification states.
 *
 * The text is the measured template, copied word for word from the prompt in
 * `reconcilerSource` of
 * `test/fixtures/recorded/code-review-reconciler-replay-crew-chatter-run-6.json`,
 * which calls rec-2 to rec-10 of that fixture and all 20 calls of
 * `test/fixtures/recorded/code-review-reconciler-test-5-crew-chatter-run-6.json`
 * used. Do not reword it without a new replay: the 30 recorded calls describe
 * this text and no other. The basis example `"plan task: Create the notes API in"`
 * comes from crew-chatter and stays on purpose: every run receives it, a model
 * that copies it gives an invalid basis, and an invalid basis still keeps the
 * finding (`src/code-review-reconcile.ts`).
 *
 * Like the review prompts, it states no consequence: it never says that a
 * rejection needs every call to agree, or that the final panel is never
 * reconciled. The findings render as the replay rendered them, which is the
 * remediation input without its classification.
 */
export function buildCodeReviewReconcilerPrompt(
  findings: CodeReviewRemediationFindingInput[],
  specContent: string,
  planContent: string,
  diff: string,
  reviewedCommit: string
): string {
  const rendered = findings
    .map((finding) => `- finding ${finding.findingId}; location ${finding.location}; intentKey ${finding.intentKey}\n${finding.reports.map((report) => `  - reviewer ${report.reviewerId}; severity ${report.severity}; subject ${report.subject}`).join("\n")}`)
    .join("\n");
  const entries = findings
    .map((finding) => `{"findingId": ${finding.findingId}, <the remaining fields of one shape below>}`)
    .join(", ");
  return `${CODE_REVIEW_RECONCILER_PROMPT_PREFIX}

Code reviewers reported the findings below against a committed change. Decide, for each finding, whether the implementer must fix it before the next review. Your working directory is the repository checkout at commit ${reviewedCommit}; you may read it. Run no git commands and do not create, modify, or delete any file.

Keep a finding when the code fails a behavior the approved specification or plan states, or breaks in ordinary use: it crashes, loses or corrupts data, returns a wrong result, or lets a user read or change data the specification does not allow.
Reject a finding only when it asks for protection, limits, or policy beyond what the approved specification states, and the specification already states a workable baseline for that behavior. A rejection must quote that baseline: words copied exactly from the approved specification, which the system checks.
When you are unsure, keep the finding: a kept finding costs one fix, and a wrongly rejected one ships a defect.

Return exactly one JSON object, with no surrounding prose and no markdown fences:
{"decisions": [${entries}]}

The decisions list has exactly one entry per finding id listed below, no more and no fewer. Each decision takes exactly one of these shapes:
- keep: {"findingId": <id>, "disposition": "keep", "basis": "<basis>"} where basis is exactly one of: an acceptance criterion ID copied from the approved specification (for example AC-001); the text "plan task: " followed by the first five words of that task, copied exactly from the approved plan (for example "plan task: Create the notes API in"); or one of crash, data-loss, wrong-result, unauthorized-access.
- reject: {"findingId": <id>, "disposition": "reject", "rationale": "<one sentence>", "excerpt": "<the specification's exact words stating the baseline>"}

Findings:

${rendered}

Approved specification:

${specContent}

Approved plan:

${planContent}

Diff of the change:

${diff}`;
}
