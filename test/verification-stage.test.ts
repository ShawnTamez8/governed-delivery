import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
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
import { freezeProfile, loadProfile } from "../src/profile.ts";
import { appendAudit, verifyAuditChain } from "../src/audit.ts";
import { canonicalJson, sha256Hex } from "../src/canonical.ts";
import type { Profile } from "../src/profile.ts";
import type { VerifyCommand } from "../src/governed-config.ts";

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
  /** Skip the recorded head event entirely. */
  gateEvent?: false;
  /** Write a summary that the anchored pattern must refuse. */
  gateSummary?: string;
  /** Leave the implementation stage in this status instead of passing it. */
  implementationStatus?: "blocked";
  /** Skip creating the worktree, so the path does not exist. */
  worktree?: false;
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
    writeFileSync(join(root, ".gitignore"), ".governance/\n");
    writeFileSync(join(root, "base.txt"), "base\n");
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
    });
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
        summary: opts.gateSummary ?? `head=${head}`,
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
  const serialized = canonicalJson(profile);
  writeFileSync(join(root, ".governance", "profiles", String(runId), "profile.json"), serialized);
  store.setProfileRef(runId, sha256Hex(serialized));
}

function readRecord(root: string, resultRef: string) {
  return JSON.parse(readFileSync(join(root, resultRef), "utf8")) as {
    worktreePath: string;
    verifiedCommit: string;
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
      const printed = readFileSync(join(ctx.root, record.commands[0].evidenceRef), "utf8").trim();
      assert.equal(
        statSync(printed).ino,
        statSync(ctx.worktreePath).ino,
        `command ran in ${printed}, not the worktree ${ctx.worktreePath}`
      );
    },
    { commands: [CWD] }
  );
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

test("an implementation.gate.pass summary that does not match the pattern refuses", async () => {
  await withImplementedRun(
    async (ctx) => {
      const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
      assert.equal(result.ok, false);
      assert.match(
        (result as { ok: false; reason: string }).reason,
        /does not record a commit/
      );
    },
    { gateSummary: "implementation passed" }
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
    refreeze(ctx.root, ctx.store, ctx.runId, (p) => {
      p.policy.runDurationLimitSeconds = 0;
    });
    const result = await runVerificationStage(ctx.store, { runId: ctx.runId, rootDir: ctx.root });
    assert.equal(result.ok, false);
    assert.match(
      (result as { ok: false; reason: string }).reason,
      /exceeded the run-duration limit of 0 seconds/
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
