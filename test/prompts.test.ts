import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as promptBuilders from "../src/prompts.ts";
import {
  buildCodeReviewPrompt,
  buildCodeReviewRemediationPrompt,
  buildImplementationAuthorPrompt,
  buildPlanAuthorPrompt,
  buildPlanReconcilePrompt,
  buildPlanReviewPrompt,
  buildPlanSelfCritiquePrompt,
  buildSpecAuthorPrompt,
  buildSpecReconcilePrompt,
  buildSpecReviewPrompt,
  buildSpecSelfCritiquePrompt,
  type PanelPromptBounds,
  type ReconciliationFindingInput,
} from "../src/prompts.ts";
import { IMPLEMENTER } from "../src/agents/implementer.ts";
import { PLAN_AUTHOR } from "../src/agents/plan-author.ts";
import { CODE_REVIEWER_CORRECTNESS } from "../src/agents/code-reviewer-correctness.ts";
import { CODE_REVIEWER_SECURITY } from "../src/agents/code-reviewer-security.ts";
import { SPEC_AUTHOR } from "../src/agents/spec-author.ts";
import { SPEC_REVIEWER_TRACEABILITY } from "../src/agents/spec-reviewer-traceability.ts";
import { validatePanelRequest } from "../src/select.ts";
import { validateSpecDoc } from "../src/spec-doc.ts";
import { validatePlanDoc } from "../src/plan-doc.ts";
import { validateAgentResult, type AgentResult } from "../src/agent-result.ts";
import { CLAUDE_CODE } from "../src/executor.ts";
import { parseEnvelope } from "../src/harness.ts";
import { validateSelfCritique } from "../src/self-critique.ts";
import {
  planNormativeNodes,
  specNormativeNodes,
  validateReconciliation,
  validateReviewerReports,
} from "../src/reconciliation.ts";
import { validateCodeReviewReports } from "../src/code-review.ts";
import { normalizeText, sha256Hex } from "../src/canonical.ts";

// Hazard 3: every constrained field the prompts request must state its
// constraint in the prompt source. This test reads the file, never the
// generated strings — it guards the source.
const source = readFileSync(join(process.cwd(), "src", "prompts.ts"), "utf8");

/**
 * The frozen panel configuration a self-critique prompt is built from.
 *
 * `sizeMin` and `sizeMax` deliberately differ: with the default 2 and 2 a
 * builder that rendered the maximum where the minimum belongs would produce
 * identical text, and the assertion would pass on a prompt that tells the
 * author the wrong bound.
 */
const PANEL: PanelPromptBounds = {
  sizeMin: 2,
  sizeMax: 3,
  requiredSpecialties: ["requirements-traceability"],
  registeredSpecialties: ["consistency", "security"],
};

// The patch rules (baseCommit, the add/modify action enum, whole-file
// content, the no-deletion rule) arrived with the implementation stage —
// the step whose prompts request patches, exactly as this comment promised
// they would.
const CONSTRAINT_STRINGS = [
  "proposed",
  "blocked",
  "failed",
  "feature",
  "defect_fix",
  "## Declared artifacts",
  "## Acceptance criteria",
  "AC-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})",
  "never reuse an ID for a different criterion",
  "the run itself writes",
  "Never declare a tasks.md file",
  "low",
  "medium",
  "high",
  "critical",
  "lowercase kebab-case",
  "64",
  "proposedContentChanges.findings",
  // The plan document schema's constrained values. Still no patch rules: the
  // plan stage is a content write like the spec stage.
  "## Tasks",
  "Checkbox prefixes such as",
  "## Coverage",
  "Copy each canonical AC ID",
  "do not copy or paraphrase criterion prose",
  "not_applicable",
  "every line in ## Coverage is a normative node",
  "Do not casually edit, polish, or rephrase coverage entries",
  "proposedContentChanges.plan",
  // The patch rules the implementation prompt states.
  "proposedPatches",
  "baseCommit",
  "add",
  "modify",
  "deletion",
  "content",
  "A tasks.md path is prohibited",
  "JSON-standard escaping",
  "literal UTF-8",
  "\\uXXXX",
  "\\UXXXXXXXX",
  // The code-review contract's constrained fields. The severity rubric is
  // here because the gate compares severity against a threshold frozen in the
  // profile (hazard 3): a threshold over an unstated scale is a comparison
  // against nothing. `code-findings` is an output kind, not a prompt string,
  // so it is deliberately absent.
  "Changed paths:",
  "one of the changed paths below",
  "positive integer",
  "fails to implement an acceptance criterion",
  "small but concrete defect with localized impact",
  "reproducible impact",
  "optional refactoring",
  "speculative hardening",
  // The read-only constraint: hazard 3 applied to a constrained behaviour,
  // per docs/proposals/implementer-writes-files-it-also-proposes.md. The
  // sentence is UX, not a guard — enforcement is the invocation boundary
  // and the cleanliness gate.
  "read-only",
  // The self-critique contract's constrained fields (step 5b Task 4). The
  // panel request is a model-returned value reaching deterministic code, so
  // every rule it must obey is stated where it is requested.
  "proposedContentChanges.selfCritique",
  "panelRequest",
  "critique:",
  "artifact:",
  "size:",
  "specialties:",
  "no more of them than the size you request",
  "never an agent identity",
  "registered specialties",
  // The panel bounds Task 5 made binding. The default installation's only
  // legal size is two and the configured required lenses consume seats inside
  // it, so an author told neither would block a run on arithmetic it was never
  // given — hazard 3 names panel size explicitly.
  "A size outside that range blocks the run",
  "always seated and already consume seats",
  "must fit inside the size you request",
  // Two behaviours, not shapes. The first is the no-invention rule the
  // prototype watched an author break; the second says what happens to a
  // self-critique that produces an invalid document, so the model is not
  // told a fallback exists.
  "may not add an obligation",
  "fallback to your draft",
  // The reviewer contract Task 6 changed: the specialty-only reporting
  // boundary, the classification vocabulary, and the classification-
  // dependent location syntax. The empty-result sentence is restated so the
  // specialty boundary and the empty-result rule read as one rule.
  "Report only findings within your specialty",
  "must not be reported",
  "An empty findings array is a valid result",
  "classification",
  "current_artifact",
  "upstream",
  "upstream:design:",
  "upstream:specification:",
  "never require or invent a heading",
  "use that criterion's AC ID as the location",
  "use that entry's AC ID as the location",
  // The reconciliation contract's constrained fields, conditional where
  // used and forbidden elsewhere. Impact is derived, never model output, so
  // the sentence forbidding it is pinned too.
  "decisions",
  "exactly one entry per finding id",
  "addressed",
  "rejected_with_rationale",
  "upstream_follow_up",
  "upstream_blocking",
  "cannot_determine",
  "normativeChanges",
  "artifactText",
  "whyUpstream",
  "Do not return an impact field",
  // Hazard 17's obligation on the author, and hazard 3's reason it must be
  // stated here: the removal claim is a constrained field the validator
  // enforces, so a prompt silent about it guarantees a blocked paid run.
  "superseded half counts as a removed node",
  "Deleting an obligation is not a way to answer a finding",
  // The node form itself, which a paid run was measured failing without: an
  // author copied the artifact line, list marker and all, and every claim was
  // refused. Hazard 3 — the constraint belongs where the field is requested.
  "artifactText is the node",
  "Leave off the list marker",
  "does not authorize you to add an obligation",
  "Findings to reconcile",
  "none were reported this round",
  "cite its AC ID",
  // The conditional-field prohibitions: the validator refuses a field on
  // every disposition that does not list it, so the prompt must state the
  // allowed/forbidden matrix, not only what each disposition requires.
  "grounding is allowed only on rejected_with_rationale",
  "normativeChanges is",
  "proposal is allowed only on upstream_follow_up",
  "return no field at all that your disposition does not list",
  // The membership rule of each structured section, which is as much a
  // constrained field as the format of a value inside it. Measured
  // 2026-09-05, $0.41049: an author answering a finding about a gap in the
  // criterion numbering explained the gap as the first line under the
  // heading, the section admitted nothing but criteria and never said so,
  // and the run blocked terminally at the spec_review gate.
  "a path contains no whitespace",
  "one criterion and nothing else",
  "not inside this section",
  // The reviewer's half of the same incident: the gap the author was asked
  // to explain is the ordinary residue of the removal accounting, so a
  // reviewer told nothing about stable-ID semantics reports the correct
  // output of another guard as a defect.
  "not a sequence",
  "gap in the numbering is not by itself a finding",
  "never renumber criteria to close a gap",
  // The coverage line's one-artifact rule, and the reviewer rule that stops
  // the finding which provokes breaking it. Measured 2026-09-05, $1.25141:
  // three reviewers said a coverage entry omitted a second implementing
  // artifact, the author named both on one line, and the pair parsed as a
  // single path outside the signed scope.
  "names exactly one of them, copied verbatim",
  "list of paths is not a path",
  "needs a second artifact",
  "not a coverage finding",
  // The one-artifact rule must not withdraw the other legal coverage form.
  // Stated on the author side as the alternative, and on the reviewer side as
  // something that is not a defect.
  "takes the not_applicable form above",
  "says not_applicable with a",
  // What the single path *means*. Without it the rule is a shape with no
  // semantics, and an author asked for one path out of several contributing
  // files has no stated basis for choosing. All four plan prompts carry it.
  "representative delivery anchor",
  "most directly responsible for the criterion's observable outcome",
  "Several criteria may name the same path",
  "Report missing implementation work against the plan's tasks",
];

