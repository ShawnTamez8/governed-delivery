import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { appendAudit, verifyAuditChain } from "../src/audit.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { runCodeReviewStage } from "../src/code-review-stage.ts";
import { runDeliveryStage } from "../src/delivery-stage.ts";
import { formatImplementationGate } from "../src/handoff.ts";
import { profilePath, worktreePath } from "../src/paths.ts";
import { validatePlanDoc } from "../src/plan-doc.ts";
import { policyHash } from "../src/policy.ts";
import { freezeProfile, loadProfile } from "../src/profile.ts";
import { createRunIntake, RunIntakeFreezeError } from "../src/run-intake.ts";
import { computeScope } from "../src/scope.ts";
import { computeRisk } from "../src/select.ts";
import { validateSpecDoc } from "../src/spec-doc.ts";
import { openStore, type Store } from "../src/store.ts";
import { runVerificationStage } from "../src/verification-stage.ts";

function workspace(): string {
  return mkdtempSync(join(dirname(resolve(".")), ".buildworks-intake-"));
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function repository(root: string): void {
  git(root, "init", "-q");
  writeFileSync(join(root, ".gitignore"), ".governance/\n");
  writeFileSync(join(root, "governed.yaml"), 'verify:\n  - name: unit\n    command: ["node", "--version"]\n');
  git(root, "add", "-A");
  git(root, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "-qm", "base");
}

test("shared intake writes the existing run, audit, and frozen-profile contract", () => {
  const root = workspace();
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  process.env.BW_APPROVAL_PUBLIC_KEY = join(root, "missing-public.pem");
  try {
    repository(root);
    const store = openStore(root);
    try {
      const created = createRunIntake(store, root, {
        project: "project",
        featureId: "feature-1",
        slug: "feature-one",
        changeKind: "feature",
        model: "test-model",
        narrationCheck: "off",
      });
      assert.equal(created.run.id, 1);
      assert.equal(created.run.project, "project");
      assert.equal(created.run.feature_id, "feature-1");
      assert.equal(created.run.slug, "feature-one");
      assert.equal(created.run.change_kind, "feature");
      assert.equal(created.run.profile_ref, created.profileHash);
      const profile = JSON.parse(readFileSync(profilePath(root, created.run.id), "utf8"));
      assert.equal(profile.approvalSigner, null, "low-level intake retains its existing unbound behavior");
      assert.deepEqual(store.getAuditEvents(created.run.id).map((event) => event.action),
        ["run.create", "profile.freeze", "run.narration"]);
      assert.equal(profile.narrationCheck, null);
      assert.equal(store.getAuditEvents(created.run.id)[2]!.summary, "narration check off (new-run --no-narration-check)");
      assert.equal(verifyAuditChain(store), null);
    } finally {
      store.close();
    }
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
  }
});

test("shared intake passes per-setting overrides to the freeze, and omitting them takes the seeded defaults", () => {
  const root = workspace();
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  process.env.BW_APPROVAL_PUBLIC_KEY = join(root, "missing-public.pem");
  try {
    repository(root);
    const store = openStore(root);
    try {
      const base = { project: "project", featureId: "feature-1", slug: "feature-one", changeKind: "feature" as const, model: "test-model", narrationCheck: "off" as const };
      const seeded = createRunIntake(store, root, base);
      const overridden = createRunIntake(store, root, { ...base, featureId: "feature-2", slug: "feature-two",
        settings: { effort: "xhigh", modelFor: { implementer: "override-model" }, effortFor: { "code-reviewer-security": "max" } } });
      const read = (id: number) => JSON.parse(readFileSync(profilePath(root, id), "utf8")).dispatchSettings;
      assert.deepEqual(read(seeded.run.id)["implementer"], { model: "claude-sonnet-5-5", effort: "medium" });
      assert.deepEqual(read(overridden.run.id)["implementer"], { model: "override-model", effort: "xhigh" });
      assert.deepEqual(read(overridden.run.id)["code-reviewer-security"], { model: "claude-haiku-5-5", effort: "max" });
      assert.deepEqual(read(overridden.run.id)["code-reviewer-correctness"], { model: "claude-haiku-5-5", effort: "medium" });
    } finally {
      store.close();
    }
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
  }
});

test("guided intake requires a usable public key before inserting a run", () => {
  const root = workspace();
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  process.env.BW_APPROVAL_PUBLIC_KEY = `${root}-missing-public.pem`;
  try {
    repository(root);
    const store = openStore(root);
    try {
      assert.throws(() => createRunIntake(store, root, {
        project: "project",
        featureId: "feature-1",
        slug: "feature-one",
        changeKind: "feature",
        model: "test-model",
        narrationCheck: "off",
      }, { requireApprovalSigner: true }), /approval public key not found/);
      assert.deepEqual(store.query("SELECT * FROM run"), []);
      assert.deepEqual(store.query("SELECT * FROM audit"), []);
    } finally {
      store.close();
    }
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a shared profile-freeze failure blocks and audits the created run", () => {
  const root = workspace();
  const keyDirectory = `${root}-keys`;
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    repository(root);
    mkdirSync(keyDirectory);
    const { publicKey } = generateKeyPairSync("ed25519");
    const publicPath = join(keyDirectory, "approval.pub");
    writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }));
    process.env.BW_APPROVAL_PUBLIC_KEY = publicPath;
    const store = openStore(root);
    try {
      mkdirSync(join(root, ".governance", "profiles"), { recursive: true });
      writeFileSync(join(root, ".governance", "profiles", "1"), "collision\n");
      assert.throws(() => createRunIntake(store, root, {
        project: "project",
        featureId: "feature-1",
        slug: "feature-one",
        changeKind: "feature",
        model: "test-model",
        narrationCheck: "off",
      }), (error: unknown) => {
        assert.ok(error instanceof RunIntakeFreezeError);
        assert.equal(error.runId, 1);
        return true;
      });
      assert.equal(store.getRun(1)!.status, "blocked");
      assert.deepEqual(store.getAuditEvents(1).map((event) => event.action),
        ["run.create", "profile.freeze.failed"]);
      assert.equal(verifyAuditChain(store), null);
    } finally {
      store.close();
    }
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
    rmSync(keyDirectory, { recursive: true, force: true });
  }
});

