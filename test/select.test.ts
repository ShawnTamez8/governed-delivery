import { AGENTS } from "../src/agents.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRisk, selectReviewers, staffingShortfall } from "../src/select.ts";
import { PANEL_SIZE_FLOOR, REQUIRED_SPECIALTIES } from "../src/policy.ts";
import { CLAUDE_CODE } from "../src/executor.ts";

/** Reviewers only, mirroring what `selectReviewers` considers a candidate. */
const REVIEWERS = AGENTS.filter((a) => a.role === "reviewer" && a.outputs.includes("findings"));

test("computeRisk score boundaries", () => {
  assert.equal(computeRisk("feature", 2, false), "low");
  assert.equal(computeRisk("defect_fix", 2, false), "standard");
  assert.equal(computeRisk("feature", 11, false), "standard");
  assert.equal(computeRisk("defect_fix", 11, true), "high");
});

test("a panel of the frozen floor returns two reviewers, traceability first", () => {
  const panel = selectReviewers(AGENTS, PANEL_SIZE_FLOOR, ["requirements-traceability"]);
  assert.equal(panel.length, 2);
  assert.equal(panel[0].id, "spec-reviewer-traceability");
  assert.ok(panel.every((a) => a.role === "reviewer"));
});

test("the size is what sizes the panel — risk no longer does", () => {
  for (const size of [1, 2, 3]) {
    const panel = selectReviewers(AGENTS, size, ["requirements-traceability"]);
    assert.equal(panel.length, size, `size ${size} must staff ${size}`);
    assert.equal(panel[0].id, "spec-reviewer-traceability");
  }
});

test("a size beyond the registry returns what it has rather than inventing a seat", () => {
  // The caller refuses a short panel by name; the selector's job is to be a
  // pure function, not to decide policy.
  const panel = selectReviewers(AGENTS, REVIEWERS.length + 5, ["requirements-traceability"]);
  assert.equal(panel.length, REVIEWERS.length);
});

test("the author never appears in any panel", () => {
  for (const size of [1, 2, 3]) {
    const panel = selectReviewers(AGENTS, size, ["requirements-traceability"]);
    assert.ok(!panel.some((a) => a.id === "spec-author"), `author leaked into a panel of ${size}`);
  }
});

test("the selector never seats the same specialty twice", () => {
  const consistency = REVIEWERS.find((agent) => agent.specialty === "consistency")!;
  const duplicateLens = {
    ...consistency,
    id: "aaa-consistency-duplicate",
  };
  const panel = selectReviewers(
    [...AGENTS, duplicateLens],
    3,
    ["requirements-traceability"]
  );
  assert.equal(panel.length, 3);
  assert.equal(new Set(panel.map((agent) => agent.specialty)).size, 3);
});

test("the default registry staffs the configured panel", () => {
  assert.equal(
    staffingShortfall(AGENTS, PANEL_SIZE_FLOOR, REQUIRED_SPECIALTIES, CLAUDE_CODE.id),
    null
  );
});

test("a panel larger than the registry's distinct specialties is refused by name", () => {
  const reason = staffingShortfall(
    AGENTS,
    REVIEWERS.length + 1,
    REQUIRED_SPECIALTIES,
    CLAUDE_CODE.id
  );
  assert.match(String(reason), /distinct reviewer specialties/);
  assert.match(String(reason), new RegExp(`cannot fill a panel of ${REVIEWERS.length + 1}`));
});

test("a required specialty no reviewer holds is refused, naming the specialty", () => {
  const reason = staffingShortfall(AGENTS, 2, ["data-privacy"], CLAUDE_CODE.id);
  assert.match(String(reason), /no reviewer for required specialty data-privacy/);
});

test("two reviewers sharing a specialty count as one seat, not two", () => {
  // Independence is a claim about lenses. A registry of three reviewers all
  // holding the same specialty cannot staff a panel of two.
  const cloned = REVIEWERS.map((a) => ({ ...a, specialty: "requirements-traceability" }));
  const reason = staffingShortfall(
    cloned,
    2,
    ["requirements-traceability"],
    CLAUDE_CODE.id
  );
  assert.match(String(reason), /seats 1 distinct reviewer specialty/);
});

test("required specialties cannot consume more seats than the panel has", () => {
  const reason = staffingShortfall(
    AGENTS,
    2,
    ["requirements-traceability", "security", "consistency"],
    CLAUDE_CODE.id
  );
  assert.match(String(reason), /3 required specialties cannot fit in a panel of 2/);
});

test("a reviewer on another executor cannot satisfy the staffing preflight", () => {
  const wrongExecutor = AGENTS.map((agent) =>
    agent.specialty === "requirements-traceability"
      ? { ...agent, executor: "another-executor" }
      : agent
  );
  const reason = staffingShortfall(
    wrongExecutor,
    2,
    ["requirements-traceability"],
    CLAUDE_CODE.id
  );
  assert.match(String(reason), /no reviewer for required specialty requirements-traceability/);
});

test("duplicate eligible reviewer ids are refused before selection can collapse them", () => {
  const duplicate = { ...REVIEWERS[0]!, specialty: "database" };
  const reason = staffingShortfall(
    [...AGENTS, duplicate],
    2,
    REQUIRED_SPECIALTIES,
    CLAUDE_CODE.id
  );
  assert.match(String(reason), /duplicate agent ids/);
  assert.match(String(reason), new RegExp(duplicate.id));
});