test("every constrained field's constraint appears in the prompt source", () => {
  for (const constraint of CONSTRAINT_STRINGS) {
    assert.ok(source.includes(constraint), `prompt source is missing the constraint: ${constraint}`);
  }
});

test("the generated author prompt states the schema constraints", () => {
  const prompt = buildSpecAuthorPrompt(SPEC_AUTHOR, "design text");
  for (const constraint of [
    "proposed, blocked, failed",
    "## Declared artifacts",
    "the run itself writes",
    "Never declare a tasks.md file",
    "feature, defect_fix",
    "AC-001: <criterion text>",
    "beginning at AC-001 and increasing monotonically",
    "No git operations",
    "Output the JSON object",
    // Both section membership rules reach the generated prompt, not only the
    // source: the author is told what each section admits, not just how one
    // entry inside it is shaped.
    "a path contains no whitespace",
    "one criterion and nothing else",
    "not inside this section",
  ]) {
    assert.ok(prompt.includes(constraint), `author prompt missing: ${constraint}`);
  }
});

test("the generated spec reviewer prompt states the finding constraints and names the agent", () => {
  const prompt = buildSpecReviewPrompt(SPEC_REVIEWER_TRACEABILITY, "DESIGN-TEXT", "# spec");
  for (const constraint of [
    "spec reviewer spec-reviewer-traceability",
    "low, medium, high, critical",
    "lowercase kebab-case",
    "64",
    "proposedContentChanges.findings",
    // The specialty boundary and the classification contract Task 6 added.
    "Report only findings within your specialty: requirements-traceability",
    "must not be reported",
    "An empty findings array is a valid result",
    "current_artifact",
    "upstream:design:",
    "use that criterion's AC ID as the location",
    "never require or invent a heading",
    // Stable-ID semantics: a gap is the residue of a claimed removal, not a
    // defect, so the reviewer is told before it can report one.
    "not a sequence",
    "gap in the numbering is not by itself a finding",
  ]) {
    assert.ok(prompt.includes(constraint), `reviewer prompt missing: ${constraint}`);
  }
  // The design is the governing input the spec reviewer judges against, and
  // it is what makes an upstream classification citable at all.
  assert.ok(prompt.includes("DESIGN-TEXT"), "the design reaches the spec reviewer");
  assert.ok(prompt.includes("# spec"), "the specification under review travels with it");
});

test("the generated plan author prompt states the schema, the hash, and the scope", () => {
  const specHash = "a".repeat(64);
  const prompt = buildPlanAuthorPrompt(PLAN_AUTHOR, "# spec", specHash, [
    "src/thing.ts",
    "test/thing.test.ts",
  ]);
  for (const constraint of [
    "proposed, blocked, failed",
    "## Tasks",
    "Checkbox prefixes such as",
    "## Coverage",
    "not_applicable requires both a rationale and an alternative verification",
    "Copy each canonical AC ID",
    "do not copy or paraphrase criterion prose",
    "proposedContentChanges",
    "No git operations",
    "Output the JSON object",
    // The coverage line's one-artifact rule, asserted per prompt: three
    // builders carry it and the whole-file scan passes while any one of them
    // still does.
    "names exactly one of them, copied verbatim",
    "list of paths is not a path",
    "takes the not_applicable form above",
    "representative delivery anchor",
    "most directly responsible for the criterion's observable outcome",
  ]) {
    assert.ok(prompt.includes(constraint), `plan author prompt missing: ${constraint}`);
  }
  // The hash is handed to the model, not left to it to compute: it is what
  // binds the plan to the specification the operator signed.
  assert.ok(prompt.includes(`plan_for must be exactly: ${specHash}`));
  // The signed scope is stated as the only paths the plan may promise.
  assert.ok(prompt.includes("- src/thing.ts"));
  assert.ok(prompt.includes("- test/thing.test.ts"));
});

test("the criterion examples advertised by emitting prompts validate against the receiving parsers", () => {
  const spec = validateSpecDoc(`feature: demo
change_kind: feature

## Declared artifacts

- src/a.ts

## Acceptance criteria

- AC-001: criterion text
`);
  assert.equal(spec.ok, true, spec.ok ? "" : spec.reason);

  const plan = validatePlanDoc(`feature: demo
plan_for: ${"a".repeat(64)}

## Tasks

- Build the criterion

## Coverage

- AC-001 -> src/a.ts
- AC-002 -> not_applicable: rationale / alternative verification
`);
  assert.equal(plan.ok, true, plan.ok ? "" : plan.reason);
});

