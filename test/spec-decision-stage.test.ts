import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type Store } from "../src/store.ts";
import { verifyAuditChain } from "../src/audit.ts";
import { freezeUniformProfile } from "./uniform-profile.ts";
import { runSpecStage } from "../src/spec-stage.ts";
import { answerQuestion, DECISION_ANSWER_MAX_CHARS, runSpecDecisionStage } from "../src/spec-decision-stage.ts";
import { validateSpecDoc } from "../src/spec-doc.ts";
import type { ExecutorDefinition } from "../src/executor.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { parseGovernedConfig, type VerificationConfig } from "../src/governed-config.ts";
import { buildSpecDecisionFoldPrompt, type FoldQuestionInput } from "../src/prompts.ts";
import { SPEC_AUTHOR } from "../src/agents/spec-author.ts";
import { computeScope } from "../src/scope.ts";
import { policyHash } from "../src/policy.ts";
import { DESIGN_SPLIT_INTENT, readSplitRecord, renderPieceDesign, type SplitEvidence } from "../src/design-split.ts";
import { readRunSnapshot } from "../src/operator-state.ts";
import { readDependencyRecord } from "../src/dependency-policy.ts";

/**
 * One minimal frozen configuration. The fold prompt states it; the command name
 * and tokens must stay clear of the words the stage emitter routes on, because
 * it routes over the whole prompt (test/prompts.test.ts guards this).
 */
const VERIFICATION: VerificationConfig = { commands: [{ name: "unit", command: ["node", "--version"] }], derived: [] };
const FIXTURE = join(process.cwd(), "test", "fixtures", "harness", "emit-spec-stage.mjs");
const CLI = join(process.cwd(), "src", "cli.ts");

