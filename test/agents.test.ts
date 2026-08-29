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