// --- the narration check (narration-check-spec-review Task 3) ---------------

/**
 * The deployment the probe recorded, and the threshold and question hash the
 * 2026-10-17 evaluation recorded for the narration check: values from outside
 * the code under test.
 */
const PROBE = JSON.parse(readFileSync(resolve("test", "fixtures", "recorded", "systemone-probe-snitch-resource.json"), "utf8")).provenance as {
  endpoint: string; deployment: string; deploymentType: string;
};
const EVALUATION = JSON.parse(readFileSync(resolve("test", "fixtures", "recorded", "systemone-format-checks-evaluation.json"), "utf8")) as {
  requests: Array<{ check: string; questionHash: string }>;
  score: Array<{ verdict: { check: string; threshold: number } }>;
};
const NARRATION_ENV = {
  SYSTEMONE_ENDPOINT: PROBE.endpoint,
  SYSTEMONE_DEPLOYMENT: PROBE.deployment,
  SYSTEMONE_DEPLOYMENT_TYPE: PROBE.deploymentType,
  SYSTEMONE_API_KEY: "k-test-not-a-real-key",
};

function withIntakeRepository(fn: (root: string, store: Store) => void): void {
  const root = workspace();
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  process.env.BW_APPROVAL_PUBLIC_KEY = join(root, "missing-public.pem");
  try {
    repository(root);
    const store = openStore(root);
    try {
      fn(root, store);
    } finally {
      store.close();
    }
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
  }
}

const NARRATED = { project: "project", featureId: "feature-1", slug: "feature-one", changeKind: "feature" as const, model: "test-model", narrationCheck: "on" as const };

test("narration check on freezes the environment's deployment, the evaluated threshold and question, and never the key", () => {
  withIntakeRepository((root, store) => {
    const created = createRunIntake(store, root, NARRATED, { env: NARRATION_ENV });
    const profile = JSON.parse(readFileSync(profilePath(root, created.run.id), "utf8"));
    const narration = EVALUATION.score.find((s) => s.verdict.check === "narration")!.verdict;
    const questionHashes = new Set(EVALUATION.requests.filter((r) => r.check === "narration").map((r) => r.questionHash));
    assert.equal(questionHashes.size, 1);
    assert.deepEqual(profile.narrationCheck, {
      endpoint: PROBE.endpoint,
      deployment: PROBE.deployment,
      deploymentType: PROBE.deploymentType,
      threshold: narration.threshold,
      timeoutMs: 120_000,
      questionHash: [...questionHashes][0],
    });
    assert.ok(!readFileSync(profilePath(root, created.run.id), "utf8").includes(NARRATION_ENV.SYSTEMONE_API_KEY), "the key is never frozen");
    const events = store.getAuditEvents(created.run.id);
    assert.deepEqual(events.map((e) => e.action), ["run.create", "profile.freeze", "run.narration"]);
    assert.match(events[2]!.summary, new RegExp(`^narration check on; endpoint=${PROBE.endpoint.replace(/[.]/g, "\\.")}; deployment=${PROBE.deployment}; `));
    assert.ok(!events[2]!.summary.includes(NARRATION_ENV.SYSTEMONE_API_KEY));
  });
});