function fixtureExecutor(scriptPath: string): ExecutorDefinition {
  return {
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

function freezeExecutorIntoProfile(store: Store, root: string, runId: number, executor: ExecutorDefinition): void {
  const path = join(root, ".governance", "profiles", String(runId), "profile.json");
  const profile = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  profile.executor = executor;
  const serialized = canonicalJson(profile);
  writeFileSync(path, serialized);
  store.setProfileRef(runId, sha256Hex(serialized));
}

interface Ctx {
  store: Store;
  root: string;
  runId: number;
}

/**
 * A real repository and a frozen run whose design carries `marker`, so the
 * stock fixture's reconcile answers in that operator-question mode. The
 * question rows the tests answer are written by `runSpecStage` itself, not
 * inserted by hand (hazard 4).
 */
function withRun(
  marker: string,
  fn: (ctx: Ctx) => Promise<void>,
  verification: VerificationConfig = VERIFICATION
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-spec-decision-"));
  const store = openStore(root);
  const git = (args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const cleanup = () => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  };
  try {
    assert.equal(git(["init", "-q"]).status, 0);
    writeFileSync(join(root, "base.txt"), "base");
    assert.equal(git(["add", "-A"]).status, 0);
    assert.equal(git(["-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "-m", "base"]).status, 0);
    const head = git(["rev-parse", "HEAD"]).stdout.trim();
    const run = store.insertRun("p", "f-1", "demo", "feature");
    const frozen = freezeUniformProfile(root, run.id, head, "m", verification);
    store.setProfileRef(run.id, frozen.hash);
    freezeExecutorIntoProfile(store, root, run.id, fixtureExecutor(FIXTURE));
    mkdirSync(join(root, "docs", "features", "demo"), { recursive: true });
    writeFileSync(join(root, "docs", "features", "demo", "design.md"), `# design\n\n${marker}\n`);
    return Promise.resolve(fn({ store, root, runId: run.id })).finally(cleanup);
  } catch (err) {
    cleanup();
    throw err;
  }
}

/** Run the spec stage to its question pause and return the asked finding. */
async function pausedAtQuestion(ctx: Ctx): Promise<{ findingId: number; reviewStageId: number }> {
  const result = await runSpecStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
  assert.ok(result.ok, result.ok ? "" : result.reason);
  assert.equal(result.stageIds.specDecision, null, "the fixture mode must open a question");
  const questions = ctx.store.getDecisionQuestions(result.stageIds.specReview);
  assert.equal(questions.length, 1);
  return { findingId: questions[0].finding_id, reviewStageId: result.stageIds.specReview };
}

function events(store: Store, runId: number, action: string) {
  return store.query<{ summary: string; actor: string; actor_type: string; stage_id: number | null }>(
    "SELECT summary, actor, actor_type, stage_id FROM audit WHERE run_id = ? AND action = ? ORDER BY id",
    [runId, action]
  );
}

test("approve records the recommended option's answer as a human decision", async () => {
  await withRun("FIXTURE-ASK-OPERATOR", async (ctx) => {
    const { findingId, reviewStageId } = await pausedAtQuestion(ctx);
    const question = ctx.store.getDecisionQuestions(reviewStageId)[0];
    const recommended = (JSON.parse(question.options) as { answer: string }[])[question.recommended].answer;
    const result = answerQuestion(ctx.store, { runId: ctx.runId, findingId, action: "approve" });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.equal(result.answer, recommended);
    assert.equal(result.open, 0);
    const answers = ctx.store.getDecisionAnswers(reviewStageId);
    assert.deepEqual(
      answers.map((a) => [a.question_id, a.action, a.answer]),
      [[question.id, "approve", recommended]]
    );
    const recorded = events(ctx.store, ctx.runId, "decision.answer");
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].actor, "operator");
    assert.equal(recorded[0].actor_type, "human");
    assert.equal(recorded[0].stage_id, reviewStageId);
    assert.match(recorded[0].summary, new RegExp(`finding ${findingId} answered approve; answerHash=${sha256Hex(recommended)}`));
    assert.equal(verifyAuditChain(ctx.store), null);
  });
});

test("deny records an empty answer and modify records the operator's text", async () => {
  await withRun("FIXTURE-ASK-OPERATOR", async (ctx) => {
    const { findingId, reviewStageId } = await pausedAtQuestion(ctx);
    const denied = answerQuestion(ctx.store, { runId: ctx.runId, findingId, action: "deny" });
    assert.ok(denied.ok, denied.ok ? "" : denied.reason);
    assert.equal(ctx.store.getDecisionAnswers(reviewStageId)[0].answer, "");
  });
  await withRun("FIXTURE-ASK-CANNOT", async (ctx) => {
    const { findingId, reviewStageId } = await pausedAtQuestion(ctx);
    const text = "Exports are retained for ninety days.";
    // Surrounding whitespace is dropped by the core, so every writer records the same text.
    const modified = answerQuestion(ctx.store, { runId: ctx.runId, findingId, action: "modify", answer: `\n  ${text} \r\n` });
    assert.ok(modified.ok, modified.ok ? "" : modified.reason);
    assert.equal(modified.answer, text);
    assert.deepEqual(
      ctx.store.getDecisionAnswers(reviewStageId).map((a) => [a.action, a.answer]),
      [["modify", text]]
    );
  });
});

test("every malformed answer is refused by name, audited, and records nothing", async () => {
  await withRun("FIXTURE-ASK-OPERATOR", async (ctx) => {
    const { findingId, reviewStageId } = await pausedAtQuestion(ctx);
    const cases: [Parameters<typeof answerQuestion>[1], RegExp][] = [
      [{ runId: ctx.runId, findingId, action: "modify" }, /modify requires a non-empty answer/],
      [{ runId: ctx.runId, findingId, action: "modify", answer: "  \n" }, /modify requires a non-empty answer/],
      [
        { runId: ctx.runId, findingId, action: "modify", answer: "x".repeat(DECISION_ANSWER_MAX_CHARS + 1) },
        new RegExp(`${DECISION_ANSWER_MAX_CHARS + 1} characters; the limit is ${DECISION_ANSWER_MAX_CHARS}`),
      ],
      [{ runId: ctx.runId, findingId, action: "approve", answer: "mine" }, /approve takes no answer text/],
      [{ runId: ctx.runId, findingId, action: "deny", answer: "" }, /deny takes no answer text/],
      [{ runId: ctx.runId, findingId, action: "accept" }, /invalid decision action accept: allowed values are approve, deny, modify/],
      [{ runId: ctx.runId, findingId: 999999, action: "approve" }, /finding 999999 has no question in run \d+'s spec_review stage/],
    ];
    for (const [input, reason] of cases) {
      const result = answerQuestion(ctx.store, input);
      assert.equal(result.ok, false, JSON.stringify(input).slice(0, 80));
      if (result.ok) continue;
      assert.match(result.reason, reason);
    }
    assert.equal(ctx.store.getDecisionAnswers(reviewStageId).length, 0);
    const refused = events(ctx.store, ctx.runId, "decision.refused");
    assert.equal(refused.length, cases.length);
    assert.ok(refused.every((e) => e.actor === "operator" && e.actor_type === "human" && e.stage_id === null));
  });
});

test("a question answered once refuses a second answer", async () => {
  await withRun("FIXTURE-ASK-OPERATOR", async (ctx) => {
    const { findingId, reviewStageId } = await pausedAtQuestion(ctx);
    assert.ok(answerQuestion(ctx.store, { runId: ctx.runId, findingId, action: "deny" }).ok);
    const again = answerQuestion(ctx.store, { runId: ctx.runId, findingId, action: "approve" });
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.match(again.reason, /already answered; answers are immutable/);
    assert.deepEqual(ctx.store.getDecisionAnswers(reviewStageId).map((a) => a.action), ["deny"]);
  });
});

test("a finding without a question, or one belonging to another run's stage, is refused", async () => {
  await withRun("FIXTURE-ASK-OPERATOR", async (ctx) => {
    const { findingId, reviewStageId } = await pausedAtQuestion(ctx);
    const unasked = ctx.store.getCanonicalFindings(reviewStageId).find((f) => f.id !== findingId)!;
    const own = answerQuestion(ctx.store, { runId: ctx.runId, findingId: unasked.id, action: "approve" });
    assert.equal(own.ok, false);
    if (!own.ok) assert.match(own.reason, new RegExp(`finding ${unasked.id} has no question`));

    // A second run in the same store, paused at its own question: its finding
    // must not be answerable through the first run.
    const other = ctx.store.insertRun("p", "f-2", "other", "feature");
    const spec = ctx.store.insertStage(other.id, "spec", null);
    ctx.store.completeStage(spec.id, "docs/features/other/spec.md", "pass");
    const review = ctx.store.insertStage(other.id, "spec_review", spec.id);
    ctx.store.completeStage(review.id, "docs/features/other/spec.md", "pass");
    const foreign = ctx.store.upsertCanonicalFinding(review.id, 1, "foreign", "AC-001");
    ctx.store.insertDecisionQuestion({
      findingId: foreign.id,
      text: "t",
      options: [{ label: "a", answer: "A" }, { label: "b", answer: "B" }],
      recommended: 0,
      why: "w",
    });
    const crossed = answerQuestion(ctx.store, { runId: ctx.runId, findingId: foreign.id, action: "approve" });
    assert.equal(crossed.ok, false);
    if (!crossed.ok) assert.match(crossed.reason, new RegExp(`finding ${foreign.id} has no question in run ${ctx.runId}'s`));
    assert.equal(ctx.store.getDecisionAnswers(review.id).length, 0);
    assert.equal(ctx.store.getDecisionAnswers(reviewStageId).length, 0);
  });
});

test("a run that is not paused at a question refuses every answer", async () => {
  await withRun("FIXTURE-ASK-OPERATOR", async (ctx) => {
    const { findingId } = await pausedAtQuestion(ctx);
    ctx.store.setRunStatus(ctx.runId, "blocked");
    const blocked = answerQuestion(ctx.store, { runId: ctx.runId, findingId, action: "approve" });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.reason, /is blocked, not in_progress/);
  });
  // No question opened: the spec group already passed spec_decision.
  await withRun("no marker", async (ctx) => {
    const result = await runSpecStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.ok(result.ok && result.stageIds.specDecision !== null);
    const closed = answerQuestion(ctx.store, { runId: ctx.runId, findingId: 1, action: "approve" });
    assert.equal(closed.ok, false);
    if (!closed.ok) assert.match(closed.reason, /already has a spec_decision stage: its questions are closed/);
  });
  await withRun("no marker", async (ctx) => {
    const missing = answerQuestion(ctx.store, { runId: 424242, findingId: 1, action: "approve" });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.match(missing.reason, /run 424242 does not exist/);
    assert.equal(ctx.store.query("SELECT * FROM audit").length, 0, "no event names a run that does not exist");
  });
});

test("a failed decision.answer append leaves no answer and no event, and the same answer then succeeds", async () => {
  await withRun("FIXTURE-ASK-OPERATOR", async (ctx) => {
    const { findingId, reviewStageId } = await pausedAtQuestion(ctx);
    const realExec = ctx.store.exec.bind(ctx.store);
    (ctx.store as { exec: unknown }).exec = (sql: string, params?: unknown[]) => {
      if (sql.startsWith("INSERT INTO audit") && params?.includes("decision.answer")) {
        throw new Error("simulated crash mid-answer");
      }
      return realExec(sql, params as never);
    };
    assert.throws(
      () => answerQuestion(ctx.store, { runId: ctx.runId, findingId, action: "approve" }),
      /simulated crash mid-answer/
    );
    (ctx.store as { exec: unknown }).exec = realExec;
    assert.equal(ctx.store.getDecisionAnswers(reviewStageId).length, 0, "the answer rolled back with its event");
    assert.equal(events(ctx.store, ctx.runId, "decision.answer").length, 0);
    const retried = answerQuestion(ctx.store, { runId: ctx.runId, findingId, action: "approve" });
    assert.ok(retried.ok, retried.ok ? "" : retried.reason);
    assert.equal(ctx.store.getDecisionAnswers(reviewStageId).length, 1);
    assert.equal(verifyAuditChain(ctx.store), null);
  });
});

// --- the decision group: runSpecDecisionStage (Task 6) ----------------------

interface Paused {
  reviewStageId: number;
  specPath: string;
  questions: ReturnType<Store["getDecisionQuestions"]>;
  disclosed: number | null;
}

/** Run the spec stage to its pause and return every question it opened. */
async function paused(ctx: Ctx): Promise<Paused> {
  const result = await runSpecStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
  assert.ok(result.ok, result.ok ? "" : result.reason);
  assert.equal(result.stageIds.specDecision, null, "the fixture mode must open a question");
  const questions = ctx.store.getDecisionQuestions(result.stageIds.specReview);
  const disclosed = ctx.store
    .getCanonicalFindings(result.stageIds.specReview)
    .find((f) => f.intent_key === "disclosed-open-decision");
  return { reviewStageId: result.stageIds.specReview, specPath: result.specPath, questions, disclosed: disclosed?.id ?? null };
}

function answer(ctx: Ctx, findingId: number, action: string, text?: string): void {
  const result = answerQuestion(ctx.store, { runId: ctx.runId, findingId, action, ...(text === undefined ? {} : { answer: text }) });
  assert.ok(result.ok, result.ok ? "" : result.reason);
}

function decisionAgentRuns(store: Store, runId: number): number {
  return store.query<{ n: number }>(
    "SELECT COUNT(*) n FROM agent_run ar JOIN stage s ON s.id = ar.stage_id WHERE s.run_id = ? AND s.kind = 'spec_decision'",
    [runId]
  )[0].n;
}

function lastSummary(store: Store, runId: number, action: string): string | undefined {
  return store.query<{ summary: string }>(
    "SELECT summary FROM audit WHERE run_id = ? AND action = ? ORDER BY id DESC LIMIT 1",
    [runId, action]
  )[0]?.summary;
}

function odLine(spec: string): string | undefined {
  return normalizeText(spec).split("\n").find((line) => line.startsWith("- OD-001 "));
}

test("an approved answer is folded into the spec, grounded in that answer, and the gate records the folded hash", async () => {
  await withRun("FIXTURE-ASK-OPERATOR", async (ctx) => {
    const { questions, specPath } = await paused(ctx);
    answer(ctx, questions[0].finding_id, "approve");
    const recommended = (JSON.parse(questions[0].options) as { answer: string }[])[questions[0].recommended].answer;
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.equal(result.folded, 1);
    const chain = ctx.store.getStageChain(ctx.runId);
    assert.deepEqual(chain.map((s) => [s.kind, s.status]), [["spec", "passed"], ["spec_review", "passed"], ["spec_decision", "passed"]]);
    assert.equal(chain[2].input_stage_id, chain[1].id);
    const onDisk = readFileSync(specPath, "utf8");
    const doc = validateSpecDoc(onDisk);
    assert.ok(doc.ok);
    assert.ok(doc.value.acceptanceCriteria.some((c) => c.text === recommended), "the approved answer is now a criterion");
    assert.equal(decisionAgentRuns(ctx.store, ctx.runId), 1, "one fold dispatch");
    assert.match(
      lastSummary(ctx.store, ctx.runId, "spec_decision.gate.pass")!,
      new RegExp(`specHash=${sha256Hex(normalizeText(onDisk))}; risk=(low|standard|high); answers=1; folded=1`)
    );
    assert.ok(lastSummary(ctx.store, ctx.runId, "spec_decision.fold.record"));
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "in_progress");
    assert.equal(verifyAuditChain(ctx.store), null);
  });
});

test("the fold dispatches under the reconciler setting while recording the author agent", async () => {
  await withRun("FIXTURE-ASK-OPERATOR", async (ctx) => {
    // Give the reconciler values no other setting has, so a fold that resolved
    // spec-author's setting would record different ones.
    const path = join(ctx.root, ".governance", "profiles", String(ctx.runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8")) as { dispatchSettings: Record<string, { model: string; effort: string }> };
    profile.dispatchSettings.reconciler = { model: "reconciler-model", effort: "high" };
    const serialized = canonicalJson(profile);
    writeFileSync(path, serialized);
    ctx.store.setProfileRef(ctx.runId, sha256Hex(serialized));

    const { questions } = await paused(ctx);
    answer(ctx, questions[0].finding_id, "approve");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    const rows = ctx.store.query<{ agent: string; setting: string; requested_model: string; requested_effort: string }>(
      "SELECT ar.agent, ar.setting, ar.requested_model, ar.requested_effort FROM agent_run ar JOIN stage s ON s.id = ar.stage_id WHERE s.run_id = ? AND s.kind = 'spec_decision'",
      [ctx.runId]
    );
    assert.deepEqual(rows.map((r) => ({ ...r })), [
      { agent: "spec-author", setting: "reconciler", requested_model: "reconciler-model", requested_effort: "high" },
    ]);
  });
});

test("when every answer is deny the stage passes the reviewed spec unchanged without a dispatch", async () => {
  await withRun("FIXTURE-DISCLOSE-OD FIXTURE-ASK-EVERY", async (ctx) => {
    const { questions, specPath } = await paused(ctx);
    assert.ok(questions.length >= 2);
    const before = readFileSync(specPath, "utf8");
    for (const q of questions) answer(ctx, q.finding_id, "deny");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.equal(result.folded, 0);
    assert.equal(decisionAgentRuns(ctx.store, ctx.runId), 0, "nothing to fold, nothing spent");
    assert.equal(readFileSync(specPath, "utf8"), before);
    const reviewed = /specHash=([0-9a-f]{64}); risk=(\w+)/.exec(lastSummary(ctx.store, ctx.runId, "spec.gate.pass")!)!;
    assert.match(
      lastSummary(ctx.store, ctx.runId, "spec_decision.gate.pass")!,
      new RegExp(`specHash=${reviewed[1]}; risk=${reviewed[2]}; answers=${questions.length}; folded=0`)
    );
  });
});

test("an approved answer and a denied disclosed open decision fold together, the denied entry byte-for-byte intact", async () => {
  await withRun("FIXTURE-DISCLOSE-OD FIXTURE-ASK-EVERY", async (ctx) => {
    const { questions, specPath, disclosed } = await paused(ctx);
    assert.notEqual(disclosed, null, "the spec disclosed OD-001");
    const reviewerQuestions = questions.filter((q) => q.finding_id !== disclosed);
    const before = odLine(readFileSync(specPath, "utf8"));
    assert.ok(before);
    answer(ctx, disclosed!, "deny");
    answer(ctx, reviewerQuestions[0].finding_id, "approve");
    for (const q of reviewerQuestions.slice(1)) answer(ctx, q.finding_id, "deny");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    const onDisk = readFileSync(specPath, "utf8");
    assert.equal(odLine(onDisk), before);
    const recommended = (JSON.parse(reviewerQuestions[0].options) as { answer: string }[])[reviewerQuestions[0].recommended].answer;
    assert.ok(onDisk.includes(`: ${recommended}`));
  });
});

/** A disclosed OD denied and reviewer questions answered, under a fold mode that breaks one rule. */
async function mixedFoldBlocks(mode: string, reason: RegExp): Promise<void> {
  await withRun(`FIXTURE-DISCLOSE-OD FIXTURE-ASK-EVERY ${mode}`, async (ctx) => {
    const { questions, specPath, disclosed } = await paused(ctx);
    const reviewerQuestions = questions.filter((q) => q.finding_id !== disclosed);
    assert.equal(reviewerQuestions.length, 2);
    const before = readFileSync(specPath, "utf8");
    answer(ctx, disclosed!, "deny");
    answer(ctx, reviewerQuestions[0].finding_id, "modify", "Exports are retained for ninety days.");
    if (mode === "FIXTURE-FOLD-CROSS") {
      answer(ctx, reviewerQuestions[1].finding_id, "modify", "Only the owner may download exports.");
    } else {
      answer(ctx, reviewerQuestions[1].finding_id, "deny");
    }
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false, mode);
    if (result.ok) return;
    assert.match(result.reason, reason);
    const chain = ctx.store.getStageChain(ctx.runId);
    assert.equal(chain.at(-1)!.kind, "spec_decision");
    assert.equal(chain.at(-1)!.status, "blocked");
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
    assert.equal(readFileSync(specPath, "utf8"), before, "a refused fold is never written");
    assert.equal(lastSummary(ctx.store, ctx.runId, "spec_decision.gate.pass"), undefined);
  });
}

test("a fold that deletes a denied disclosed open decision blocks", async () => {
  await mixedFoldBlocks("FIXTURE-FOLD-DROP-OD", /changed open decision\(s\) no folded answer owns: OD-001 was removed/);
});

test("a fold that rewords a denied disclosed open decision blocks", async () => {
  await mixedFoldBlocks(
    "FIXTURE-FOLD-REWORD-OD",
    /changed open decision\(s\) no folded answer owns: OD-001 changed from \(high\) who may download the export archive to \(high\) who may download the archive/
  );
});

test("a fold that deletes an open decision no question was asked about blocks", async () => {
  await withRun("FIXTURE-DISCLOSE-OD FIXTURE-ASK-OPERATOR FIXTURE-ASK-SECOND FIXTURE-FOLD-DROP-OD", async (ctx) => {
    const { questions, specPath, disclosed } = await paused(ctx);
    assert.notEqual(disclosed, null);
    assert.deepEqual(questions.map((q) => q.finding_id === disclosed), [false], "only a reviewer finding is asked");
    const before = readFileSync(specPath, "utf8");
    assert.ok(odLine(before), "the unasked disclosure is still in the reviewed spec");
    answer(ctx, questions[0].finding_id, "approve");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /changed open decision\(s\) no folded answer owns: OD-001 was removed/);
    assert.equal(readFileSync(specPath, "utf8"), before, "a refused fold is never written");
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
  });
});

test("a denied disclosure the review revision already dropped blocks, even when nothing is folded", async () => {
  await withRun("FIXTURE-DISCLOSE-OD FIXTURE-ASK-EVERY FIXTURE-RECONCILE-DROP-OD", async (ctx) => {
    const { questions, specPath, disclosed } = await paused(ctx);
    assert.notEqual(disclosed, null);
    assert.equal(odLine(readFileSync(specPath, "utf8")), undefined, "the review revision dropped OD-001");
    for (const q of questions) answer(ctx, q.finding_id, "deny");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /denied OD-001 is missing from the reviewed spec/);
    assert.equal(decisionAgentRuns(ctx.store, ctx.runId), 0, "refused without a dispatch");
    assert.equal(lastSummary(ctx.store, ctx.runId, "spec_decision.gate.pass"), undefined);
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
  });
});

test("a fold that changes a denied disclosed open decision's severity blocks", async () => {
  await mixedFoldBlocks("FIXTURE-FOLD-RESEVERITY-OD", /OD-001 changed from \(high\) .* to \(low\)/);
});

test("a fold that adds a node for a denied reviewer-raised question blocks as unclaimed", async () => {
  await mixedFoldBlocks(
    "FIXTURE-FOLD-DENIED-NODE",
    /left normative node\(s\) unclaimed by any folded answer: AC-\d+: the denied question is settled after all/
  );
});

test("a fold node grounded in another question's answer blocks", async () => {
  await mixedFoldBlocks("FIXTURE-FOLD-CROSS", /must address every folded answer: finding \d+ is cannot_determine/);
});

test("a fold that adds an open decision blocks", async () => {
  await mixedFoldBlocks("FIXTURE-FOLD-ADD-OD", /added open decision\(s\) OD-099/);
});

test("a fold whose addition the answer does not ground blocks and writes nothing", async () => {
  await withRun("FIXTURE-ASK-OPERATOR FIXTURE-FOLD-UNGROUNDED", async (ctx) => {
    const { questions, specPath } = await paused(ctx);
    const before = readFileSync(specPath, "utf8");
    answer(ctx, questions[0].finding_id, "approve");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, new RegExp(`finding ${questions[0].finding_id} is cannot_determine \\(.*grounding excerpt does not occur`));
    assert.equal(readFileSync(specPath, "utf8"), before);
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
  });
});

