import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type Store } from "../src/store.ts";
import { verifyAuditChain, appendAudit } from "../src/audit.ts";
import { freezeProfile } from "../src/profile.ts";
import { runSpecStage } from "../src/spec-stage.ts";
import { AGENTS } from "../src/agents.ts";
import { buildPolicy, policyHash } from "../src/policy.ts";
import type { ExecutorDefinition } from "../src/executor.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import type { VerificationConfig } from "../src/governed-config.ts";

/** One minimal frozen configuration; this stage does not read it. */
const VERIFICATION: VerificationConfig = { commands: [{ name: "unit", command: ["node", "--version"] }] };
const FIXTURE = join(process.cwd(), "test", "fixtures", "harness", "emit-spec-stage.mjs");

function fixtureExecutor(scriptPath: string): ExecutorDefinition {
  return {
    // The fixture simulates the claude-code executor: the run's frozen
    // profile freezes the fixture each test hands (see withRun and the
    // per-scratch freeze calls), so the stage's binding checks see the
    // fixture as the executor the run froze.
    id: "claude-code",
    command: ["node", scriptPath],
    probe: ["node", "--version"],
    capabilities: ["spec", "plan", "review", "implementation"],
    telemetry: { perInvocationModel: true, effectiveModel: true, tokenUsage: true, sessionCost: true },
    sandbox: {
      allowedPaths: [],
      deniedPaths: [],
      commandAllowlist: [],
      idleTimeoutSeconds: 30,
      absoluteTimeoutSeconds: 120,
      envPassthrough: ["PATH", "SystemRoot", "TEMP", "TMP"],
      network: "inherit",
    },
  };
}

/**
 * The fixture source, normalized at the read boundary.
 *
 * These tests build scratch executors by substituting into the fixture's own
 * text, several of them across multi-line targets. Under a CRLF working tree
 * — which `core.autocrlf=true` produces on any fresh checkout — those
 * substitutions silently no-match and the test then fails on a wrong-stage
 * outcome that never mentions line endings. That is hazard 12: two checkouts
 * of the same commit behaving as different products, diagnosed as a
 * regression. `normalizeText` is the same tolerance the spec hash and the
 * signing tool already apply; the fixture source is one more reader of bytes
 * that crossed a checkout.
 */
function fixtureSource(): string {
  return normalizeText(readFileSync(FIXTURE, "utf8"));
}

interface Ctx {
  store: Store;
  root: string;
  runId: number;
}

/**
 * Freeze a profile whose executor is the fixture the tests hand. The
 * stage's binding checks compare the handed executor against the frozen
 * one canonically, so a test run must freeze exactly what it hands — the
 * fixture-blindness answer: a run that hands an executor its profile never
 * froze must be refused, and fixture tests are not exempt from that
 * contract.
 */
function freezeExecutorIntoProfile(
  store: Store,
  root: string,
  runId: number,
  executor: ExecutorDefinition
): void {
  const path = join(root, ".governance", "profiles", String(runId), "profile.json");
  const profile = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  profile.executor = executor;
  const serialized = canonicalJson(profile);
  writeFileSync(path, serialized);
  store.setProfileRef(runId, sha256Hex(serialized));
}