test("the plan author prompt has no revision variant — reconciliation owns revision", () => {
  // The legacy revision variant left with the legacy revision dispatch
  // (Task 6). The author prompt drafts; the reconciliation prompt revises,
  // carrying findings with their reports and asking for typed decisions.
  const specHash = "a".repeat(64);
  const prompt = buildPlanAuthorPrompt(PLAN_AUTHOR, "# spec", specHash, ["src/a.ts"]);
  assert.ok(!prompt.includes("## Revision"));
  assert.ok(!prompt.includes("Address"), "no legacy revision heading");
});

test("the generated plan reviewer prompt states the finding constraints and names the agent", () => {
  const prompt = buildPlanReviewPrompt(SPEC_REVIEWER_TRACEABILITY, "# plan", "# spec");
  for (const constraint of [
    "plan reviewer spec-reviewer-traceability",
    "low, medium, high, critical",
    "lowercase kebab-case",
    "64",
    "proposedContentChanges.findings",
    // The same specialty boundary and classification contract the spec
    // reviewer prompt carries, with the plan's own upstream source.
    "Report only findings within your specialty: requirements-traceability",
    "must not be reported",
    "An empty findings array is a valid result",
    "current_artifact",
    "upstream:specification:",
    "use that entry's AC ID as the location",
    "never require or invent a heading",
    // What the coverage relation can express, so the reviewer does not ask
    // for a change the document forbids and the author cannot make. The
    // not_applicable clause is asserted because this is the only plan prompt
    // that never restates the document schema: without it, the sentence below
    // is the whole description of a coverage line a reviewer ever receives,
    // and it would read as forbidding a legitimate entry.
    "Coverage is one line per criterion",
    "says not_applicable with a",
    "Several criteria may name the same artifact",
    "representative delivery anchor",
    "not a coverage finding",
    // The redirect, not a silence: a criterion the plan genuinely fails to
    // deliver must still be reportable, against the tasks that would deliver
    // it.
    "Report missing implementation work against the plan's tasks",
  ]) {
    assert.ok(prompt.includes(constraint), `plan reviewer prompt missing: ${constraint}`);
  }
  // Both documents reach the reviewer: judging coverage needs the criteria.
  assert.ok(prompt.includes("# plan"));
  assert.ok(prompt.includes("# spec"));
  // The rule about what coverage can express must not read as "report fewer
  // coverage findings": the sentence asking for exactly that judgement stays,
  // and the enumeration of what a coverage finding *is* travels with it.
  assert.ok(prompt.includes("actually deliver the specification's acceptance criteria"));
  assert.ok(prompt.includes("names a criterion the plan does not deliver"));
});

test("the generated implementation author prompt states the patch contract", () => {
  const baseCommit = "b".repeat(40);
  const prompt = buildImplementationAuthorPrompt(IMPLEMENTER, "# plan", "# spec", [
    "src/a1.ts",
    "test/a1.test.ts",
  ], baseCommit);
  for (const constraint of [
    "proposed, blocked, failed",
    "proposedPatches",
    "action one of add, modify",
    "deletion is refused by the system",
    "complete new file content",
    "A tasks.md path is prohibited",
    "Run no git commands",
    "This checkout is read-only for you",
    "Patch only these paths:",
    "Output the JSON object",
    "JSON-standard escaping",
    "literal UTF-8",
    "\\uXXXX",
    "\\UXXXXXXXX",
  ]) {
    assert.ok(prompt.includes(constraint), `implementation author prompt missing: ${constraint}`);
  }
  // The base commit is handed to the model, not left to it to compute: it is
  // what the system verifies every proposed patch against.
  assert.ok(prompt.includes(`baseCommit must be exactly: ${baseCommit}`));
  // The signed scope is stated as the only paths a patch may touch, one
  // `- <path>` line per entry.
  assert.ok(prompt.includes("- src/a1.ts"));
  assert.ok(prompt.includes("- test/a1.test.ts"));
});

test("the generated spec self-critique prompt states the contract and carries both governing inputs", () => {
  // Both inputs travel: the design is the ceiling on what the author may
  // require, the specification is what it is revising. A prompt with only one
  // of them asks for a judgement the model has no basis to make.
  const prompt = buildSpecSelfCritiquePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", PANEL);
  for (const constraint of [
    "proposedContentChanges.selfCritique",
    "proposed, blocked, failed",
    "the run itself writes",
    "Never declare a tasks.md file",
    "panelRequest",
    "never an agent identity",
    "may not add an obligation",
    "fallback to your draft",
    "Preserve each existing ID",
    "Output the JSON object",
    // The section membership rules, asserted per prompt for the same reason
    // the panel bounds are: three builders carry them, and the whole-file
    // scan above passes while any one of them still does.
    "a path contains no whitespace",
    "one criterion and nothing else",
    "not inside this section",
    "never renumber criteria to close a gap",
    // Asserted here and again on the plan prompt, per prompt rather than per
    // file: both prompts carry these sentences, and the whole-file scan above
    // cannot tell which one dropped it.
    "at least 2",
    "at most 3",
    "A size outside that range blocks the run",
    "always seated and already consume seats",
    "      - requirements-traceability",
    "must fit inside the size you request",
  ]) {
    assert.ok(prompt.includes(constraint), `spec self-critique prompt missing: ${constraint}`);
  }
  assert.ok(prompt.includes("DESIGN-TEXT"), "the design is the governing input");
  assert.ok(prompt.includes("SPEC-TEXT"), "the specification being critiqued travels with it");
  // The registry's lenses are named. Not telling the author what can be
  // staffed made the Task 1 prototype's author request an unstaffable
  // specialty, and the run blocked by name on a request it had no way to get
  // right.
  assert.ok(prompt.includes("- consistency"));
  assert.ok(prompt.includes("- security"));
  assert.ok(!prompt.includes("data-privacy"), "no specialty the caller did not supply");
});

test("the spec self-critique prompt is not the author prompt", () => {
  // Hazard 7 in the small: two dispatches under one agent and one model that
  // sent the same bytes would be paying twice for one answer.
  const author = buildSpecAuthorPrompt(SPEC_AUTHOR, "DESIGN-TEXT");
  const critique = buildSpecSelfCritiquePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", PANEL);
  assert.notEqual(author, critique);
  assert.ok(!author.includes("selfCritique"), "the draft prompt asks for a spec, not a critique");
});

