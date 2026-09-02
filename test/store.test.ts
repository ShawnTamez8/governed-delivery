import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type Store } from "../src/store.ts";
import { appendAudit } from "../src/audit.ts";

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

// --- canonical finding, immutable report, and reconciliation decision ------

test("upsertCanonicalFinding returns the row it wrote, not the most recently inserted row", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const first = store.upsertCanonicalFinding(stage.id, 1, "missing-trace", "## Acceptance criteria");
    const second = store.upsertCanonicalFinding(stage.id, 1, "different-concern", "## Declared artifacts");
    assert.notEqual(first.id, second.id);
    // The two-insert case passes by coincidence: with only one prior row, a
    // broken implementation returning "whatever was last inserted overall"
    // regardless of identity would still happen to be right. A third call
    // repeating the first identity, after a different row was inserted in
    // between, is what the removed `insertFinding`'s `ON CONFLICT ... DO
    // UPDATE` plus `lastInsertRowid` could not pass — that bug returned
    // whichever row the *previous* successful insert created, which here
    // would be `second`.
    const third = store.upsertCanonicalFinding(stage.id, 1, "missing-trace", "## Acceptance criteria");
    assert.equal(third.id, first.id);
    assert.equal(store.getCanonicalFindings(stage.id).length, 2);
  });
});

test("a same-location pair with differing severities is one canonical finding with two immutable reports", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const agentA = store.insertAgentRun(agentRunInput(stage.id, { agent: "reviewer-a" }));
    const agentB = store.insertAgentRun(agentRunInput(stage.id, { agent: "reviewer-b" }));
    const findingA = store.upsertCanonicalFinding(stage.id, 1, "missing-trace", "## Acceptance criteria");
    const findingB = store.upsertCanonicalFinding(stage.id, 1, "missing-trace", "## Acceptance criteria");
    assert.equal(findingA.id, findingB.id);
    store.insertFindingReport({
      findingId: findingA.id,
      agentRunId: agentA.id,
      severity: "critical",
      classification: "current_artifact",
      subject: "sev A",
    });
    store.insertFindingReport({
      findingId: findingA.id,
      agentRunId: agentB.id,
      severity: "low",
      classification: "current_artifact",
      subject: "sev B",
    });
    const reports = store.getFindingReports(findingA.id);
    assert.equal(reports.length, 2);
    assert.deepEqual(
      reports.map((r) => r.severity).sort(),
      ["critical", "low"]
    );
    assert.equal(store.getCanonicalFindings(stage.id).length, 1);
  });
});

test("a mixed-classification pair is two canonical findings, each with its own report, never fused", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const agentA = store.insertAgentRun(agentRunInput(stage.id, { agent: "reviewer-a" }));
    const agentB = store.insertAgentRun(agentRunInput(stage.id, { agent: "reviewer-b" }));
    // Classification determines the location shape, so the two reports
    // cannot share one canonical identity (operator decision, 2026-09-02):
    // the report contract cannot produce a one-canonical-two-mixed-report
    // row, so this never constructs one — it proves the two halves stay
    // separate instead.
    const currentArtifact = store.upsertCanonicalFinding(stage.id, 1, "atomic-write", "## Acceptance criteria");
    const upstream = store.upsertCanonicalFinding(stage.id, 1, "atomic-write", "upstream:design:atomic-write-decision");
    assert.notEqual(currentArtifact.id, upstream.id);
    store.insertFindingReport({
      findingId: currentArtifact.id,
      agentRunId: agentA.id,
      severity: "critical",
      classification: "current_artifact",
      subject: "critical here",
    });
    store.insertFindingReport({
      findingId: upstream.id,
      agentRunId: agentB.id,
      severity: "low",
      classification: "upstream",
      subject: "low upstream",
    });
    assert.equal(store.getCanonicalFindings(stage.id).length, 2);
    assert.equal(store.getFindingReports(currentArtifact.id).length, 1);
    assert.equal(store.getFindingReports(upstream.id).length, 1);
    assert.equal(store.getFindingReports(currentArtifact.id)[0].classification, "current_artifact");
    assert.equal(store.getFindingReports(upstream.id)[0].classification, "upstream");
  });
});

