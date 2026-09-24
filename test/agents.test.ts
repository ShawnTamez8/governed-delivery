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

test("the seeded reviewers can staff the code-review panel", () => {
  // Hazard 11, the code-review sibling of "the seeded reviewers can staff a
  // standard-risk plan panel": the fixed panel is every registered code
  // reviewer, so a default installation that seats fewer than two lenses
  // cannot complete a run at all.
  const codeReviewers = AGENTS.filter(
    (a) => a.role === "reviewer" && a.outputs.includes("code-findings")
  );
  assert.ok(codeReviewers.length >= 3, "the default code-review panel seats three lenses");
  const specialties = new Set<string>();
  for (const agent of codeReviewers) {
    assert.deepEqual(
      agent.outputs,
      ["code-findings"],
      `${agent.id} must produce code findings and nothing else`
    );
    assert.equal(agent.executor, "claude-code", `${agent.id} must be bound to the frozen executor`);
    assert.notEqual(agent.specialty, null, `${agent.id} must carry a lens`);
    assert.equal(typeof agent.codeReviewInstructions, "string");
    assert.ok(agent.codeReviewInstructions!.trim().length > 0, `${agent.id} must carry instructions`);
    assert.ok(!specialties.has(agent.specialty!), `${agent.id} repeats the lens ${agent.specialty}`);
    specialties.add(agent.specialty!);
  }
});

test("only code reviewers carry code-review instructions, and the seeded lenses differ", () => {
  const codeReviewers = AGENTS.filter((a) => a.outputs.includes("code-findings"));
  assert.deepEqual(
    codeReviewers.map((a) => a.specialty).sort(),
    ["correctness", "resilience", "security"]
  );
  assert.equal(new Set(codeReviewers.map((a) => a.codeReviewInstructions)).size, 3);
  const resilience = codeReviewers.find((a) => a.specialty === "resilience")!;
  for (const required of ["idempotency", "transaction", "recovery", "safe degradation"]) {
    assert.ok(resilience.codeReviewInstructions!.includes(required), `resilience instructions omit ${required}`);
  }
  for (const excluded of ["missing tests", "style", "injection", "ordinary functional-result defects"]) {
    assert.ok(resilience.codeReviewInstructions!.includes(excluded), `resilience instructions omit the ${excluded} exclusion`);
  }
  for (const agent of AGENTS.filter((a) => !a.outputs.includes("code-findings"))) {
    assert.equal(
      agent.codeReviewInstructions,
      undefined,
      `${agent.id} must not carry code-review instructions`
    );
  }
});

test("no author allows code-findings output", () => {
  // Section 9: the dispatcher derives the required output from the performer,
  // so an author that could return code findings would be the implementer
  // reviewing its own patch.
  for (const agent of AGENTS.filter((a) => a.role === "author")) {
    assert.ok(
      !agent.outputs.includes("code-findings"),
      `${agent.id} must not allow code-findings output`
    );
  }
});

test("the two review output kinds are disjoint across the registry", () => {
  // The output kind is what partitions the two reviewer registries:
  // `findings` seats a spec or plan panel, `code-findings` seats the
  // code-review panel. An agent carrying both would be eligible for both,
  // which is the item-4 specialist drift this stage defers arriving by
  // accident rather than by decision.
  for (const agent of AGENTS) {
    assert.ok(
      !(agent.outputs.includes("findings") && agent.outputs.includes("code-findings")),
      `${agent.id} must not be eligible for both review panels`
    );
  }
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
  for (const forbidden of ["spec", "plan", "plan-revision", "findings", "code-findings"]) {
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

test("each author allows its own reconciliation output and never the other's", () => {
  // Section 9 again, on the other new result kind: reconciliation is the
  // author's answer phase, so the dispatcher must find the capability on the
  // author definition that produces it — and an author that reconciles both
  // artifacts would be one capability crossing the artifact boundary.
  const specAuthor = agentById("spec-author")!;
  const planAuthor = agentById("plan-author")!;
  assert.ok(specAuthor.outputs.includes("spec-reconciliation"), "the spec author reconciles its spec");
  assert.ok(planAuthor.outputs.includes("plan-reconciliation"), "the plan author reconciles its plan");
  assert.ok(
    !specAuthor.outputs.includes("plan-reconciliation"),
    "the spec author must not be able to reconcile a plan"
  );
  assert.ok(
    !planAuthor.outputs.includes("spec-reconciliation"),
    "the plan author must not be able to reconcile a spec"
  );
});

test("no reviewer can produce either reconciliation result kind", () => {
  // The same boundary as self-critique: reconciliation is an author dispatch,
  // and a reviewer that could return one would be a panel seat answering its
  // own findings, which is section 13's "nothing resolves its own finding"
  // collapsed quietly.
  for (const agent of AGENTS.filter((a) => a.role === "reviewer")) {
    for (const forbidden of ["spec-reconciliation", "plan-reconciliation"]) {
      assert.ok(!agent.outputs.includes(forbidden), `${agent.id} must not allow ${forbidden} output`);
    }
  }
});
