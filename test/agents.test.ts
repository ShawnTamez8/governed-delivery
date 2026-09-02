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

test("the implementer allows patches output, nothing else, and never reviews", () => {
  // Section 9: a dispatcher that derived the required output from the result
  // kind rather than the performer would let another author satisfy the
  // implementation stage. The refusal is asserted here before the stage that
  // relies on it.
  const author = agentById("implementer");
  assert.ok(author, "the implementation stage needs a registered author");
  assert.equal(author.role, "author");
  assert.equal(author.specialty, null);
  assert.ok(author.outputs.includes("patches"), "the implementer must allow patches output");
  for (const forbidden of ["spec", "plan", "plan-revision", "findings"]) {
    assert.ok(!author.outputs.includes(forbidden), `the implementer must not allow ${forbidden} output`);
  }
  // The implementer is an author, and selectReviewers filters to role
  // "reviewer" — patch output can never enter a review panel. Assert the
  // seed directly rather than through the filter, so a reviewer definition
  // that gained patches output is caught at the registry.
  for (const agent of AGENTS.filter((a) => a.role === "reviewer")) {
    assert.ok(!agent.outputs.includes("patches"), `${agent.id} must not allow patches output`);
  }
  // Hazard 11: a default installation must be able to complete a run. The
  // seeded registry staffs an implementation dispatch — an author whose
  // outputs include patches.
  assert.ok(
    AGENTS.some((a) => a.role === "author" && a.outputs.includes("patches")),
    "the seed must staff an implementation dispatch"
  );
});

test("each author allows its own self-critique output and never the other's", () => {
  // Section 9 again: the dispatcher derives the required output from the
  // performer, so the self-critique phase has to be a capability the author
  // definition carries. Without it the stage would be asking an agent for a
  // result kind its definition never allowed.
  const specAuthor = agentById("spec-author")!;
  const planAuthor = agentById("plan-author")!;
  assert.ok(specAuthor.outputs.includes("spec-self-critique"), "the spec author critiques its own spec");
  assert.ok(planAuthor.outputs.includes("plan-self-critique"), "the plan author critiques its own plan");
  assert.ok(
    !specAuthor.outputs.includes("plan-self-critique"),
    "the spec author must not be able to self-critique a plan"
  );
  assert.ok(
    !planAuthor.outputs.includes("spec-self-critique"),
    "the plan author must not be able to self-critique a spec"
  );
});

test("no reviewer can produce either self-critique result kind", () => {
  // Hazard 14: self-critique is an author dispatch. A reviewer that could
  // return one would be a panel seat producing the artifact's own defence,
  // which is the independence claim collapsing quietly.
  for (const agent of AGENTS.filter((a) => a.role === "reviewer")) {
    for (const forbidden of ["spec-self-critique", "plan-self-critique"]) {
      assert.ok(!agent.outputs.includes(forbidden), `${agent.id} must not allow ${forbidden} output`);
    }
  }
});
