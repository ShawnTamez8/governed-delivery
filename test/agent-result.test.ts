import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAgentResult } from "../src/agent-result.ts";

function validResult(): Record<string, unknown> {
  return {
    status: "proposed",
    agent: "spec-author",
    role: "author",
    executor: "claude-code",
    summary: "a proposed spec",
    proposedContentChanges: { spec: "# spec" },
  };
}

test("a valid proposed result is accepted", () => {
  const result = validateAgentResult("spec-author", validResult());
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.summary, "a proposed spec");
});

test("non-object input is refused", () => {
  const result = validateAgentResult("spec-author", "not an object");
  assert.deepEqual(result, { ok: false, reason: "AgentResult must be an object" });
});

test("an invalid status is refused naming the allowed values", () => {
  const result = validateAgentResult("spec-author", { ...validResult(), status: "bogus" });
  assert.deepEqual(result, {
    ok: false,
    reason: "invalid AgentResult status bogus: allowed values are proposed, blocked, failed",
  });
});

test("an agent id mismatch is refused naming both ids", () => {
  const result = validateAgentResult("spec-author", { ...validResult(), agent: "someone-else" });
  assert.deepEqual(result, {
    ok: false,
    reason: "AgentResult agent someone-else does not match dispatched agent spec-author",
  });
});

test("missing fields are refused naming the field", () => {
  for (const field of ["agent", "role", "executor", "summary"]) {
    const raw = validResult();
    delete raw[field];
    const result = validateAgentResult("spec-author", raw);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, new RegExp(`AgentResult ${field}`));
  }
});

test("a patch without baseCommit is refused", () => {
  const result = validateAgentResult("spec-author", {
    ...validResult(),
    proposedPatches: [{ files: [{ path: "a.ts", action: "add", content: "x" }] }],
  });
  assert.deepEqual(result, { ok: false, reason: "proposed patch is missing baseCommit" });
});

test("a delete action is schema-legal but refused", () => {
  const result = validateAgentResult("spec-author", {
    ...validResult(),
    proposedPatches: [{ baseCommit: "abc", files: [{ path: "a.ts", action: "delete" }] }],
  });
  assert.deepEqual(result, { ok: false, reason: "deletion is schema-legal but refused" });
});

test("an invalid patch action is refused naming the allowed values", () => {
  const result = validateAgentResult("spec-author", {
    ...validResult(),
    proposedPatches: [{ baseCommit: "abc", files: [{ path: "a.ts", action: "rename" }] }],
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "invalid patch action rename: allowed values are add, modify",
  });
});

test("a blocked result validates fine", () => {
  const result = validateAgentResult("spec-reviewer-traceability", {
    status: "blocked",
    agent: "spec-reviewer-traceability",
    role: "reviewer",
    executor: "claude-code",
    summary: "blocked on missing context",
  });
  assert.equal(result.ok, true);
});

test("confidence outside 0..1 is accepted — the architecture does not constrain it", () => {
  const result = validateAgentResult("spec-author", { ...validResult(), confidence: 42 });
  assert.equal(result.ok, true);
});

test("unknown extra fields are ignored, never an error", () => {
  const result = validateAgentResult("spec-author", { ...validResult(), inventedField: true });
  assert.equal(result.ok, true);
});