test("narration check on refuses before any run row when a variable or the key is missing, and says how to go without it", () => {
  withIntakeRepository((root, store) => {
    for (const name of Object.keys(NARRATION_ENV)) {
      const env: Record<string, string | undefined> = { ...NARRATION_ENV, [name]: undefined };
      assert.throws(
        () => createRunIntake(store, root, NARRATED, { env }),
        new RegExp(`^Error: narration check: ${name} is not set; set it, or create the run with new-run --no-narration-check$`)
      );
    }
    assert.throws(
      () => createRunIntake(store, root, NARRATED, { env: { ...NARRATION_ENV, SYSTEMONE_ENDPOINT: "http://example.com/v1" } }),
      /^Error: narration check: SYSTEMONE_ENDPOINT must be an absolute https URL; set it, or create/
    );
    assert.deepEqual(store.query("SELECT * FROM run"), [], "no refusal leaves a run row");
    assert.deepEqual(store.query("SELECT * FROM audit"), []);
  });
});

// --- new-run --after (design-split-into-features Task 8) --------------------

const COMMITTER = ["-c", "user.name=BuildWorks", "-c", "user.email=buildworks@example.invalid"];

function commitAll(root: string): string {
  git(root, "add", "-A");
  git(root, ...COMMITTER, "commit", "-qm", "schema-bound fixture");
  return git(root, "rev-parse", "HEAD");
}

interface Delivered {
  root: string;
  store: Store;
  runId: number;
  worktree: string;
}

/**
 * A completed earlier run whose delivery record verifies: a copy of
 * `withBoundary(10, ...)` from test/operator-state.test.ts, so the record is
 * written by the real verification, code-review and delivery stages and never
 * typed here. The root's untracked copies of the spec and plan are removed at
 * the end, as the operator would before merging, since the delivered branch
 * commits the same two files.
 */
