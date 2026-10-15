import { test } from "node:test";
import assert from "node:assert/strict";
import {
  critiqueAuditEntries,
  SELF_REVIEW_AUDIT_ENTRY_CHARS,
  SELF_REVIEW_AUDIT_MAX_ENTRIES,
  SELF_REVIEW_RESULT_SCHEMA,
  validateImplementationSelfReview,
} from "../src/implementation-self-review.ts";
import { PATCH_RESULT_SCHEMA } from "../src/agent-result.ts";

// docs/features/implementation-self-review/plan.md, Task 6. The prompt's own
// advertised example is checked against this validator in test/prompts.test.ts.

test("the advertised self-review shape validates, and unknown fields are ignored", () => {
  const result = validateImplementationSelfReview({ critique: ["..."], extra: true });
  assert.ok(result.ok, result.ok ? "" : result.reason);
  assert.deepEqual(result.value, { critique: ["..."] });
});

test("each malformed self-review is refused by name", () => {
  const cases: [unknown, string][] = [
    [null, "self-review must be an object"],
    [["critique"], "self-review must be an object"],
    ["critique", "self-review must be an object"],
    [{}, "self-review has no critique"],
    [{ critique: "checked everything" }, "self-review critique must be an array"],
    [{ critique: [] }, "self-review critique must not be empty: say what was checked when nothing was found"],
    [{ critique: ["checked", ""] }, "every self-review critique entry must be a non-empty string"],
    [{ critique: ["  "] }, "every self-review critique entry must be a non-empty string"],
    [{ critique: [7] }, "every self-review critique entry must be a non-empty string"],
  ];
  for (const [raw, reason] of cases) {
    const result = validateImplementationSelfReview(raw);
    assert.equal(result.ok, false, JSON.stringify(raw));
    if (!result.ok) assert.equal(result.reason, reason, JSON.stringify(raw));
  }
});

test("an entry of exactly the limit is kept whole, and one character more is cut with its full length named", () => {
  assert.equal(SELF_REVIEW_AUDIT_ENTRY_CHARS, 2000);
  const exact = "a".repeat(2000);
  const over = "b".repeat(2001);
  const [kept, cut] = critiqueAuditEntries([exact, over]);
  assert.equal(kept, exact);
  assert.equal(cut, `${"b".repeat(2000)} (cut at 2000 of 2001 characters)`);
});

test("51 entries record 50, in critique order", () => {
  assert.equal(SELF_REVIEW_AUDIT_MAX_ENTRIES, 50);
  const critique = Array.from({ length: 51 }, (_, index) => `entry ${index + 1}`);
  const recorded = critiqueAuditEntries(critique);
  assert.equal(recorded.length, 50);
  assert.deepEqual(recorded, critique.slice(0, 50));
});

// docs/features/structured-patch-output/plan.md, Task 2: the schema the
// self-review dispatch sends with --json-schema.

test("the self-review schema keeps every patch-schema property and adds the required critique", () => {
  const { proposedContentChanges, ...patchProperties } = SELF_REVIEW_RESULT_SCHEMA.properties;
  assert.deepEqual(patchProperties, PATCH_RESULT_SCHEMA.properties);
  assert.deepEqual(SELF_REVIEW_RESULT_SCHEMA.required, [...PATCH_RESULT_SCHEMA.required, "proposedContentChanges"]);
  assert.equal(SELF_REVIEW_RESULT_SCHEMA.additionalProperties, false);
  assert.deepEqual(proposedContentChanges.required, ["selfReview"]);
  assert.deepEqual(proposedContentChanges.properties.selfReview.required, ["critique"]);
});

test("the schema's critique bounds forbid what the validator refuses", () => {
  const critique = SELF_REVIEW_RESULT_SCHEMA.properties.proposedContentChanges.properties.selfReview.properties.critique;
  // An empty critique: the validator refuses it and minItems forbids it.
  assert.equal(validateImplementationSelfReview({ critique: [] }).ok, false);
  assert.equal(critique.minItems, 1);
  // An empty entry: the validator refuses it and minLength forbids it.
  assert.equal(validateImplementationSelfReview({ critique: [""] }).ok, false);
  assert.deepEqual(critique.items, { type: "string", minLength: 1 });
  // The smallest critique both allow.
  assert.ok(validateImplementationSelfReview({ critique: ["x"] }).ok);
});
