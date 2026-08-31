import { AGENTS } from "../src/agents.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRisk, selectReviewers, PANEL_SIZE } from "../src/select.ts";

test("computeRisk score boundaries", () => {
  assert.equal(computeRisk("feature", 2, false), "low");
  assert.equal(computeRisk("defect_fix", 2, false), "standard");
  assert.equal(computeRisk("feature", 11, false), "standard");
  assert.equal(computeRisk("defect_fix", 11, true), "high");
});

test("standard-risk spec stage returns the two seeded reviewers, traceability first", () => {
  const panel = selectReviewers(AGENTS, "standard", ["requirements-traceability"]);
  assert.equal(panel.length, PANEL_SIZE.standard);
  assert.equal(panel[0].id, "spec-reviewer-traceability");
  assert.ok(panel.every((a) => a.role === "reviewer"));
});

test("high risk convenes the full three-reviewer panel from the seed", () => {
  const panel = selectReviewers(AGENTS, "high", ["requirements-traceability"]);
  assert.equal(panel.length, PANEL_SIZE.high);
  assert.equal(panel[0].id, "spec-reviewer-traceability");
  assert.ok(panel.every((a) => a.role === "reviewer"));
});

test("low risk returns one reviewer — the first required specialty's agent", () => {
  const panel = selectReviewers(AGENTS, "low", ["requirements-traceability"]);
  assert.equal(panel.length, 1);
  assert.equal(panel[0].id, "spec-reviewer-traceability");
});

test("the author never appears in any panel", () => {
  for (const risk of ["low", "standard", "high"] as const) {
    const panel = selectReviewers(AGENTS, risk, ["requirements-traceability"]);
    assert.ok(!panel.some((a) => a.id === "spec-author"), `author leaked into ${risk} panel`);
  }
});