async function withDeliveredRun(fn: (ctx: Delivered) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-intake-after-"));
  const store = openStore(root);
  const oldMode = process.env.EMIT_MODE;
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  process.env.EMIT_MODE = "ok";
  process.env.BW_APPROVAL_PUBLIC_KEY = join(root, "missing-public.pem");
  try {
    git(root, "init", "-q");
    writeFileSync(join(root, ".gitignore"), ".governance/\n*.scratch\n");
    writeFileSync(join(root, "base.txt"), "schema-bound worktree marker\n");
    writeFileSync(join(root, "governed.yaml"), 'verify:\n  - name: node\n    command: ["node", "--version"]\n');
    const specPath = join(root, "docs", "features", "demo", "spec.md");
    const planPath = join(root, "docs", "features", "demo", "plan.md");
    mkdirSync(dirname(specPath), { recursive: true });
    writeFileSync(join(dirname(specPath), "design.md"), "# design\nThe declared artifact must be committed.\n");
    const startingCommit = commitAll(root);
    const run = store.insertRun("operator", "demo", "demo", "feature");
    const frozen = freezeProfile(root, run.id, startingCommit, "fixture-model",
      { commands: [{ name: "node", command: ["node", "--version"] }], derived: [] });
    const { profile } = loadProfile(root, run.id);
    profile.approvalSigner = null;
    profile.executor = { ...profile.executor,
      command: [process.execPath, resolve("test", "fixtures", "harness", "emit-code-review.mjs")],
      probe: [process.execPath, "--version"],
      sandbox: { ...profile.executor.sandbox, envPassthrough: [...profile.executor.sandbox.envPassthrough, "EMIT_MODE"] } };
    profile.policyHash = policyHash(profile.policy);
    const serialized = canonicalJson(profile);
    writeFileSync(frozen.path, serialized);
    store.setProfileRef(run.id, sha256Hex(serialized));
    const audit = (stageId: number, action: string, summary: string) =>
      appendAudit(store, { runId: run.id, stageId, actor: "system", actorType: "cli", action, summary });
    const specification = `feature: demo
change_kind: feature

## Declared artifacts

- src/a1.ts

## Acceptance criteria

- AC-001: The declared artifact must be committed.
`;
    const spec = validateSpecDoc(specification);
    assert.ok(spec.ok, spec.ok ? "" : spec.reason);
    const scope = computeScope(spec.value.declaredArtifacts);
    const risk = computeRisk(run.change_kind, scope.length, false);
    const specHash = sha256Hex(normalizeText(specification));
    const planText = `feature: demo
plan_for: ${specHash}

## Tasks

- Commit the declared artifact.

## Coverage

- ${spec.value.acceptanceCriteria[0]!.id} -> ${scope[0]}
`;
    const plan = validatePlanDoc(planText);
    assert.ok(plan.ok, plan.ok ? "" : plan.reason);
    let predecessor: number | null = null;
    const stage = (kind: string, ref: string) => {
      const row = store.insertStage(run.id, kind, predecessor);
      audit(row.id, kind === "awaiting_approval" ? "approval.stage.create" : `${kind}.stage.create`, `created ${kind} stage ${row.id}`);
      store.completeStage(row.id, ref, "pass");
      predecessor = row.id;
      return row.id;
    };
    writeFileSync(specPath, specification);
    stage("spec", specPath);
    audit(stage("spec_review", specPath), "spec.gate.pass", `spec_review gate passed in round 1; specHash=${specHash}; risk=${risk}`);
    audit(stage("spec_decision", specPath), "spec_decision.gate.pass",
      `spec_decision gate passed; specHash=${specHash}; risk=${risk}; answers=0; folded=0`);
    const approvalStage = stage("awaiting_approval", specPath);
    const approval = store.insertApproval({ runId: run.id, featureId: run.feature_id, specHash, startingCommit,
      profileHash: store.getRun(run.id)!.profile_ref!, risk, scope: canonicalJson(scope),
      expiresAt: new Date(0).toISOString(), signature: "schema-permitted historical approval", signer: "fixture-signer" });
    audit(approvalStage, "approval.granted", `approval ${approval.id} verified for run ${run.id}, signer ${approval.signer}; signer not bound at intake`);
    writeFileSync(planPath, planText);
    stage("plan", planPath);
    audit(stage("plan_review", planPath), "plan.gate.pass",
      `plan_review gate passed in round 1; planHash=${sha256Hex(normalizeText(planText))}; planFor=${specHash}`);
    const worktree = worktreePath(root, run.id);
    git(root, "worktree", "add", "-q", worktree, "-b", `gov/demo/${run.id}`, startingCommit);
    const docs = join(worktree, "docs", "features", "demo");
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(docs, "spec.md"), specification);
    writeFileSync(join(docs, "plan.md"), planText);
    const base = commitAll(worktree);
    for (const artifact of scope) {
      const path = join(worktree, artifact);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "schema-bound committed artifact\n");
    }
    const head = commitAll(worktree);
    audit(stage("implementation", worktree), "implementation.gate.pass", formatImplementationGate({ base, head }));
    const verified = await runVerificationStage(store, { runId: run.id, rootDir: root });
    assert.ok(verified.ok, verified.ok ? "" : verified.reason);
    const reviewed = await runCodeReviewStage(store, profile.executor, { runId: run.id, rootDir: root });
    assert.ok(reviewed.ok, reviewed.ok ? "" : reviewed.reason);
    const delivered = runDeliveryStage(store, { runId: run.id, rootDir: root });
    assert.ok(delivered.ok, delivered.ok ? "" : delivered.reason);
    assert.equal(store.getRun(run.id)!.status, "completed");
    rmSync(specPath);
    rmSync(planPath);
    await fn({ root, store, runId: run.id, worktree });
  } finally {
    store.close();
    if (oldMode === undefined) delete process.env.EMIT_MODE;
    else process.env.EMIT_MODE = oldMode;
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
  }
}

const NEXT_FEATURE = { project: "operator", featureId: "demo-2", slug: "demo-part-2", changeKind: "feature" as const, model: "test-model", narrationCheck: "off" as const };

function runCount(store: Store): number {
  return store.query<{ n: number }>("SELECT COUNT(*) n FROM run")[0]!.n;
}

/** createRunIntake with `after` refuses with `reason` and adds no run row. */
function refusesAfter(ctx: Delivered, after: number, reason: RegExp): void {
  const before = runCount(ctx.store);
  assert.throws(() => createRunIntake(ctx.store, ctx.root, { ...NEXT_FEATURE, after }), reason);
  assert.equal(runCount(ctx.store), before, "a refused link leaves no run row");
}