function withRun(
  fn: (ctx: Ctx) => Promise<void>,
  opts: { baseDirs?: string[] } = {}
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-spec-stage-"));
  const store = openStore(root);
  // The spec stage now reads the starting commit's tree to refuse declared
  // artifacts that name directories (step 8's exact-equality delivery), so a
  // run needs a real commit in a real repository — a fake 40-hex string makes
  // every tree read fail closed. `baseDirs` lets a regression commit an
  // existing directory (git tracks no empty directory, so each carries a
  // `.keep`).
  const git = (args: string[]): { status: number; stdout: string; stderr: string } => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  try {
    const init = git(["init", "-q"]);
    assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
    writeFileSync(join(root, "base.txt"), "base");
    for (const dir of opts.baseDirs ?? []) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, ".keep"), "x");
    }
    const add = git(["add", "-A"]);
    assert.equal(add.status, 0, `git add failed: ${add.stderr}`);
    const commit = git(["-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "-m", "base"]);
    assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
    const head = git(["rev-parse", "HEAD"]).stdout.trim();
    const run = store.insertRun("p", "f-1", "demo", "feature");
    // The stage resolves its model from the frozen profile now, so a run
    // without one cannot reach a dispatch at all.
    const frozen = freezeProfile(root, run.id, head, "m", VERIFICATION);
    store.setProfileRef(run.id, frozen.hash);
    // The run's frozen executor *is* the fixture the tests hand by default;
    // scratch-executor tests freeze their own right before the stage call.
    freezeExecutorIntoProfile(store, root, run.id, fixtureExecutor(FIXTURE));
    mkdirSync(join(root, "docs", "features", "demo"), { recursive: true });
    writeFileSync(join(root, "docs", "features", "demo", "design.md"), "# design\n");
    return Promise.resolve(fn({ store, root, runId: run.id })).finally(() => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    });
  } catch (err) {
    store.close();
    rmSync(root, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Rewrite one or more frozen policy values and re-freeze, recomputing both
 * `policyHash` and the profile hash on the run row.
 *
 * Active policy values such as panel size and round counts come from the
 * frozen profile, so a test that wants another configuration has to freeze
 * one. Recomputing `policyHash` matters: the profile validity check refuses a
 * profile whose recorded hash does not describe its own policy, so a lazy
 * patch here would be refused rather than honoured.
 */
function freezePolicyInto(
  store: Store,
  root: string,
  runId: number,
  patch: Record<string, unknown>
): void {
  const path = join(root, ".governance", "profiles", String(runId), "profile.json");
  const profile = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const policy = { ...(profile.policy as Record<string, unknown>), ...patch };
  profile.policy = policy;
  profile.policyHash = policyHash(policy as never);
  const serialized = canonicalJson(profile);
  writeFileSync(path, serialized);
  store.setProfileRef(runId, sha256Hex(serialized));
}

function agentRunCounts(store: Store, runId: number): { author: number; reviewer: number } {
  const rows = store.query<{ stage_id: number; role: string }>(
    "SELECT ar.role FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ?",
    [runId]
  );
  return {
    author: rows.filter((r) => r.role === "author").length,
    reviewer: rows.filter((r) => r.role === "reviewer").length,
  };
}

// --- happy path and round semantics (step 5b Task 9) ------------------------

test("happy path: a clean-panel round gates on decision completeness, not a closure budget", async () => {
  await withRun(async ({ store, root, runId }) => {
    const result = await runSpecStage(store, fixtureExecutor(FIXTURE), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    if (!result.ok) return;
    const chain = store.getStageChain(runId);
    assert.deepEqual(chain.map((s) => s.kind), ["spec", "spec_review"]);
    assert.equal(chain[1].input_stage_id, chain[0].id);
    assert.ok(chain.every((s) => s.status === "passed"));
    assert.ok(chain.every((s) => s.output_ref === result.specPath));
    const spec = readFileSync(result.specPath, "utf8");
    assert.ok(spec.includes("REVISED-spec"), "the reconciled revision was written");
    assert.equal(store.getRun(runId)!.status, "in_progress");
    const counts = agentRunCounts(store, runId);
    // Draft, self-critique, and exactly one reconciliation: the default
    // frozen policy configures one round, and the gate decides over that
    // round's decisions rather than requiring a second, empty-findings panel.
    assert.equal(counts.author, 3);
    assert.equal(counts.reviewer, 2);
    const findings = store.getCanonicalFindings(chain[1].id);
    assert.equal(findings.length, 2);
    assert.ok(findings.every((f) => f.round === 1));
    const material = findings.find((f) => f.intent_key === "missing-traceability");
    const decisions = store.getFindingDecisions(chain[1].id);
    assert.equal(decisions.length, 2);
    assert.ok(decisions.every((d) => d.disposition === "addressed"));
    assert.ok(decisions.some((d) => d.finding_id === material!.id));
    // The round-1 reconciliation's decisions arrived valid: each finding's
    // decision kept its disposition, nothing was converted, and the fixture's
    // single claim matched the derived node exactly.
    const reconcileRecords = store
      .query<{ summary: string }>(
        "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.reconcile.record' ORDER BY id",
        [runId]
      )
      .map((r) => r.summary);
    assert.equal(reconcileRecords.length, 1, "exactly one reconciliation event for one configured round");
    const round1 = reconcileRecords[0];
    assert.ok(!round1.includes("->cannot_determine"), "no happy-path decision was converted");
    assert.match(round1, /unclaimed=0/);
    // Both directions are accounted for: the fixture's revision replaces a
    // criterion and claims both halves, so neither an addition nor a removal
    // is left over.
    assert.match(round1, /unclaimedRemoved=0/);
    for (const finding of findings) {
      assert.match(round1, new RegExp(`d${finding.id}=addressed`), `finding ${finding.id} kept its addressed disposition`);
    }
    const gate = store.query<{ summary: string }>(
      "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.gate.pass' ORDER BY id DESC LIMIT 1",
      [runId]
    )[0]!;
    assert.match(gate.summary, /gate passed after 1 round\(s\)/);
  });
});

test("dedup: two reviewers reporting the same identity produce one canonical row with two reports", async () => {
  await withRun(async ({ store, root, runId }) => {
    const result = await runSpecStage(store, fixtureExecutor(FIXTURE), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const reviewStage = store.getStageChain(runId)[1];
    const findings = store.getCanonicalFindings(reviewStage.id);
    const dup = findings.filter((f) => f.intent_key === "missing-traceability");
    assert.equal(dup.length, 1, "the shared identity deduplicates to one canonical row");
    const reports = store.getFindingReports(dup[0].id);
    assert.equal(reports.length, 2, "both reviewers' reports are retained, unfused");
  });
});

test("a configured round count runs panel then reconciliation that many times, with one self-critique in total, and a recurring identity gets a distinct round-scoped canonical row each round", async () => {
  await withRun(async ({ store, root, runId }) => {
    // The reviewer branch is made unconditional — it reports the same two
    // findings every round regardless of whether the document was revised —
    // so the same intent/location genuinely recurs in round 2 rather than
    // the panel simply seeing nothing left to report.
    const scratch = join(root, "emit-spec-stage-recurring.mjs");
    const source = fixtureSource().replace(
      'const findings = stdin.includes("REVISED-spec")',
      "const findings = false"
    );
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    freezePolicyInto(store, root, runId, { specReviewRounds: 2 });
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const counts = agentRunCounts(store, runId);
    assert.equal(counts.author, 4, "draft, one self-critique, and one reconciliation per round");
    assert.equal(counts.reviewer, 4, "two reviewers seated in each of two rounds");
    const reviewStage = store.getStageChain(runId)[1];
    const findings = store.getCanonicalFindings(reviewStage.id);
    assert.equal(findings.length, 4, "two identities, each raised once per round");
    for (const round of [1, 2]) {
      const inRound = findings.filter((f) => f.round === round);
      assert.equal(inRound.length, 2, `round ${round} raised both identities`);
      assert.deepEqual(
        inRound.map((f) => f.intent_key).sort(),
        ["missing-traceability", "nit-pick"]
      );
    }
    const traceabilityIds = findings.filter((f) => f.intent_key === "missing-traceability").map((f) => f.id);
    assert.equal(new Set(traceabilityIds).size, 2, "round 1 and round 2 are distinct canonical identities");
    for (const finding of findings) {
      assert.equal(store.getFindingReports(finding.id).length, 2, "neither round's reports overwrote the other");
    }
    const decisions = store.getFindingDecisions(reviewStage.id);
    assert.equal(decisions.length, 4);
    assert.ok(decisions.every((d) => d.disposition === "addressed"));
    const gate = store.query<{ summary: string }>(
      "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.gate.pass' ORDER BY id DESC LIMIT 1",
      [runId]
    )[0]!;
    assert.match(gate.summary, /gate passed after 2 round\(s\)/);
  });
});

test("the gate blocks on a cannot_determine decision from an earlier round even though a later round finds nothing new", async () => {
  await withRun(async ({ store, root, runId }) => {
    // Round 1's reconciler converts one of its two decisions to
    // cannot_determine outright (no grounding, no claim); the other still
    // claims the revision, so the revised document still satisfies the
    // normative accounting. Round 2's panel then sees the REVISED-spec
    // marker and reports nothing, so its own reconciliation returns zero
    // decisions — proving the gate still blocks on round 1's alone.
    const scratch = join(root, "emit-spec-stage-earlier-round-blocks.mjs");
    const source = fixtureSource().replace(
      `  const decisions = ids.map((id, index) => ({
    findingId: id,
    disposition: "addressed",
    rationale: "fixture addressed the finding",
    changedLocations: ["AC-001"],
    normativeChanges:
      revising && index === 0
        ? [
            {
              artifactLocation: "AC-001",
              artifactText: "AC-001: the thing works REVISED-spec",
              grounding: { source: "design", location: "# design", excerpt: "design" },
            },
            {
              artifactLocation: "AC-001",
              artifactText: supersededCriterion(current),
              grounding: { source: "design", location: "# design", excerpt: "design" },
            },
          ]
        : [],
  }));`,
      `  const decisions = ids.map((id, index) => {
    const disposition = index === 0 ? "cannot_determine" : "addressed";
    const base = {
      findingId: id,
      disposition,
      rationale: index === 0 ? "fixture cannot determine" : "fixture addressed the finding",
    changedLocations: ["AC-001"],
    };
    if (disposition !== "addressed") return base;
    return {
      ...base,
      normativeChanges:
        revising && index === 1
          ? [
              {
                artifactLocation: "AC-001",
                artifactText: "AC-001: the thing works REVISED-spec",
                grounding: { source: "design", location: "# design", excerpt: "design" },
              },
              {
                artifactLocation: "AC-001",
                artifactText: supersededCriterion(current),
                grounding: { source: "design", location: "# design", excerpt: "design" },
              },
            ]
          : [],
    };
  });`
    );
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    freezePolicyInto(store, root, runId, { specReviewRounds: 2 });
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    const reviewStage = store.getStageChain(runId)[1];
    const decisions = store.getFindingDecisions(reviewStage.id);
    assert.equal(decisions.length, 2, "round 2 produced no new decisions to report on");
    const blocked = decisions.find((d) => d.disposition === "cannot_determine")!;
    assert.match(result.reason, new RegExp(`finding id\\(s\\) ${blocked.finding_id}`));
    assert.equal(store.getProposalsForStage(reviewStage.id).length, 0, "cannot_determine claims no proposal candidate");
    assert.equal(store.getRun(runId)!.status, "blocked");
    assert.equal(verifyAuditChain(store), null, "the audit chain still validates on a blocked run");
  });
});

test("upstream_follow_up stores a proposal, names every source finding, and does not block", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-follow-up.mjs");
    const source = fixtureSource().replace(
      `  const decisions = ids.map((id, index) => ({
    findingId: id,
    disposition: "addressed",
    rationale: "fixture addressed the finding",
    changedLocations: ["AC-001"],
    normativeChanges:
      revising && index === 0
        ? [
            {
              artifactLocation: "AC-001",
              artifactText: "AC-001: the thing works REVISED-spec",
              grounding: { source: "design", location: "# design", excerpt: "design" },
            },
            {
              artifactLocation: "AC-001",
              artifactText: supersededCriterion(current),
              grounding: { source: "design", location: "# design", excerpt: "design" },
            },
          ]
        : [],
  }));`,
      `  const decisions = ids.map((id, index) => {
    const disposition = index === 0 ? "upstream_follow_up" : "addressed";
    const base = {
      findingId: id,
      disposition,
      rationale: index === 0 ? "fixture routes upstream" : "fixture addressed the finding",
    changedLocations: ["AC-001"],
    };
    if (disposition !== "addressed") {
      return {
        ...base,
        proposal: { title: "design gap", problem: "the design never says this", whyUpstream: "the artifact cannot invent it" },
      };
    }
    return {
      ...base,
      normativeChanges:
        revising && index === 1
          ? [
              {
                artifactLocation: "AC-001",
                artifactText: "AC-001: the thing works REVISED-spec",
                grounding: { source: "design", location: "# design", excerpt: "design" },
              },
              {
                artifactLocation: "AC-001",
                artifactText: supersededCriterion(current),
                grounding: { source: "design", location: "# design", excerpt: "design" },
              },
            ]
          : [],
    };
  });`
    );
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const reviewStage = store.getStageChain(runId)[1];
    const decisions = store.getFindingDecisions(reviewStage.id);
    const routed = decisions.find((d) => d.disposition === "upstream_follow_up")!;
    const proposals = store.getProposalsForStage(reviewStage.id);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].route, "follow_up");
    assert.equal(proposals[0].title, "design gap");
    assert.deepEqual(store.getProposalSources(proposals[0].id), [routed.finding_id]);
    // The evidence file lands under the governance directory, not in the
    // repository the operator would git-mv from (architecture section 14).
    assert.ok(existsSync(join(root, proposals[0].evidence_ref)), "proposal evidence was retained");
    assert.ok(!existsSync(join(root, "docs", "proposals")), "no run writes into docs/proposals/");
    // Its own queryable event, carrying the fields Task 8 step 8 names: a
    // later query has to find every upstream route without parsing prose,
    // and a valid chain proves only that the events present were not
    // altered — never that a required one was emitted.
    const recorded = store.query<{ summary: string }>(
      "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.proposal.record' ORDER BY id",
      [runId]
    );
    assert.equal(recorded.length, 1, "one proposal event per persisted candidate");
    assert.match(recorded[0].summary, new RegExp(`^proposal ${proposals[0].id} created;`));
    assert.match(recorded[0].summary, new RegExp(`finding=${routed.finding_id};`));
    assert.match(recorded[0].summary, /route=follow_up;/);
    assert.match(recorded[0].summary, /risk=(low|standard|high);/);
    assert.match(recorded[0].summary, /specHashBefore=[0-9a-f]{64}; specHashAfter=[0-9a-f]{64};/);
    assert.match(recorded[0].summary, new RegExp(`evidence=${proposals[0].evidence_ref.replace(/[\\/]/g, "[\\\\/]")}`));
    assert.equal(verifyAuditChain(store), null, "the audit chain still verifies");
  });
});

