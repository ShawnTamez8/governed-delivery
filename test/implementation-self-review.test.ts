import { test } from "node:test";
import assert from "node:assert/strict";
import {
  critiqueAuditEntries,
  SELF_REVIEW_AUDIT_ENTRY_CHARS,
  SELF_REVIEW_AUDIT_MAX_ENTRIES,
  SELF_REVIEW_REPLY_SCHEMA,
  validateImplementationSelfReview,
  validateSelfReviewReply,
} from "../src/implementation-self-review.ts";
import { WORKSPACE_REPLY_SCHEMA } from "../src/agent-result.ts";

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

test("the schema's critique bounds forbid what the validator refuses", () => {
  const critique = SELF_REVIEW_REPLY_SCHEMA.properties.critique;
  // An empty critique: the validator refuses it and minItems forbids it.
  assert.equal(validateImplementationSelfReview({ critique: [] }).ok, false);
  assert.equal(critique.minItems, 1);
  // An empty entry: the validator refuses it and minLength forbids it.
  assert.equal(validateImplementationSelfReview({ critique: [""] }).ok, false);
  assert.deepEqual(critique.items, { type: "string", minLength: 1 });
  // The smallest critique both allow.
  assert.ok(validateImplementationSelfReview({ critique: ["x"] }).ok);
});

// docs/features/sandboxed-implementer/plan.md, Task 6: the self-review's
// reply once its fixes go through the tool server.

test("the self-review reply schema is the workspace reply plus a required, bounded critique", () => {
  const { critique, ...shared } = SELF_REVIEW_REPLY_SCHEMA.properties;
  assert.deepEqual(shared, WORKSPACE_REPLY_SCHEMA.properties);
  assert.deepEqual(SELF_REVIEW_REPLY_SCHEMA.required, [...WORKSPACE_REPLY_SCHEMA.required, "critique"]);
  assert.equal(SELF_REVIEW_REPLY_SCHEMA.additionalProperties, false);
  assert.deepEqual(critique, { type: "array", minItems: 1, items: { type: "string", minLength: 1 } });
});

test("the self-review reply validator checks both halves, each refusal named", () => {
  const valid = { status: "completed", summary: "checked", incompleteTasks: [], critique: ["checked the reset path"] };
  assert.deepEqual(validateSelfReviewReply(valid), { ok: true, value: valid });
  assert.deepEqual(validateSelfReviewReply({ ...valid, status: "proposed" }), {
    ok: false,
    reason: 'invalid reply status "proposed": allowed values are completed, blocked',
  });
  assert.deepEqual(validateSelfReviewReply({ ...valid, critique: [] }), {
    ok: false,
    reason: "self-review critique must not be empty: say what was checked when nothing was found",
  });
  const { critique: _dropped, ...noCritique } = valid;
  assert.deepEqual(validateSelfReviewReply(noCritique), { ok: false, reason: "self-review has no critique" });
});