test("--after over a merged delivered commit freezes the link and records it", async () => {
  await withDeliveredRun(({ root, store, runId, worktree }) => {
    git(root, ...COMMITTER, "merge", "--no-ff", "-q", "-m", "merge feature 1", `gov/demo/${runId}`);
    const delivered = git(worktree, "rev-parse", "HEAD");
    const created = createRunIntake(store, root, { ...NEXT_FEATURE, after: runId });
    const profile = JSON.parse(readFileSync(profilePath(root, created.run.id), "utf8"));
    assert.deepEqual(profile.after, { runId, deliveredCommit: delivered });
    const events = store.getAuditEvents(created.run.id);
    assert.deepEqual(events.map((e) => e.action), ["run.create", "profile.freeze", "run.narration", "run.after"]);
    assert.equal(events[3]!.summary, `after run ${runId}; deliveredCommit=${delivered}`);
    assert.equal(verifyAuditChain(store), null);
  });
});

test("--after refuses a delivered commit that is not in the checkout's history", async () => {
  await withDeliveredRun((ctx) => {
    refusesAfter(ctx, ctx.runId, new RegExp(`--after: run ${ctx.runId}'s delivered commit [0-9a-f]{12} is not in this checkout's history: merge \\(not squash\\) gov/demo/${ctx.runId} and commit`));
  });
});

test("--after refuses a squash-merged delivery", async () => {
  await withDeliveredRun((ctx) => {
    git(ctx.root, "merge", "--squash", "-q", `gov/demo/${ctx.runId}`);
    git(ctx.root, ...COMMITTER, "commit", "-qm", "squash feature 1");
    assert.ok(readFileSync(join(ctx.root, "src", "a1.ts"), "utf8"), "the squash brought the delivered file in");
    refusesAfter(ctx, ctx.runId, /is not in this checkout's history: merge \(not squash\)/);
  });
});

test("--after refuses a missing run and a run that is not completed", async () => {
  await withDeliveredRun((ctx) => {
    git(ctx.root, ...COMMITTER, "merge", "--no-ff", "-q", "-m", "merge feature 1", `gov/demo/${ctx.runId}`);
    refusesAfter(ctx, 999, /--after: run 999 does not exist/);
    const other = ctx.store.insertRun("operator", "demo-3", "demo-other", "feature");
    ctx.store.setRunStatus(other.id, "blocked");
    refusesAfter(ctx, other.id, new RegExp(`--after: run ${other.id} is blocked, not completed`));
  });
});

test("--after refuses a run that belongs to another project, adding no run row", async () => {
  await withDeliveredRun((ctx) => {
    git(ctx.root, ...COMMITTER, "merge", "--no-ff", "-q", "-m", "merge feature 1", `gov/demo/${ctx.runId}`);
    const before = runCount(ctx.store);
    assert.throws(
      () => createRunIntake(ctx.store, ctx.root, { ...NEXT_FEATURE, project: "elsewhere", after: ctx.runId }),
      new RegExp(`--after: run ${ctx.runId} belongs to project operator, not elsewhere; a feature builds only on an earlier feature of its own project`)
    );
    assert.equal(runCount(ctx.store), before, "a refused link leaves no run row");
    // The same link from the run's own project is accepted, so the refusal is about the project alone.
    assert.equal(createRunIntake(ctx.store, ctx.root, { ...NEXT_FEATURE, after: ctx.runId }).run.project, "operator");
  });
});

test("--after refuses a completed run whose delivery record no longer verifies", async () => {
  await withDeliveredRun((ctx) => {
    git(ctx.root, ...COMMITTER, "merge", "--no-ff", "-q", "-m", "merge feature 1", `gov/demo/${ctx.runId}`);
    const delivery = ctx.store.getStageChain(ctx.runId).at(-1)!;
    assert.equal(delivery.kind, "delivery_check");
    rmSync(resolve(ctx.root, delivery.output_ref!));
    refusesAfter(ctx, ctx.runId,
      new RegExp(`--after: run ${ctx.runId}'s delivery record does not verify: cannot (read delivery_check evidence at|inspect) `));
  });
});

test("--after names the first broken record, not the delivery record that no longer matches it", async () => {
  await withDeliveredRun((ctx) => {
    git(ctx.root, ...COMMITTER, "merge", "--no-ff", "-q", "-m", "merge feature 1", `gov/demo/${ctx.runId}`);
    // The delivery record is intact but now fails to match the verification
    // handoff; its own reason says only that. The cause is the missing record.
    const verification = ctx.store.getStageChain(ctx.runId).find((s) => s.kind === "verification")!;
    rmSync(resolve(ctx.root, verification.output_ref!));
    refusesAfter(ctx, ctx.runId,
      new RegExp(`--after: run ${ctx.runId}'s delivery record does not verify: cannot read verification evidence at `));
  });
});
