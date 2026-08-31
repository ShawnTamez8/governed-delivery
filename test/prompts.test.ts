import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildImplementationAuthorPrompt,
  buildPlanAuthorPrompt,
  buildPlanReviewPrompt,
  buildSpecAuthorPrompt,
  buildSpecReviewPrompt,
} from "../src/prompts.ts";
import { IMPLEMENTER } from "../src/agents/implementer.ts";
import { PLAN_AUTHOR } from "../src/agents/plan-author.ts";
import { SPEC_AUTHOR } from "../src/agents/spec-author.ts";
import { SPEC_REVIEWER_TRACEABILITY } from "../src/agents/spec-reviewer-traceability.ts";

// Hazard 3: every constrained field the prompts request must state its
// constraint in the prompt source. This test reads the file, never the
// generated strings — it guards the source.
const source = readFileSync(join(process.cwd(), "src", "prompts.ts"), "utf8");

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