test("the decision group refuses before any stage row while a question is unanswered", async () => {
  await withRun("FIXTURE-DISCLOSE-OD FIXTURE-ASK-EVERY", async (ctx) => {
    const { questions } = await paused(ctx);
    answer(ctx, questions[0].finding_id, "approve");
    const chain = ctx.store.getStageChain(ctx.runId);
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, new RegExp(`finding\\(s\\) ${questions.slice(1).map((q) => q.finding_id).join(", ")} are unanswered`));
    assert.deepEqual(ctx.store.getStageChain(ctx.runId), chain);
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "in_progress", "a precondition refusal does not block the run");
  });
});

// --- verification-aware prompts (docs/features/verification-aware-prompts/plan.md) ---

/** team-notes' own governed.yaml, from the run 10 fixture, through the real parser (hazard 4). */
function run10Verification(): VerificationConfig {
  const fixture = JSON.parse(
    readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "run-10-dispatch-context.json"), "utf8")
  ) as { governedYaml: string };
  const parsed = parseGovernedConfig(fixture.governedYaml);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.reason);
  return parsed.config;
}

/**
 * The fold prompt the stage should have sent, rebuilt from the run's own rows:
 * the design the run wrote, the reviewed spec as it stood before the fold, and
 * every question with its recorded answer. `agent_run.input_hash` is the SHA-256
 * of the prompt sent, so equality with this proves what the stage passed.
 */