test("upstream_blocking stores a proposal and blocks, naming both the finding and the proposal", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-blocking.mjs");
    const source = fixtureSource().replace(
      `  const decisions = ids.map((id, index) => ({
    findingId: id,
    disposition: "addressed",
    rationale: "fixture addressed the finding",
    changedLocations: ["AC-001"],
    normativeChanges:
      revising && index === 0
        ? [
            {
              artifactLocation: "AC-001",
              artifactText: "AC-001: the thing works REVISED-spec",
              grounding: { source: "design", location: "# design", excerpt: "design" },
            },
            {
              artifactLocation: "AC-001",
              artifactText: supersededCriterion(current),
              grounding: { source: "design", location: "# design", excerpt: "design" },
            },
          ]
        : [],
  }));`,
      `  const decisions = ids.map((id, index) => {
    const disposition = index === 0 ? "upstream_blocking" : "addressed";
    const base = {
      findingId: id,
      disposition,
      rationale: index === 0 ? "fixture routes upstream" : "fixture addressed the finding",
    changedLocations: ["AC-001"],
    };
    if (disposition !== "addressed") {
      return {
        ...base,
        proposal: { title: "design gap", problem: "the design never says this", whyUpstream: "the artifact cannot invent it" },
      };
    }
    return {
      ...base,
      normativeChanges:
        revising && index === 1
          ? [
              {
                artifactLocation: "AC-001",
                artifactText: "AC-001: the thing works REVISED-spec",
                grounding: { source: "design", location: "# design", excerpt: "design" },
              },
              {
                artifactLocation: "AC-001",
                artifactText: supersededCriterion(current),
                grounding: { source: "design", location: "# design", excerpt: "design" },
              },
            ]
          : [],
    };
  });`
    );
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    const reviewStage = store.getStageChain(runId)[1];
    const decisions = store.getFindingDecisions(reviewStage.id);
    const routed = decisions.find((d) => d.disposition === "upstream_blocking")!;
    const proposals = store.getProposalsForStage(reviewStage.id);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].route, "blocking_dependency");
    assert.match(result.reason, new RegExp(`${routed.finding_id} \\(proposal ${proposals[0].id}\\)`));
    assert.equal(store.getRun(runId)!.status, "blocked");
    // The blocking route records the same event contract as the advancing
    // one — the difference is the route it carries, not whether it audits.
    const recorded = store.query<{ summary: string }>(
      "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.proposal.record' ORDER BY id",
      [runId]
    );
    assert.equal(recorded.length, 1);
    assert.match(recorded[0].summary, new RegExp(`^proposal ${proposals[0].id} created;`));
    assert.match(recorded[0].summary, /route=blocking_dependency;/);
    assert.match(recorded[0].summary, new RegExp(`finding=${routed.finding_id};`));
    assert.equal(verifyAuditChain(store), null, "a blocked run's audit chain still verifies");
  });
});

test("the same upstream candidate raised in two rounds links one proposal and records the link", async () => {
  await withRun(async ({ store, root, runId }) => {
    // Two rounds, and a reviewer that keeps reporting: each round raises the
    // same upstream candidate under its own round-scoped canonical identity.
    // The identity key is stage-scoped, so the second round must link to the
    // first round's proposal rather than duplicate it — and the event has to
    // say which of the two happened, or a later query cannot tell a repeated
    // concern from two distinct ones.
    const scratch = join(root, "emit-spec-stage-dedup-link.mjs");
    const source = fixtureSource()
      .replace('const findings = stdin.includes("REVISED-spec")', "const findings = false")
      .replace(
        `  const decisions = ids.map((id, index) => ({
    findingId: id,
    disposition: "addressed",
    rationale: "fixture addressed the finding",
    changedLocations: ["AC-001"],
    normativeChanges:
      revising && index === 0
        ? [
            {
              artifactLocation: "AC-001",
              artifactText: "AC-001: the thing works REVISED-spec",
              grounding: { source: "design", location: "# design", excerpt: "design" },
            },
            {
              artifactLocation: "AC-001",
              artifactText: supersededCriterion(current),
              grounding: { source: "design", location: "# design", excerpt: "design" },
            },
          ]
        : [],
  }));`,
        `  const decisions = ids.map((id) => ({
    findingId: id,
    disposition: "upstream_follow_up",
    rationale: "fixture routes upstream",
    changedLocations: [],
    proposal: { title: "design gap", problem: "the design never says this", whyUpstream: "the artifact cannot invent it" },
  }));`
      )
      // Nothing is revised, so the artifact is handed back unchanged and no
      // normative node is added for anyone to claim.
      .replace("const artifact = revising ? REVISED_SPEC : current;", "const artifact = current;");
    // A substitution that silently fails to match leaves the stock fixture
    // running and the test asserting nothing it means to (hazard 12's shape).
    assert.ok(source.includes("const artifact = current;"), "the artifact substitution must apply");
    assert.ok(source.includes('disposition: "upstream_follow_up"'), "the decision substitution must apply");
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    freezePolicyInto(store, root, runId, { specReviewRounds: 2 });
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);

    const reviewStage = store.getStageChain(runId)[1];
    const proposals = store.getProposalsForStage(reviewStage.id);
    assert.equal(proposals.length, 1, "one stored proposal, however many rounds raised it");
    // Every source canonical finding is preserved — the dedup grows the
    // source set and fuses nothing else.
    const sources = store.getProposalSources(proposals[0].id);
    const upstreamDecisions = store
      .getFindingDecisions(reviewStage.id)
      .filter((d) => d.disposition === "upstream_follow_up");
    assert.equal(upstreamDecisions.length, 4, "two identities in each of two rounds");
    assert.deepEqual(sources.sort(), upstreamDecisions.map((d) => d.finding_id).sort());

    const recorded = store
      .query<{ summary: string }>(
        "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.proposal.record' ORDER BY id",
        [runId]
      )
      .map((r) => r.summary);
    assert.equal(recorded.length, 4, "one event per candidate, linked or created");
    assert.equal(
      recorded.filter((s) => s.includes(" created;")).length,
      1,
      "only the first candidate created the row"
    );
    assert.equal(
      recorded.filter((s) => s.includes(" linked;")).length,
      3,
      "every later candidate linked to it"
    );
  });
});