test("the generated plan self-critique prompt restates the hash and the scope it must still satisfy", () => {
  const specHash = "a".repeat(64);
  const prompt = buildPlanSelfCritiquePrompt(
    PLAN_AUTHOR,
    "SPEC-TEXT",
    "PLAN-TEXT",
    specHash,
    ["src/thing.ts", "test/thing.test.ts"],
    PANEL
  );
  for (const constraint of [
    "proposedContentChanges.selfCritique",
    "panelRequest",
    "## Tasks",
    "Checkbox prefixes such as",
    "## Coverage",
    "not_applicable requires both a rationale and an alternative verification",
    "may not add an obligation",
    "fallback to your draft",
    "Copy each canonical AC ID",
    // The plan side's own copy. Task 4 shipped a guard proven only on the spec
    // side once already; these two prompts are duplicated on purpose and
    // nothing structural notices a missing assertion on one of them.
    "at least 2",
    "at most 3",
    "A size outside that range blocks the run",
    "always seated and already consume seats",
    "      - requirements-traceability",
    "must fit inside the size you request",
    // The one-artifact rule, and the move that answers a second-artifact
    // critique without breaching it.
    "names exactly one of them, copied verbatim",
    "list of paths is not a path",
    "takes the not_applicable form above",
    "representative delivery anchor",
    "most directly responsible for the criterion's observable outcome",
    "needs a second artifact",
  ]) {
    assert.ok(prompt.includes(constraint), `plan self-critique prompt missing: ${constraint}`);
  }
  assert.ok(prompt.includes("SPEC-TEXT"), "the approved specification is the governing input");
  assert.ok(prompt.includes("PLAN-TEXT"), "the plan being critiqued travels with it");
  // The revised plan is gated exactly like the draft, so the two values the
  // gates bind are stated rather than left to be rediscovered.
  assert.ok(prompt.includes(`plan_for must be exactly: ${specHash}`));
  assert.ok(prompt.includes("- src/thing.ts"));
  assert.ok(prompt.includes("- test/thing.test.ts"));
});

test("every size a self-critique prompt advertises is one the validator accepts", () => {
  // Hazard 3's second sentence: "assert that every example value a prompt
  // advertises validates against the schema that receives it." Both the stated
  // floor and the example JSON are advertised sizes, and a model copies the
  // example. The configuration that broke this is the third one below —
  // required lenses outnumbering the floor, which `invalidPolicyReason`
  // permits — where the bare floor is a value guaranteed to be refused.
  for (const requiredSpecialties of [
    [],
    ["requirements-traceability"],
    ["requirements-traceability", "security", "consistency"],
  ]) {
    const bounds: PanelPromptBounds = {
      sizeMin: 2,
      sizeMax: 3,
      requiredSpecialties,
      registeredSpecialties: ["consistency", "security"],
    };
    const prompts = {
      spec: buildSpecSelfCritiquePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", bounds),
      plan: buildPlanSelfCritiquePrompt(
        PLAN_AUTHOR,
        "SPEC-TEXT",
        "PLAN-TEXT",
        "a".repeat(64),
        ["src/a.ts"],
        bounds
      ),
    };
    for (const [name, prompt] of Object.entries(prompts)) {
      const stated = Number(/at least (\d+)/.exec(prompt)![1]);
      const example = Number(/"size": (\d+)/.exec(prompt)![1]);
      assert.equal(
        example,
        stated,
        `${name} prompt advertises an example size the same prompt calls illegal`
      );
      const accepted = validatePanelRequest(
        { size: stated, specialties: [] },
        bounds.sizeMin,
        bounds.sizeMax,
        requiredSpecialties
      );
      assert.equal(
        accepted.ok,
        true,
        `${name} prompt advertises size ${stated} with ${requiredSpecialties.length} required lenses, which the validator refuses: ${
          accepted.ok ? "" : accepted.reason
        }`
      );
    }
  }
});

test("a configuration requiring no lens states no always-seated block", () => {
  // An empty required list is legal. A prompt that announced "these lenses are
  // always seated" and then listed nothing would be stating a constraint that
  // does not exist, which is the same defect as omitting one that does.
  const none: PanelPromptBounds = { ...PANEL, requiredSpecialties: [] };
  for (const prompt of [
    buildSpecSelfCritiquePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", none),
    buildPlanSelfCritiquePrompt(PLAN_AUTHOR, "SPEC-TEXT", "PLAN-TEXT", "a".repeat(64), ["src/a.ts"], none),
  ]) {
    assert.ok(!prompt.includes("always seated"), "no always-seated block without required lenses");
    // The cap is still stated, just the simpler one: with no required lens the
    // author's own list is the whole set that has to fit.
    assert.ok(prompt.includes("no more of them than the size you request"));
    assert.ok(prompt.includes("at least 2"), "the size bound is stated either way");
    assert.ok(prompt.includes("A specialty outside that list cannot be staffed"));
  }
});

// --- reconciliation -----------------------------------------------------------

/** The mixed pair: one canonical finding carrying two unfused reports. */
const PAIR: ReconciliationFindingInput[] = [
  {
    findingId: 7,
    reports: [
      {
        reviewerId: "spec-reviewer-security",
        severity: "critical",
        classification: "current_artifact",
        location: "## Acceptance criteria",
        intentKey: "shared-concern",
        subject: "severe in-artifact concern",
      },
      {
        reviewerId: "spec-reviewer-traceability",
        severity: "low",
        classification: "upstream",
        location: "upstream:design:shared-concern",
        intentKey: "shared-concern",
        subject: "mild upstream concern",
      },
    ],
  },
];

test("the generated spec reconciliation prompt carries the decision contract and every report unfused", () => {
  const prompt = buildSpecReconcilePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", PAIR);
  for (const constraint of [
    "proposedContentChanges",
    "decisions",
    "exactly one entry per finding id",
    "addressed",
    "rejected_with_rationale",
    "upstream_follow_up",
    "upstream_blocking",
    "cannot_determine",
    "normativeChanges",
    "artifactText",
    "whyUpstream",
    "Do not return an impact field",
    // The node form for this artifact kind, asserted per prompt because the
    // two prompts state different forms and one builder renders both.
    "an acceptance criterion's node text is `AC-001: <criterion text>`",
    "Leave off the list marker",
    // The section membership rules, asserted per prompt: the whole-file scan
    // cannot tell which of the three builders carrying them dropped one, and
    // this is the builder the measured block came from.
    "a path contains no whitespace",
    "one criterion and nothing else",
    "not inside this section",
    "never renumber criteria to close a gap",
    // Both directions of the normative delta, asserted on this prompt rather
    // than only in the whole-file scan: the two reconciliation prompts render
    // from one contract builder, so a sentence missing from one of them would
    // be invisible to a scan that found it in the other.
    "superseded half counts as a removed node",
    "across the entire revision must be claimed",
    "Never duplicate or repeat the same node across multiple decisions",
    "Deleting an obligation is not a way to answer a finding",
    "source is always design",
    "does not authorize you to add an obligation",
    "upstream_blocking blocks the run, upstream_follow_up does not",
    // The conditional-field matrix: each disposition lists its fields, and the
    // validator refuses any field on a disposition that does not list it.
    "grounding is allowed only on rejected_with_rationale",
    "normativeChanges is",
    "proposal is allowed only on upstream_follow_up",
    "return no field at all that your disposition does not list",
    // The document schema the reconciled artifact must still satisfy.
    "## Declared artifacts",
    "the run itself writes",
    "Never declare a tasks.md file",
    "## Acceptance criteria",
    "Preserve each existing ID",
    "cite its AC ID",
    "Output the JSON object",
  ]) {
    assert.ok(prompt.includes(constraint), `spec reconcile prompt missing: ${constraint}`);
  }
  // Both governing inputs travel, and the artifact under review.
  assert.ok(prompt.includes("DESIGN-TEXT"), "the design is the governing input");
  assert.ok(prompt.includes("SPEC-TEXT"), "the specification under review travels with it");
  // Both reports reach the reconciler with their severity and classification
  // intact — the pair is rendered unfused, each report its own line.
  assert.ok(
    prompt.includes("severity critical, classification current_artifact"),
    "the first report keeps its own severity and classification"
  );
  assert.ok(
    prompt.includes("severity low, classification upstream"),
    "the second report keeps its own severity and classification"
  );
  assert.ok(
    prompt.includes("location upstream:design:shared-concern"),
    "the upstream report's location token is intact"
  );
  assert.ok(
    !prompt.includes("severity critical, classification upstream"),
    "no fused severity/classification pair appears"
  );
});