test("the same identity in a later round gets a separate canonical row, not an overwrite", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const round1 = store.upsertCanonicalFinding(stage.id, 1, "missing-trace", "## Acceptance criteria");
    const round2 = store.upsertCanonicalFinding(stage.id, 2, "missing-trace", "## Acceptance criteria");
    assert.notEqual(round1.id, round2.id);
    assert.equal(store.getCanonicalFindings(stage.id).length, 2);
  });
});

test("a second report from the same reviewer on the same finding is refused by the UNIQUE constraint", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const agent = store.insertAgentRun(agentRunInput(stage.id));
    const finding = store.upsertCanonicalFinding(stage.id, 1, "missing-trace", "## Acceptance criteria");
    store.insertFindingReport({
      findingId: finding.id,
      agentRunId: agent.id,
      severity: "high",
      classification: "current_artifact",
      subject: "first",
    });
    assert.throws(
      () =>
        store.insertFindingReport({
          findingId: finding.id,
          agentRunId: agent.id,
          severity: "low",
          classification: "current_artifact",
          subject: "second",
        }),
      /UNIQUE constraint failed/
    );
  });
});

test("insertFindingReport refuses an invalid severity or classification, naming the allowed values", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const agent = store.insertAgentRun(agentRunInput(stage.id));
    const finding = store.upsertCanonicalFinding(stage.id, 1, "missing-trace", "## Acceptance criteria");
    assert.throws(
      () =>
        store.insertFindingReport({
          findingId: finding.id,
          agentRunId: agent.id,
          severity: "catastrophic",
          classification: "current_artifact",
          subject: "s",
        }),
      /invalid severity catastrophic: allowed values are low, medium, high, critical/
    );
    assert.throws(
      () =>
        store.insertFindingReport({
          findingId: finding.id,
          agentRunId: agent.id,
          severity: "high",
          classification: "somewhere",
          subject: "s",
        }),
      /invalid classification somewhere: allowed values are current_artifact, upstream/
    );
  });
});

/**
 * A decision in the exact conditional shape `validateReconciliation` produces
 * for the disposition asked for: grounding only on `rejected_with_rationale`,
 * `normativeChanges` only on `addressed` — an empty array there is legal,
 * because a deletion-only or prose-only revision adds no normative node to
 * claim.
 *
 * Derived from the disposition rather than defaulted flat. A flat default of
 * `normativeChanges: null` on `addressed` describes a combination no
 * reconciliation can return, so every test built on it asserted a state no
 * run can reach — and the store, which had no matrix check, agreed with it.
 */
function decisionInput(findingId: number, agentRunId: number, overrides: Record<string, unknown> = {}) {
  const disposition = (overrides.disposition as string | undefined) ?? "addressed";
  return {
    findingId,
    agentRunId,
    disposition,
    rationale: "fixed it",
    changedLocations: ["## Acceptance criteria"],
    grounding:
      disposition === "rejected_with_rationale"
        ? { source: "design", location: "## Retention", excerpt: "any operator may export" }
        : null,
    normativeChanges: disposition === "addressed" ? [] : null,
    artifactHashBefore: "a".repeat(64),
    artifactHashAfter: "b".repeat(64),
    ...overrides,
  };
}

