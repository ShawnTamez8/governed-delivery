import { AGENTS } from "../src/agents.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRisk,
  selectReviewers,
  staffingShortfall,
  validatePanelRequest,
} from "../src/select.ts";
import { PANEL_SIZE_FLOOR, PANEL_SIZE_MAX, REQUIRED_SPECIALTIES } from "../src/policy.ts";
import type { PanelRequest } from "../src/self-critique.ts";
import { CLAUDE_CODE } from "../src/executor.ts";

/** Reviewers only, mirroring what `selectReviewers` considers a candidate. */
const REVIEWERS = AGENTS.filter((a) => a.role === "reviewer" && a.outputs.includes("findings"));

/**
 * The two specialists the default registry does not hold. The plan's Task 5
 * states the case they exist for: "A request for both SQL and UI is
 * over-capacity at size two; at size three it succeeds only when both
 * specialist definitions are in the frozen registry."
 */
const SQL_REVIEWER = { ...REVIEWERS[0]!, id: "spec-reviewer-sql", specialty: "sql" };
const UI_REVIEWER = { ...REVIEWERS[0]!, id: "spec-reviewer-ui", specialty: "ui" };

/** The request shape as a model returns it, for the malformed cases. */
function request(raw: unknown): PanelRequest {
  return raw as PanelRequest;
}

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

// --- the author's requested lenses ------------------------------------------

test("a requested lens is seated ahead of the ranked fill", () => {
  // Without the requested pass the ranked fill takes `consistency` first (it
  // sorts before `security` by id), so this fails if the request is accepted
  // and then ignored — which is exactly what the stages did before Task 5.
  const panel = selectReviewers(AGENTS, 2, [], ["security"]);
  assert.equal(panel.length, 2);
  assert.equal(panel[0].specialty, "security", "the requested lens takes the first free seat");
  assert.equal(new Set(panel.map((a) => a.specialty)).size, 2);
});

test("required lenses fill before requested ones", () => {
  const panel = selectReviewers(AGENTS, 2, ["requirements-traceability"], ["security"]);
  assert.deepEqual(
    panel.map((a) => a.id),
    ["spec-reviewer-traceability", "spec-reviewer-security"]
  );
});

test("a requested lens that is also required consumes one seat, not two", () => {
  const panel = selectReviewers(
    AGENTS,
    2,
    ["requirements-traceability"],
    ["requirements-traceability"]
  );
  assert.equal(panel.length, 2);
  assert.equal(panel[0].id, "spec-reviewer-traceability");
  assert.equal(new Set(panel.map((a) => a.specialty)).size, 2, "distinct lenses, not one twice");
});

test("the author's list order never changes which reviewers are seated", () => {
  // Step 6 of Task 5: the author proposes lenses and never identities. Two
  // requests naming the same set in a different order are the same request,
  // so the panel is compared as an ordered list — a weaker set comparison
  // would pass even if the author's ordering leaked into the seating.
  const forward = selectReviewers(AGENTS, 3, ["requirements-traceability"], [
    "security",
    "consistency",
  ]);
  const reverse = selectReviewers(AGENTS, 3, ["requirements-traceability"], [
    "consistency",
    "security",
  ]);
  assert.deepEqual(forward.map((a) => a.id), reverse.map((a) => a.id));
  assert.equal(forward.length, 3);
});

test("an unstaffable requested lens is not silently replaced by another", () => {
  // The selector is pure and fills the seat; `staffingShortfall` is what
  // refuses. This records that division: the panel comes back the right size
  // with the wrong composition, which is why the stage must ask the other
  // function first.
  const panel = selectReviewers(AGENTS, 2, ["requirements-traceability"], ["sql"]);
  assert.equal(panel.length, 2);
  assert.ok(!panel.some((a) => a.specialty === "sql"), "no reviewer holds the requested lens");
  assert.equal(
    staffingShortfall(AGENTS, 2, ["requirements-traceability"], ["sql"], CLAUDE_CODE.id),
    "the agent registry has no reviewer for requested specialty sql; a panel of 2 was asked to seat requirements-traceability, sql and the registry seats consistency, requirements-traceability, security"
  );
});

// --- the panel request against the frozen policy -----------------------------

test("a request inside the frozen bounds is returned as it was made", () => {
  const result = validatePanelRequest(
    { size: 2, specialties: ["security"] },
    PANEL_SIZE_FLOOR,
    PANEL_SIZE_MAX,
    REQUIRED_SPECIALTIES
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, { size: 2, specialties: ["security"] });
});

test("a size outside the frozen bounds is refused by name at either end", () => {
  for (const size of [1, 3]) {
    const result = validatePanelRequest(
      request({ size, specialties: [] }),
      2,
      2,
      []
    );
    assert.equal(result.ok, false, `size ${size} must not be accepted`);
    if (result.ok) return;
    assert.equal(result.reason, `panel request size ${size} is outside the frozen bounds 2-2`);
  }
});

test("nothing clamps a request to the nearest legal size", () => {
  // The refusal is the whole point: a panel the author did not ask for is not
  // the author's proposal, so an out-of-range size can never come back as a
  // legal one.
  const result = validatePanelRequest(request({ size: 9, specialties: [] }), 2, 5, []);
  assert.equal(result.ok, false);
});

test("a non-integer size is refused before any bound is applied", () => {
  for (const size of [2.5, "2", null, undefined]) {
    const result = validatePanelRequest(request({ size, specialties: [] }), 2, 5, []);
    assert.equal(result.ok, false, `size ${JSON.stringify(size)} must not be accepted`);
    if (result.ok) return;
    assert.match(result.reason, /is not an integer/);
  }
});

