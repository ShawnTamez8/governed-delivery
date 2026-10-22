import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type Store } from "../src/store.ts";
import { runVerificationStage } from "../src/verification-stage.ts";
import { checkWorktreeClean } from "../src/workspace-commit.ts";
import { freezeProfile, loadProfile } from "../src/profile.ts";
import { appendAudit, verifyAuditChain } from "../src/audit.ts";
import { canonicalJson, sha256Hex } from "../src/canonical.ts";
import { policyHash } from "../src/policy.ts";
import type { Profile } from "../src/profile.ts";
import type { VerifyCommand } from "../src/governed-config.ts";
import { sandboxLeftovers } from "../src/container.ts";
import { verificationEvidenceDir } from "../src/paths.ts";
import { readAcceptanceReport, type AcceptanceReport } from "../src/acceptance.ts";
import { parseVerificationHandoff } from "../src/handoff.ts";
import {
  acceptanceRuns,
  markUnremovable,
  recordingDockerCommand,
  sandboxPrefix,
  serveAcceptanceReport,
  STAND_IN_DOCKER_COMMAND,
  standInSandbox,
  workContainerMounts,
} from "./fixtures/docker/stand-in.ts";

const FIXTURES = join(process.cwd(), "test", "fixtures", "verify");
const MODEL = "m";
const SLUG = "demo";

const OK: VerifyCommand = { name: "ok", command: ["node", join(FIXTURES, "exit-zero.mjs")] };
const FAILING: VerifyCommand = { name: "failing", command: ["node", join(FIXTURES, "exit-two.mjs")] };
const CWD: VerifyCommand = { name: "cwd", command: ["node", join(FIXTURES, "print-cwd.mjs")] };
const HANG: VerifyCommand = { name: "hang", command: ["node", join(FIXTURES, "hang-with-child.mjs")] };
const FLOOD: VerifyCommand = { name: "flood", command: ["node", join(FIXTURES, "flood-stdout.mjs")] };
const TOUCH: VerifyCommand = { name: "touch", command: ["node", join(FIXTURES, "touch-tracked.mjs")] };
const MOVE: VerifyCommand = { name: "move", command: ["node", join(FIXTURES, "commit-empty.mjs")] };
const MISSING: VerifyCommand = { name: "missing", command: ["definitely-not-a-real-binary"] };
const WRITE_IGNORED: VerifyCommand = { name: "build", command: ["node", join(FIXTURES, "write-ignored.mjs")] };

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

interface Ctx {
  store: Store;
  root: string;
  runId: number;
  head: string;
  worktreePath: string;
  implementationStageId: number;
}

interface Opts {
  commands?: VerifyCommand[];
  /** Skip the recorded gate event entirely. */
  gateEvent?: false;
  /** Write a summary that the handoff parse must refuse. */
  gateSummary?: string;
  /** Leave the implementation stage in this status instead of passing it. */
  implementationStatus?: "blocked";
  /** Skip creating the worktree, so the path does not exist. */
  worktree?: false;
  /** Extra `.gitignore` lines after `.governance/`. */
  ignore?: string[];
  /** Further files committed beside `base.txt`, by repository path. */
  files?: Record<string, string>;
}

/**
 * A run parked exactly where the verification stage expects it: a real git
 * repository, a real linked worktree on the run branch, an `implementation`
 * stage passed with the worktree as its `output_ref`, and the head that stage
 * committed recorded in its own audit event. Nothing is dispatched — every
 * precondition must be reachable without spending.
 */
