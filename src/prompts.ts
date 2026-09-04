import type { AgentDefinition } from "./agents.ts";

/**
 * The author prompt: role, the design document verbatim, the AgentResult
 * contract with every constrained field stated, and the spec document
 * schema. The draft only — revision is the reconciliation dispatch's job
 * (step 5b Task 6), which carries the findings with their reports and asks
 * for typed decisions rather than a bare rewrite. A pure function of its
 * inputs.
 */
export function buildSpecAuthorPrompt(agent: AgentDefinition, designContent: string): string {
  return `you are the spec author

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
  database rows
- an ## Acceptance criteria section: one criterion per list line in exactly
  this form: \`- AC-001: <criterion text>\`. Criterion IDs must match
  \`AC-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})\`. Mint them here, beginning at AC-001 and increasing monotonically; never reuse an ID for a different
  criterion

Design document:

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
  - a ## Declared artifacts section: one concrete, exact, repo-relative
    file path per line — never a directory scope or a glob, and never a
    document the run itself writes (the design, spec, or plan under
    docs/features/): delivery proves each declared artifact by its exact
    committed path. Never declare a tasks.md file: task execution and status
    belong in run-state database rows
  - an ## Acceptance criteria section: one criterion per list line in exactly
    this form: \`- AC-001: <criterion text>\`. Criterion IDs must match
    \`AC-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})\`. Preserve each existing ID
    when wording or reordering criteria; mint a greater unused ID only for a
    genuinely new criterion, and never reuse an ID for a different criterion
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
  return `you are the spec reviewer ${agent.id} with specialty ${agent.specialty ?? "general review"}

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
 */
export function buildPlanAuthorPrompt(
  agent: AgentDefinition,
  specContent: string,
  specHash: string,
  scope: string[]
): string {
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
paths below. A plan promising an artifact outside the approved scope is
refused by the gate, so name only these:

${scope.map((p) => `- ${p}`).join("\n")}

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
  return `you are the plan reviewer ${agent.id} with specialty ${agent.specialty ?? "general review"}

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
 * size example carried until Task 5 fixed it. One structural entry is
 * advertised per canonical finding: an array showing only the first id in a
 * multi-finding round would be an incomplete envelope the validator refuses
 * for every omitted id, and the model copies the array it is shown. A round
 * with no findings advertises an empty decisions list, which is the only
 * envelope that validates against zero canonical ids.
 */
function reconciliationDecisionContract(
  sourceName: string,
  normativeNodes: string,
  nodeForm: string,
  exampleDecisions: string
): string {
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
  Empty when you change nothing, as for cannot_determine.

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
  Deleting an obligation is not a way to answer a finding. Where the
  obligation itself is wrong, the two honest routes are rejected_with_rationale
  grounded in the ${sourceName} document, or an upstream disposition carrying a
  proposal candidate.
  artifactText is the node's own text, not the artifact line it sits on:
  ${nodeForm} Leave off the list marker.

For disposition upstream_follow_up or upstream_blocking you must also supply:
- proposal: {"title": "...", "problem": "...", "whyUpstream": "..."}
  A concern whose cause is the ${sourceName} document goes upstream. The
  system derives the impact from your disposition: upstream_blocking blocks the run, upstream_follow_up does not. Do not return an impact field.

grounding is allowed only on rejected_with_rationale; normativeChanges is
allowed only on addressed; proposal is allowed only on upstream_follow_up and
upstream_blocking. Return none of those fields on any other disposition, and
return no field at all that your disposition does not list.

cannot_determine carries none of grounding, normativeChanges, or proposal.`;
}

/**
 * The example decisions array both reconciliation prompts advertise: one
 * structural entry per canonical finding id of the round, or an empty array
 * when the round has none. The complete array is the only envelope a model
 * can copy that still validates — every id it names is one the validator
 * accepts, and no canonical id is omitted.
 */
function exampleDecisionsFor(findings: ReconciliationFindingInput[]): string {
  return findings.length > 0
    ? `[${findings
        .map(
          (finding) =>
            `{"findingId": ${finding.findingId}, "disposition": "...", "rationale": "...", "changedLocations": ["..."]}`
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
 */
export function buildSpecReconcilePrompt(
  agent: AgentDefinition,
  designContent: string,
  specContent: string,
  findings: ReconciliationFindingInput[]
): string {
  const exampleDecisions = exampleDecisionsFor(findings);
  return `you are the spec author ${agent.id}

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
    exampleDecisions
  )}

You may address a finding only by a change whose added normative nodes you
can ground in the design below. A reviewer calling a concern current_artifact
does not authorize you to add an obligation the design does not contain.
Sharpening the specification, completing it, and making it consistent is the
work; inventing a requirement the design never states is not, however
reasonable that requirement looks. Where the design leaves a decision open,
route the concern upstream with a complete proposal candidate, or return
cannot_determine.

The revised specification must satisfy the same document schema as before:
- frontmatter with feature and change_kind (one of feature, defect_fix)
- a ## Declared artifacts section: one concrete, exact, repo-relative file
  path per line — never a directory scope or a glob, and never a document
  the run itself writes (the design, spec, or plan under docs/features/):
  delivery proves each declared artifact by its exact committed path.
  Never declare a tasks.md file: task execution and status belong in run-state
  database rows
- an ## Acceptance criteria section: one criterion per list line in exactly
  this form: \`- AC-001: <criterion text>\`. Criterion IDs must match
  \`AC-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})\`. Preserve each existing ID
  when wording or reordering criteria; mint a greater unused ID only for a
  genuinely new criterion, and never reuse an ID for a different criterion
A revised specification that does not validate blocks the run.

Design document:

${designContent}

The specification under review:

${specContent}

Findings to reconcile:

${renderFindingsBlock(findings)}`;
}

/**
 * The plan reconciliation prompt: the approved specification, the complete
 * plan, the findings, and the same decision contract with the plan's
 * governing source and normative nodes. It restates `plan_for` and the
 * approved scope for the same reason the self-critique prompt does — the
 * reconciled plan is gated exactly like the draft.
 */
export function buildPlanReconcilePrompt(
  agent: AgentDefinition,
  specContent: string,
  planContent: string,
  specHash: string,
  scope: string[],
  findings: ReconciliationFindingInput[]
): string {
  const exampleDecisions = exampleDecisionsFor(findings);
  return `you are the plan author ${agent.id}

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
    'a task\'s node text is the task itself and a coverage entry\'s is `AC-001 -> <artifact path>`, so write "AC-001 -> src/a.ts", never "- AC-001 -> src/a.ts".',
    exampleDecisions
  )}

You may address a finding only by a change whose added normative nodes you
can ground in the approved specification below. A reviewer calling a concern
current_artifact does not authorize you to add an obligation the
specification does not contain. Sharpening the plan, completing it, and
making it consistent is the work; inventing a requirement the specification
never states is not, however reasonable that requirement looks. Where the
specification leaves a decision open, route the concern upstream with a
complete proposal candidate, or return cannot_determine.

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
paths below. A plan promising an artifact outside the approved scope is
refused by the gate, so name only these:

${scope.map((p) => `- ${p}`).join("\n")}

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
- path: a repo-relative path, one of the approved scope paths below.
  A tasks.md path is prohibited because task execution and status belong in
  run-state database rows
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