function expectedFoldPrompt(
  ctx: Ctx,
  marker: string,
  reviewStageId: number,
  reviewedSpec: string,
  verification: VerificationConfig
): string {
  const answers = new Map(ctx.store.getDecisionAnswers(reviewStageId).map((a) => [a.question_id, a]));
  const inputs: FoldQuestionInput[] = ctx.store.getDecisionQuestions(reviewStageId).map((q) => {
    const recorded = answers.get(q.id)!;
    return { findingId: q.finding_id, text: q.text, action: recorded.action as FoldQuestionInput["action"], answer: recorded.answer };
  });
  return buildSpecDecisionFoldPrompt(SPEC_AUTHOR, `# design\n\n${marker}\n`, reviewedSpec, inputs, verification);
}

function foldPromptHashes(store: Store, runId: number): string[] {
  return store
    .query<{ input_hash: string }>(
      "SELECT ar.input_hash FROM agent_run ar JOIN stage s ON s.id = ar.stage_id WHERE s.run_id = ? AND s.kind = 'spec_decision' ORDER BY ar.id",
      [runId]
    )
    .map((r) => r.input_hash);
}

test("a Verification: open decision pauses the run, is answered, and is folded under the frozen commands", async () => {
  // What this proves: the pipeline carries a `Verification:` open decision from
  // the draft through spec_review to an operator question, takes the answer
  // through the fold with the frozen commands in the prompt, and reaches a
  // passed spec_decision gate, which is the point approval binds. What it
  // cannot prove: that the reconciler routes the decision blocking. That route
  // is the fixture's here (FIXTURE-ASK-OPERATOR); in a real run it is the
  // model's, under a prompt rule nothing checks.
  const marker = "FIXTURE-DISCLOSE-VERIFICATION-OD FIXTURE-ASK-OPERATOR";
  const verification = run10Verification();
  const answerText = "The build needs a Next.js app directory: declare app/page.tsx.";
  await withRun(
    marker,
    async (ctx) => {
      const { questions, specPath, disclosed, reviewStageId } = await paused(ctx);
      assert.notEqual(disclosed, null, "the draft's Verification: decision became a finding");
      assert.deepEqual(questions.map((q) => q.finding_id), [disclosed], "the question is on that finding");
      const [report] = ctx.store.getFindingReports(disclosed!);
      assert.match(report.subject, /^OD-001: Verification: /);
      assert.deepEqual(ctx.store.getStageChain(ctx.runId).map((s) => s.kind), ["spec", "spec_review"], "paused before spec_decision");
      assert.equal(ctx.store.getRun(ctx.runId)!.status, "in_progress");

      const reviewed = readFileSync(specPath, "utf8");
      answer(ctx, disclosed!, "modify", answerText);
      const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
      assert.ok(result.ok, result.ok ? "" : result.reason);
      assert.equal(result.folded, 1);

      // The fold dispatch got the frozen commands and the operator's answer.
      const sent = expectedFoldPrompt(ctx, marker, reviewStageId, reviewed, verification);
      for (const line of ["- typecheck: npx tsc --noEmit", "- lint: npm run lint", "- build: npm run build", answerText]) {
        assert.ok(sent.includes(line), `the fold prompt carries ${line}`);
      }
      assert.deepEqual(foldPromptHashes(ctx.store, ctx.runId), [sha256Hex(sent)]);

      const chain = ctx.store.getStageChain(ctx.runId);
      assert.deepEqual(chain.map((s) => [s.kind, s.status]), [["spec", "passed"], ["spec_review", "passed"], ["spec_decision", "passed"]]);
      const onDisk = readFileSync(specPath, "utf8");
      assert.match(
        lastSummary(ctx.store, ctx.runId, "spec_decision.gate.pass")!,
        new RegExp(`specHash=${sha256Hex(normalizeText(onDisk))}; risk=(low|standard|high); answers=1; folded=1`)
      );
      assert.equal(verifyAuditChain(ctx.store), null);
    },
    verification
  );
});

