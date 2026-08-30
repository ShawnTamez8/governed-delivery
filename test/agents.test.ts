import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENTS, agentById } from "../src/agents.ts";

test("no reviewer allows spec output", () => {
  for (const agent of AGENTS.filter((a) => a.role === "reviewer")) {
    assert.ok(!agent.outputs.includes("spec"), `${agent.id} must not allow spec output`);
  }
});

test("the seed covers the spec stage's required specialty and provides two reviewers", () => {
  const reviewers = AGENTS.filter((a) => a.role === "reviewer");
  assert.ok(reviewers.length >= 2, "standard risk needs a panel of two");
  assert.ok(
    reviewers.some((r) => r.specialty === "requirements-traceability"),
    "the spec stage's required specialty must be seeded"
  );
});

test("the spec author is an author and is never a reviewer candidate", () => {
  const author = agentById("spec-author");
  assert.ok(author);
  assert.equal(author.role, "author");
  assert.equal(author.specialty, null);
});

test("the plan author allows plan output and never spec output", () => {
  // Section 9: a dispatcher that derived the required output from the result
  // kind rather than the performer would let a spec author satisfy a plan
  // stage. The refusal is asserted here before the stage that relies on it.
  const author = agentById("plan-author");
  assert.ok(author, "the plan stage needs a registered author");
  assert.equal(author.role, "author");
  assert.equal(author.specialty, null);
  assert.ok(author.outputs.includes("plan"), "the plan author must allow plan output");
  assert.ok(!author.outputs.includes("spec"), "the plan author must not allow spec output");

  const specAuthor = agentById("spec-author")!;
  assert.ok(!specAuthor.outputs.includes("plan"), "the spec author must not allow plan output");
});

test("no reviewer allows plan output", () => {
  for (const agent of AGENTS.filter((a) => a.role === "reviewer")) {
    assert.ok(!agent.outputs.includes("plan"), `${agent.id} must not allow plan output`);
  }
});

test("the seeded reviewers can staff a standard-risk plan panel", () => {
  // Hazard 11: a default installation must be able to complete a run. The
  // plan panel draws from the same reviewer pool as the spec panel, so this
  // asserts the seed is sufficient rather than assuming it.
  const reviewers = AGENTS.filter((a) => a.role === "reviewer" && a.outputs.includes("findings"));
  assert.ok(reviewers.length >= 2, "standard risk seats two reviewers");
});