test("insertFindingDecision persists every field, including conditional grounding as its own columns", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const agent = store.insertAgentRun(agentRunInput(stage.id));
    const finding = store.upsertCanonicalFinding(stage.id, 1, "missing-trace", "## Acceptance criteria");
    const decision = store.insertFindingDecision(
      decisionInput(finding.id, agent.id, {
        disposition: "rejected_with_rationale",
        grounding: { source: "design", location: "## Retention", excerpt: "any operator may export" },
        changedLocations: [],
      })
    );
    assert.equal(decision.finding_id, finding.id);
    assert.equal(decision.disposition, "rejected_with_rationale");
    assert.equal(decision.grounding_source, "design");
    assert.equal(decision.grounding_location, "## Retention");
    assert.equal(decision.grounding_excerpt, "any operator may export");
    assert.equal(decision.normative_changes, null);
    assert.deepEqual(JSON.parse(decision.changed_locations), []);
    assert.equal(store.getFindingDecision(decision.id)!.id, decision.id);
  });
});

test("insertFindingDecision persists normativeChanges as JSON round-tripping the nested grounding", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const agent = store.insertAgentRun(agentRunInput(stage.id));
    const finding = store.upsertCanonicalFinding(stage.id, 1, "missing-trace", "## Acceptance criteria");
    const normativeChanges = [
      {
        artifactLocation: "## Acceptance criteria",
        artifactText: "the export refuses when the file already exists",
        grounding: { source: "design", location: "## Behaviour", excerpt: "refuses when <path> already exists" },
      },
    ];
    const decision = store.insertFindingDecision(
      decisionInput(finding.id, agent.id, { normativeChanges })
    );
    assert.deepEqual(JSON.parse(decision.normative_changes!), normativeChanges);
  });
});

test("a second decision on the same finding is refused by the UNIQUE constraint", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const agent = store.insertAgentRun(agentRunInput(stage.id));
    const finding = store.upsertCanonicalFinding(stage.id, 1, "missing-trace", "## Acceptance criteria");
    store.insertFindingDecision(decisionInput(finding.id, agent.id));
    assert.throws(() => store.insertFindingDecision(decisionInput(finding.id, agent.id)), /UNIQUE constraint failed/);
  });
});

test("insertFindingDecision refuses an invalid disposition, naming the allowed values", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const agent = store.insertAgentRun(agentRunInput(stage.id));
    const finding = store.upsertCanonicalFinding(stage.id, 1, "missing-trace", "## Acceptance criteria");
    assert.throws(
      () => store.insertFindingDecision(decisionInput(finding.id, agent.id, { disposition: "ignored" })),
      /invalid disposition ignored: allowed values are addressed, rejected_with_rationale, upstream_follow_up, upstream_blocking, cannot_determine/
    );
  });
});

// The store is the authoritative boundary, not a pass-through for whatever
// the stages happen to send today. `validateReconciliation` enforces this
// matrix on the model's answer; a CHECK constraint cannot express a
// cross-column rule like "grounding exactly when rejected_with_rationale", so
// without these refusals the database can hold a decision shape no
// reconciliation could ever produce (Task 7 step 4).
test("insertFindingDecision refuses a conditional field the disposition forbids", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const agent = store.insertAgentRun(agentRunInput(stage.id));
    const finding = store.upsertCanonicalFinding(stage.id, 1, "missing-trace", "## Acceptance criteria");
    const grounding = { source: "design", location: "## R", excerpt: "any operator may export" };
    assert.throws(
      () => store.insertFindingDecision(decisionInput(finding.id, agent.id, { grounding })),
      /disposition addressed forbids a grounding object/
    );
    assert.throws(
      () =>
        store.insertFindingDecision(
          decisionInput(finding.id, agent.id, { disposition: "cannot_determine", normativeChanges: [] })
        ),
      /disposition cannot_determine forbids normativeChanges/
    );
    assert.throws(
      () =>
        store.insertFindingDecision(
          decisionInput(finding.id, agent.id, { disposition: "upstream_blocking", grounding })
        ),
      /disposition upstream_blocking forbids a grounding object/
    );
  });
});