test("the fold prompt carries the frozen profile's commands, and another config changes it", async () => {
  const marker = "FIXTURE-ASK-OPERATOR";
  const other: VerificationConfig = { commands: [{ name: "smoke", command: ["node", "--version"] }], derived: [] };
  async function foldWith(verification: VerificationConfig): Promise<{ sent: string; expected: string }> {
    let observed = { sent: "", expected: "" };
    await withRun(
      marker,
      async (ctx) => {
        const { questions, specPath, reviewStageId } = await paused(ctx);
        const reviewed = readFileSync(specPath, "utf8");
        answer(ctx, questions[0].finding_id, "approve");
        const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
        assert.ok(result.ok, result.ok ? "" : result.reason);
        const [hash] = foldPromptHashes(ctx.store, ctx.runId);
        observed = { sent: hash!, expected: sha256Hex(expectedFoldPrompt(ctx, marker, reviewStageId, reviewed, verification)) };
      },
      verification
    );
    return observed;
  }
  const recorded = await foldWith(VERIFICATION);
  const changed = await foldWith(other);
  assert.equal(recorded.sent, recorded.expected, "the fold sent the prompt built from the frozen commands");
  assert.equal(changed.sent, changed.expected);
  assert.notEqual(recorded.sent, changed.sent, "the fold prompt follows the frozen config");
});

// --- the design split (design-split-into-features Task 7) --------------------

/**
 * A threshold under the stock fixture's declared file count that its two
 * derived halves still fit, read from the fixture's own BASE_SPEC (the same
 * derivation test/spec-stage.test.ts uses), so the spec stage proposes a split.
 */
const SPLIT_THRESHOLD = (() => {
  const literal = /const BASE_SPEC = `([\s\S]*?)`;/.exec(normalizeText(readFileSync(FIXTURE, "utf8")));
  assert.ok(literal, "the fixture defines BASE_SPEC");
  const parsed = validateSpecDoc(literal![1]!);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.reason);
  return Math.ceil(computeScope(parsed.value.declaredArtifacts).length / 2);
})();

/** Rewrite the frozen threshold and re-freeze, recomputing both hashes. */
function freezeSplitThreshold(ctx: Ctx): void {
  const path = join(ctx.root, ".governance", "profiles", String(ctx.runId), "profile.json");
  const profile = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const policy = { ...(profile.policy as Record<string, unknown>), designSplitPathThreshold: SPLIT_THRESHOLD };
  profile.policy = policy;
  profile.policyHash = policyHash(policy as never);
  const serialized = canonicalJson(profile);
  writeFileSync(path, serialized);
  ctx.store.setProfileRef(ctx.runId, sha256Hex(serialized));
}

/** Run the spec stage under the lowered threshold to its pause; `split` is the split question's finding. */
async function pausedAtSplit(ctx: Ctx): Promise<Paused & { split: number }> {
  freezeSplitThreshold(ctx);
  const result = await paused(ctx);
  const record = readSplitRecord(ctx.store.getAuditEvents(ctx.runId));
  const question = result.questions.find((q) => q.finding_id === record?.findingId);
  assert.ok(question, "the spec stage proposed a split");
  return { ...result, split: question!.finding_id };
}

/** The split the review recorded: the evidence the `spec.split.record` event names. */
function recordedSplit(ctx: Ctx): { ref: string; path: string; evidence: SplitEvidence } {
  const summary = lastSummary(ctx.store, ctx.runId, "spec.split.record")!;
  const ref = /evidence=([^;]+);/.exec(summary)![1]!;
  const path = join(ctx.root, ref);
  return { ref, path, evidence: JSON.parse(readFileSync(path, "utf8")) as SplitEvidence };
}

/** The proposals the decision group stored: a review-stage question's proposal is not one. */
function splitProposals(ctx: Ctx) {
  return ctx.store.query<{ id: number; title: string; problem: string; why_upstream: string; route: string; evidence_ref: string; stage_id: number }>(
    "SELECT p.* FROM proposal p JOIN stage s ON s.id = p.stage_id WHERE p.run_id = ? AND s.kind = 'spec_decision' ORDER BY p.id",
    [ctx.runId]
  );
}

test("an approved split stores one rendered design per feature, folds nothing, and ends the run blocked with the next steps", async () => {
  await withRun("FIXTURE-SPLIT-CRITERIA", async (ctx) => {
    const { questions, specPath, split } = await pausedAtSplit(ctx);
    assert.deepEqual(questions.map((q) => q.finding_id), [split], "the split is the only question");
    answer(ctx, split, "approve");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(decisionAgentRuns(ctx.store, ctx.runId), 0, "no fold dispatch");
    const chain = ctx.store.getStageChain(ctx.runId);
    assert.deepEqual(chain.map((s) => [s.kind, s.status]), [["spec", "passed"], ["spec_review", "passed"], ["spec_decision", "blocked"]]);
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");

    // Each stored design is the renderer's output for that piece, computed
    // here from the retained evidence and the reviewed spec on disk.
    const { ref, evidence } = recordedSplit(ctx);
    const spec = validateSpecDoc(readFileSync(specPath, "utf8"));
    assert.ok(spec.ok, spec.ok ? "" : spec.reason);
    const proposals = splitProposals(ctx);
    assert.equal(proposals.length, 2);
    for (const [index, proposal] of proposals.entries()) {
      const piece = evidence.split.pieces[index]!;
      assert.equal(proposal.stage_id, chain[2].id);
      assert.equal(proposal.title, piece.title);
      assert.equal(proposal.route, "blocking_dependency");
      assert.equal(proposal.evidence_ref, ref);
      assert.equal(
        proposal.problem,
        renderPieceDesign({ originalSlug: "demo", runId: ctx.runId, spec: spec.value, split: evidence.split, index: index + 1, decisions: [] })
      );
      assert.match(proposal.why_upstream, new RegExp(`^Feature ${index + 1} of 2 split from run ${ctx.runId}'s design \\(demo\\)`));
      assert.deepEqual(ctx.store.getProposalSources(proposal.id), [split]);
    }
    assert.match(proposals[1]!.why_upstream, /build after: demo-part-1\.$/);
    for (const [index, proposal] of proposals.entries()) {
      assert.ok(result.reason.includes(`${proposal.id} (demo-part-${index + 1})`), result.reason);
    }
    assert.match(result.reason, /^design split approved: 2 features stored as proposals /);
    assert.match(result.reason, /new-run --after/);
    const approved = events(ctx.store, ctx.runId, "spec_decision.split.approve");
    assert.equal(approved.length, 1);
    assert.equal(approved[0]!.summary, `proposals=${proposals.map((p) => p.id).join(",")}; slugs=demo-part-1,demo-part-2`);
    const last = ctx.store.getAuditEvents(ctx.runId).at(-1)!;
    assert.equal(last.action, "spec_decision.split.blocked");
    assert.equal(last.summary, result.reason);
    const observed = readRunSnapshot(ctx.store, ctx.root, ctx.runId).snapshot;
    assert.equal(observed.phase, "blocked");
    assert.ok(observed.workflowAction.reasons.some((r) => r.reason.includes(result.reason)), "status shows the split reason");
    // status suggests exporting each feature under its slug, the name its
    // design moves to, not a name derived from its title.
    const exports = observed.operatorActions.filter((a) => a.kind === "proposal_export");
    assert.deepEqual(
      exports.map((a) => a.args.slice(a.args.indexOf("--proposal"))),
      proposals.map((p, index) => ["--proposal", String(p.id), "--name", `demo-part-${index + 1}`])
    );
    assert.equal(verifyAuditChain(ctx.store), null);

    // The operator's export step: the stored design reaches docs/proposals/
    // through proposal-export, never through the run.
    const exported = spawnSync(process.execPath, [CLI, "proposal-export", "--repo", ctx.root, "--proposal", String(proposals[0]!.id), "--name", "demo-part-1"], {
      cwd: ctx.root, encoding: "utf8",
    });
    assert.equal(exported.status, 0, exported.stderr);
    const file = readFileSync(join(ctx.root, "docs", "proposals", "demo-part-1.md"), "utf8");
    assert.ok(file.includes(`## Problem\n\n${proposals[0]!.problem}`), "the export carries the rendered design under ## Problem");
  });
});

