import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSelfCritique } from "../src/self-critique.ts";

/**
 * A well-formed payload, in the shape the Task 1 prototype's two real
 * self-critique dispatches returned: several critique entries, a complete
 * revised artifact, and a panel request carrying an integer and a unique
 * specialty list. Every refusal below is this object with one thing wrong,
 * so what is under test is the field, not the fixture.
 */
function valid(): Record<string, unknown> {
  return {
    critique: [
      "the acceptance criterion does not say how it is observed",
      "the declared artifacts omit the migration",
    ],
    artifact: "feature: demo\nchange_kind: feature\n\n## Declared artifacts\n\n- src/a.ts\n",
    panelRequest: { size: 2, specialties: ["security"] },
  };
}

test("a complete self-critique validates and carries its fields through", () => {
  const result = validateSelfCritique(valid());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.critique.length, 2);
  assert.equal(result.value.panelRequest.size, 2);
  assert.deepEqual(result.value.panelRequest.specialties, ["security"]);
});

test("a panel request naming no extra lens is a request, not a refusal", () => {
  // The configured required specialties still consume seats. An author that
  // wants nothing beyond them has proposed a panel, and refusing that would
  // be an obligation the design does not state.
  const result = validateSelfCritique({ ...valid(), panelRequest: { size: 2, specialties: [] } });
  assert.equal(result.ok, true);
});

test("a non-object self-critique is refused by name", () => {
  for (const raw of [undefined, null, "text", 3, []]) {
    const result = validateSelfCritique(raw);
    assert.equal(result.ok, false, `${JSON.stringify(raw)} must not validate`);
    if (result.ok) return;
    assert.match(result.reason, /self-critique must be an object/);
  }
});

test("a missing or empty critique is refused, never treated as nothing to say", () => {
  for (const critique of [undefined, [], "one long string"]) {
    const result = validateSelfCritique({ ...valid(), critique });
    assert.equal(result.ok, false, `${JSON.stringify(critique)} must not validate`);
    if (result.ok) return;
    assert.match(result.reason, /critique must be a non-empty array/);
  }
});

test("a critique entry that is not a non-empty string is refused", () => {
  for (const entry of ["", "   ", null, 7, {}]) {
    const result = validateSelfCritique({ ...valid(), critique: ["a real finding", entry] });
    assert.equal(result.ok, false, `${JSON.stringify(entry)} must not validate`);
    if (result.ok) return;
    assert.match(result.reason, /critique entry must be a non-empty string/);
  }
});

test("a missing or empty artifact is refused rather than falling back to the draft", () => {
  for (const artifact of [undefined, "", "   ", null, 42, { spec: "x" }]) {
    const result = validateSelfCritique({ ...valid(), artifact });
    assert.equal(result.ok, false, `${JSON.stringify(artifact)} must not validate`);
    if (result.ok) return;
    assert.match(result.reason, /artifact must be the full revised document/);
  }
});

test("an absent panel request is refused", () => {
  for (const panelRequest of [undefined, null, "two", []]) {
    const result = validateSelfCritique({ ...valid(), panelRequest });
    assert.equal(result.ok, false, `${JSON.stringify(panelRequest)} must not validate`);
    if (result.ok) return;
    assert.match(result.reason, /panelRequest must be an object/);
  }
});

test("a panel size that is not a positive integer is refused, naming what was returned", () => {
  for (const size of [undefined, 0, -1, 2.5, "2", null, NaN]) {
    const result = validateSelfCritique({ ...valid(), panelRequest: { size, specialties: [] } });
    assert.equal(result.ok, false, `${JSON.stringify(size)} must not validate`);
    if (result.ok) return;
    assert.match(result.reason, /panelRequest size .* is not a positive integer/);
  }
});

test("a specialties list that is not an array of non-empty strings is refused", () => {
  const notArray = validateSelfCritique({ ...valid(), panelRequest: { size: 2, specialties: "security" } });
  assert.equal(notArray.ok, false);
  if (notArray.ok) return;
  assert.match(notArray.reason, /panelRequest specialties must be an array/);

  for (const entry of ["", "  ", null, 3, ["security"]]) {
    const result = validateSelfCritique({ ...valid(), panelRequest: { size: 2, specialties: [entry] } });
    assert.equal(result.ok, false, `${JSON.stringify(entry)} must not validate`);
    if (result.ok) return;
    assert.match(result.reason, /panelRequest specialty must be a non-empty string/);
  }
});

test("duplicate specialties are refused and named", () => {
  const result = validateSelfCritique({
    ...valid(),
    panelRequest: { size: 3, specialties: ["security", "consistency", "security"] },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /specialties contain duplicates: security/);
});

test("two spellings of one specialty are two requests, and the second is not a duplicate", () => {
  // Nothing normalizes a model value here. `Security` and `security` are
  // different strings, so this is a request for two lenses — one of which the
  // registry cannot seat, which is the staffing refusal's question (Task 5),
  // not this validator's.
  const result = validateSelfCritique({
    ...valid(),
    panelRequest: { size: 2, specialties: ["security", "Security"] },
  });
  assert.equal(result.ok, true);
});

test("more specialties than seats is refused, naming both counts", () => {
  const result = validateSelfCritique({
    ...valid(),
    panelRequest: { size: 2, specialties: ["security", "consistency", "requirements-traceability"] },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /asks for 3 specialties in a panel of 2/);
});

test("the frozen policy bounds are not this validator's question", () => {
  // A size of five is structurally valid and may still be refused against the
  // run's frozen `panelSizeMax` where selection happens (step 5b Task 5).
  // Checking a live constant here would be the frozen-policy defect the
  // previous task corrected: one value, two enforcers, no shared source.
  const result = validateSelfCritique({
    ...valid(),
    panelRequest: { size: 5, specialties: ["security"] },
  });
  assert.equal(result.ok, true);
});