function withImplementedRun(fn: (ctx: Ctx) => Promise<void>, opts: Opts = {}): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-verification-"));
  const store = openStore(root);
  try {
    assert.equal(git(root, ["init", "-q"]).status, 0);
    writeFileSync(join(root, ".gitignore"), [".governance/", ...(opts.ignore ?? [])].join("\n") + "\n");
    writeFileSync(join(root, "base.txt"), "base\n");
    for (const [path, content] of Object.entries(opts.files ?? {})) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    assert.equal(git(root, ["add", "-A"]).status, 0);
    const commit = git(root, [
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "-m",
      "base",
    ]);
    assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
    const head = git(root, ["rev-parse", "HEAD"]).stdout.trim();
    assert.match(head, /^[0-9a-f]{40}([0-9a-f]{24})?$/);

    const run = store.insertRun("p", "f-1", SLUG, "feature");
    const frozen = freezeProfile(root, run.id, head, MODEL, {
      commands: opts.commands ?? [OK],
      derived: [],
    }, standInSandbox());
    store.setProfileRef(run.id, frozen.hash);

    const worktreePath = join(root, ".governance", "worktrees", String(run.id));
    if (opts.worktree !== false) {
      const added = git(root, ["worktree", "add", "-q", worktreePath, "-b", `gov/${SLUG}/${run.id}`, head]);
      assert.equal(added.status, 0, `git worktree add failed: ${added.stderr}`);
    }

    const stage = store.insertStage(run.id, "implementation", null);
    if (opts.implementationStatus === "blocked") {
      store.completeStage(stage.id, "", "block");
    } else {
      store.completeStage(stage.id, worktreePath, "pass");
    }
    if (opts.gateEvent !== false) {
      appendAudit(store, {
        runId: run.id,
        stageId: stage.id,
        actor: "system",
        actorType: "cli",
        action: "implementation.gate.pass",
        // The one canonical handoff shape (step 8, task 2): base and head.
        // The fixture's base equals its head because verification parses the
        // shape and refuses malformed ones; base semantics are delivery's.
        summary: opts.gateSummary ?? `base=${head}; head=${head}`,
      });
    }

    return Promise.resolve(
      fn({ store, root, runId: run.id, head, worktreePath, implementationStageId: stage.id })
    ).finally(() => {
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
 * Rewrite the frozen profile and re-record its hash on the run.
 *
 * The stage reads its ceilings from the profile, and `buildPolicy`'s real
 * values (a 900-second command ceiling, a 1MB output budget) cannot be
 * exercised in a test suite. Re-freezing rather than reaching past the profile
 * is what keeps these tests honest: the stage still loads a profile whose hash
 * matches the run row, so a stage reading the live constant instead of the
 * frozen value fails here.
 */
function refreeze(root: string, store: Store, runId: number, mutate: (p: Profile) => void): void {
  const { profile } = loadProfile(root, runId);
  mutate(profile);
  // `policyHash` is recomputed rather than carried over. The profile validity
  // check refuses a profile whose recorded hash does not describe its own
  // policy, so a mutation that skipped this would be refused for the wrong
  // reason and the test would prove nothing about the limit it was changing.
  profile.policyHash = policyHash(profile.policy);
  const serialized = canonicalJson(profile);
  writeFileSync(join(root, ".governance", "profiles", String(runId), "profile.json"), serialized);
  store.setProfileRef(runId, sha256Hex(serialized));
}

function readRecord(root: string, resultRef: string) {
  return JSON.parse(readFileSync(join(root, resultRef), "utf8")) as {
    worktreePath: string;
    verifiedCommit: string;
    patchBase: string;
    outcome: string;
    blockingCommand: string | null;
    commands: { name: string; evidenceRef: string; blockedBecause: string | null }[];
  };
}

// --- the pass path ---

test("the pass path records the worktree, the verified commit, and every command's evidence", async () => {
  await withImplementedRun(async (ctx) => {
    const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.ok(result.ok, result.ok ? "" : result.reason);

    const stage = ctx.store.getStage(result.stageId)!;
    assert.equal(stage.kind, "verification");
    assert.equal(stage.status, "passed");
    assert.equal(stage.gate_result, "pass");
    assert.equal(stage.input_stage_id, ctx.implementationStageId);
    // The run continues: verification passing is not the end of the chain.
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "in_progress");

    const record = readRecord(ctx.root, result.resultRef);
    assert.equal(record.worktreePath, ctx.worktreePath);
    assert.equal(record.verifiedCommit, ctx.head);
    // The handoff's base travels with the record: delivery (step 8) diffs
    // `patchBase..verifiedCommit`, so the base must survive the handoff, not
    // be guessed by the next stage.
    assert.equal(record.patchBase, ctx.head);
    assert.equal(record.outcome, "pass");
    assert.equal(record.blockingCommand, null);
    assert.deepEqual(record.commands.map((c) => c.name), ["ok"]);
    for (const command of record.commands) {
      assert.match(readFileSync(join(ctx.root, command.evidenceRef), "utf8"), /VERIFY_OK/);
    }
    assert.equal(verifyAuditChain(ctx.store), null);
  });
});

test("the commands run in the worktree, not in the repository root", async () => {
  await withImplementedRun(
    async (ctx) => {
      const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.ok(result.ok, result.ok ? "" : result.reason);
      const record = readRecord(ctx.root, result.resultRef);
      // The first line is the header naming the container; the stand-in runs
      // the command where the worktree is mounted at /work.
      const [header, ...output] = readFileSync(join(ctx.root, record.commands[0].evidenceRef), "utf8").split("\n");
      assert.match(header!, /^# ran in container /);
      const printed = output.join("\n").trim();
      assert.equal(
        statSync(printed).ino,
        statSync(ctx.worktreePath).ino,
        `command ran in ${printed}, not the worktree ${ctx.worktreePath}`
      );
    },
    { commands: [CWD] }
  );
});

test("a work container the stand-in cannot remove blocks verification with no verification result recorded", async () => {
  await withImplementedRun(async (ctx) => {
    const unmark = markUnremovable(sandboxPrefix(ctx.root, ctx.runId, "verification"));
    try {
      const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.equal(result.ok, false);
      assert.match((result as { reason: string }).reason, /^verification blocked: work container \S+ \([0-9a-f]{64}\) could not be proven removed/);
      const actions = ctx.store.getAuditEvents(ctx.runId).map((e) => e.action);
      assert.deepEqual(actions.filter((a) => a.startsWith("verification.")), [
        "verification.stage.create",
        "verification.command.pass",
        "verification.sandbox.quiescence.failed",
        "verification.gate.block",
      ]);
      const stage = ctx.store.getStageChain(ctx.runId).find((s) => s.kind === "verification")!;
      assert.equal(stage.status, "blocked");
      assert.equal(stage.output_ref, "");
      assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
      assert.equal(existsSync(join(verificationEvidenceDir(ctx.root, ctx.runId), "result.json")), false);
      assert.equal(verifyAuditChain(ctx.store), null);
    } finally {
      unmark();
      const leftovers = sandboxLeftovers(STAND_IN_DOCKER_COMMAND, ctx.root);
      for (const line of leftovers.containers) spawnSync(process.execPath, [...STAND_IN_DOCKER_COMMAND.slice(1), "rm", "-f", line.split(" ")[0]!]);
      for (const line of leftovers.networks) spawnSync(process.execPath, [...STAND_IN_DOCKER_COMMAND.slice(1), "network", "rm", line.split(" ")[0]!]);
    }
  });
});

test("every configured command runs, in frozen order, when they all pass", async () => {
  await withImplementedRun(
    async (ctx) => {
      const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.ok(result.ok, result.ok ? "" : result.reason);
      assert.deepEqual(
        readRecord(ctx.root, result.resultRef).commands.map((c) => c.name),
        ["ok", "cwd"]
      );
    },
    { commands: [OK, CWD] }
  );
});

test("ignored output the passing commands left is removed, so code review's clean guard passes", async () => {
  await withImplementedRun(
    async (ctx) => {
      const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.ok(result.ok, result.ok ? "" : result.reason);
      // The guard code review applies before its stage row exists
      // (src/code-review-stage.ts), which counts ignored entries.
      assert.deepEqual(checkWorktreeClean(ctx.worktreePath), { ok: true });
      const cleanup = ctx.store.getAuditEvents(ctx.runId).filter((e) => e.action === "verification.cleanup");
      assert.equal(cleanup.length, 1);
      assert.match(cleanup[0]!.summary, /frontend\/dist\//);
      assert.match(cleanup[0]!.summary, /node_modules\//);
      // The evidence lives outside the worktree and survives.
      const record = readRecord(ctx.root, result.resultRef);
      assert.match(readFileSync(join(ctx.root, record.commands[0]!.evidenceRef), "utf8"), /WROTE_IGNORED/);
      assert.equal(verifyAuditChain(ctx.store), null);
    },
    { commands: [WRITE_IGNORED], ignore: ["node_modules/", "dist/"] }
  );
});

// --- the acceptance suite (docs/features/protected-acceptance-tests/plan.md, Tasks 7 and 8) ---

const ACCEPTANCE = { dir: `acceptance/${SLUG}/`, repeatEach: 2 };
const SUITE_FILE = `${ACCEPTANCE.dir}acceptance.spec.mjs`;

/** A recorded acceptance report's one suite file and its parsed report. */
function recordedReport(report: string): { content: string; report: AcceptanceReport } {
  const fixture = JSON.parse(
    readFileSync(join(process.cwd(), "test", "fixtures", "recorded", `acceptance-report-${report}.json`), "utf8")
  ) as { files: { content: string }[]; log: string };
  const read = readAcceptanceReport(fixture.log);
  assert.ok(read.ok, read.ok ? "" : read.reason);
  return { content: fixture.files[0]!.content, report: read.report };
}

/**
 * A run with the suite frozen on and its recorded file committed, whose
 * verification sandbox the stand-in answers with `report`: the stand-in runs no
 * browser.
 */
function withSuiteRun(report: string, fn: (ctx: Ctx) => Promise<void>, opts: Opts = {}): Promise<void> {
  return withImplementedRun(
    async (ctx) => {
      refreeze(ctx.root, ctx.store, ctx.runId, (p) => {
        p.acceptance = ACCEPTANCE;
      });
      const unserve = serveAcceptanceReport(sandboxPrefix(ctx.root, ctx.runId, "verification"), report);
      try {
        await fn(ctx);
      } finally {
        unserve();
      }
    },
    { ...opts, files: { [SUITE_FILE]: recordedReport(report).content } }
  );
}

function readAcceptance(root: string, resultRef: string): { tests: { title: string; outcome: string; failureClass: string | null; message: string | null }[] } | undefined {
  return (JSON.parse(readFileSync(join(root, resultRef), "utf8")) as { acceptance?: never }).acceptance;
}

test("a run with an acceptance suite verifies with the suite mounted read-only, and a run without one mounts only the worktree", async () => {
  // Task 7.
  for (const acceptance of [ACCEPTANCE, null]) {
    await withImplementedRun(async (ctx) => {
      const dir = mkdtempSync(join(tmpdir(), "bw-docker-argv-"));
      const unserve = serveAcceptanceReport(sandboxPrefix(ctx.root, ctx.runId, "verification"), "pass");
      try {
        const recording = recordingDockerCommand(dir);
        refreeze(ctx.root, ctx.store, ctx.runId, (p) => {
          p.acceptance = acceptance;
          p.sandbox.dockerCommand = recording.dockerCommand;
        });
        const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
        assert.ok(result.ok, result.ok ? "" : result.reason);
        const base = [`${ctx.worktreePath}:/work`, `${join(ctx.worktreePath, ".git")}:/work/.git:ro`];
        const overlay = `${join(ctx.worktreePath, "acceptance", SLUG)}:/work/acceptance/${SLUG}:ro`;
        assert.deepEqual(
          workContainerMounts(recording.calls()).map((s) => s.mounts),
          [acceptance === null ? base : [...base, overlay]]
        );
      } finally {
        unserve();
        rmSync(dir, { recursive: true, force: true });
      }
    }, { files: { [SUITE_FILE]: recordedReport("pass").content } });
  }
});

test("a passing suite runs after the frozen commands, passes verification, and records each test", async () => {
  // Task 8.
  await withSuiteRun("pass", async (ctx) => {
    const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    const record = readRecord(ctx.root, result.resultRef);
    assert.deepEqual(record.commands.map((c) => c.name), ["ok", "acceptance"]);
    const titles = [...new Set(recordedReport("pass").report.tests.map((t) => t.title))];
    assert.deepEqual(readAcceptance(ctx.root, result.resultRef), {
      tests: titles.map((title) => ({ title, outcome: "pass", failureClass: null, message: null })),
    });
    // The runner ran on the committed suite, once.
    assert.equal(acceptanceRuns(sandboxPrefix(ctx.root, ctx.runId, "verification")).length, 1);
    // The handoff code review and delivery read still parses the record that carries the suite.
    const handoff = parseVerificationHandoff(JSON.parse(readFileSync(join(ctx.root, result.resultRef), "utf8")), ctx.runId, result.stageId);
    assert.equal(handoff.ok, true, handoff.ok ? "" : handoff.reason);
    assert.equal(verifyAuditChain(ctx.store), null);
  });
});

test("a failing suite blocks verification on the acceptance command, naming the failing test", async () => {
  await withSuiteRun("valid-red-matcher", async (ctx) => {
    const { report } = recordedReport("valid-red-matcher");
    const title = report.tests[0]!.title;
    await assertBlocked(ctx, new RegExp(`^verification blocked on acceptance: acceptance failed: ${escapeRegExp(title)}$`), "acceptance");
    const stage = ctx.store.getStageChain(ctx.runId).find((s) => s.kind === "verification")!;
    // The stand-in serves the recorded log with its suite path rewritten to the committed one.
    const firstError = report.tests[0]!.results.find((r) => r.status !== "passed")!.errors[0]!.message
      .split(report.tests[0]!.file).join(SUITE_FILE);
    assert.deepEqual(readAcceptance(ctx.root, stage.output_ref!), {
      tests: [{ title, outcome: "fail", failureClass: "valid_red", message: firstError }],
    });
    assert.equal(readRecord(ctx.root, stage.output_ref!).commands.at(-1)!.blockedBecause, `acceptance failed: ${title}`);
  });
});

test("a test whose repeats differ blocks verification as flaky, naming the test rather than the code", async () => {
  await withSuiteRun("flaky", async (ctx) => {
    const title = recordedReport("flaky").report.tests[0]!.title;
    await assertBlocked(ctx, new RegExp(`^verification blocked on acceptance: acceptance flaky: ${escapeRegExp(title)}$`), "acceptance");
    const stage = ctx.store.getStageChain(ctx.runId).find((s) => s.kind === "verification")!;
    assert.deepEqual(readAcceptance(ctx.root, stage.output_ref!)!.tests.map((t) => [t.title, t.outcome]), [[title, "flaky"]]);
  });
});

test("a suite that does not load blocks verification by name", async () => {
  await withSuiteRun("load-error", async (ctx) => {
    await assertBlocked(ctx, /^verification blocked on acceptance: acceptance failed: the suite does not load: /, "acceptance");
  });
});

test("the suite's report is held to the retention ceiling, not the frozen commands' output budget", async () => {
  // The recorded pass report's log is larger than this budget; the frozen command's output is not.
  const budget = 4096;
  assert.ok(Buffer.byteLength(JSON.parse(readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "acceptance-report-pass.json"), "utf8")).log) > budget);
  await withSuiteRun("pass", async (ctx) => {
    refreeze(ctx.root, ctx.store, ctx.runId, (p) => {
      p.policy.resultMaxBytes = budget;
    });
    const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    const acceptance = readRecord(ctx.root, result.resultRef).commands.at(-1)!;
    assert.equal(acceptance.name, "acceptance");
    assert.ok(statSync(join(ctx.root, acceptance.evidenceRef)).size > budget, "the retained report exceeds the frozen commands' budget");
  });
});

test("an earlier frozen command's block stands, and the suite never runs", async () => {
  await withSuiteRun(
    "pass",
    async (ctx) => {
      await assertBlocked(ctx, /exited with code 2/, "failing");
      const stage = ctx.store.getStageChain(ctx.runId).find((s) => s.kind === "verification")!;
      assert.deepEqual(readRecord(ctx.root, stage.output_ref!).commands.map((c) => c.name), ["failing"]);
      assert.equal(readAcceptance(ctx.root, stage.output_ref!), undefined);
      assert.equal(acceptanceRuns(sandboxPrefix(ctx.root, ctx.runId, "verification")).length, 0);
    },
    { commands: [FAILING] }
  );
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- the six block paths ---

/** Every block path lands in the same terminal state; only the cause differs. */
async function assertBlocked(ctx: Ctx, pattern: RegExp, blockingCommand: string): Promise<void> {
  const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
  assert.equal(result.ok, false, "expected the stage to block");
  assert.match((result as { ok: false; reason: string }).reason, pattern);
  const chain = ctx.store.getStageChain(ctx.runId);
  const stage = chain.find((s) => s.kind === "verification")!;
  assert.equal(stage.status, "blocked");
  assert.equal(stage.gate_result, "block");
  assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
  const record = readRecord(ctx.root, stage.output_ref!);
  assert.equal(record.outcome, "block");
  assert.equal(record.blockingCommand, blockingCommand);
  // The worktree survives a block (section 7), and so does the evidence.
  assert.ok(statSync(ctx.worktreePath).isDirectory());
  for (const command of record.commands) {
    assert.ok(statSync(join(ctx.root, command.evidenceRef)).isFile());
  }
  assert.equal(verifyAuditChain(ctx.store), null);
}

test("a non-zero exit blocks the run and stops the remaining commands", async () => {
  await withImplementedRun(
    async (ctx) => {
      await assertBlocked(ctx, /exited with code 2/, "failing");
      // The command after the failure never ran: the decision is terminal at
      // the first failure, not after the whole list.
      const stage = ctx.store.getStageChain(ctx.runId).find((s) => s.kind === "verification")!;
      assert.deepEqual(
        readRecord(ctx.root, stage.output_ref!).commands.map((c) => c.name),
        ["failing"]
      );
    },
    { commands: [FAILING, OK] }
  );
});

test("an unresolvable command blocks the run", async () => {
  await withImplementedRun(async (ctx) => await assertBlocked(ctx, /exited with code 1/, "missing"), {
    commands: [MISSING],
  });
});

test("a command that exceeds the frozen ceiling is killed and blocks the run", async () => {
  await withImplementedRun(
    async (ctx) => {
      refreeze(ctx.root, ctx.store, ctx.runId, (p) => {
        p.policy.verifyCommandTimeoutSeconds = 2;
      });
      const started = Date.now();
      await assertBlocked(ctx, /exceeded the 2-second ceiling/, "hang");
      // Asserted explicitly: a killed run can look green because Node's own
      // exit teardown kills the hung child long after the ceiling should have.
      assert.ok(Date.now() - started < 30_000, "the ceiling did not fire promptly");
    },
    { commands: [HANG] }
  );
});

test("output above the frozen budget blocks the run and the bytes are retained anyway", async () => {
  await withImplementedRun(
    async (ctx) => {
      refreeze(ctx.root, ctx.store, ctx.runId, (p) => {
        p.policy.resultMaxBytes = 4096;
      });
      await assertBlocked(ctx, /more than the 4096-byte output budget/, "flood");
      const stage = ctx.store.getStageChain(ctx.runId).find((s) => s.kind === "verification")!;
      const record = readRecord(ctx.root, stage.output_ref!);
      const retained = statSync(join(ctx.root, record.commands[0].evidenceRef)).size;
      assert.ok(retained > 4096, `evidence file is ${retained} bytes, budget 4096`);
    },
    { commands: [FLOOD] }
  );
});

test("a command that dirties the worktree blocks even though it exits zero", async () => {
  await withImplementedRun(
    async (ctx) => {
      await assertBlocked(ctx, /left the worktree dirty in: .*base\.txt/, "touch");
    },
    { commands: [TOUCH] }
  );
});

test("a command that advances the branch blocks even though it exits zero", async () => {
  await withImplementedRun(
    async (ctx) => {
      await assertBlocked(ctx, /moved the worktree head from/, "move");
    },
    { commands: [MOVE] }
  );
});

test("a worktree already dirty at entry is refused before the stage row exists", async () => {
  await withImplementedRun(async (ctx) => {
    appendFileSync(join(ctx.worktreePath, "base.txt"), "uncommitted\n");
    const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; reason: string }).reason, /not clean before verification/);
    // Refused before any state mutation: no stage row, and the run continues.
    assert.equal(ctx.store.getStageChain(ctx.runId).some((s) => s.kind === "verification"), false);
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "in_progress");
  });
});

// --- the recorded head, which is the proof the committed deliverable was tested ---

test("a missing implementation.gate.pass event refuses rather than skipping the head check", async () => {
  await withImplementedRun(
    async (ctx) => {
      const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.equal(result.ok, false);
      assert.match(
        (result as { ok: false; reason: string }).reason,
        /has no implementation\.gate\.pass audit event/
      );
      assert.equal(ctx.store.getStageChain(ctx.runId).some((s) => s.kind === "verification"), false);
    },
    { gateEvent: false }
  );
});

test("an implementation.gate.pass summary that does not match the handoff shape refuses", async () => {
  await withImplementedRun(
    async (ctx) => {
      const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.equal(result.ok, false);
      assert.match(
        (result as { ok: false; reason: string }).reason,
        /does not record the implementation handoff as base=<commit>; head=<commit>/
      );
    },
    { gateSummary: "implementation passed" }
  );
});

test("the pre-step-8 head-only summary shape refuses by name, never defaulted", async () => {
  // Nothing has shipped, so no compatibility branch exists for the old
  // `head=<sha>` form the implementation stage wrote before task 2: a run
  // whose gate event lacks the base cannot be verified into a delivery.
  await withImplementedRun(
    async (ctx) => {
      const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.equal(result.ok, false);
      assert.match(
        (result as { ok: false; reason: string }).reason,
        /does not record the implementation handoff as base=<commit>; head=<commit>/
      );
      assert.equal(ctx.store.getStageChain(ctx.runId).some((s) => s.kind === "verification"), false);
    },
    { gateSummary: `head=${"a".repeat(40)}` }
  );
});

test("a worktree at a different commit than implementation recorded is refused", async () => {
  await withImplementedRun(async (ctx) => {
    const moved = git(ctx.worktreePath, [
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "moved out from under the stage",
    ]);
    assert.equal(moved.status, 0, moved.stderr);
    const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match(
      (result as { ok: false; reason: string }).reason,
      /not the commit implementation left/
    );
    assert.equal(ctx.store.getStageChain(ctx.runId).some((s) => s.kind === "verification"), false);
  });
});

// --- every other precondition, refused by name ---

test("a nonexistent run is refused by name", async () => {
  await withImplementedRun(async (ctx) => {
    const result = await runVerificationStage(ctx.store, { runId: 9999, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; reason: string }).reason, /run 9999 does not exist/);
  });
});