test("an added node no decision claims aborts the round before any decision is persisted", async () => {
  await withRun(async ({ store, root, runId }) => {
    // The fixture revises the criterion but claims nothing: the derived added
    // node has no owning decision to convert (`src/reconciliation.ts`'s
    // module comment), so the round fails closed rather than persisting an
    // addressed decision the accounting cannot support.
    const scratch = join(root, "emit-spec-stage-unclaimed.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace("    normativeChanges:\n      revising && index === 0", "    normativeChanges:\n      false")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /left normative node\(s\) unclaimed by any decision/);
    const reviewStage = store.getStageChain(runId)[1];
    // The canonical findings and their reviewer reports were already written
    // before reconciliation ran, and survive the abort; no decision was ever
    // persisted for them.
    const findings = store.getCanonicalFindings(reviewStage.id);
    assert.equal(findings.length, 2);
    for (const finding of findings) {
      assert.ok(store.getFindingReports(finding.id).length > 0);
    }
    assert.equal(store.getFindingDecisions(reviewStage.id).length, 0, "no decision was persisted on an aborted round");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a removed node no decision claims aborts the round, naming the deleted node", async () => {
  await withRun(async ({ store, root, runId }) => {
    // Hazard 17 at stage level: the reconciliation answers both findings
    // `addressed` and deletes a declared artifact, claiming nothing for it.
    // Nothing was added, so the addition-only accounting saw a clean round;
    // the removal has no owning decision to convert, so the round must fail
    // closed exactly as an unclaimed addition does. The deletion is expressed
    // by the document the fixture returns, as every other artifact change in
    // these tests is.
    const scratch = join(root, "emit-spec-stage-unclaimed-removal.mjs");
    const source = fixtureSource()
      .replace(
        "const artifact = revising ? REVISED_SPEC : current;",
        'const artifact = revising ? current.replace("- src/a11.ts\\n", "") : current;'
      )
      .replace("    normativeChanges:\n      revising && index === 0", "    normativeChanges:\n      false");
    assert.ok(source.includes('current.replace("- src/a11.ts\\n", "")'), "the deletion substitution must apply");
    assert.ok(source.includes("    normativeChanges:\n      false"), "the claim substitution must apply");
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /left removed normative node\(s\) unclaimed by any decision/);
    assert.match(result.reason, /src\/a11\.ts/, "the refusal names the deleted node");

    const reviewStage = store.getStageChain(runId)[1];
    assert.equal(store.getFindingDecisions(reviewStage.id).length, 0, "no decision was persisted on an aborted round");
    assert.equal(store.getRun(runId)!.status, "blocked");
    // The abort precedes decision insertion and the reconcile summary, so the
    // blocked round's evidence is the invalid event, not an `unclaimedRemoved`
    // token — there is no summary to carry one.
    const invalid = store
      .query<{ summary: string }>(
        "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.reconcile.invalid' ORDER BY id",
        [runId]
      )
      .map((r) => r.summary);
    assert.equal(invalid.length, 1);
    assert.match(invalid[0], /src\/a11\.ts/);
    assert.equal(
      store.query("SELECT * FROM audit WHERE run_id = ? AND action = 'spec.reconcile.record'", [runId]).length,
      0,
      "the aborted round wrote no reconcile summary"
    );
  });
});

test("a decision converted by an unmatched grounding is stored as cannot_determine and blocks by name, not discarded as an unclaimed node", async () => {
  await withRun(async ({ store, root, runId }) => {
    // The other half of the test above, and the distinction the stage must
    // not collapse. Here the decision *does* claim the added node, but its
    // grounding excerpt does not occur in the governing design, so
    // `validateReconciliation` converts it to cannot_determine and drops its
    // claims — which releases the node into `unclaimedNodes` even though an
    // owning decision exists and survives. Aborting on that signal would
    // discard the typed answer, the conversion record, and the finding id,
    // reporting prose where section 12 promises a named block.
    const scratch = join(root, "emit-spec-stage-converted.mjs");
    const source = fixtureSource().replace(
      'grounding: { source: "design", location: "# design", excerpt: "design" },',
      'grounding: { source: "design", location: "# design", excerpt: "a phrase the governing design never contains" },'
    );
    assert.notEqual(source, fixtureSource(), "the grounding substitution must apply");
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;

    const reviewStage = store.getStageChain(runId)[1];
    const decisions = store.getFindingDecisions(reviewStage.id);
    const converted = decisions.find((d) => d.disposition === "cannot_determine");
    assert.ok(converted, "the converted decision must be persisted, not discarded with the round");
    // The conversion is recorded on the decision itself, naming the check
    // that fired, so the reason survives independently of the audit trail.
    assert.match(converted!.rationale, /\[deterministic validation: .*grounding excerpt does not occur/);
    assert.equal(converted!.grounding_source, null, "a converted decision drops its invalid conditional content");
    assert.equal(converted!.normative_changes, null);

    // The gate blocks on the stored decision, naming the canonical finding —
    // not on the released node as prose.
    assert.match(result.reason, new RegExp(`finding id\\(s\\) .*\\b${converted!.finding_id}\\b`));
    assert.ok(
      !/unclaimed by any decision/.test(result.reason),
      `a converted decision must not be reported as unclaimed: ${result.reason}`
    );

    // The conversion and the released node both stay visible in the
    // reconciliation record.
    const record = store
      .query<{ summary: string }>(
        "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.reconcile.record' ORDER BY id",
        [runId]
      )
      .map((r) => r.summary)[0];
    assert.match(record, new RegExp(`${converted!.finding_id}:addressed->cannot_determine`));
    assert.match(record, /unclaimed=1/);
    // The conversion drops both of the decision's claims, so the superseded
    // criterion is released alongside the added one and both counts say so.
    assert.match(record, /unclaimedRemoved=1/);
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("mixed reports reach the reconciler unfused: a shared identity dedups, a classification split stays two findings", async () => {
  await withRun(async ({ store, root, runId }) => {
    // The two reviewers share one canonical identity (dup-concern) and split
    // another concern by classification (shared-concern): one reports it
    // current_artifact, the other upstream. Neither pair may be fused into
    // one report or one finding (section 13's no-fusion rule; operator
    // decision, 2026-09-02, on the mixed-classification case specifically).
    const scratch = join(root, "emit-spec-stage-mixed-pair.mjs");
    const source = fixtureSource()
      .replace(
        `  const findings = stdin.includes("REVISED-spec")
    ? []
    : [
        {
          location: "AC-001",
          intentKey: "missing-traceability",
          severity: "high",
          classification: "current_artifact",
          subject: "criterion lacks a traceable origin",
        },
        {
          location: "## Declared artifacts",
          intentKey: "nit-pick",
          severity: "low",
          classification: "current_artifact",
          subject: "artifact list could be grouped",
        },
      ];`,
        `  const findings =
    agentId === "spec-reviewer-security"
      ? [
          {
            location: "AC-001",
            intentKey: "shared-concern",
            severity: "critical",
            classification: "current_artifact",
            subject: "severe in-artifact concern",
          },
          {
            location: "## Declared artifacts",
            intentKey: "dup-concern",
            severity: "critical",
            classification: "current_artifact",
            subject: "the same concern twice",
          },
        ]
      : [
          {
            location: "upstream:design:shared-concern",
            intentKey: "shared-concern",
            severity: "low",
            classification: "upstream",
            subject: "mild upstream concern",
          },
          {
            location: "## Declared artifacts",
            intentKey: "dup-concern",
            severity: "low",
            classification: "current_artifact",
            subject: "the same concern twice",
          },
        ];`
      )
      .replace(
        `  const decisions = ids.map((id, index) => ({
    findingId: id,
    disposition: "addressed",
    rationale: "fixture addressed the finding",
    changedLocations: ["AC-001"],
    normativeChanges:
      revising && index === 0
        ? [
            {
              artifactLocation: "AC-001",
              artifactText: "AC-001: the thing works REVISED-spec",
              grounding: { source: "design", location: "# design", excerpt: "design" },
            },
            {
              artifactLocation: "AC-001",
              artifactText: supersededCriterion(current),
              grounding: { source: "design", location: "# design", excerpt: "design" },
            },
          ]
        : [],
  }));
  emit({
    status: "proposed",
    agent: "spec-author",
    role: "author",
    executor: "claude-code",
    summary: "fixture reconcile",
    proposedContentChanges: { spec: artifact, decisions },
  });
}`,
        `  const decisions = ids.map((id) => ({
    findingId: id,
    disposition: "addressed",
    rationale: "fixture addressed the finding",
    changedLocations: ["AC-001"],
  }));
  emit({
    status: "proposed",
    agent: "spec-author",
    role: "author",
    executor: "claude-code",
    summary: "fixture reconcile",
    proposedContentChanges: { spec: current, decisions },
  });
}`
      );
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const reviewStage = store.getStageChain(runId)[1];
    const findings = store.getCanonicalFindings(reviewStage.id);
    assert.equal(findings.length, 3, "dup-concern dedups; shared-concern splits by classification");
    const dup = findings.find((f) => f.intent_key === "dup-concern")!;
    const sharedCurrent = findings.find(
      (f) => f.intent_key === "shared-concern" && f.location === "AC-001"
    )!;
    const sharedUpstream = findings.find(
      (f) => f.intent_key === "shared-concern" && f.location === "upstream:design:shared-concern"
    )!;
    assert.ok(dup && sharedCurrent && sharedUpstream);
    assert.equal(store.getFindingReports(dup.id).length, 2, "both reviewers' reports on the shared identity survive");
    const dupSeverities = store.getFindingReports(dup.id).map((r) => r.severity).sort();
    assert.deepEqual(dupSeverities, ["critical", "low"], "neither report's own severity was fused or dropped");
    assert.equal(store.getFindingReports(sharedCurrent.id).length, 1);
    assert.equal(store.getFindingReports(sharedCurrent.id)[0].classification, "current_artifact");
    assert.equal(store.getFindingReports(sharedUpstream.id).length, 1);
    assert.equal(store.getFindingReports(sharedUpstream.id)[0].classification, "upstream");
    // No canonical row exists that fuses a severity with a classification no
    // reviewer actually returned.
    for (const finding of [sharedCurrent, sharedUpstream]) {
      assert.equal(store.getFindingReports(finding.id).length, 1);
    }
  });
});

// --- panel sizing, staffing, and risk (unaffected by the round/gate rewrite) -

test("a reviewer returning blocked with empty findings cannot pass the gate by absence", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-blocked-reviewer.mjs");
    const source = fixtureSource().replace(
      '    status: "proposed",\n    agent: agentId,',
      '    status: "blocked",\n    agent: agentId,'
    );
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /returned status blocked, not proposed/);
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("an invalid intentKey aborts terminally naming the reviewer", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-bad-key.mjs");
    const source = fixtureSource().replace(
      'intentKey: "missing-traceability",',
      'intentKey: "Bad Key!",'
    );
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /is not lowercase kebab-case within 64 characters/);
  });
});

test("a spec whose change_kind contradicts the run aborts terminally", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-kind-mismatch.mjs");
    const source = fixtureSource().replace("change_kind: feature", "change_kind: defect_fix");
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /does not match run change_kind feature/);
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("the panel is sized by the frozen policy, and high risk does not enlarge it", async () => {
  await withRun(async ({ store, root, runId }) => {
    // `src/agents/` is a protected path, so this spec scores high risk. Risk
    // still binds the approval and is still recorded, but it stopped sizing
    // the panel: the seated count is the size the author asked for either way.
    const scratch = join(root, "emit-spec-stage-high-risk.mjs");
    const source = fixtureSource()
      .replace("src/a1.ts", "src/agents/evil.ts")
      .replace('const findings = stdin.includes("REVISED-spec")', "const findings = true");
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    assert.equal(agentRunCounts(store, runId).reviewer, 2, "the author asked for two, not three");
    const gate = store.query<{ summary: string }>(
      "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.gate.pass' ORDER BY id DESC LIMIT 1",
      [runId]
    )[0]!;
    assert.match(gate.summary, /risk=high/, "risk is still computed and still recorded");
  });
});

test("a request too small for the configured required lenses blocks by name", async () => {
  await withRun(async ({ store, root, runId }) => {
    // Required specialties consume seats inside the size the author asks for
    // (hazard 11). The fixture requests two; three lenses are configured as
    // always seated, so the request cannot be honoured. Nothing shrinks the
    // configuration or drops the author's lens to make it fit.
    const scratch = join(root, "emit-spec-stage-clean.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace('const findings = stdin.includes("REVISED-spec")', "const findings = true")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    freezePolicyInto(store, root, runId, {
      panelSizeMax: 3,
      requiredSpecialties: ["requirements-traceability", "security", "consistency"],
    });
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(
      result.reason,
      /spec panel request refused: panel request of 2 cannot seat the 3 required and requested specialties: consistency, requirements-traceability, security/
    );
    assert.equal(agentRunCounts(store, runId).reviewer, 0, "no reviewer was dispatched");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("an author asking for seats enough to hold every required lens staffs all of them", async () => {
  await withRun(async ({ store, root, runId }) => {
    // The same configuration as above, and a request that fits it. This is the
    // half that proves the refusal is about capacity rather than about the
    // configuration being unusable.
    const scratch = join(root, "emit-spec-stage-three-seats.mjs");
    writeFileSync(
      scratch,
      fixtureSource()
        .replace(
          'panelRequest: { size: 2, specialties: ["security"] },',
          'panelRequest: { size: 3, specialties: ["security"] },'
        )
        .replace('const findings = stdin.includes("REVISED-spec")', "const findings = true")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    freezePolicyInto(store, root, runId, {
      panelSizeMax: 3,
      requiredSpecialties: ["requirements-traceability", "security", "consistency"],
    });
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    assert.equal(
      agentRunCounts(store, runId).reviewer,
      3,
      "every configured required specialty consumes a seat the author asked for"
    );
  });
});

test("the author's requested size is what sizes the panel", async () => {
  await withRun(async ({ store, root, runId }) => {
    // The discriminating configuration, and it has to be chosen deliberately:
    // one required lens under a ceiling of three, with the author asking for
    // three. A stage that ignored the request and seated the frozen floor
    // instead would seat two here, so this fails unless the request itself is
    // what sizes the panel.
    const scratch = join(root, "emit-spec-stage-three-requested.mjs");
    writeFileSync(
      scratch,
      fixtureSource()
        .replace(
          'panelRequest: { size: 2, specialties: ["security"] },',
          'panelRequest: { size: 3, specialties: ["security"] },'
        )
        .replace('const findings = stdin.includes("REVISED-spec")', "const findings = true")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    freezePolicyInto(store, root, runId, { panelSizeMax: 3 });
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    assert.equal(
      agentRunCounts(store, runId).reviewer,
      3,
      "the requested three, not the two the frozen floor would have staffed"
    );
  });
});

test("a requested size outside the frozen bounds blocks before the panel spends", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-oversized-request.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        'panelRequest: { size: 2, specialties: ["security"] },',
        'panelRequest: { size: 3, specialties: ["security"] },'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /panel request size 3 is outside the frozen bounds 2-2/);
    assert.equal(agentRunCounts(store, runId).reviewer, 0, "no reviewer was dispatched");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a requested lens the frozen registry cannot seat blocks by name", async () => {
  await withRun(async ({ store, root, runId }) => {
    // The Task 1 prototype's `data-privacy` case, now reaching the staffing
    // refusal it was always meant to hit. The selector alone would have filled
    // the seat with another lens and returned a full-sized panel.
    const scratch = join(root, "emit-spec-stage-unstaffable-lens.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        'panelRequest: { size: 2, specialties: ["security"] },',
        'panelRequest: { size: 2, specialties: ["data-privacy"] },'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /spec panel cannot be staffed/);
    assert.match(result.reason, /no reviewer for requested specialty data-privacy/);
    assert.match(result.reason, /the registry seats consistency, requirements-traceability, security/);
    assert.equal(agentRunCounts(store, runId).reviewer, 0, "no reviewer was dispatched");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("the spec panel seats the lens the author asked for", async () => {
  await withRun(async ({ store, root, runId }) => {
    // The request names `security`; the ranked fill would otherwise take
    // `consistency` first, because it sorts earlier by id. Asserting the seated
    // ids is what distinguishes a request that was honoured from one that was
    // validated and then discarded.
    const scratch = join(root, "emit-spec-stage-lens-check.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace('const findings = stdin.includes("REVISED-spec")', "const findings = true")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const seated = store
      .query<{ agent: string }>(
        "SELECT DISTINCT ar.agent FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ? AND ar.role = 'reviewer' ORDER BY ar.agent",
        [runId]
      )
      .map((r) => r.agent);
    assert.deepEqual(seated, ["spec-reviewer-security", "spec-reviewer-traceability"]);
  });
});

test("the seam's short panel is still refused after staffing passes", async () => {
  await withRun(async ({ store, root, runId }) => {
    // The backstop, reachable only through the seam: the registry seats more
    // distinct specialties than the request asks for, so no fixture can
    // produce a short panel honestly. This is the guard `staffingShortfall`
    // cannot cover, because staffing has already said yes by the time
    // selection returns.
    const result = await runSpecStage(
      store,
      fixtureExecutor(FIXTURE),
      { runId, requestedModel: "m", rootDir: root },
      { selectPanel: () => [] }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /spec panel incomplete: needs 2 reviewers, found 0/);
    assert.equal(agentRunCounts(store, runId).reviewer, 0, "no reviewer was dispatched");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a missing design document is refused before any dispatch", async () => {
  const root = mkdtempSync(join(tmpdir(), "bw-spec-stage-"));
  const store = openStore(root);
  const run = store.insertRun("p", "f-1", "no-design", "feature");
  const frozen = freezeProfile(root, run.id, "b".repeat(40), "m", VERIFICATION);
  store.setProfileRef(run.id, frozen.hash);
  // This test builds its own run (no design.md exists); like withRun, the
  // frozen executor must be the fixture the test hands.
  freezeExecutorIntoProfile(store, root, run.id, fixtureExecutor(FIXTURE));
  try {
    const result = await runSpecStage(store, fixtureExecutor(FIXTURE), { runId: run.id, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /cannot read design document/);
    assert.equal(store.query("SELECT * FROM agent_run").length, 0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the panel is sized from distinct artifacts, not repeated ones", async () => {
  // 11 declared entries, 9 distinct. Deduplicated that is low risk; counted
  // raw it is standard, and the approval binds the risk the gate recorded, so
  // a miscount would bind the operator to a risk the run never computed.
  //
  // Panel size used to be the observable here. It no longer can be — the
  // frozen policy sizes the panel and risk does not — so the recorded risk in
  // the gate summary is what this asserts, which is the thing that actually
  // matters. The seated count is asserted too, as the frozen floor, so a
  // regression that reconnected risk to panel size would still fail here.
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-duplicates.mjs");
    const source = fixtureSource()
      // Swapped at the shared helper, so the self-critique branch returns
      // the same document: the panel is sized from the artifact the stage
      // actually gated, which is the self-critiqued one.
      .replace("return BASE_SPEC;", "return DUPLICATE_SPEC;")
      // Clean review, so the run reaches the gate in one round and the
      // reviewer count is the panel size rather than a multiple of it.
      .replace('const findings = stdin.includes("REVISED-spec")', "const findings = true");
    writeFileSync(scratch, source);
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), {
      runId,
      requestedModel: "m",
      rootDir: root,
    });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    assert.equal(agentRunCounts(store, runId).reviewer, 2, "the author asked for two, at any risk");
    const gate = store.query<{ summary: string }>(
      "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.gate.pass' ORDER BY id DESC LIMIT 1",
      [runId]
    )[0];
    assert.ok(gate, "the gate must record what it passed");
    assert.match(gate.summary, /risk=low/);
  });
});

test("the passing gate records the spec hash and risk it gated", async () => {
  await withRun(async ({ store, root, runId }) => {
    const result = await runSpecStage(store, fixtureExecutor(FIXTURE), {
      runId,
      requestedModel: "m",
      rootDir: root,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const gate = store.query<{ summary: string }>(
      "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.gate.pass' ORDER BY id DESC LIMIT 1",
      [runId]
    )[0]!;
    // The hash must be of the spec actually on disk after the last revision.
    const onDisk = sha256Hex(normalizeText(readFileSync(result.specPath, "utf8")));
    assert.match(gate.summary, new RegExp(`specHash=${onDisk}; risk=(low|standard|high)`));
  });
});

test("a blocked run is refused before anything can be dispatched", async () => {
  // A run can be blocked with no stage rows at all: `new-run` blocks the run
  // when the profile freeze fails. The zero-stage guard below does not see
  // that case, so `bw spec` would author and review a specification against a
  // run that can never complete — real spend on a dead run.
  await withRun(async ({ store, root, runId }) => {
    store.setRunStatus(runId, "blocked");
    assert.equal(store.getStageChain(runId).length, 0, "the guard under test is the zero-stage case");
    const result = await runSpecStage(store, fixtureExecutor(FIXTURE), {
      runId,
      requestedModel: "m",
      rootDir: root,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /run \d+ is blocked, not in_progress/);
    assert.equal(store.query("SELECT * FROM agent_run").length, 0, "nothing was spent");
    assert.equal(store.getStageChain(runId).length, 0, "no stage row was created");
  });
});

test("a stage with no model in the frozen map fails before any dispatch", async () => {
  await withRun(async ({ store, root, runId }) => {
    // Rewrite the frozen profile with `spec` removed from the map, and re-point
    // run.profile_ref at the new bytes so the profile stays self-consistent —
    // the refusal under test is the missing model, not a tampered profile.
    const path = join(root, ".governance", "profiles", String(runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8")) as { modelMap: Record<string, string> };
    delete profile.modelMap.spec;
    const serialized = canonicalJson(profile);
    writeFileSync(path, serialized);
    store.setProfileRef(runId, sha256Hex(serialized));

    const result = await runSpecStage(store, fixtureExecutor(FIXTURE), {
      runId,
      requestedModel: "m",
      rootDir: root,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /no model configured for stage spec/);
    // Section 10 requires this failure to precede the invocation; the absent
    // agent_run row is the proof that it did.
    assert.equal(store.query("SELECT * FROM agent_run").length, 0, "nothing was spent");
  });
});

test("an executor without the spec capability is refused before the stage row", async () => {
  await withRun(async ({ store, root, runId }) => {
    const noSpec = {
      ...fixtureExecutor(FIXTURE),
      capabilities: fixtureExecutor(FIXTURE).capabilities.filter((c) => c !== "spec"),
    };
    freezeExecutorIntoProfile(store, root, runId, noSpec);
    const result = await runSpecStage(store, noSpec, { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /lacks the required capability "spec" for stage kind spec/);
    assert.equal(store.query("SELECT * FROM agent_run").length, 0, "nothing was spent");
  });
});

test("a pre-Task-3 profile refuses the stage before any dispatch, and its evidence stays readable", async () => {
  await withRun(async ({ store, root, runId }) => {
    // Some history exists before the profile goes stale, because the claim
    // being tested is that a refused run keeps what it already recorded.
    appendAudit(store, {
      runId,
      stageId: null,
      actor: "system",
      actorType: "cli",
      action: "run.create",
      summary: "recorded before the policy shape changed",
    });

    // The superseded shape, hashed correctly at every level: the file hash
    // matches the run row, and policyHash matches the policy. Only the shape
    // is wrong.
    const path = join(root, ".governance", "profiles", String(runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const { specReviewRounds, planReviewRounds, panelSizeMin, panelSizeMax, ...carried } = buildPolicy();
    const policy = { ...carried, panelSizes: { low: 1, standard: 2, high: 3 }, remediationRounds: 3 };
    profile.policy = policy;
    profile.policyHash = sha256Hex(canonicalJson(policy));
    const serialized = canonicalJson(profile);
    writeFileSync(path, serialized);
    store.setProfileRef(runId, sha256Hex(serialized));

    const result = await runSpecStage(store, fixtureExecutor(FIXTURE), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false, "a superseded policy shape must not execute");
    if (result.ok) return;
    assert.match(result.reason, /cannot be executed/);

    // Nothing was spent: no agent_run row, no retained raw output, no stage.
    assert.equal(store.query("SELECT * FROM agent_run").length, 0, "no dispatch happened");
    assert.ok(!existsSync(join(root, ".governance", "raw")), "no raw output means no spawn");
    assert.equal(store.getStageChain(runId).length, 0, "the refusal precedes the stage row");

    // And the run's own records are untouched and still verifiable, which is
    // the half of the decision that says a refused run is evidence, not waste.
    assert.equal(store.getRun(runId)!.id, runId);
    // `verifyAuditChain` returns the break, or null when the chain holds.
    assert.equal(verifyAuditChain(store), null, "the audit chain still verifies");
    assert.equal(existsSync(path), true, "the frozen profile is still on disk to inspect");
  });
});

// --- self-critique -----------------------------------------------------------

test("exactly one self-critique runs per artifact, and the panel reviews its output", async () => {
  await withRun(async ({ store, root, runId }) => {
    const result = await runSpecStage(store, fixtureExecutor(FIXTURE), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const recorded = store.query<{ summary: string }>(
      "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.selfcritique.record'",
      [runId]
    );
    assert.equal(recorded.length, 1, "one self-critique per artifact, whatever the round budget does");
    // The record is one event; the dispatch budget is what makes it one
    // invocation: draft, self-critique, and one reconciliation for the
    // default single-round policy — never a second self-critique.
    assert.equal(agentRunCounts(store, runId).author, 3, "no second self-critique dispatch");
    assert.match(recorded[0].summary, /1 critique entries; panel request size 2, specialties \[security\]/);
    assert.equal(agentRunCounts(store, runId).reviewer, 2);
  });
});

test("the panel reviews the self-critiqued specification, not the draft", async () => {
  await withRun(async ({ store, root, runId }) => {
    // A clean panel, so the run passes in round one and the document the
    // gate approved is the one self-critique produced.
    const scratch = join(root, "emit-spec-stage-clean-critique.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace('const findings = stdin.includes("REVISED-spec")', "const findings = true")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    if (!result.ok) return;
    const onDisk = readFileSync(result.specPath, "utf8");
    assert.ok(onDisk.includes("SELFCRITIQUED"), "the self-critiqued document is what was written and gated");
    const gate = store.query<{ summary: string }>(
      "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.gate.pass' ORDER BY id DESC LIMIT 1",
      [runId]
    )[0]!;
    assert.match(gate.summary, new RegExp(`specHash=${sha256Hex(normalizeText(onDisk))}`));
  });
});

test("an author whose frozen definition cannot self-critique blocks before the dispatch", async () => {
  await withRun(async ({ store, root, runId }) => {
    // The capability is read from the frozen profile, not the live registry
    // (hard rule 6), so this is the refusal a run configured without the
    // output would hit.
    const path = join(root, ".governance", "profiles", String(runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8")) as {
      agents: { id: string; outputs: string[] }[];
    };
    const author = profile.agents.find((a) => a.id === "spec-author")!;
    author.outputs = author.outputs.filter((o) => o !== "spec-self-critique");
    const serialized = canonicalJson(profile);
    writeFileSync(path, serialized);
    store.setProfileRef(runId, sha256Hex(serialized));

    const result = await runSpecStage(store, fixtureExecutor(FIXTURE), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /does not allow spec-self-critique output/);
    // The refusal precedes every dispatch: a run that cannot complete this
    // stage must not pay for a draft first.
    assert.equal(store.query("SELECT * FROM agent_run").length, 0, "nothing was spent");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a self-critique missing its panel request blocks, and no reviewer sees the draft", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-no-panel-request.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace('        panelRequest: { size: 2, specialties: ["security"] },\n', "")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /spec self-critique refused: self-critique panelRequest must be an object/);
    assert.equal(agentRunCounts(store, runId).reviewer, 0, "the panel must not review a phase that failed");
    assert.equal(store.getStageChain(runId)[0].status, "blocked");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a self-critique requesting one lens twice blocks by name", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-duplicate-lens.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        'panelRequest: { size: 2, specialties: ["security"] },',
        'panelRequest: { size: 2, specialties: ["security", "security"] },'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /specialties contain duplicates: security/);
    assert.equal(agentRunCounts(store, runId).reviewer, 0);
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a self-critique whose document does not validate blocks instead of falling back to the draft", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-invalid-critique-doc.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        'artifact: authoredSpec().replace("- AC-001: the thing works", "- AC-001: the thing works SELFCRITIQUED"),',
        'artifact: "this is not a specification",'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /spec self-critique document refused/);
    // The draft is still the file on disk — the invalid revision never
    // replaced it — but the run is blocked. Nothing continued on the draft:
    // that is what "no fallback" means here.
    const onDisk = readFileSync(join(root, "docs", "features", "demo", "spec.md"), "utf8");
    assert.ok(!onDisk.includes("this is not a specification"));
    assert.equal(agentRunCounts(store, runId).reviewer, 0, "the panel never reviewed the draft");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("the self-critique prompt names the specialties the frozen registry can seat", async () => {
  await withRun(async ({ store, root, runId }) => {
    // Revision A from the Task 1 prototype: an author that is not told what
    // the registry seats requests a lens nobody can staff. The builder's own
    // test proves the list is rendered; this proves the stage supplies it,
    // which is the half a prompt-only test cannot see. The fixture answers
    // with whatever lens the prompt actually listed, so an empty list would
    // come back as `none-listed`.
    const scratch = join(root, "emit-spec-stage-registry-echo.mjs");
    writeFileSync(
      scratch,
      fixtureSource()
        .replace(
          'panelRequest: { size: 2, specialties: ["security"] },',
          "panelRequest: { size: 2, specialties: [registeredLens()] },"
        )
        .replace(
          "function authoredSpec() {",
          `function registeredLens() {
  const block = stdin.split("registered specialties:")[1] ?? "";
  const listed = block.split("A specialty outside")[0] ?? "";
  const lenses = listed
    .split("- ")
    .slice(1)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return lenses[0] ?? "none-listed";
}

function authoredSpec() {`
        )
        .replace('const findings = stdin.includes("REVISED-spec")', "const findings = true")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const recorded = store.query<{ summary: string }>(
      "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.selfcritique.record'",
      [runId]
    )[0]!;
    const named = /specialties \[([a-z-]*)\]/.exec(recorded.summary)![1];
    assert.notEqual(named, "none-listed", "the prompt listed no registered specialty at all");
    const seatable = AGENTS.filter((a) => a.role === "reviewer" && a.outputs.includes("findings")).map(
      (a) => a.specialty
    );
    assert.ok(seatable.includes(named), `${named} is not a specialty the registry seats`);
  });
});

// --- reconciliation ------------------------------------------------------------

test("the spec reviewer's prompt carries the design document", async () => {
  await withRun(async ({ store, root, runId }) => {
    // A design carrying a sentinel, and a reviewer that reports a finding
    // only when it saw the sentinel — the finding row is the observable.
    writeFileSync(join(root, "docs", "features", "demo", "design.md"), "# design DESIGN-SENTINEL\n");
    const scratch = join(root, "emit-spec-stage-design-sentinel.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        '    ? []\n    : [\n        {\n          location: "AC-001",',
        '    ? []\n    : stdin.includes("DESIGN-SENTINEL")\n    ? [{ location: "AC-001", intentKey: "design-present", severity: "low", classification: "current_artifact", subject: "the design reached the reviewer" }]\n    : [\n        {\n          location: "AC-001",'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const reviewStage = store.getStageChain(runId)[1];
    const findings = store.getCanonicalFindings(reviewStage.id);
    assert.ok(
      findings.some((f) => f.intent_key === "design-present"),
      "the reviewer saw the design document the stage supplied"
    );
  });
});

test("an author whose frozen definition cannot reconcile blocks before the dispatch", async () => {
  await withRun(async ({ store, root, runId }) => {
    // The capability is read from the frozen profile, not the live registry
    // (hard rule 6), so this is the refusal a run configured without the
    // output would hit. The check sits beside the draft's own capability
    // check: a run that can never complete its stage must not pay for a
    // draft first.
    const path = join(root, ".governance", "profiles", String(runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8")) as {
      agents: { id: string; outputs: string[] }[];
    };
    const author = profile.agents.find((a) => a.id === "spec-author")!;
    author.outputs = author.outputs.filter((o) => o !== "spec-reconciliation");
    const serialized = canonicalJson(profile);
    writeFileSync(path, serialized);
    store.setProfileRef(runId, sha256Hex(serialized));

    const result = await runSpecStage(store, fixtureExecutor(FIXTURE), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /does not allow spec-reconciliation output/);
    assert.equal(store.query("SELECT * FROM agent_run").length, 0, "nothing was spent");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a reconciliation whose document does not validate blocks instead of overwriting the gated spec", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-invalid-reconcile.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        "proposedContentChanges: { spec: artifact, decisions },",
        'proposedContentChanges: { spec: "not a specification", decisions },'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /spec reconciliation document refused/);
    // The refusal happened before the write: the gated document is still the
    // file on disk, not the never-approved reconciliation.
    const onDisk = readFileSync(join(root, "docs", "features", "demo", "spec.md"), "utf8");
    assert.ok(!onDisk.includes("not a specification"));
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a reconciliation missing a decision for a reported finding blocks by name", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-missing-decision.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace("const decisions = ids.map((id, index) => ({", "const decisions = ids.slice(1).map((id, index) => ({")
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /spec reconciliation refused: reconciliation is incomplete: no decision for canonical finding id\(s\)/);
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("the reconciliation prompt carries the design document", async () => {
  await withRun(async ({ store, root, runId }) => {
    // The reconciler's answer embeds what it saw: the fixture echoes whether
    // the sentinel reached it into the decision's changedLocations, and the
    // reconcile event is where the stage test reads it back.
    writeFileSync(join(root, "docs", "features", "demo", "design.md"), "# design DESIGN-SENTINEL\n");
    const scratch = join(root, "emit-spec-stage-reconcile-design.mjs");
    writeFileSync(
      scratch,
      fixtureSource().replace(
        'changedLocations: ["AC-001"],',
        'changedLocations: [stdin.includes("DESIGN-SENTINEL") ? "design-seen" : "design-missing"],'
      )
    );
    freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    const records = store
      .query<{ summary: string }>(
        "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.reconcile.record' ORDER BY id",
        [runId]
      )
      .map((r) => r.summary);
    assert.ok(records[0].includes("design-seen"), "the reconciler saw the governing design");
  });
});

// --- declared artifacts are exact file paths (step 8 task 1) -----------------

test("a spec whose declared artifact names a directory in the starting tree blocks at the draft write", async () => {
  await withRun(
    async ({ store, root, runId }) => {
      // `src/` exists in the base commit; the draft declares it. Delivery
      // proves artifacts by exact equality with committed file paths, so the
      // spec gate refuses the shape before the run pays for the revision.
      const scratch = join(root, "emit-spec-stage-dir-artifact.mjs");
      writeFileSync(scratch, fixtureSource().replace("- src/a1.ts", "- src"));
      freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
      const result = await runSpecStage(store, fixtureExecutor(scratch), {
        runId,
        requestedModel: "m",
        rootDir: root,
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(
        result.reason,
        /declared artifact names a directory in the starting commit tree: src/
      );
      assert.equal(store.getStageChain(runId)[0].status, "blocked");
      assert.equal(store.getRun(runId)!.status, "blocked");
    },
    { baseDirs: ["src"] }
  );
});

test("a self-critique revision that declares a directory blocks instead of replacing the gated draft", async () => {
  await withRun(
    async ({ store, root, runId }) => {
      // The draft declares ordinary files and passes the tree rule; the
      // self-critique revision swaps the first artifact for the `src/`
      // directory that exists in the base commit. Every revision goes through
      // the same write-time rule, so the revision refuses by name and the
      // draft stays the file on disk (no fallback, no replacement).
      const scratch = join(root, "emit-spec-stage-critique-dir.mjs");
      writeFileSync(
        scratch,
        fixtureSource().replace(
          'artifact: authoredSpec().replace("- AC-001: the thing works", "- AC-001: the thing works SELFCRITIQUED"),',
          'artifact: authoredSpec().replace("- src/a1.ts", "- src"),'
        )
      );
      freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
      const result = await runSpecStage(store, fixtureExecutor(scratch), {
        runId,
        requestedModel: "m",
        rootDir: root,
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(
        result.reason,
        /spec self-critique document refused: declared artifact names a directory in the starting commit tree: src/
      );
      const onDisk = readFileSync(join(root, "docs", "features", "demo", "spec.md"), "utf8");
      assert.ok(onDisk.includes("src/a1.ts"), "the draft, not the refused revision, is the file on disk");
      assert.equal(store.getRun(runId)!.status, "blocked");
    },
    { baseDirs: ["src"] }
  );
});

test("a draft declaring the run's own plan document refuses before the run pays for a revision", async () => {
  // design.md, spec.md, and plan.md under docs/features/<slug>/ are written
  // by the system itself (spec/plan are projections committed before the
  // recorded patch base), so none can ever appear in the range delivery
  // certifies. The spec gate refuses the declaration by name instead of
  // letting the run block terminally at the last stage.
  await withRun(
    async ({ store, root, runId }) => {
      const scratch = join(root, "emit-spec-stage-run-doc.mjs");
      writeFileSync(
        scratch,
        fixtureSource().replace("- src/a1.ts", "- docs/features/demo/plan.md")
      );
      freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
      const result = await runSpecStage(store, fixtureExecutor(scratch), {
        runId,
        requestedModel: "m",
        rootDir: root,
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(
        result.reason,
        /declared artifact names a document the run itself writes \(design, spec, or plan under docs\/features\/demo\/\): docs\/features\/demo\/plan\.md/
      );
      assert.equal(store.getStageChain(runId)[0].status, "blocked");
      assert.equal(store.getRun(runId)!.status, "blocked");
    },
    { baseDirs: ["src"] }
  );
});

test("a self-critique revision that declares the run's own plan document blocks instead of replacing the gated draft", async () => {
  await withRun(
    async ({ store, root, runId }) => {
      // The draft declares ordinary files and passes; the self-critique
      // revision swaps the first artifact for the run's own plan document.
      // Every revision goes through the same write-time rule, so the revision
      // refuses by name and the draft stays the file on disk.
      const scratch = join(root, "emit-spec-stage-critique-run-doc.mjs");
      writeFileSync(
        scratch,
        fixtureSource().replace(
          'artifact: authoredSpec().replace("- AC-001: the thing works", "- AC-001: the thing works SELFCRITIQUED"),',
          'artifact: authoredSpec().replace("- src/a1.ts", "- docs/features/demo/plan.md"),'
        )
      );
      freezeExecutorIntoProfile(store, root, runId, fixtureExecutor(scratch));
      const result = await runSpecStage(store, fixtureExecutor(scratch), {
        runId,
        requestedModel: "m",
        rootDir: root,
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(
        result.reason,
        /spec self-critique document refused: declared artifact names a document the run itself writes \(design, spec, or plan under docs\/features\/demo\/\): docs\/features\/demo\/plan\.md/
      );
      const onDisk = readFileSync(join(root, "docs", "features", "demo", "spec.md"), "utf8");
      assert.ok(onDisk.includes("src/a1.ts"), "the draft, not the refused revision, is the file on disk");
      assert.equal(store.getRun(runId)!.status, "blocked");
    },
    { baseDirs: ["src"] }
  );
});