test("the structural rules are re-checked here, not assumed from the shape validator", () => {
  // A tolerance applied at one boundary and not its sibling is how a malformed
  // value reaches a consumer that trusted the other end to have caught it.
  const notAnArray = validatePanelRequest(request({ size: 2, specialties: "security" }), 2, 5, []);
  assert.equal(notAnArray.ok, false);
  if (notAnArray.ok) return;
  assert.match(notAnArray.reason, /specialties must be an array/);

  const blank = validatePanelRequest(request({ size: 2, specialties: ["  "] }), 2, 5, []);
  assert.equal(blank.ok, false);
  if (blank.ok) return;
  assert.match(blank.reason, /is not a non-empty string/);

  const duplicated = validatePanelRequest(
    request({ size: 3, specialties: ["security", "security"] }),
    2,
    5,
    []
  );
  assert.equal(duplicated.ok, false);
  if (duplicated.ok) return;
  assert.match(duplicated.reason, /specialties contain duplicates: security/);
});

test("required specialties consume seats inside the requested size", () => {
  // The plan's stated consequence: with size two and requirements-traceability
  // required, the author may request at most one additional specialty.
  const oneMore = validatePanelRequest(
    { size: 2, specialties: ["security"] },
    2,
    2,
    ["requirements-traceability"]
  );
  assert.equal(oneMore.ok, true, "one further lens fits");

  const twoMore = validatePanelRequest(
    { size: 2, specialties: ["sql", "ui"] },
    2,
    2,
    ["requirements-traceability"]
  );
  assert.equal(twoMore.ok, false, "two further lenses do not");
  if (twoMore.ok) return;
  assert.equal(
    twoMore.reason,
    "panel request of 2 cannot seat the 3 required and requested specialties: requirements-traceability, sql, ui"
  );
});

test("SQL plus UI needs three seats and two registered specialists", () => {
  const required = ["requirements-traceability"];
  const requested = ["sql", "ui"];

  // At the default size it is over capacity before the registry is consulted.
  assert.equal(
    validatePanelRequest({ size: PANEL_SIZE_FLOOR, specialties: requested }, 2, 5, required).ok,
    false
  );

  // At size three the seats fit, and the default registry still cannot staff it.
  assert.equal(validatePanelRequest({ size: 3, specialties: requested }, 2, 5, required).ok, true);
  const missing = staffingShortfall(AGENTS, 3, required, requested, CLAUDE_CODE.id);
  assert.match(String(missing), /no reviewer for requested specialties sql, ui/);
  assert.match(String(missing), /a panel of 3 was asked to seat/);
  assert.match(String(missing), /the registry seats consistency, requirements-traceability, security/);

  // With both specialists registered it staffs, one seat per lens.
  const enlarged = [...AGENTS, SQL_REVIEWER, UI_REVIEWER];
  assert.equal(staffingShortfall(enlarged, 3, required, requested, CLAUDE_CODE.id), null);
  const panel = selectReviewers(enlarged, 3, required, requested);
  assert.deepEqual(
    panel.map((a) => a.specialty),
    ["requirements-traceability", "sql", "ui"]
  );
});

// --- staffing ----------------------------------------------------------------

test("the default registry staffs the configured panel", () => {
  assert.equal(
    staffingShortfall(AGENTS, PANEL_SIZE_FLOOR, REQUIRED_SPECIALTIES, [], CLAUDE_CODE.id),
    null
  );
});

test("a panel larger than the registry's distinct specialties is refused by name", () => {
  const reason = staffingShortfall(
    AGENTS,
    REVIEWERS.length + 1,
    REQUIRED_SPECIALTIES,
    [],
    CLAUDE_CODE.id
  );
  assert.match(String(reason), /distinct reviewer specialties/);
  assert.match(String(reason), new RegExp(`cannot fill a panel of ${REVIEWERS.length + 1}`));
});

test("a required specialty no reviewer holds is refused, naming the specialty", () => {
  const reason = staffingShortfall(AGENTS, 2, ["data-privacy"], [], CLAUDE_CODE.id);
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
    [],
    CLAUDE_CODE.id
  );
  assert.match(String(reason), /seats 1 distinct reviewer specialty/);
});

test("required specialties cannot consume more seats than the panel has", () => {
  const reason = staffingShortfall(
    AGENTS,
    2,
    ["requirements-traceability", "security", "consistency"],
    [],
    CLAUDE_CODE.id
  );
  assert.match(String(reason), /3 required specialties cannot fit in a panel of 2/);
});

test("the union of required and requested is refused as a union, not as a configuration defect", () => {
  // The configured lenses fit on their own; it is the request on top of them
  // that does not. Reporting this as "3 required specialties" would name the
  // wrong cause.
  const reason = staffingShortfall(
    AGENTS,
    2,
    ["requirements-traceability"],
    ["security", "consistency"],
    CLAUDE_CODE.id
  );
  assert.equal(
    reason,
    "a panel of 2 cannot seat the 3 required and requested specialties: consistency, requirements-traceability, security"
  );
});

test("duplicate requested specialties are refused at the staffing boundary too", () => {
  const reason = staffingShortfall(
    AGENTS,
    3,
    ["requirements-traceability"],
    ["security", "security"],
    CLAUDE_CODE.id
  );
  assert.match(String(reason), /requested specialties contain duplicates: security/);
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
    [],
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
    [],
    CLAUDE_CODE.id
  );
  assert.match(String(reason), /duplicate agent ids/);
  assert.match(String(reason), new RegExp(duplicate.id));
});
