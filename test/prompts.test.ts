import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildImplementationAuthorPrompt,
  buildPlanAuthorPrompt,
  buildPlanReviewPrompt,
  buildPlanSelfCritiquePrompt,
  buildSpecAuthorPrompt,
  buildSpecReviewPrompt,
  buildSpecSelfCritiquePrompt,
  type PanelPromptBounds,
} from "../src/prompts.ts";
import { IMPLEMENTER } from "../src/agents/implementer.ts";
import { PLAN_AUTHOR } from "../src/agents/plan-author.ts";
import { SPEC_AUTHOR } from "../src/agents/spec-author.ts";
import { SPEC_REVIEWER_TRACEABILITY } from "../src/agents/spec-reviewer-traceability.ts";
import { validatePanelRequest } from "../src/select.ts";

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
  "## Coverage",
  "not_applicable",
  "proposedContentChanges.plan",
  // The patch rules the implementation prompt states.
  "proposedPatches",
  "baseCommit",
  "add",
  "modify",
  "deletion",
  "content",
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
    "feature, defect_fix",
    "No git operations",
    "Output the JSON object",
  ]) {
    assert.ok(prompt.includes(constraint), `author prompt missing: ${constraint}`);
  }
});

test("the generated reviewer prompt states the finding constraints and names the agent", () => {
  const prompt = buildSpecReviewPrompt(SPEC_REVIEWER_TRACEABILITY, "# spec");
  for (const constraint of [
    "spec reviewer spec-reviewer-traceability",
    "low, medium, high, critical",
    "lowercase kebab-case",
    "64",
    "proposedContentChanges.findings",
  ]) {
    assert.ok(prompt.includes(constraint), `reviewer prompt missing: ${constraint}`);
  }
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
    "## Coverage",
    "not_applicable requires both a rationale and an alternative verification",
    "proposedContentChanges",
    "No git operations",
    "Output the JSON object",
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

test("the plan author revision prompt varies by carrying the open findings", () => {
  // Hazard 7: a retry that varies nothing is a slower failure with a larger
  // bill. The revision must differ from the first attempt.
  const specHash = "a".repeat(64);
  const first = buildPlanAuthorPrompt(PLAN_AUTHOR, "# spec", specHash, ["src/a.ts"]);
  const revised = buildPlanAuthorPrompt(PLAN_AUTHOR, "# spec", specHash, ["src/a.ts"], {
    findingsSummary: "- coverage-gap: criterion 2 names no artifact",
  });
  assert.notEqual(first, revised);
  assert.ok(revised.includes("## Revision"));
  assert.ok(revised.includes("coverage-gap: criterion 2 names no artifact"));
});

test("the generated plan reviewer prompt states the finding constraints and names the agent", () => {
  const prompt = buildPlanReviewPrompt(SPEC_REVIEWER_TRACEABILITY, "# plan", "# spec");
  for (const constraint of [
    "plan reviewer spec-reviewer-traceability",
    "low, medium, high, critical",
    "lowercase kebab-case",
    "64",
    "proposedContentChanges.findings",
  ]) {
    assert.ok(prompt.includes(constraint), `plan reviewer prompt missing: ${constraint}`);
  }
  // Both documents reach the reviewer: judging coverage needs the criteria.
  assert.ok(prompt.includes("# plan"));
  assert.ok(prompt.includes("# spec"));
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
    "Run no git commands",
    "This checkout is read-only for you",
    "Patch only these paths:",
    "Output the JSON object",
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
    "panelRequest",
    "never an agent identity",
    "may not add an obligation",
    "fallback to your draft",
    "Output the JSON object",
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
    "## Coverage",
    "not_applicable requires both a rationale and an alternative verification",
    "may not add an obligation",
    "fallback to your draft",
    // The plan side's own copy. Task 4 shipped a guard proven only on the spec
    // side once already; these two prompts are duplicated on purpose and
    // nothing structural notices a missing assertion on one of them.
    "at least 2",
    "at most 3",
    "A size outside that range blocks the run",
    "always seated and already consume seats",
    "      - requirements-traceability",
    "must fit inside the size you request",
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