test("a run that is not in progress is refused by name", async () => {
  await withImplementedRun(async (ctx) => {
    ctx.store.setRunStatus(ctx.runId, "blocked");
    const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; reason: string }).reason, /is blocked, not in_progress/);
  });
});

test("a second verification stage is refused, naming the existing one's status", async () => {
  await withImplementedRun(async (ctx) => {
    const first = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.ok(first.ok, first.ok ? "" : first.reason);
    const second = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(second.ok, false);
    assert.match(
      (second as { ok: false; reason: string }).reason,
      /already has a verification stage with status passed/
    );
  });
});

test("a last stage that is not a passed implementation is refused by name", async () => {
  await withImplementedRun(
    async (ctx) => {
      const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.equal(result.ok, false);
      assert.match(
        (result as { ok: false; reason: string }).reason,
        /last stage is implementation \(blocked\), not a passed implementation/
      );
    },
    { implementationStatus: "blocked" }
  );
});

test("a missing worktree is refused by name", async () => {
  await withImplementedRun(
    async (ctx) => {
      const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.equal(result.ok, false);
      assert.match((result as { ok: false; reason: string }).reason, /worktree for run \d+ is missing at/);
    },
    { worktree: false }
  );
});

test("a profile modified since intake is refused by name", async () => {
  await withImplementedRun(async (ctx) => {
    const path = join(ctx.root, ".governance", "profiles", String(ctx.runId), "profile.json");
    appendFileSync(path, " ");
    const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; reason: string }).reason, /has been modified since intake/);
  });
});

