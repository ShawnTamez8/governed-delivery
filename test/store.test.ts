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

function approvalInput(runId: number) {
  return {
    runId,
    featureId: "f-1",
    specHash: "a".repeat(64),
    startingCommit: "b".repeat(40),
    profileHash: "c".repeat(64),
    risk: "standard",
    scope: '["docs/features/s/spec.md"]',
    expiresAt: "2099-01-01T00:00:00.000Z",
    signature: "AAAA",
    signer: "d".repeat(64),
  };
}

test("insertApproval persists every bound field and reads back by run", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const approval = store.insertApproval(approvalInput(run.id));
    assert.equal(approval.run_id, run.id);
    assert.equal(approval.feature_id, "f-1");
    assert.equal(approval.spec_hash, "a".repeat(64));
    assert.equal(approval.starting_commit, "b".repeat(40));
    assert.equal(approval.profile_hash, "c".repeat(64));
    assert.equal(approval.risk, "standard");
    assert.equal(approval.scope, '["docs/features/s/spec.md"]');
    assert.equal(approval.expires_at, "2099-01-01T00:00:00.000Z");
    assert.equal(approval.signature, "AAAA");
    assert.equal(approval.signer, "d".repeat(64));
    assert.ok(!Number.isNaN(Date.parse(approval.created_at)));
    assert.deepEqual(store.getApproval(run.id), approval);
  });
});

test("insertApproval refuses an invalid risk naming the allowed values", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    assert.throws(
      () => store.insertApproval({ ...approvalInput(run.id), risk: "extreme" }),
      /invalid risk extreme: allowed values are low, standard, high/
    );
  });
});

test("one authorization covers the run: a second approval is refused", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    store.insertApproval(approvalInput(run.id));
    assert.throws(() => store.insertApproval(approvalInput(run.id)), /UNIQUE|constraint/i);
  });
});

test("an approval for a nonexistent run is refused by the foreign key", () => {
  withStore((store) => {
    assert.throws(() => store.insertApproval(approvalInput(9999)), /FOREIGN KEY|constraint/i);
  });
});

test("setProfileRef records the frozen profile hash and names a missing run", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    store.setProfileRef(run.id, "e".repeat(64));
    assert.equal(store.getRun(run.id)!.profile_ref, "e".repeat(64));
    assert.throws(() => store.setProfileRef(9999, "e".repeat(64)), /run 9999 does not exist/);
  });
});

test("insertRun refuses a feature_id that could forge a payload line", () => {
  withStore((store) => {
    // feature_id reaches the signed approval payload, so a line break here
    // becomes a forged field there.
    assert.throws(
      () => store.insertRun("p", "f-1\nrisk: low", "s", "feature"),
      // The message escapes the newline rather than reproducing it, so the
      // diagnostic stays one readable line.
      /invalid feature_id "f-1\\nrisk: low": must be 1-64 characters of letters, digits, dot, underscore, or hyphen/
    );
    assert.throws(
      () => store.insertRun("p", "a".repeat(65), "s", "feature"),
      /invalid feature_id .*: must be 1-64 characters/
    );
    assert.throws(
      () => store.insertRun("p", "", "s", "feature"),
      /invalid feature_id .*: must be 1-64 characters/
    );
  });
});

test("insertRun accepts the feature_id forms the fixtures use", () => {
  withStore((store) => {
    for (const id of ["f", "f-1", "FEAT.2", "a_b-c.1", "a".repeat(64)]) {
      assert.ok(store.insertRun("p", id, "s", "feature").id > 0, `${id} must be accepted`);
    }
  });
});
