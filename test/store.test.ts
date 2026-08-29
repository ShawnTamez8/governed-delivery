import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type Store } from "../src/store.ts";

function withStore(fn: (store: Store) => void): void {
  const root = mkdtempSync(join(tmpdir(), "bw-store-"));
  const store = openStore(root);
  try {
    fn(store);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test("insertRun persists defaults and returns the row", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "my-feature", "feature");
    assert.equal(run.project, "p");
    assert.equal(run.feature_id, "f-1");
    assert.equal(run.slug, "my-feature");
    assert.equal(run.change_kind, "feature");
    assert.equal(run.status, "in_progress");
    assert.equal(run.profile_ref, null);
    assert.ok(!Number.isNaN(Date.parse(run.created_at)));
    assert.ok(!Number.isNaN(Date.parse(run.updated_at)));
    assert.deepEqual(store.getRun(run.id), run);
  });
});

test("stages chain by inputStageId and walk in ordinal order", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const s0 = store.insertStage(run.id, "spec", null);
    const s1 = store.insertStage(run.id, "spec_review", s0.id);
    const s2 = store.insertStage(run.id, "awaiting_approval", s1.id);
    assert.equal(s0.ordinal, 0);
    assert.equal(s1.ordinal, 1);
    assert.equal(s2.ordinal, 2);
    assert.equal(s1.input_stage_id, s0.id);
    assert.equal(s2.input_stage_id, s1.id);
    const chain = store.getStageChain(run.id);
    assert.deepEqual(
      chain.map((s) => s.id),
      [s0.id, s1.id, s2.id]
    );
  });
});

test("a stage from another run is refused as input", () => {
  withStore((store) => {
    const runA = store.insertRun("p", "f-a", "a", "feature");
    const runB = store.insertRun("p", "f-b", "b", "feature");
    const stageA = store.insertStage(runA.id, "spec", null);
    assert.throws(
      () => store.insertStage(runB.id, "spec_review", stageA.id),
      /stage \d+ belongs to run \d+, not run \d+/
    );
  });
});

test("a duplicate ordinal fails on the UNIQUE constraint", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    store.insertStage(run.id, "spec", null);
    assert.throws(() => store.insertStage(run.id, "spec_review", null), /UNIQUE constraint failed/);
  });
});

test("invalid change_kind is refused naming the allowed values", () => {
  withStore((store) => {
    assert.throws(
      () => store.insertRun("p", "f-1", "s", "nonsense"),
      /invalid change_kind nonsense: allowed values are feature, defect_fix/
    );
  });
});

test("setStageStatus rejects an invalid string from an untyped source", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec", null);
    assert.throws(
      () => store.setStageStatus(stage.id, "bogus"),
      /invalid stage status bogus: allowed values are pending, in_progress, passed, blocked, failed/
    );
    assert.throws(
      () => store.setStageStatus(stage.id, "pending", "maybe"),
      /invalid gate_result maybe: allowed values are pass, block/
    );
  });
});

test("completeStage persists output_ref, gate_result, and ended_at with pass", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec", null);
    const done = store.completeStage(stage.id, "content:abc123", "pass");
    assert.equal(done.status, "passed");
    assert.equal(done.gate_result, "pass");
    assert.equal(done.output_ref, "content:abc123");
    assert.ok(done.ended_at !== null);
  });
});

test("completeStage maps gate_result block to status blocked", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec", null);
    const done = store.completeStage(stage.id, "content:abc123", "block");
    assert.equal(done.status, "blocked");
    assert.equal(done.gate_result, "block");
  });
});

function agentRunInput(stageId: number, overrides: Partial<import("../src/store.ts").AgentRunInput> = {}) {
  return {
    stageId,
    agent: "planner",
    role: "author",
    executor: "claude-code",
    requestedModel: "sonnet",
    effectiveModel: "claude-sonnet",
    fallback: null,
    tokensIn: 100,
    tokensOut: 20,
    cacheRead: 0,
    cacheWrite: 0,
    cost: null,
    durationMs: 3742,
    inputHash: "sha-a",
    outputHash: "sha-b",
    rawOutputRef: ".governance/raw/1/x.json",
    independence: "configured_standalone",
    ...overrides,
  };
}

test("insertAgentRun persists all fields, null ones included", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec", null);
    const row = store.insertAgentRun(agentRunInput(stage.id));
    assert.equal(row.stage_id, stage.id);
    assert.equal(row.role, "author");
    assert.equal(row.cost, null);
    assert.equal(row.fallback, null);
    assert.equal(row.tokens_in, 100);
    assert.equal(row.duration_ms, 3742);
    assert.deepEqual(store.getAgentRun(row.id), row);
  });
});

test("an invalid role is refused naming the allowed values", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec", null);
    assert.throws(
      () => store.insertAgentRun(agentRunInput(stage.id, { role: "reviewer-and-author" })),
      /invalid role reviewer-and-author: allowed values are author, reviewer/
    );
  });
});

test("an invalid independence is refused naming the allowed values", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec", null);
    assert.throws(
      () => store.insertAgentRun(agentRunInput(stage.id, { independence: "self_reported" })),
      /invalid independence self_reported: allowed values are unverified_self_attestation, configured_standalone/
    );
  });
});

test("a missing stage_id fails on the foreign key", () => {
  withStore((store) => {
    assert.throws(() => store.insertAgentRun(agentRunInput(9999)), /FOREIGN KEY constraint failed/);
  });
});

function findingInput(stageId: number, overrides: Record<string, unknown> = {}) {
  return {
    stageId,
    agentRunId: null,
    severity: "high",
    intentKey: "missing-traceability",
    subject: "no trace for criterion 3",
    location: "## Acceptance criteria",
    ...overrides,
  };
}

test("two insertions with the same identity produce one row", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec", null);
    store.insertFinding(findingInput(stage.id));
    store.insertFinding(findingInput(stage.id, { subject: "reworded concern" }));
    assert.equal(store.getFindings(stage.id).length, 1);
    assert.equal(store.getFindings(stage.id)[0].subject, "reworded concern");
  });
});

test("different intent keys produce two rows", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec", null);
    store.insertFinding(findingInput(stage.id));
    store.insertFinding(findingInput(stage.id, { intentKey: "different-concern" }));
    assert.equal(store.getFindings(stage.id).length, 2);
  });
});

test("an invalid severity or disposition is refused naming the allowed values", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec", null);
    assert.throws(
      () => store.insertFinding(findingInput(stage.id, { severity: "catastrophic" })),
      /invalid severity catastrophic: allowed values are low, medium, high, critical/
    );
    assert.throws(
      () => store.insertFinding(findingInput(stage.id, { disposition: "ignored" })),
      /invalid disposition ignored: allowed values are open, resolved, disputed, accepted/
    );
  });
});

test("updateFindingDisposition changes the row", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec", null);
    const finding = store.insertFinding(findingInput(stage.id));
    store.updateFindingDisposition(finding.id, "resolved");
    assert.equal(store.getFinding(finding.id)!.disposition, "resolved");
  });
});

test("setRunStatus blocks a run and refuses invalid values", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    store.setRunStatus(run.id, "blocked");
    assert.equal(store.getRun(run.id)!.status, "blocked");
    assert.throws(
      () => store.setRunStatus(run.id, "flying"),
      /invalid run status flying: allowed values are in_progress, blocked, completed/
    );
  });
});