test("the generated plan reconciliation prompt carries the spec as governing input and restates the binding values", () => {
  const specHash = "a".repeat(64);
  const prompt = buildPlanReconcilePrompt(PLAN_AUTHOR, "SPEC-TEXT", "PLAN-TEXT", specHash, ["src/a.ts"], PAIR);
  for (const constraint of [
    "decisions",
    "source is always specification",
    "does not authorize you to add an obligation",
    "## Tasks",
    "Checkbox prefixes such as",
    "## Coverage",
    "not_applicable requires both a rationale and an alternative verification",
    "Copy each canonical AC ID",
    "cite its AC ID",
    "Do not return an impact field",
    // The plan side's own copy of the removal obligation and of the
    // single-claim rule, for the reason the conditional-field matrix is
    // asserted twice: one shared builder, and nothing structural notices a
    // sentence tested on one prompt only.
    "superseded half counts as a removed node",
    "across the entire revision must be claimed",
    "Never duplicate or repeat the same node across multiple decisions",
    "Deleting an obligation is not a way to answer a finding",
    // The plan side states its own node forms — a task and a coverage entry —
    // which are not the spec side's, so a shared assertion would prove
    // neither. The spec side carries the same pair for its own forms.
    "a task's node text is the task itself",
    "`AC-001 -> <artifact path>`",
    "`AC-001 -> not_applicable: <rationale> / <alternative verification>`",
    "Leave off the list marker",
    "every line in ## Coverage is a normative node",
    "Do not casually edit, polish, or rephrase coverage entries",
    // The one-artifact rule, and the move that answers a second-artifact
    // finding without breaching it. This is the builder the measured block
    // came from.
    "names exactly one of them, copied verbatim",
    "list of paths is not a path",
    "takes the not_applicable form above",
    "representative delivery anchor",
    "most directly responsible for the criterion's observable outcome",
    "needs a second artifact",
    // The plan side's own copy of the conditional-field matrix. These two
    // prompts share the contract builder, and nothing structural notices a
    // missing assertion on one of them.
    "grounding is allowed only on rejected_with_rationale",
    "normativeChanges is",
    "proposal is allowed only on upstream_follow_up",
    "return no field at all that your disposition does not list",
  ]) {
    assert.ok(prompt.includes(constraint), `plan reconcile prompt missing: ${constraint}`);
  }
  assert.ok(prompt.includes("SPEC-TEXT"), "the approved specification is the governing input");
  assert.ok(prompt.includes("PLAN-TEXT"), "the plan under review travels with it");
  // The two values the gates bind are stated rather than left to be
  // rediscovered, exactly as the self-critique prompt restates them.
  assert.ok(prompt.includes(`plan_for must be exactly: ${specHash}`));
  assert.ok(prompt.includes("- src/a.ts"));
  // The findings block renders on the plan side too.
  assert.ok(prompt.includes("severity critical, classification current_artifact"));
});

test("a reconciliation prompt with no findings states the none-line, not a bare block", () => {
  for (const prompt of [
    buildSpecReconcilePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", []),
    buildPlanReconcilePrompt(PLAN_AUTHOR, "SPEC-TEXT", "PLAN-TEXT", "a".repeat(64), ["src/a.ts"], []),
  ]) {
    assert.ok(prompt.includes("Findings to reconcile:"));
    assert.ok(prompt.includes("none were reported this round."), "the empty round is stated as such");
  }
});

test("the spec reconciliation prompt is not the spec author prompt", () => {
  // Hazard 7 in the small: two dispatches under one agent and one model that
  // sent the same bytes would be paying twice for one answer.
  const author = buildSpecAuthorPrompt(SPEC_AUTHOR, "DESIGN-TEXT");
  const reconcile = buildSpecReconcilePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", []);
  assert.notEqual(author, reconcile);
  assert.ok(!author.includes("decisions"), "the draft prompt asks for a spec, not decisions");
});

test("every finding id a reconcile prompt advertises is one the validator accepts", () => {
  // Hazard 3's second sentence, applied to the decision example: a fixed
  // example `"findingId": 1` in a round whose canonical ids do not include 1
  // is a value the validator is guaranteed to refuse — the same defect the
  // panel-size example carried until Task 5. The advertised example is the
  // round's complete envelope: one structural entry per canonical finding,
  // so a copied array validates rather than failing for every omitted id.
  // An empty round advertises the only envelope that validates against zero
  // canonical ids.
  const report = {
    reviewerId: "spec-reviewer-security",
    severity: "high",
    classification: "current_artifact",
    location: "## Acceptance criteria",
    intentKey: "missing-traceability",
    subject: "criterion lacks a traceable origin",
  };
  const findings: ReconciliationFindingInput[] = [
    { findingId: 3, reports: [report] },
    { findingId: 5, reports: [report] },
  ];
  const prompts = {
    spec: buildSpecReconcilePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", findings),
    plan: buildPlanReconcilePrompt(PLAN_AUTHOR, "SPEC-TEXT", "PLAN-TEXT", "a".repeat(64), ["src/a.ts"], findings),
  };
  for (const [name, prompt] of Object.entries(prompts)) {
    const advertised = [...prompt.matchAll(/"findingId": (\d+)/g)].map((m) => Number(m[1]));
    assert.deepEqual(
      advertised,
      [3, 5],
      `${name} prompt advertises the complete decisions envelope, not only its first id`
    );
  }
  for (const prompt of [
    buildSpecReconcilePrompt(SPEC_AUTHOR, "DESIGN-TEXT", "SPEC-TEXT", []),
    buildPlanReconcilePrompt(PLAN_AUTHOR, "SPEC-TEXT", "PLAN-TEXT", "a".repeat(64), ["src/a.ts"], []),
  ]) {
    assert.ok(prompt.includes('"decisions": []'), "an empty round advertises an empty decisions list");
  }
});

