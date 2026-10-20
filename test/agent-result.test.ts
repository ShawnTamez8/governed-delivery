import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  describeIncompleteReply,
  parseWorkspaceReply,
  WORKSPACE_REPLY_SCHEMA,
  WORKSPACE_STATUSES,
  validateAgentResult,
  validateWorkspaceReply,
} from "../src/agent-result.ts";
import { RESULT_SCHEMA as SPIKE_RESULT_SCHEMA } from "../scripts/sandbox-spike/spike-target.ts";

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

const RECORDED = join(process.cwd(), "test", "fixtures", "recorded");

// docs/features/sandboxed-implementer/plan.md, Task 6: the reply a patch
// dispatch returns once it changes files through the tool server.

test("the workspace reply schema is the schema the spike's recorded phase sent", () => {
  assert.deepEqual(WORKSPACE_REPLY_SCHEMA, SPIKE_RESULT_SCHEMA);
  assert.deepEqual(WORKSPACE_REPLY_SCHEMA.properties.status.enum, [...WORKSPACE_STATUSES]);
});

test("the spike's recorded structured answer passes the workspace reply validator", () => {
  const recorded = JSON.parse(readFileSync(join(RECORDED, "sandbox-spike-crew-chatter-phase-2.json"), "utf8")) as {
    resultLine: { structured_output: unknown };
  };
  const result = validateWorkspaceReply(recorded.resultLine.structured_output);
  assert.ok(result.ok, result.ok ? "" : result.reason);
  assert.equal(result.value.status, "completed");
  assert.deepEqual(Object.keys(recorded.resultLine.structured_output as object).sort(), [...WORKSPACE_REPLY_SCHEMA.required].sort());
});

test("each malformed workspace reply is refused by name", () => {
  const valid = { status: "completed", summary: "did it", incompleteTasks: [] };
  const cases: [unknown, string][] = [
    [null, "the reply must be an object"],
    [[valid], "the reply must be an object"],
    [{ ...valid, status: "proposed" }, 'invalid reply status "proposed": allowed values are completed, blocked'],
    [{ ...valid, summary: " " }, "the reply summary must be a non-empty string"],
    [{ ...valid, incompleteTasks: "none" }, "the reply incompleteTasks must be an array of strings"],
    [{ ...valid, incompleteTasks: [3] }, "the reply incompleteTasks must be an array of strings"],
    // Each prompt defines completed as nothing left undone (src/prompts.ts).
    [{ ...valid, incompleteTasks: ["task 7", "task 8"] }, "the reply says completed but lists incomplete tasks: task 7; task 8"],
  ];
  for (const [raw, reason] of cases) {
    assert.deepEqual(validateWorkspaceReply(raw), { ok: false, reason }, JSON.stringify(raw));
  }
  assert.deepEqual(validateWorkspaceReply({ ...valid, status: "blocked", incompleteTasks: ["task 3"] }), {
    ok: true,
    value: { status: "blocked", summary: "did it", incompleteTasks: ["task 3"] },
  });
});

test("a stage reads the spike's recorded answer from its serialized structured output, and names each refusal", () => {
  // `parseEnvelope` hands a --json-schema dispatch's structured_output on serialized.
  const recorded = JSON.parse(readFileSync(join(RECORDED, "sandbox-spike-crew-chatter-phase-2.json"), "utf8")) as {
    resultLine: { structured_output: unknown };
  };
  const read = parseWorkspaceReply(JSON.stringify(recorded.resultLine.structured_output), validateWorkspaceReply);
  assert.deepEqual(read, { ok: true, value: recorded.resultLine.structured_output });
  assert.deepEqual(parseWorkspaceReply('{"status": "done"}', validateWorkspaceReply), {
    ok: false,
    reason: 'implementer reply refused: invalid reply status "done": allowed values are completed, blocked',
  });
  const unparsed = parseWorkspaceReply("not json", validateWorkspaceReply);
  assert.equal(unparsed.ok, false);
  if (!unparsed.ok) assert.match(unparsed.reason, /^implementer body refused: /);
});

test("an incomplete reply is quoted whole, so the block reason carries what the agent said", () => {
  assert.equal(
    describeIncompleteReply({ status: "blocked", summary: "the registry was unreachable", incompleteTasks: ["task 3", "task 4"] }),
    "status blocked, not completed: the registry was unreachable; incomplete: task 3; task 4"
  );
  assert.equal(
    describeIncompleteReply({ status: "blocked", summary: "stopped", incompleteTasks: [] }),
    "status blocked, not completed: stopped; incomplete: none listed"
  );
});