test("a run past the frozen duration limit is refused by name", async () => {
  await withImplementedRun(async (ctx) => {
    // The limit stays a real one and the *run* is what goes stale. A frozen
    // limit of zero used to be how this reached the breach path, but zero is
    // not a configuration that can be frozen any more — it would refuse every
    // run the moment it started — so the run is backdated past a one-second
    // limit instead, which is how a run actually breaches it.
    refreeze(ctx.root, ctx.store, ctx.runId, (p) => {
      p.policy.runDurationLimitSeconds = 1;
    });
    ctx.store.exec("UPDATE run SET created_at = ? WHERE id = ?", [
      new Date(Date.now() - 3600_000).toISOString(),
      ctx.runId,
    ]);
    const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match(
      (result as { ok: false; reason: string }).reason,
      /exceeded the run-duration limit of 1 seconds/
    );
  });
});

test("an unexpected failure blocks the run rather than wedging it", async () => {
  await withImplementedRun(async (ctx) => {
    // The evidence directory is where the stage writes, so a file in its place
    // makes `mkdirSync` throw from inside the guarded body — an unexpected
    // failure the stage did not enumerate.
    mkdirSync(join(ctx.root, ".governance", "verification"), { recursive: true });
    writeFileSync(join(ctx.root, ".governance", "verification", String(ctx.runId)), "not a directory");
    const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; reason: string }).reason, /verification stage failed:/);
    const stage = ctx.store.getStageChain(ctx.runId).find((s) => s.kind === "verification")!;
    assert.equal(stage.status, "blocked");
    assert.equal(ctx.store.getRun(ctx.runId)!.status, "blocked");
    assert.equal(verifyAuditChain(ctx.store), null);
  });
});