test("the generated code review prompt states every field the validator and the gate act on", () => {
  const prompt = buildCodeReviewPrompt(
    CODE_REVIEWER_CORRECTNESS,
    "SPEC-TEXT",
    "PLAN-TEXT",
    ["js/a.js", "css/b.css"],
    "DIFF-TEXT",
    "c".repeat(40)
  );
  for (const constraint of [
    "code reviewer code-reviewer-correctness",
    "Report only findings within your specialty: correctness",
    "low, medium, high, critical",
    // One distinguishing phrase per rubric level: a threshold over an
    // unstated scale is a comparison against nothing (hazard 3).
    "unsafe, or destroys data or state",
    "fails to implement an acceptance criterion",
    "does not fail an acceptance criterion",
    "small but concrete defect with localized impact",
    "current_artifact",
    "lowercase kebab-case",
    "64",
    "An empty findings array is a valid result",
    "read-only",
    "- js/a.js",
    "- css/b.css",
    CODE_REVIEWER_CORRECTNESS.codeReviewInstructions!,
    "reproducible impact",
    "optional refactoring",
    "speculative hardening",
    "SPEC-TEXT",
    "PLAN-TEXT",
    "DIFF-TEXT",
    "c".repeat(40),
  ]) {
    assert.ok(prompt.includes(constraint), `code review prompt is missing: ${constraint}`);
  }
  // No consequence a reviewer could write to. The sibling review prompts
  // state none either: a reviewer grading to clear a gate is the bias
  // section 12 keeps out by making the verdict an input to the gate.
  assert.ok(!prompt.includes("threshold"), "the prompt must not name the gate threshold");
  assert.ok(!prompt.includes("high or critical blocks"), "the prompt must not state a consequence");
  assert.ok(!prompt.includes("blocks the run"), "the prompt must not state a consequence");
  assert.ok(!prompt.includes("upstream:plan:"), "code review must not advertise an upstream route");

  // The `Changed paths:` block shape is a contract the harness fixture
  // scrapes. Asserted as the fixture reads it, not as prose.
  const scraped = /Changed paths:\n\n([\s\S]*?)\n\n/.exec(prompt);
  assert.ok(scraped, "the changed-paths block must be scrapable");
  assert.deepEqual(scraped![1]!.split("\n"), ["- js/a.js", "- css/b.css"]);
});

test("the security and correctness prompts carry distinct protected specialist instructions", () => {
  const security = buildCodeReviewPrompt(
    CODE_REVIEWER_SECURITY,
    "SPEC",
    "PLAN",
    ["src/a.ts"],
    "DIFF",
    "c".repeat(40)
  );
  const correctness = buildCodeReviewPrompt(
    CODE_REVIEWER_CORRECTNESS,
    "SPEC",
    "PLAN",
    ["src/a.ts"],
    "DIFF",
    "c".repeat(40)
  );
  assert.ok(correctness.includes("behavioral defects"));
  assert.ok(security.includes("trust-boundary"));
  assert.notEqual(correctness, security);
});

test("the remediation prompt carries every report and advertises a valid patch result", () => {
  const base = "b".repeat(40);
  const prompt = buildCodeReviewRemediationPrompt(
    IMPLEMENTER,
    "SPEC-TEXT",
    "PLAN-TEXT",
    ["src/a.ts"],
    base,
    ["src/a.ts"],
    "DIFF-TEXT",
    [
      {
        findingId: 7,
        location: "src/a.ts:3",
        intentKey: "wrong-result",
        reports: [
          {
            reviewerId: "code-reviewer-correctness",
            severity: "high",
            classification: "current_artifact",
            subject: "The calculation returns the wrong result for ordinary input.",
          },
        ],
      },
    ]
  );
  for (const text of [
    "finding 7",
    "src/a.ts:3",
    "wrong-result",
    "code-reviewer-correctness",
    "severity high",
    "classification current_artifact",
    "The calculation returns the wrong result",
    "SPEC-TEXT",
    "PLAN-TEXT",
    "DIFF-TEXT",
    base,
    "Do not return finding dispositions, proposals, waivers, questions",
    "JSON-standard escaping",
    "literal UTF-8",
    "\\uXXXX",
    "\\UXXXXXXXX",
  ]) {
    assert.ok(prompt.includes(text), `remediation prompt missing: ${text}`);
  }
  const advertised = /Return exactly a JSON AgentResult object with this shape:\n(\{[^\n]+\})/.exec(prompt);
  assert.ok(advertised);
  const result = validateAgentResult(IMPLEMENTER.id, JSON.parse(advertised![1]!));
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
});

const CLI_ROUTER = resolve("test", "fixtures", "harness", "emit-cli-run.mjs");
const ROUTE_PREFIXES = {
  SPEC_AUTHOR_PROMPT_PREFIX: promptBuilders.SPEC_AUTHOR_PROMPT_PREFIX,
  SPEC_REVIEW_PROMPT_PREFIX: promptBuilders.SPEC_REVIEW_PROMPT_PREFIX,
  PLAN_AUTHOR_PROMPT_PREFIX: promptBuilders.PLAN_AUTHOR_PROMPT_PREFIX,
  PLAN_REVIEW_PROMPT_PREFIX: promptBuilders.PLAN_REVIEW_PROMPT_PREFIX,
  IMPLEMENTATION_PROMPT_PREFIX: promptBuilders.IMPLEMENTATION_PROMPT_PREFIX,
  CODE_REVIEW_PROMPT_PREFIX: promptBuilders.CODE_REVIEW_PROMPT_PREFIX,
  CODE_REVIEW_REMEDIATION_PROMPT_PREFIX: promptBuilders.CODE_REVIEW_REMEDIATION_PROMPT_PREFIX,
};
interface PromptRoute {
  name: string;
  prefix: string;
  emitter: string;
}
const router: {
  PROMPT_ROUTES: PromptRoute[];
  selectPromptRoute(prompt: string): PromptRoute;
} = await import(pathToFileURL(CLI_ROUTER).href);

function routingPrompts(document: string) {
  const hash = "a".repeat(64);
  const base = "b".repeat(40);
  const scope = ["src/a.ts"];
  return [
    { builder: "buildSpecAuthorPrompt", prefix: "SPEC_AUTHOR_PROMPT_PREFIX", emitter: "emit-spec-stage.mjs", prompt: buildSpecAuthorPrompt(SPEC_AUTHOR, document) },
    { builder: "buildSpecSelfCritiquePrompt", prefix: "SPEC_AUTHOR_PROMPT_PREFIX", emitter: "emit-spec-stage.mjs", prompt: buildSpecSelfCritiquePrompt(SPEC_AUTHOR, document, document, PANEL) },
    { builder: "buildSpecReviewPrompt", prefix: "SPEC_REVIEW_PROMPT_PREFIX", emitter: "emit-spec-stage.mjs", prompt: buildSpecReviewPrompt(SPEC_REVIEWER_TRACEABILITY, document, document) },
    { builder: "buildSpecReconcilePrompt", prefix: "SPEC_AUTHOR_PROMPT_PREFIX", emitter: "emit-spec-stage.mjs", prompt: buildSpecReconcilePrompt(SPEC_AUTHOR, document, document, PAIR) },
    { builder: "buildPlanAuthorPrompt", prefix: "PLAN_AUTHOR_PROMPT_PREFIX", emitter: "emit-plan-stage.mjs", prompt: buildPlanAuthorPrompt(PLAN_AUTHOR, document, hash, scope) },
    { builder: "buildPlanSelfCritiquePrompt", prefix: "PLAN_AUTHOR_PROMPT_PREFIX", emitter: "emit-plan-stage.mjs", prompt: buildPlanSelfCritiquePrompt(PLAN_AUTHOR, document, document, hash, scope, PANEL) },
    { builder: "buildPlanReviewPrompt", prefix: "PLAN_REVIEW_PROMPT_PREFIX", emitter: "emit-plan-stage.mjs", prompt: buildPlanReviewPrompt(SPEC_REVIEWER_TRACEABILITY, document, document) },
    { builder: "buildPlanReconcilePrompt", prefix: "PLAN_AUTHOR_PROMPT_PREFIX", emitter: "emit-plan-stage.mjs", prompt: buildPlanReconcilePrompt(PLAN_AUTHOR, document, document, hash, scope, PAIR) },
    { builder: "buildImplementationAuthorPrompt", prefix: "IMPLEMENTATION_PROMPT_PREFIX", emitter: "emit-implementation-stage.mjs", prompt: buildImplementationAuthorPrompt(IMPLEMENTER, document, document, scope, base) },
    { builder: "buildCodeReviewPrompt", prefix: "CODE_REVIEW_PROMPT_PREFIX", emitter: "emit-code-review.mjs", prompt: buildCodeReviewPrompt(CODE_REVIEWER_CORRECTNESS, document, document, scope, document, base) },
    { builder: "buildCodeReviewRemediationPrompt", prefix: "CODE_REVIEW_REMEDIATION_PROMPT_PREFIX", emitter: "emit-code-review.mjs", prompt: buildCodeReviewRemediationPrompt(IMPLEMENTER, document, document, scope, base, scope, document, []) },
  ];
}