test("insertFindingDecision refuses a conditional field the disposition requires but omits", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const agent = store.insertAgentRun(agentRunInput(stage.id));
    const finding = store.upsertCanonicalFinding(stage.id, 1, "missing-trace", "## Acceptance criteria");
    assert.throws(
      () =>
        store.insertFindingDecision(
          decisionInput(finding.id, agent.id, { disposition: "rejected_with_rationale", grounding: null })
        ),
      /disposition rejected_with_rationale requires a grounding object/
    );
    assert.throws(
      () => store.insertFindingDecision(decisionInput(finding.id, agent.id, { normativeChanges: null })),
      /disposition addressed requires a normativeChanges array/
    );
  });
});

test("insertFindingDecision refuses a grounding source that is not a governing input", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const agent = store.insertAgentRun(agentRunInput(stage.id));
    const finding = store.upsertCanonicalFinding(stage.id, 1, "missing-trace", "## Acceptance criteria");
    // The artifact under review cannot ground its own rejection — the first
    // rule `groundingTextuallyFails` states.
    assert.throws(
      () =>
        store.insertFindingDecision(
          decisionInput(finding.id, agent.id, {
            disposition: "rejected_with_rationale",
            grounding: { source: "specification.md", location: "## R", excerpt: "e" },
          })
        ),
      /invalid grounding source specification\.md: allowed values are design, specification/
    );
    // Including the grounding nested inside a normative change, which the
    // top-level check never sees.
    assert.throws(
      () =>
        store.insertFindingDecision(
          decisionInput(finding.id, agent.id, {
            normativeChanges: [
              {
                artifactLocation: "## Acceptance criteria",
                artifactText: "a new criterion",
                grounding: { source: "the spec itself", location: "## B", excerpt: "e" },
              },
            ],
          })
        ),
      /invalid grounding source the spec itself: allowed values are design, specification/
    );
  });
});

test("getFindingDecisions reads across every round of a stage, not only the latest", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const agent = store.insertAgentRun(agentRunInput(stage.id));
    const round1 = store.upsertCanonicalFinding(stage.id, 1, "a", "## A");
    const round2 = store.upsertCanonicalFinding(stage.id, 2, "b", "## B");
    store.insertFindingDecision(decisionInput(round1.id, agent.id, { disposition: "upstream_blocking" }));
    store.insertFindingDecision(decisionInput(round2.id, agent.id, { disposition: "addressed" }));
    const decisions = store.getFindingDecisions(stage.id);
    assert.deepEqual(
      decisions.map((d) => d.finding_id).sort(),
      [round1.id, round2.id].sort()
    );
  });
});

// --- proposal: dedup without fusion -----------------------------------

function proposalInput(
  runId: number,
  stageId: number,
  findingId: number,
  overrides: Record<string, unknown> = {}
) {
  return {
    runId,
    stageId,
    findingId,
    title: "Missing redaction policy",
    problem: "The design never states a redaction rule.",
    whyUpstream: "No amount of plan work can invent the missing decision.",
    route: "follow_up",
    evidenceRef: ".governance/proposals/1/finding-1.json",
    ...overrides,
  };
}

test("upsertProposal creates one row and links its source finding", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const finding = store.upsertCanonicalFinding(stage.id, 1, "a", "upstream:design:x");
    const first = store.upsertProposal(proposalInput(run.id, stage.id, finding.id), "identity-a");
    assert.equal(first.created, true);
    assert.equal(store.getProposalsForStage(stage.id).length, 1);
    assert.deepEqual(store.getProposalSources(first.proposal.id), [finding.id]);
  });
});