test("an approved split carries the operator's other answers into every feature's design", async () => {
  await withRun("FIXTURE-SPLIT-CRITERIA FIXTURE-DISCLOSE-OD FIXTURE-ASK-OPERATOR", async (ctx) => {
    const { questions, split, disclosed } = await pausedAtSplit(ctx);
    assert.notEqual(disclosed, null);
    assert.deepEqual(questions.map((q) => q.finding_id).sort((a, b) => a - b), [disclosed!, split].sort((a, b) => a - b));
    const asked = questions.find((q) => q.finding_id === disclosed)!;
    const modified = "Exports are kept for ninety days.";
    answer(ctx, disclosed!, "modify", modified);
    answer(ctx, split, "approve");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.equal(decisionAgentRuns(ctx.store, ctx.runId), 0, "the answers are carried, not folded");
    const proposals = splitProposals(ctx);
    assert.equal(proposals.length, 2);
    for (const proposal of proposals) {
      const section = proposal.problem.split("## Decisions already made\n\n")[1] ?? "";
      assert.ok(section.startsWith(`${asked.text}\n\nAnswer: ${modified}\n`), section);
    }
  });
});

test("a denied split folds nothing and the run continues to approval with the reviewed spec", async () => {
  await withRun("FIXTURE-SPLIT-CRITERIA", async (ctx) => {
    const { specPath, split } = await pausedAtSplit(ctx);
    const before = readFileSync(specPath, "utf8");
    answer(ctx, split, "deny");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.equal(result.folded, 0);
    assert.equal(decisionAgentRuns(ctx.store, ctx.runId), 0);
    assert.equal(readFileSync(specPath, "utf8"), before);
    assert.equal(splitProposals(ctx).length, 0, "a denied split leaves no feature behind");
    assert.equal(ctx.store.getStageChain(ctx.runId).at(-1)!.status, "passed");
    assert.equal(readRunSnapshot(ctx.store, ctx.root, ctx.runId).snapshot.phase, "awaiting_approval");
    assert.equal(events(ctx.store, ctx.runId, "spec_decision.split.approve").length, 0);
  });
});

test("a denied split is left out of the fold of the other answers", async () => {
  const marker = "FIXTURE-SPLIT-CRITERIA FIXTURE-DISCLOSE-OD FIXTURE-ASK-OPERATOR";
  await withRun(marker, async (ctx) => {
    const { questions, specPath, split, disclosed, reviewStageId } = await pausedAtSplit(ctx);
    const reviewed = readFileSync(specPath, "utf8");
    answer(ctx, split, "deny");
    answer(ctx, disclosed!, "approve");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.equal(result.folded, 1);
    const [sent] = foldPromptHashes(ctx.store, ctx.runId);
    const recorded = new Map(ctx.store.getDecisionAnswers(reviewStageId).map((a) => [a.question_id, a]));
    const input = (q: (typeof questions)[number]): FoldQuestionInput => {
      const a = recorded.get(q.id)!;
      return { findingId: q.finding_id, text: q.text, action: a.action as FoldQuestionInput["action"], answer: a.answer };
    };
    const build = (qs: typeof questions) =>
      sha256Hex(buildSpecDecisionFoldPrompt(SPEC_AUTHOR, `# design\n\n${marker}\n`, reviewed, qs.map(input), VERIFICATION));
    assert.equal(sent, build(questions.filter((q) => q.finding_id !== split)), "the fold prompt carries every question but the split");
    assert.notEqual(sent, build(questions), "and is not the prompt that carries the split");
    assert.equal(splitProposals(ctx).length, 0);
  });
});

test("modify is refused on the split question and still accepted on another", async () => {
  await withRun("FIXTURE-SPLIT-CRITERIA FIXTURE-DISCLOSE-OD FIXTURE-ASK-OPERATOR", async (ctx) => {
    const { split, disclosed, reviewStageId } = await pausedAtSplit(ctx);
    const refused = answerQuestion(ctx.store, { runId: ctx.runId, findingId: split, action: "modify", answer: "split it in three" });
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.reason, "the design-split question takes approve (split) or deny (build as one); modify is not accepted");
    const audited = events(ctx.store, ctx.runId, "decision.refused");
    assert.equal(audited.length, 1);
    assert.equal(audited[0]!.summary, refused.reason);
    assert.equal(ctx.store.getDecisionAnswers(reviewStageId).length, 0, "no answer was recorded");
    answer(ctx, disclosed!, "modify", "Only the owner may download exports.");
    assert.deepEqual(ctx.store.getDecisionAnswers(reviewStageId).map((a) => a.action), ["modify"]);
  });
});

test("split evidence or a reviewed spec edited after the pause refuses the approved split and stores nothing", async (t) => {
  for (const edit of ["evidence", "spec"] as const) {
    await t.test(edit, async () => {
      await withRun("FIXTURE-SPLIT-CRITERIA", async (ctx) => {
        const { specPath, split } = await pausedAtSplit(ctx);
        answer(ctx, split, "approve");
        if (edit === "evidence") {
          const { path } = recordedSplit(ctx);
          writeFileSync(path, `${readFileSync(path, "utf8")}\n`);
        } else {
          const spec = readFileSync(specPath, "utf8");
          const changed = spec.replace("the second thing works", "the second thing works quickly");
          assert.notEqual(changed, spec);
          assert.ok(validateSpecDoc(changed).ok, "a valid spec with a different hash");
          writeFileSync(specPath, changed);
        }
        const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.match(
          result.reason,
          edit === "evidence"
            ? /design split refused: the split evidence .* has changed since spec review recorded it/
            : /design split refused: the reviewed spec .* has changed since the split was proposed/
        );
        assert.equal(events(ctx.store, ctx.runId, "spec_decision.split.invalid").length, 1);
        assert.equal(splitProposals(ctx).length, 0);
        assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
      });
    });
  }
});