test("CLI fixture routes every builder by its shared leading role, not embedded roles or document wrapping", () => {
  assert.deepEqual(
    routingPrompts("").map(({ builder }) => builder).sort(),
    Object.keys(promptBuilders).filter((name) => name.startsWith("build")).sort(),
    "every exported builder must have a routing assertion"
  );
  assert.deepEqual(
    Object.fromEntries(router.PROMPT_ROUTES.map(({ name, prefix }) => [name, prefix])),
    ROUTE_PREFIXES
  );
  const embedded = Object.values(ROUTE_PREFIXES).join("\n");
  for (const document of ["# Ordinary input\nWrapped\nparagraph.", `# Quoted roles\r\n\`\`\`\r\n${embedded}\r\n\`\`\`\r\n🌙\r\n`]) {
    for (const entry of routingPrompts(document)) {
      const route = router.selectPromptRoute(entry.prompt);
      assert.equal(route.name, entry.prefix, entry.builder);
      assert.equal(route.emitter, entry.emitter, entry.builder);
      assert.ok(entry.prompt.startsWith(ROUTE_PREFIXES[entry.prefix as keyof typeof ROUTE_PREFIXES]));
    }
  }
});

test("CLI fixture refuses embedded-only and ambiguous roles with complete marker diagnostics and no prompt content", () => {
  const privateText = "PRIVATE-DOCUMENT-MUST-NOT-APPEAR";
  function refused(prompt: string, count: number) {
    assert.throws(() => router.selectPromptRoute(prompt), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(`match count ${count}`));
      for (const { name, prefix } of router.PROMPT_ROUTES) {
        assert.ok(error.message.includes(`${name}=${JSON.stringify(prefix)}`), name);
      }
      assert.ok(!error.message.includes(privateText));
      return true;
    });
  }
  refused(`${privateText}\n${Object.values(ROUTE_PREFIXES).join("\n")}`, 0);
  refused(` ${promptBuilders.SPEC_AUTHOR_PROMPT_PREFIX}\n${privateText}`, 0);
  const duplicate = { ...router.PROMPT_ROUTES[0]!, name: "DUPLICATE_SPEC_PREFIX" };
  router.PROMPT_ROUTES.push(duplicate);
  try {
    refused(`${promptBuilders.SPEC_AUTHOR_PROMPT_PREFIX}\n${privateText}`, 2);
  } finally {
    assert.equal(router.PROMPT_ROUTES.pop(), duplicate);
  }
  const child = spawnSync(process.execPath, [CLI_ROUTER], { input: privateText, encoding: "utf8" });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, "");
  assert.match(child.stderr, /match count 0/);
  assert.ok(!child.stderr.includes(privateText));
  for (const [name, prefix] of Object.entries(ROUTE_PREFIXES)) {
    assert.ok(child.stderr.includes(`${name}=${JSON.stringify(prefix)}`), name);
  }
});

test("CLI fixture directly forwards exact stdin bytes to every selected emitter and preserves child exit status", () => {
  const mirror = mkdtempSync(join(process.cwd(), ".cli-router-bytes-"));
  try {
    const harness = join(mirror, "test", "fixtures", "harness");
    mkdirSync(harness, { recursive: true });
    mkdirSync(join(mirror, "src"));
    copyFileSync(resolve("src", "prompts.ts"), join(mirror, "src", "prompts.ts"));
    const fixture = join(harness, "emit-cli-run.mjs");
    copyFileSync(CLI_ROUTER, fixture);
    for (const emitter of new Set(router.PROMPT_ROUTES.map((route) => route.emitter))) {
      writeFileSync(join(harness, emitter), 'import { readFileSync } from "node:fs"; process.stdout.write(readFileSync(0)); process.stderr.write("child stderr"); process.exitCode = 7;\n');
    }
    for (const { builder, prompt } of routingPrompts("# Wrapped\r\nUTF-8 🌙\r\n")) {
      const input = Buffer.concat([Buffer.from(prompt), Buffer.from([0, 255, 13, 10])]);
      const child = spawnSync(process.execPath, [fixture], { input });
      assert.equal(child.status, 7, child.stderr.toString());
      assert.deepEqual(child.stdout, input, `${builder}: router must forward original bytes, not decoded text`);
      assert.equal(child.stderr.toString(), "child stderr");
    }
  } finally {
    rmSync(mirror, { recursive: true, force: true });
  }
});

