import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCodeReviewReproductions } from "../src/code-review.ts";
import { upstreamPrefixFor, validateReviewerReports, type ReviewerReport } from "../src/reconciliation.ts";

/**
 * docs/features/reproduced-review-findings/plan.md, Task 3: a reviewer's
 * reproductions are checked in their own member, against the reply's own
 * findings, with every bound the reply schema states checked again.
 */

const IMPORT = "const { test, expect } = await import(process.env.BW_PLAYWRIGHT_TEST);";

/** The reply's findings, validated as the stage validates them. */
function reports(): ReviewerReport[] {
  const checked = validateReviewerReports(
    [
      { severity: "high", classification: "current_artifact", location: "js/app.js:42", intentKey: "enter-activates-focused-control", subject: "Enter on the focused theme toggle runs equals." },
      { severity: "medium", classification: "current_artifact", location: "css/style.css", intentKey: "narrow-overflow", subject: "The keypad overflows at 320 pixels." },
    ],
    { agentId: "code-reviewer-correctness", upstreamPrefix: upstreamPrefixFor("plan") }
  );
  assert.ok(checked.ok, checked.ok ? "" : checked.reason);
  return checked.value;
}

function reproduction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intentKey: "enter-activates-focused-control",
    location: "js/app.js:42",
    fileName: "enter-on-toggle.spec.mjs",
    content: `${IMPORT}\n`,
    ...overrides,
  };
}

function refused(raw: unknown): string {
  const result = validateCodeReviewReproductions(raw, reports());
  assert.equal(result.ok, false, JSON.stringify(result));
  return result.ok ? "" : result.reason;
}

test("a valid reproduction is accepted, naming its finding by intentKey and normalized location", () => {
  const result = validateCodeReviewReproductions([reproduction({ location: "js/app.js:42" })], reports());
  assert.deepEqual(result, {
    ok: true,
    value: [{ intentKey: "enter-activates-focused-control", location: "js/app.js:42", fileName: "enter-on-toggle.spec.mjs", content: `${IMPORT}\n` }],
  });
  const two = validateCodeReviewReproductions(
    [reproduction(), reproduction({ intentKey: "narrow-overflow", location: "css/style.css", fileName: "narrow.spec.mjs" })],
    reports()
  );
  assert.ok(two.ok && two.value.length === 2);
});

test("a reply without reproductions gives an empty list", () => {
  assert.deepEqual(validateCodeReviewReproductions(undefined, reports()), { ok: true, value: [] });
  assert.deepEqual(validateCodeReviewReproductions([], reports()), { ok: true, value: [] });
});

test("a reproduction naming no finding of the reply is refused", () => {
  assert.equal(refused([reproduction({ intentKey: "some-other-concern" })]), "reproduction enter-on-toggle.spec.mjs names no finding of this reply: some-other-concern::js/app.js:42");
  assert.match(refused([reproduction({ location: "js/app.js:43" })]), /names no finding of this reply: enter-activates-focused-control::js\/app\.js:43$/);
});

test("two reproductions for one finding are refused", () => {
  assert.equal(
    refused([reproduction(), reproduction({ fileName: "second.spec.mjs" })]),
    "the reply attaches two reproductions to one finding: enter-activates-focused-control::js/app.js:42"
  );
});

test("a file name outside REPRODUCTION_FILE_NAME, or used twice, is refused", () => {
  assert.match(refused([reproduction({ fileName: "enter-on-toggle.test.mjs" })]), /^reproduction file name "enter-on-toggle\.test\.mjs" does not match /);
  for (const name of ["Enter.spec.mjs", "-enter.spec.mjs", "a/b.spec.mjs", "../x.spec.mjs", `${"a".repeat(65)}.spec.mjs`, ""]) {
    assert.match(refused([reproduction({ fileName: name })]), /does not match/, name);
  }
  assert.equal(
    refused([reproduction(), reproduction({ intentKey: "narrow-overflow", location: "css/style.css" })]),
    "reproduction file name enter-on-toggle.spec.mjs is used twice in the reply"
  );
});

test("content of 65,537 characters is refused, and 65,536 is accepted", () => {
  assert.equal(
    refused([reproduction({ content: "x".repeat(65_537) })]),
    "reproduction enter-on-toggle.spec.mjs content must be a string of at most 65536 characters, not 65537"
  );
  assert.ok(validateCodeReviewReproductions([reproduction({ content: "x".repeat(65_536) })], reports()).ok);
});

test("content length is counted in code points, as the schema's maxLength counts it", () => {
  // JSON Schema 2020-12 validation, section 6.3.1: a string's length is its
  // number of characters, as RFC 8259 defines them. U+1F319 is one character
  // and two UTF-16 code units.
  const moon = "\u{1F319}";
  assert.equal(moon.length, 2);
  assert.ok(validateCodeReviewReproductions([reproduction({ content: moon.repeat(65_536) })], reports()).ok);
  assert.equal(
    refused([reproduction({ content: moon.repeat(65_537) })]),
    "reproduction enter-on-toggle.spec.mjs content must be a string of at most 65536 characters, not 65537"
  );
});

test("six entries are refused", () => {
  assert.equal(refused(Array.from({ length: 6 }, () => reproduction())), "the reply carries 6 reproductions; at most 5 are allowed");
});

test("a malformed member or entry is refused by name", () => {
  assert.equal(refused("none"), "proposedContentChanges.reproductions is not an array");
  assert.equal(refused([null]), "a reproduction entry is not an object");
  assert.match(refused([reproduction({ command: "npm test" })]), /^a reproduction carries an unknown field command: /);
  assert.equal(refused([reproduction({ intentKey: 7 })]), "a reproduction's intentKey and location must be strings");
});

test("the shared reviewer validator still refuses an unknown finding field, reproductions included", () => {
  const result = validateReviewerReports(
    [{ severity: "high", classification: "current_artifact", location: "js/app.js", intentKey: "k", subject: "s", reproduction: "x" }],
    { agentId: "code-reviewer-correctness", upstreamPrefix: upstreamPrefixFor("plan") }
  );
  assert.deepEqual(result, {
    ok: false,
    reason: "reviewer code-reviewer-correctness finding carries an unknown field reproduction: allowed fields are severity, classification, location, intentKey, subject",
  });
});