test("a reviewer's own design-split concern stays its own question beside the proposed split", async () => {
  await withRun("FIXTURE-SPLIT-CRITERIA FIXTURE-ASK-OPERATOR FIXTURE-REVIEWER-SPLIT-INTENT", async (ctx) => {
    const { questions, split, reviewStageId } = await pausedAtSplit(ctx);
    const reviewer = ctx.store
      .getCanonicalFindings(reviewStageId)
      .find((f) => f.intent_key === DESIGN_SPLIT_INTENT && f.id !== split);
    assert.ok(reviewer, "a reviewer reported the split's intent key");
    // Two findings, one question each: the split's report, decision and
    // question did not attach to the reviewer's finding.
    assert.deepEqual(questions.map((q) => q.finding_id).sort((a, b) => a - b), [reviewer!.id, split].sort((a, b) => a - b));
    assert.ok(questions[0]!.finding_id === reviewer!.id, "the reviewer's question is the older one");
    assert.equal(ctx.store.getFindingReports(split).length, 1);
    // The reviewer's question takes modify like any other; only the split refuses it.
    const ownWords = "Keep the design whole; the reviewer's concern is noted.";
    answer(ctx, reviewer!.id, "modify", ownWords);
    answer(ctx, split, "approve");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /^design split approved: 2 features stored as proposals /);
    const proposals = splitProposals(ctx);
    assert.equal(proposals.length, 2);
    for (const proposal of proposals) {
      assert.deepEqual(ctx.store.getProposalSources(proposal.id), [split]);
      assert.ok(proposal.problem.includes(`Answer: ${ownWords}`), "the reviewer's answered question is carried as another decision");
    }
  });
});

test("a spec with too few criteria to split is not sent for a split, and the run goes on as one", async () => {
  // The stock spec has one criterion and more files than the lowered
  // threshold: every split needs at least two pieces with a criterion each.
  await withRun("no marker", async (ctx) => {
    freezeSplitThreshold(ctx);
    const result = await runSpecStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.notEqual(result.stageIds.specDecision, null, "no question opened; spec_decision passed");
    const spec = validateSpecDoc(readFileSync(result.specPath, "utf8"));
    assert.ok(spec.ok, spec.ok ? "" : spec.reason);
    assert.equal(spec.value.acceptanceCriteria.length, 1);
    assert.ok(computeScope(spec.value.declaredArtifacts).length > SPLIT_THRESHOLD, "the spec is over the threshold");
    const skipped = events(ctx.store, ctx.runId, "spec.split.skipped");
    assert.equal(skipped.length, 1);
    assert.match(skipped[0]!.summary, new RegExp(`threshold=${SPLIT_THRESHOLD}; criteria=1: a split needs at least 2 criteria`));
    assert.equal(events(ctx.store, ctx.runId, "spec.split.record").length, 0);
    const splitDispatches = ctx.store.query<{ input_hash: string }>(
      "SELECT ar.input_hash FROM agent_run ar JOIN stage s ON s.id = ar.stage_id WHERE s.run_id = ? AND s.kind = 'spec' AND ar.agent = 'spec-author'",
      [ctx.runId]
    );
    // Author draft, self-critique and one reconciliation per configured round; no split.
    const rounds = (JSON.parse(readFileSync(join(ctx.root, ".governance", "profiles", String(ctx.runId), "profile.json"), "utf8")) as {
      policy: { specReviewRounds: number };
    }).policy.specReviewRounds;
    assert.equal(splitDispatches.length, 2 + rounds);
  });
});

test("status offers the split question approve or deny only, and every other question all three", async () => {
  await withRun("FIXTURE-SPLIT-CRITERIA FIXTURE-DISCLOSE-OD FIXTURE-ASK-OPERATOR", async (ctx) => {
    const { split, disclosed } = await pausedAtSplit(ctx);
    const actions = readRunSnapshot(ctx.store, ctx.root, ctx.runId).snapshot.operatorActions.filter((a) => a.kind === "decision_answer");
    const reasonFor = (finding: number) => actions.find((a) => a.args.includes(String(finding)))!.reason!;
    assert.equal(reasonFor(split), "Choose exactly one of --approve (split) or --deny (build as one); this question takes no --answer-file.");
    assert.equal(reasonFor(disclosed!), "Choose exactly one of --approve, --deny, or --answer-file <path>.");
  });
});

test("the decision fold runs in the target root, as the spec author dispatches do, and the reviewers do not", async () => {
  await withRun("FIXTURE-ASK-OPERATOR FIXTURE-REPORT-CWD", async (ctx) => {
    const { questions } = await paused(ctx);
    answer(ctx, questions[0]!.finding_id, "approve");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.equal(decisionAgentRuns(ctx.store, ctx.runId), 1, "the fold dispatched");
    // The emitter reports its working directory to stderr, which dispatchOnce
    // retains in its own raw file; the test process runs from the checkout.
    assert.notEqual(realpathSync(process.cwd()), realpathSync(ctx.root));
    const dir = join(ctx.root, ".governance", "raw", String(ctx.runId));
    const cwds = readdirSync(dir)
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .filter((text) => text.startsWith("--- stderr ---\n"))
      .flatMap((text) => [...text.matchAll(/^cwd=(.*)$/gm)].map((m) => m[1]!.trim()));
    // Draft, self-critique, reconciliation and the fold in the target; the two
    // spec reviewers elsewhere (hazard 14).
    const target = realpathSync(ctx.root);
    const inTarget = cwds.filter((cwd) => realpathSync(cwd) === target).length;
    assert.deepEqual({ inTarget, elsewhere: cwds.length - inTarget }, { inTarget: 4, elsewhere: 2 }, "one report per dispatch, the fold's included");
    const dispatches = ctx.store.query("SELECT ar.id FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ?", [ctx.runId]);
    assert.equal(cwds.length, dispatches.length);
  });
});

test("a failed split approval event leaves no stored feature", async () => {
  await withRun("FIXTURE-SPLIT-CRITERIA", async (ctx) => {
    const { split } = await pausedAtSplit(ctx);
    answer(ctx, split, "approve");
    const realExec = ctx.store.exec.bind(ctx.store);
    (ctx.store as { exec: unknown }).exec = (sql: string, params?: unknown[]) => {
      if (sql.startsWith("INSERT INTO audit") && params?.includes("spec_decision.split.approve")) {
        throw new Error("simulated crash mid-approval");
      }
      return realExec(sql, params as never);
    };
    try {
      const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason, /simulated crash mid-approval/);
    } finally {
      (ctx.store as { exec: unknown }).exec = realExec;
    }
    assert.equal(splitProposals(ctx).length, 0, "the proposals rolled back with the event that names them");
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
  });
});

// --- dependency additions (derived-artifacts-and-dependency-policy Task 8) ----

/**
 * The four packages crew-chatter run 4's reviewed spec named only in prose,
 * read from the committed recording; FIXTURE-DEPENDENCIES lists them under
 * frontend/package.json in that order.
 */
const RECORDED_ADDITIONS = (
  JSON.parse(
    readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "spec-crew-chatter-run-4-dependency-in-prose.json"), "utf8")
  ) as { provenance: { packagesAdded: string[] } }
).provenance.packagesAdded.map((name) => `frontend/package.json:${name}`);

/** Run the spec stage to its pause; `dependency` is the dependency question's finding. */
async function pausedAtDependencies(ctx: Ctx): Promise<Paused & { dependency: number }> {
  const result = await paused(ctx);
  const record = readDependencyRecord(ctx.store.getAuditEvents(ctx.runId));
  const question = result.questions.find((q) => q.finding_id === record?.findingId);
  assert.ok(question, "the spec stage asked about the dependency list");
  return { ...result, dependency: question!.finding_id };
}