test("the same identity raised again links its source finding instead of duplicating the row", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const findingA = store.upsertCanonicalFinding(stage.id, 1, "a", "upstream:design:x");
    const findingB = store.upsertCanonicalFinding(stage.id, 2, "a", "upstream:design:x");
    const identity = "identity-a";
    const first = store.upsertProposal(proposalInput(run.id, stage.id, findingA.id), identity);
    const second = store.upsertProposal(
      proposalInput(run.id, stage.id, findingB.id, { title: "a differently worded title" }),
      identity
    );
    assert.equal(second.created, false);
    assert.equal(second.proposal.id, first.proposal.id);
    // No field is fused across the two decisions: the stored row keeps the
    // first candidate's content, and only the source finding set grows.
    assert.equal(second.proposal.title, first.proposal.title);
    assert.deepEqual(store.getProposalSources(first.proposal.id).sort(), [findingA.id, findingB.id].sort());
    assert.equal(store.getProposalsForStage(stage.id).length, 1);
  });
});

test("upsertProposal refuses an invalid route, naming the allowed values", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const finding = store.upsertCanonicalFinding(stage.id, 1, "a", "upstream:design:x");
    assert.throws(
      () => store.upsertProposal(proposalInput(run.id, stage.id, finding.id, { route: "immediate" }), "id"),
      /invalid route immediate: allowed values are follow_up, blocking_dependency/
    );
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

test("a nested transaction commits once and both writes are visible", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    // `insertStage` opens its own transaction. Composing it inside an outer
    // one is what an atomic multi-write operation needs, and it is exactly
    // what SQLite refuses when BEGIN nests.
    const ids = store.transaction(() => {
      const spec = store.insertStage(run.id, "spec", null);
      const review = store.insertStage(run.id, "spec_review", spec.id);
      return [spec.id, review.id];
    });
    // Asserted by reading rows back: the depth counter is the mechanism, the
    // visible rows are the contract.
    assert.deepEqual(store.getStageChain(run.id).map((s) => s.id), ids);
  });
});

test("a throw inside a nested transaction rolls back the outer one's writes", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    assert.throws(
      () =>
        store.transaction(() => {
          store.insertStage(run.id, "spec", null);
          // A nested failure must abort the whole unit, never half of it.
          store.insertStage(run.id, "spec_review", 99999);
        }),
      /stage 99999 does not exist/
    );
    assert.equal(store.getStageChain(run.id).length, 0, "the outer write must not survive");
  });
});

test("a single-level transaction still commits and still rolls back", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    store.transaction(() => {
      store.exec("UPDATE run SET status = ? WHERE id = ?", ["blocked", run.id]);
    });
    assert.equal(store.getRun(run.id)!.status, "blocked");
    assert.throws(() =>
      store.transaction(() => {
        store.exec("UPDATE run SET status = ? WHERE id = ?", ["completed", run.id]);
        throw new Error("boom");
      })
    );
    assert.equal(store.getRun(run.id)!.status, "blocked", "the rolled-back update must not stick");
  });
});

test("getAuditEvents returns one run's events in insertion order and excludes another run's", () => {
  withStore((store) => {
    const a = store.insertRun("p", "f-1", "a", "feature");
    const b = store.insertRun("p", "f-2", "b", "feature");
    appendAudit(store, { runId: a.id, stageId: null, actor: "system", actorType: "cli", action: "one", summary: "first" });
    appendAudit(store, { runId: b.id, stageId: null, actor: "system", actorType: "cli", action: "other", summary: "other run" });
    appendAudit(store, { runId: a.id, stageId: null, actor: "system", actorType: "cli", action: "two", summary: "second" });

    const events = store.getAuditEvents(a.id);
    assert.deepEqual(events.map((e) => e.action), ["one", "two"]);
    assert.deepEqual(events.map((e) => e.summary), ["first", "second"]);
  });
});

test("getAuditEvents returns an empty array for a run with no events", () => {
  withStore((store) => {
    const run = store.insertRun("p", "f-1", "s", "feature");
    assert.deepEqual(store.getAuditEvents(run.id), []);
    // An unknown run is the empty case too, not a throw: the caller decides
    // what a missing event means.
    assert.deepEqual(store.getAuditEvents(9999), []);
  });
});