function runRouter(cwd: string, prompt: string, agentId: string, args: string[] = []): AgentResult {
  const child = spawnSync(process.execPath, [CLI_ROUTER, ...args, "--model", "fixture-model"], {
    cwd, input: prompt, encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
  const envelope = parseEnvelope(CLAUDE_CODE, child.stdout);
  const result = validateAgentResult(agentId, JSON.parse(envelope.resultText));
  assert.ok(result.ok, result.ok ? "" : result.reason);
  return result.value;
}

function proposedChanges(result: AgentResult): Record<string, unknown> {
  assert.equal(result.status, "proposed");
  assert.ok(result.proposedContentChanges && typeof result.proposedContentChanges === "object");
  return result.proposedContentChanges as Record<string, unknown>;
}

test("CLI fixture composes existing emitters for all builder families with receiving-schema validation", () => {
  const root = mkdtempSync(join(process.cwd(), ".cli-router-schema-"));
  try {
    writeFileSync(join(root, "base.txt"), "worktree marker\n");
    const design = "# design\ndesign\n";
    const specResult = runRouter(root, buildSpecAuthorPrompt(SPEC_AUTHOR, design), SPEC_AUTHOR.id);
    const specText = proposedChanges(specResult).spec;
    assert.equal(typeof specText, "string");
    const spec = validateSpecDoc(specText as string);
    assert.ok(spec.ok, spec.ok ? "" : spec.reason);
    const scope = spec.value.declaredArtifacts;
    const specHash = sha256Hex(normalizeText(specText as string));
    const planResult = runRouter(root, buildPlanAuthorPrompt(PLAN_AUTHOR, specText as string, specHash, scope), PLAN_AUTHOR.id);
    const planText = proposedChanges(planResult).plan;
    assert.equal(typeof planText, "string");
    const plan = validatePlanDoc(planText as string);
    assert.ok(plan.ok, plan.ok ? "" : plan.reason);
    assert.equal(plan.value.planFor, specHash);

    for (const kind of ["spec", "plan"] as const) {
      const agent = kind === "spec" ? SPEC_AUTHOR : PLAN_AUTHOR;
      const prompt = kind === "spec"
        ? buildSpecSelfCritiquePrompt(agent, design, specText as string, PANEL)
        : buildPlanSelfCritiquePrompt(agent, specText as string, planText as string, specHash, scope, PANEL);
      const critique = validateSelfCritique(proposedChanges(runRouter(root, prompt, agent.id)).selfCritique);
      assert.ok(critique.ok, critique.ok ? "" : critique.reason);
      const artifact = kind === "spec" ? validateSpecDoc(critique.value.artifact) : validatePlanDoc(critique.value.artifact);
      assert.ok(artifact.ok, artifact.ok ? "" : artifact.reason);

      const reviewer = SPEC_REVIEWER_TRACEABILITY;
      const reviewPrompt = kind === "spec"
        ? buildSpecReviewPrompt(reviewer, design, specText as string)
        : buildPlanReviewPrompt(reviewer, planText as string, specText as string);
      const review = validateReviewerReports(proposedChanges(runRouter(root, reviewPrompt, reviewer.id)).findings, {
        agentId: reviewer.id, upstreamPrefix: kind === "spec" ? "upstream:design:" : "upstream:specification:",
      });
      assert.ok(review.ok, review.ok ? "" : review.reason);
      const findings = review.value.map((report, index) => ({
        findingId: index + 1, reports: [{ reviewerId: reviewer.id, ...report }],
      }));
      const reconciliationPrompt = kind === "spec"
        ? buildSpecReconcilePrompt(agent, design, specText as string, findings)
        : buildPlanReconcilePrompt(agent, specText as string, planText as string, specHash, scope, findings);
      const reconciled = proposedChanges(runRouter(root, reconciliationPrompt, agent.id));
      const revisedText = reconciled[kind];
      assert.equal(typeof revisedText, "string");
      const revisedSpec = validateSpecDoc(kind === "spec" ? revisedText as string : specText as string);
      const revisedPlan = validatePlanDoc(kind === "plan" ? revisedText as string : planText as string);
      assert.ok(revisedSpec.ok, revisedSpec.ok ? "" : revisedSpec.reason);
      assert.ok(revisedPlan.ok, revisedPlan.ok ? "" : revisedPlan.reason);
      const decisions = validateReconciliation(reconciled.decisions, {
        canonicalFindingIds: findings.map(({ findingId }) => findingId),
        governingSource: kind === "spec" ? "design" : "specification",
        governingText: kind === "spec" ? design : specText as string,
        beforeNormativeNodes: kind === "spec" ? specNormativeNodes(spec.value) : planNormativeNodes(plan.value),
        afterNormativeNodes: kind === "spec" ? specNormativeNodes(revisedSpec.value) : planNormativeNodes(revisedPlan.value),
      });
      assert.ok(decisions.ok, decisions.ok ? "" : decisions.reason);
      assert.deepEqual(decisions.value.conversions, []);
      assert.deepEqual(decisions.value.unclaimedNodes, []);
      assert.deepEqual(decisions.value.unclaimedRemovals, []);
    }

    const base = "b".repeat(40);
    const implementationPrompt = buildImplementationAuthorPrompt(IMPLEMENTER, planText as string, specText as string, scope, base);
    const implemented = runRouter(root, implementationPrompt, IMPLEMENTER.id);
    assert.equal(implemented.status, "proposed");
    const patches = implemented.proposedPatches!;
    assert.deepEqual(patches.flatMap((patch) => patch.files.map((file) => file.path)), scope);
    for (const patch of patches) {
      assert.equal(patch.baseCommit, base);
      for (const file of patch.files) {
        assert.equal(file.action, "add");
        assert.equal(typeof file.content, "string");
        const path = join(root, file.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, file.content!);
      }
    }
    assert.equal(runRouter(root, implementationPrompt, IMPLEMENTER.id, ["--implementation-mode", "non-proposed"]).status, "failed");
    assert.equal(runRouter(root, implementationPrompt, IMPLEMENTER.id, ["--implementation-mode", "base-mismatch"]).proposedPatches![0]!.baseCommit, "0".repeat(40));

    for (const mode of ["ok", "high", "low", "high-then-clean"]) {
      for (const reviewer of [CODE_REVIEWER_CORRECTNESS, CODE_REVIEWER_SECURITY]) {
        const prompt = buildCodeReviewPrompt(reviewer, specText as string, planText as string, scope, "", base);
        const result = runRouter(root, prompt, reviewer.id, ["--code-review-mode", mode]);
        const reports = validateReviewerReports(proposedChanges(result).findings, { agentId: reviewer.id, upstreamPrefix: "upstream:plan:" });
        assert.ok(reports.ok, reports.ok ? "" : reports.reason);
        assert.equal(validateCodeReviewReports(reports.value, scope), null);
        const reportingSeat = mode === "high" ? CODE_REVIEWER_SECURITY : CODE_REVIEWER_CORRECTNESS;
        assert.equal(reports.value.length, mode !== "ok" && reviewer === reportingSeat ? 1 : 0);
        if (reports.value.length) assert.equal(reports.value[0]!.severity, mode === "low" ? "low" : "high");
      }
    }
    const remediationPrompt = buildCodeReviewRemediationPrompt(IMPLEMENTER, specText as string, planText as string, scope, base, scope, "", []);
    const remediated = runRouter(root, remediationPrompt, IMPLEMENTER.id, ["--code-review-mode", "high-then-clean"]);
    assert.equal(remediated.proposedPatches![0]!.baseCommit, base);
    const repaired = remediated.proposedPatches![0]!.files[0]!;
    assert.equal(repaired.path, scope[0]);
    assert.equal(repaired.action, "modify");
    writeFileSync(join(root, repaired.path), repaired.content!);
    const after = runRouter(root, buildCodeReviewPrompt(CODE_REVIEWER_CORRECTNESS, specText as string, planText as string, scope, "", base), CODE_REVIEWER_CORRECTNESS.id, ["--code-review-mode", "high-then-clean"]);
    assert.deepEqual(proposedChanges(after).findings, []);
    for (const mode of ["remediation-empty", "remediation-wrong-base", "remediation-outside-scope"]) {
      const result = runRouter(root, remediationPrompt, IMPLEMENTER.id, ["--code-review-mode", mode]);
      if (mode === "remediation-empty") assert.deepEqual(result.proposedPatches, []);
      if (mode === "remediation-wrong-base") assert.equal(result.proposedPatches![0]!.baseCommit, "0".repeat(40));
      if (mode === "remediation-outside-scope") assert.ok(!scope.includes(result.proposedPatches![0]!.files[0]!.path));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