test("an approved dependency list folds nothing and the run continues to approval with the reviewed spec", async () => {
  await withRun("FIXTURE-DEPENDENCIES", async (ctx) => {
    const { questions, specPath, dependency } = await pausedAtDependencies(ctx);
    assert.deepEqual(questions.map((q) => q.finding_id), [dependency], "the dependency list is the only question");
    const before = readFileSync(specPath, "utf8");
    answer(ctx, dependency, "approve");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.equal(result.folded, 0);
    assert.equal(decisionAgentRuns(ctx.store, ctx.runId), 0, "nothing is folded for the dependency question");
    assert.equal(readFileSync(specPath, "utf8"), before);
    const chain = ctx.store.getStageChain(ctx.runId);
    assert.deepEqual(chain.map((s) => [s.kind, s.status]), [["spec", "passed"], ["spec_review", "passed"], ["spec_decision", "passed"]]);
    const reviewed = /specHash=([0-9a-f]{64}); risk=(\w+)/.exec(lastSummary(ctx.store, ctx.runId, "spec.gate.pass")!)!;
    assert.match(
      lastSummary(ctx.store, ctx.runId, "spec_decision.gate.pass")!,
      new RegExp(`specHash=${reviewed[1]}; risk=${reviewed[2]}; answers=1; folded=0`)
    );
    assert.equal(readRunSnapshot(ctx.store, ctx.root, ctx.runId).snapshot.phase, "awaiting_approval");
    assert.equal(events(ctx.store, ctx.runId, "spec_decision.dependencies.denied").length, 0);
    assert.equal(verifyAuditChain(ctx.store), null);
  });
});

test("a denied dependency list blocks the run and dispatches no fold, even with another answer approved", async () => {
  await withRun("FIXTURE-DEPENDENCIES FIXTURE-ASK-OPERATOR", async (ctx) => {
    const { questions, specPath, dependency } = await pausedAtDependencies(ctx);
    assert.equal(questions.length, 2, "the reviewer's question and the dependency list");
    const other = questions.find((q) => q.finding_id !== dependency)!;
    const before = readFileSync(specPath, "utf8");
    const agentRunsBefore = ctx.store.query("SELECT id FROM agent_run").length;
    answer(ctx, other.finding_id, "approve");
    answer(ctx, dependency, "deny");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    const reason = `the operator denied the packages the specification adds (${RECORDED_ADDITIONS.join(", ")}): this run builds nothing further; state in the design what to use instead and start a fresh run`;
    assert.equal(result.reason, reason);
    assert.equal(ctx.store.query("SELECT id FROM agent_run").length, agentRunsBefore, "no new agent_run row: the approved answer is not folded");
    assert.equal(decisionAgentRuns(ctx.store, ctx.runId), 0);
    const chain = ctx.store.getStageChain(ctx.runId);
    assert.deepEqual(chain.map((s) => [s.kind, s.status]), [["spec", "passed"], ["spec_review", "passed"], ["spec_decision", "blocked"]]);
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
    const denied = events(ctx.store, ctx.runId, "spec_decision.dependencies.denied");
    assert.equal(denied.length, 1);
    assert.equal(denied[0]!.summary, reason);
    assert.equal(denied[0]!.stage_id, chain[2].id);
    assert.equal(readFileSync(specPath, "utf8"), before);
    assert.equal(lastSummary(ctx.store, ctx.runId, "spec_decision.gate.pass"), undefined);
    assert.equal(verifyAuditChain(ctx.store), null);
  });
});

test("modify is refused on the dependency question and still accepted on another", async () => {
  await withRun("FIXTURE-DEPENDENCIES FIXTURE-ASK-OPERATOR", async (ctx) => {
    const { questions, dependency, reviewStageId } = await pausedAtDependencies(ctx);
    const other = questions.find((q) => q.finding_id !== dependency)!;
    const refused = answerQuestion(ctx.store, { runId: ctx.runId, findingId: dependency, action: "modify", answer: "use a plain textarea instead" });
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.reason, "the dependency question takes approve (add the packages) or deny (end the run); modify is not accepted");
    const audited = events(ctx.store, ctx.runId, "decision.refused");
    assert.equal(audited.length, 1);
    assert.equal(audited[0]!.summary, refused.reason);
    assert.equal(ctx.store.getDecisionAnswers(reviewStageId).length, 0, "no answer was recorded");
    answer(ctx, other.finding_id, "modify", "Exports are retained for ninety days.");
    assert.deepEqual(ctx.store.getDecisionAnswers(reviewStageId).map((a) => a.action), ["modify"]);
  });
});

test("a fold that drops a listed package is refused and writes nothing", async () => {
  await withRun("FIXTURE-DEPENDENCIES FIXTURE-ASK-OPERATOR FIXTURE-FOLD-LOSE-PACKAGE", async (ctx) => {
    const { questions, specPath, dependency } = await pausedAtDependencies(ctx);
    const other = questions.find((q) => q.finding_id !== dependency)!;
    const before = readFileSync(specPath, "utf8");
    answer(ctx, other.finding_id, "approve");
    answer(ctx, dependency, "approve");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    const reason = "the fold changed ## Dependencies added; the operator answered the reviewed list, so a different list needs a fresh run";
    assert.equal(result.reason, reason);
    assert.equal(decisionAgentRuns(ctx.store, ctx.runId), 1, "the fold of the other answer ran");
    assert.equal(lastSummary(ctx.store, ctx.runId, "spec_decision.fold.invalid"), reason);
    assert.equal(readFileSync(specPath, "utf8"), before, "a refused fold is never written");
    assert.equal(ctx.store.getStageChain(ctx.runId).at(-1)!.status, "blocked");
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
    assert.equal(lastSummary(ctx.store, ctx.runId, "spec_decision.gate.pass"), undefined);
  });
});

test("a fold that only reorders the listed packages is accepted", async () => {
  await withRun("FIXTURE-DEPENDENCIES FIXTURE-ASK-OPERATOR FIXTURE-FOLD-REORDER-PACKAGES", async (ctx) => {
    const { questions, specPath, dependency } = await pausedAtDependencies(ctx);
    const other = questions.find((q) => q.finding_id !== dependency)!;
    const reviewed = validateSpecDoc(readFileSync(specPath, "utf8"));
    assert.ok(reviewed.ok, reviewed.ok ? "" : reviewed.reason);
    assert.deepEqual(reviewed.value.dependenciesAdded.map((a) => `${a.manifest}:${a.name}`), RECORDED_ADDITIONS);
    answer(ctx, other.finding_id, "approve");
    answer(ctx, dependency, "approve");
    const result = await runSpecDecisionStage(ctx.store, fixtureExecutor(FIXTURE), { runId: ctx.runId, rootDir: ctx.root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.equal(result.folded, 1, "the other answer is folded; the dependency question is not");
    const folded = validateSpecDoc(readFileSync(specPath, "utf8"));
    assert.ok(folded.ok, folded.ok ? "" : folded.reason);
    assert.deepEqual(
      folded.value.dependenciesAdded.map((a) => `${a.manifest}:${a.name}`),
      [...RECORDED_ADDITIONS].reverse(),
      "the fold wrote the same list in another order"
    );
    assert.equal(ctx.store.getStageChain(ctx.runId).at(-1)!.status, "passed");
    assert.equal(events(ctx.store, ctx.runId, "spec_decision.fold.invalid").length, 0);
  });
});
