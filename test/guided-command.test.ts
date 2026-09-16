import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { Writable } from "node:stream";
import { test } from "node:test";
import { approvalPayload } from "../src/approval.ts";
import { buildBinding } from "../src/approval-stage.ts";
import { appendAudit, verifyAuditChain } from "../src/audit.ts";
import { runGuidedCommand } from "../src/guided-command.ts";
import { approvalHandoffDir, profilePath } from "../src/paths.ts";
import { createRunIntake } from "../src/run-intake.ts";
import { openStore, type AgentRunRow, type RunRow } from "../src/store.ts";
import { runVerifyCommand } from "../src/verify-command.ts";
import { VERIFY_ENV_PASSTHROUGH, VERIFY_RETENTION_MAX_BYTES } from "../src/policy.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { loadProfile } from "../src/profile.ts";
import { readRunSnapshot } from "../src/operator-state.ts";

const JOURNEY_FIXTURE = resolve("test", "fixtures", "harness", "emit-cli-run.mjs");

function workspace(): string {
  return mkdtempSync(join(dirname(resolve(".")), ".buildworks-guided-"));
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function repository(root: string, slugs = ["guided-feature"]): void {
  git(root, "init", "-q");
  writeFileSync(join(root, ".gitignore"), ".governance/\n");
  writeFileSync(join(root, "governed.yaml"), 'verify:\n  - name: unit\n    command: ["node", "--version"]\n');
  for (const slug of slugs) {
    const design = join(root, "docs", "features", slug, "design.md");
    mkdirSync(dirname(design), { recursive: true });
    writeFileSync(design, `# ${slug}\n\nOperator-authored design.\n`);
  }
  git(root, "add", "-A");
  git(root, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "-qm", "base");
}

function capture() {
  let text = "";
  return {
    stream: new Writable({
      write(chunk, _encoding, done) {
        text += chunk.toString();
        done();
      },
    }),
    text: () => text,
  };
}

function prompts(values: string[], seen: string[] = []) {
  const pending = [...values];
  return async (message: string) => {
    seen.push(message);
    return pending.shift() ?? "";
  };
}

async function withNativeClaude<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const tools = `${root}-tools`;
  mkdirSync(tools);
  copyFileSync(process.execPath, join(tools, process.platform === "win32" ? "claude.exe" : "claude"));
  const before = process.env.PATH;
  process.env.PATH = `${tools}${delimiter}${before ?? ""}`;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.PATH;
    else process.env.PATH = before;
    rmSync(tools, { recursive: true, force: true });
  }
}

function createRun(root: string, input: {
  project?: string;
  featureId?: string;
  slug?: string;
  changeKind?: "feature" | "defect_fix";
} = {}): RunRow {
  const store = openStore(root);
  try {
    return createRunIntake(store, root, {
      project: input.project ?? "project",
      featureId: input.featureId ?? "feature-1",
      slug: input.slug ?? "guided-feature",
      changeKind: input.changeKind ?? "feature",
      model: "test-model",
    }, { requireApprovalSigner: true }).run;
  } finally {
    store.close();
  }
}

function useFixtureExecutor(root: string, runId: number, codeReviewMode = "ok"): void {
  const { profile } = loadProfile(root, runId);
  profile.executor.command = [
    process.execPath,
    JOURNEY_FIXTURE,
    "--implementation-mode",
    "ok",
    "--code-review-mode",
    codeReviewMode,
  ];
  profile.executor.probe = [process.execPath, "--version"];
  const serialized = canonicalJson(profile);
  writeFileSync(profilePath(root, runId), serialized);
  const store = openStore(root);
  try {
    store.setProfileRef(runId, sha256Hex(serialized));
  } finally {
    store.close();
  }
}

function parkForApproval(root: string, run: RunRow): void {
  const spec = "feature: guided-feature\nchange_kind: feature\n\n## Declared artifacts\n\n- src/result.js\n\n## Acceptance criteria\n\n- AC-001: The result is delivered.\n";
  const specPath = join(root, "docs", "features", run.slug, "spec.md");
  writeFileSync(specPath, spec);
  const store = openStore(root);
  try {
    const authored = store.insertStage(run.id, "spec", null);
    appendAudit(store, { runId: run.id, stageId: authored.id, actor: "system", actorType: "cli",
      action: "spec.stage.create", summary: `created spec stage ${authored.id}` });
    store.completeStage(authored.id, specPath, "pass");
    const reviewed = store.insertStage(run.id, "spec_review", authored.id);
    appendAudit(store, { runId: run.id, stageId: reviewed.id, actor: "system", actorType: "cli",
      action: "spec_review.stage.create", summary: `created spec_review stage ${reviewed.id}` });
    store.completeStage(reviewed.id, specPath, "pass");
    appendAudit(store, { runId: run.id, stageId: reviewed.id, actor: "system", actorType: "cli",
      action: "spec.gate.pass",
      summary: `spec_review gate passed in round 1; specHash=${sha256Hex(normalizeText(spec))}; risk=low` });
  } finally {
    store.close();
  }
}

test("guided approval exports canonical bytes, imports only a detached signature, and asks fresh paid consent", async (t) => {
  const root = workspace();
  const authority = `${root}-authority`;
  const home = `${root}-home`;
  const before = {
    key: process.env.BW_APPROVAL_PUBLIC_KEY,
    home: process.env.HOME,
    userprofile: process.env.USERPROFILE,
  };
  try {
    mkdirSync(authority);
    mkdirSync(home);
    const keys = generateKeyPairSync("ed25519");
    const publicPath = join(authority, "approval.pub");
    writeFileSync(publicPath, keys.publicKey.export({ type: "spki", format: "pem" }));
    process.env.BW_APPROVAL_PUBLIC_KEY = publicPath;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    repository(root);
    const run = createRun(root);
    parkForApproval(root, run);

    const firstOut = capture();
    const first = await runGuidedCommand(root, {
      invocationDirectory: dirname(root),
      stdout: firstOut.stream,
      stderr: capture().stream,
      prompt: prompts([]),
    });
    assert.equal(first, 3);
    const directory = approvalHandoffDir(root, run.id);
    const payloadPath = join(directory, "payload.txt");
    const signaturePath = join(directory, "signature.txt");
    assert.ok(existsSync(payloadPath));
    assert.equal(existsSync(signaturePath), false);
    const payload = readFileSync(payloadPath, "utf8");
    const expiresAt = /^expiresAt: (.+)$/m.exec(payload)![1]!;
    const store = openStore(root, { readOnly: true });
    try {
      const bound = buildBinding(store, root, run.id, expiresAt);
      assert.ok(bound.ok, bound.ok ? "" : bound.reason);
      assert.equal(payload, approvalPayload(bound.binding));
      assert.equal(store.getApproval(run.id), undefined);
    } finally {
      store.close();
    }
    assert.match(firstOut.text(), /Canonical payload:/);
    assert.match(firstOut.text(), /Expected detached signature:/);
    assert.doesNotMatch(firstOut.text(), /approval\.key|sign-approval|BEGIN .* KEY/);

    writeFileSync(payloadPath, `${payload}changed`);
    await assert.rejects(
      runGuidedCommand(root, {
        invocationDirectory: dirname(root),
        stdout: capture().stream,
        stderr: capture().stream,
        prompt: prompts([]),
      }),
      (error: unknown) => {
        assert.equal((error as { exitCode?: number }).exitCode, 3);
        assert.match((error as Error).message, /payload does not exactly match/);
        return true;
      },
    );
    writeFileSync(payloadPath, payload);
    writeFileSync(signaturePath, "not-base64");
    await assert.rejects(
      runGuidedCommand(root, {
        invocationDirectory: dirname(root),
        stdout: capture().stream,
        stderr: capture().stream,
        prompt: prompts(["yes"]),
      }),
      (error: unknown) => {
        assert.equal((error as { exitCode?: number }).exitCode, 3);
        assert.match((error as Error).message, /not valid base64/);
        return true;
      },
    );
    const refused = openStore(root, { readOnly: true });
    try {
      assert.equal(refused.getApproval(run.id), undefined);
      assert.equal(refused.getStageChain(run.id).some((stage) => stage.kind === "awaiting_approval"), false);
    } finally {
      refused.close();
    }
    const validSignature = sign(null, Buffer.from(payload, "utf8"), keys.privateKey).toString("base64");
    writeFileSync(signaturePath, validSignature);
    await assert.rejects(
      runGuidedCommand(root, {
        invocationDirectory: dirname(root),
        stdout: capture().stream,
        stderr: capture().stream,
        prompt: prompts(["no"]),
      }),
      (error: unknown) => {
        assert.equal((error as { exitCode?: number }).exitCode, 3);
        assert.match((error as Error).message, /approval submission was declined/);
        return true;
      },
    );
    await assert.rejects(
      runGuidedCommand(root, {
        invocationDirectory: dirname(root),
        stdout: capture().stream,
        stderr: capture().stream,
        prompt: async (message) => {
          if (/Submit this detached signature/.test(message)) {
            writeFileSync(payloadPath, `${payload}changed-after-preview`);
            return "yes";
          }
          return "";
        },
      }),
      (error: unknown) => {
        assert.equal((error as { exitCode?: number }).exitCode, 3);
        assert.match((error as Error).message, /binding changed after confirmation/);
        return true;
      },
    );
    writeFileSync(payloadPath, payload);
    await assert.rejects(
      runGuidedCommand(root, {
        invocationDirectory: dirname(root),
        stdout: capture().stream,
        stderr: capture().stream,
        prompt: async (message) => {
          if (/Submit this detached signature/.test(message)) {
            writeFileSync(signaturePath, Buffer.alloc(64).toString("base64"));
            return "yes";
          }
          return "";
        },
      }),
      (error: unknown) => {
        assert.equal((error as { exitCode?: number }).exitCode, 3);
        assert.match((error as Error).message, /detached signature changed after confirmation/);
        return true;
      },
    );
    writeFileSync(signaturePath, validSignature);
    const asked: string[] = [];
    const secondOut = capture();
    const second = await runGuidedCommand(root, {
      invocationDirectory: dirname(root),
      stdout: secondOut.stream,
      stderr: capture().stream,
      prompt: prompts(["yes", "no"], asked),
    });
    assert.equal(second, 1, "declining the fresh post-approval paid range leaves the approved run ready");
    assert.equal(asked.filter((message) => /Submit this detached signature/.test(message)).length, 1);
    assert.equal(asked.filter((message) => /Execute every group/.test(message)).length, 1);
    const after = openStore(root, { readOnly: true });
    try {
      assert.ok(after.getApproval(run.id));
      assert.equal(after.getStageChain(run.id).at(-1)!.kind, "awaiting_approval");
      assert.equal(after.getStageChain(run.id).some((stage) => stage.kind === "plan"), false);
    } finally {
      after.close();
    }

    const probe = join(root, "read-former-default.mjs");
    writeFileSync(probe, `
      import { readFileSync } from "node:fs";
      import { join } from "node:path";
      try {
        readFileSync(join(process.env.USERPROFILE, ".buildworks", "approval.key"));
        process.exit(9);
      } catch (error) {
        console.log(error.code);
        process.exit(error.code === "ENOENT" ? 0 : 8);
      }
    `);
    const attempted = await runVerifyCommand(
      { name: "former-default-absent", command: ["node", probe] },
      {
        cwd: root,
        timeoutSeconds: 30,
        maxBytes: 1024 * 1024,
        retentionMaxBytes: VERIFY_RETENTION_MAX_BYTES,
        envPassthrough: [...VERIFY_ENV_PASSTHROUGH],
        evidencePath: join(root, ".governance", "verification-attempt.txt"),
      },
    );
    assert.equal(attempted.exitCode, 0, attempted.stderr);
    assert.match(attempted.stdout, /ENOENT/);
    assert.equal(existsSync(join(home, ".buildworks", "approval.key")), false);
    t.diagnostic("The process-level check proves guided mode created no former default file; it does not discover authority material an operator placed elsewhere.");
  } finally {
    if (before.key === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = before.key;
    if (before.home === undefined) delete process.env.HOME;
    else process.env.HOME = before.home;
    if (before.userprofile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = before.userprofile;
    rmSync(root, { recursive: true, force: true });
    rmSync(authority, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("guided run selection resumes one nonterminal and refuses ambiguous exact matches", async () => {
  const root = workspace();
  const authority = `${root}-authority`;
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    mkdirSync(authority);
    const keys = generateKeyPairSync("ed25519");
    const publicPath = join(authority, "approval.pub");
    writeFileSync(publicPath, keys.publicKey.export({ type: "spki", format: "pem" }));
    process.env.BW_APPROVAL_PUBLIC_KEY = publicPath;
    repository(root);
    const older = createRun(root);
    const current = createRun(root);
    const store = openStore(root);
    store.setRunStatus(older.id, "completed");
    store.close();
    const out = capture();
    const resumed = await runGuidedCommand(root, {
      stdout: out.stream,
      stderr: capture().stream,
      prompt: prompts(["no"]),
    });
    assert.equal(resumed, 1);
    assert.match(out.text(), new RegExp(`Resuming run ${current.id}`));
    assert.doesNotMatch(out.text(), new RegExp(`Resuming run ${older.id}`));

    const third = createRun(root);
    await assert.rejects(
      runGuidedCommand(root, {
        stdout: capture().stream,
        stderr: capture().stream,
        prompt: prompts([]),
      }),
      new RegExp(`multiple nonterminal runs.*${current.id}, ${third.id}`),
    );
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
    rmSync(authority, { recursive: true, force: true });
  }
});

test("guided run selection reports one terminal match and refuses several terminal-only matches", async () => {
  const root = workspace();
  const authority = `${root}-authority`;
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    mkdirSync(authority);
    const keys = generateKeyPairSync("ed25519");
    const publicPath = join(authority, "approval.pub");
    writeFileSync(publicPath, keys.publicKey.export({ type: "spki", format: "pem" }));
    process.env.BW_APPROVAL_PUBLIC_KEY = publicPath;
    repository(root);
    const first = createRun(root);
    const state = openStore(root);
    state.setRunStatus(first.id, "blocked");
    state.close();
    const one = capture();
    assert.equal(await runGuidedCommand(root, {
      stdout: one.stream,
      stderr: capture().stream,
      prompt: prompts([]),
    }), 1);
    assert.match(one.text(), new RegExp(`Run ${first.id} is blocked`));
    assert.match(one.text(), new RegExp(`Reason: policy_block: run ${first.id} is blocked`));
    assert.match(one.text(), new RegExp(`Inspect: buildworks status --repo .* --run ${first.id}`));
    const second = createRun(root);
    const more = openStore(root);
    more.setRunStatus(second.id, "completed");
    more.close();
    await assert.rejects(
      runGuidedCommand(root, {
        stdout: capture().stream,
        stderr: capture().stream,
        prompt: prompts([]),
      }),
      new RegExp(`multiple terminal runs.*${first.id}, ${second.id}`),
    );
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
    rmSync(authority, { recursive: true, force: true });
  }
});

test("concurrent guided intake creates only one exact-tuple run", async () => {
  const root = workspace();
  const authority = `${root}-authority`;
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    mkdirSync(authority);
    const keys = generateKeyPairSync("ed25519");
    const publicPath = join(authority, "approval.pub");
    writeFileSync(publicPath, keys.publicKey.export({ type: "spki", format: "pem" }));
    process.env.BW_APPROVAL_PUBLIC_KEY = publicPath;
    repository(root);
    await withNativeClaude(root, async () => {
      let modelPrompts = 0;
      let releaseModels!: () => void;
      const bothAtModel = new Promise<void>((resolveBarrier) => {
        releaseModels = resolveBarrier;
      });
      const concurrentPrompt = async (message: string): Promise<string> => {
        if (/Project \[suggested/.test(message)) return "concurrent-project";
        if (/Feature ID \[suggested/.test(message)) return "concurrent-feature";
        if (/Change kind \[suggested/.test(message)) return "feature";
        if (/Model \[suggested/.test(message)) {
          modelPrompts++;
          if (modelPrompts === 2) releaseModels();
          await bothAtModel;
          return "test-model";
        }
        if (/Execute every group/.test(message)) return "no";
        throw new Error(`unexpected concurrent prompt: ${message}`);
      };
      assert.deepEqual(await Promise.all([
        runGuidedCommand(root, { stdout: capture().stream, stderr: capture().stream, prompt: concurrentPrompt }),
        runGuidedCommand(root, { stdout: capture().stream, stderr: capture().stream, prompt: concurrentPrompt }),
      ]), [1, 1]);
    });
    const store = openStore(root, { readOnly: true });
    try {
      const runs = store.query<RunRow>("SELECT * FROM run ORDER BY id");
      assert.equal(runs.length, 1);
      assert.deepEqual(
        [runs[0]!.project, runs[0]!.feature_id, runs[0]!.slug, runs[0]!.change_kind],
        ["concurrent-project", "concurrent-feature", "guided-feature", "feature"],
      );
    } finally {
      store.close();
    }
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
    rmSync(authority, { recursive: true, force: true });
  }
});

test("guided intake creates one exact prompted tuple, freezes the signer, and stops before paid work when declined", async () => {
  const root = workspace();
  const authority = `${root}-authority`;
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    mkdirSync(authority);
    const keys = generateKeyPairSync("ed25519");
    const publicPath = join(authority, "approval.pub");
    writeFileSync(publicPath, keys.publicKey.export({ type: "spki", format: "pem" }));
    process.env.BW_APPROVAL_PUBLIC_KEY = publicPath;
    repository(root);
    await withNativeClaude(root, async () => {
      const seen: string[] = [];
      const out = capture();
      const result = await runGuidedCommand(root, {
        stdout: out.stream,
        stderr: capture().stream,
        prompt: prompts(["explicit-project", "explicit-feature", "defect_fix", "explicit-model", "no"], seen),
      });
      assert.equal(result, 1);
      assert.equal(seen.filter((message) => /Project \[suggested/.test(message)).length, 1);
      assert.equal(seen.filter((message) => /Feature ID \[suggested/.test(message)).length, 1);
      assert.equal(seen.filter((message) => /Change kind \[suggested/.test(message)).length, 1);
      assert.equal(seen.filter((message) => /Model \[suggested/.test(message)).length, 1);
      assert.equal(seen.filter((message) => /Execute every group/.test(message)).length, 1);
      const store = openStore(root, { readOnly: true });
      try {
        const runs = store.query<RunRow>("SELECT * FROM run");
        assert.equal(runs.length, 1);
        assert.deepEqual({
          project: runs[0]!.project,
          featureId: runs[0]!.feature_id,
          slug: runs[0]!.slug,
          changeKind: runs[0]!.change_kind,
          status: runs[0]!.status,
        }, {
          project: "explicit-project",
          featureId: "explicit-feature",
          slug: "guided-feature",
          changeKind: "defect_fix",
          status: "in_progress",
        });
        assert.deepEqual(store.getStageChain(runs[0]!.id), []);
        const profile = JSON.parse(readFileSync(join(root, ".governance", "profiles", String(runs[0]!.id), "profile.json"), "utf8"));
        assert.ok(profile.approvalSigner);
        assert.ok(Object.values(profile.modelMap).every((model) => model === "explicit-model"));
      } finally {
        store.close();
      }
    });
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
    rmSync(authority, { recursive: true, force: true });
  }
});

test("guided identity selection uses only displayed persisted tuples", async () => {
  const root = workspace();
  const authority = `${root}-authority`;
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    mkdirSync(authority);
    const keys = generateKeyPairSync("ed25519");
    const publicPath = join(authority, "approval.pub");
    writeFileSync(publicPath, keys.publicKey.export({ type: "spki", format: "pem" }));
    process.env.BW_APPROVAL_PUBLIC_KEY = publicPath;
    repository(root);
    const first = createRun(root, { project: "one", featureId: "one" });
    const second = createRun(root, { project: "two", featureId: "two", changeKind: "defect_fix" });
    const store = openStore(root);
    store.setRunStatus(first.id, "completed");
    store.setRunStatus(second.id, "blocked");
    store.close();
    const out = capture();
    const result = await runGuidedCommand(root, {
      stdout: out.stream,
      stderr: capture().stream,
      prompt: prompts(["2"]),
    });
    assert.equal(result, 1);
    assert.match(out.text(), /two \| two \| guided-feature \| defect_fix/);
    assert.match(out.text(), new RegExp(`Run ${second.id} is blocked`));
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
    rmSync(authority, { recursive: true, force: true });
  }
});

test("complete guided fixture journey reaches delivery with two paid consents and no provider spend", { timeout: 300_000 }, async () => {
  const parent = workspace();
  const target = join(parent, "guided-app");
  const authority = `${parent}-authority`;
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    mkdirSync(authority);
    const keys = generateKeyPairSync("ed25519");
    const publicPath = join(authority, "approval.pub");
    writeFileSync(publicPath, keys.publicKey.export({ type: "spki", format: "pem" }));
    process.env.BW_APPROVAL_PUBLIC_KEY = publicPath;
    await withNativeClaude(parent, async () => {
      const prepared = await runGuidedCommand(target, {
        invocationDirectory: parent,
        stdout: capture().stream,
        stderr: capture().stream,
        prompt: async (message) => {
          if (/Project type/.test(message)) return "static-web";
          if (/Feature slug/.test(message)) return "demo";
          if (/Git author name/.test(message)) return "Fixture User";
          if (/Git author email/.test(message)) return "fixture@example.invalid";
          if (/Commit the generated baseline/.test(message)) return "yes";
          throw new Error(`unexpected scaffold prompt: ${message}`);
        },
      });
      assert.equal(prepared, 0);
      writeFileSync(join(target, "docs", "features", "demo", "design.md"),
        "# design\n\nDeliver the declared artifact.\n");

      const paidDecisions: string[] = [];
      const intake = await runGuidedCommand(target, {
        invocationDirectory: parent,
        stdout: capture().stream,
        stderr: capture().stream,
        prompt: async (message) => {
          if (/Commit only .*design\.md/.test(message)) return "yes";
          if (/Project \[suggested/.test(message)) return "guided-project";
          if (/Feature ID \[suggested/.test(message)) return "guided-feature";
          if (/Change kind \[suggested/.test(message)) return "feature";
          if (/Model \[suggested/.test(message)) return "test-model";
          if (/Execute every group/.test(message)) {
            paidDecisions.push("declined-initial");
            return "no";
          }
          throw new Error(`unexpected intake prompt: ${message}`);
        },
      });
      assert.equal(intake, 1);
      const reader = openStore(target, { readOnly: true });
      const runs = reader.query<RunRow>("SELECT * FROM run");
      assert.equal(runs.length, 1);
      const run = runs[0]!;
      assert.deepEqual(reader.getStageChain(run.id), []);
      assert.equal(reader.query<AgentRunRow>(
        "SELECT a.* FROM agent_run a JOIN stage s ON s.id = a.stage_id WHERE s.run_id = ?",
        [run.id],
      ).length, 0, "declining before the first dispatch must leave no provider invocation");
      reader.close();
      assert.deepEqual({
        project: run.project,
        featureId: run.feature_id,
        slug: run.slug,
        changeKind: run.change_kind,
      }, {
        project: "guided-project",
        featureId: "guided-feature",
        slug: "demo",
        changeKind: "feature",
      });
      assert.deepEqual(paidDecisions, ["declined-initial"]);
      useFixtureExecutor(target, run.id, "low");

      const specificationOutput = capture();
      const specification = await runGuidedCommand(target, {
        invocationDirectory: parent,
        stdout: specificationOutput.stream,
        stderr: capture().stream,
        prompt: async (message) => {
          if (/Execute every group/.test(message)) {
            paidDecisions.push("accepted-specification");
            return "yes";
          }
          if (/Action \(1-4\)/.test(message)) {
            return "4";
          }
          throw new Error(`unexpected specification prompt: ${message}`);
        },
      });
      assert.equal(specification, 3);
      assert.match(specificationOutput.text(), /Remaining groups: spec/);

      const handoff = approvalHandoffDir(target, run.id);
      const payload = readFileSync(join(handoff, "payload.txt"));
      writeFileSync(join(handoff, "signature.txt"),
        sign(null, payload, keys.privateKey).toString("base64"));

      const approvalDecisions: string[] = [];
      const terminalOutput = capture();
      const completed = await runGuidedCommand(target, {
        invocationDirectory: parent,
        stdout: terminalOutput.stream,
        stderr: capture().stream,
        prompt: async (message) => {
          if (/Submit this detached signature/.test(message)) {
            approvalDecisions.push("submitted");
            return "yes";
          }
          if (/Execute every group/.test(message)) {
            paidDecisions.push("accepted-delivery");
            return "yes";
          }
          throw new Error(`unexpected continuation prompt: ${message}`);
        },
      });
      assert.equal(completed, 0);
      assert.deepEqual(approvalDecisions, ["submitted"]);
      assert.deepEqual(paidDecisions, ["declined-initial", "accepted-specification", "accepted-delivery"]);
      assert.match(terminalOutput.text(),
        /Remaining groups: plan -> implementation -> verification -> code_review -> delivery_check/);

      const store = openStore(target, { readOnly: true });
      try {
        const architecture = normalizeText(readFileSync(resolve("ARCHITECTURE.md"), "utf8"));
        const sequenceText = /## 5\. Stage sequence\n[\s\S]*?```\n([\s\S]*?)\n```/.exec(architecture)?.[1];
        assert.ok(sequenceText);
        const sequence = sequenceText.split(/\s*->\s*/).map((kind) => kind.trim());
        assert.equal(sequence.at(-1), "completed");
        assert.deepEqual(store.getStageChain(run.id).map((stage) => stage.kind), sequence.slice(0, -1));
        assert.equal(store.getAuditEvents(run.id).filter((event) => event.action === "approval.granted").length, 1);
        assert.equal(verifyAuditChain(store), null);
        const snapshot = readRunSnapshot(store, target, run.id).snapshot;
        assert.equal(snapshot.run.status, "completed");
        assert.equal(snapshot.phase, "completed");
        assert.equal(snapshot.cost.knownUsd, 0);
        assert.equal(snapshot.delivery.outcome, "pass");
        assert.ok(snapshot.delivery.branch);
        assert.ok(snapshot.delivery.worktreePath);
        assert.ok(snapshot.delivery.deliveredCommit);
        assert.ok(snapshot.delivery.resultRef);
        assert.deepEqual(snapshot.delivery.missingPaths, []);
        const agents = store.query<AgentRunRow>(
          "SELECT a.* FROM agent_run a JOIN stage s ON s.id = a.stage_id WHERE s.run_id = ? ORDER BY a.id",
          [run.id],
        );
        assert.ok(agents.length > 0);
        assert.ok(agents.every((agent) => agent.cost === 0));
      } finally {
        store.close();
      }
      assert.match(terminalOutput.text(), /Retained branch:/);
      assert.match(terminalOutput.text(), /Retained worktree:/);
      assert.match(terminalOutput.text(), /Delivered commit:/);
      assert.match(terminalOutput.text(), /Delivery evidence:/);
      assert.match(terminalOutput.text(), /Known recorded cost: USD 0/);
      assert.match(terminalOutput.text(), /code-reviewer-correctness low:/);
      assert.deepEqual(loadProfile(target, run.id).profile.executor.command, [
        process.execPath,
        JOURNEY_FIXTURE,
        "--implementation-mode",
        "ok",
        "--code-review-mode",
        "low",
      ]);
    });
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(parent, { recursive: true, force: true });
    rmSync(authority, { recursive: true, force: true });
  }
});

test("guided identity validation refuses invalid prompted values before creating a run", async (t) => {
  for (const [name, values] of [
    ["project", ["bad\nproject", "bad\nproject", "bad\nproject"]],
    ["feature", ["project", "Bad Feature", "Bad Feature", "Bad Feature"]],
    ["change kind", ["project", "feature-id", "unknown", "unknown", "unknown"]],
    ["model", ["project", "feature-id", "feature", "bad model", "bad model", "bad model"]],
  ] as const) {
    await t.test(name, async () => {
      const root = workspace();
      try {
        repository(root);
        await withNativeClaude(root, async () => {
          await assert.rejects(
            runGuidedCommand(root, {
              stdout: capture().stream,
              stderr: capture().stream,
              prompt: prompts([...values]),
            }),
            /no valid response was provided/,
          );
        });
        assert.equal(existsSync(join(root, ".governance", "state.db")), false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

test("guided identity tuples remain distinct by every persisted field", async () => {
  const root = workspace();
  const authority = `${root}-authority`;
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    mkdirSync(authority);
    const keys = generateKeyPairSync("ed25519");
    const publicPath = join(authority, "approval.pub");
    writeFileSync(publicPath, keys.publicKey.export({ type: "spki", format: "pem" }));
    process.env.BW_APPROVAL_PUBLIC_KEY = publicPath;
    repository(root);
    const runs = [
      createRun(root, { project: "one", featureId: "feature" }),
      createRun(root, { project: "two", featureId: "feature" }),
      createRun(root, { project: "one", featureId: "other" }),
      createRun(root, { project: "one", featureId: "feature", changeKind: "defect_fix" }),
    ];
    const store = openStore(root);
    try {
      for (const run of runs) store.setRunStatus(run.id, "completed");
    } finally {
      store.close();
    }
    const out = capture();
    const seen: string[] = [];
    const result = await runGuidedCommand(root, {
      stdout: out.stream,
      stderr: capture().stream,
      prompt: prompts(["4"], seen),
    });
    assert.equal(result, 0);
    const displayed = `${seen.join("\n")}\n${out.text()}`;
    for (const identity of [
      "one | feature | guided-feature | feature",
      "two | feature | guided-feature | feature",
      "one | other | guided-feature | feature",
      "one | feature | guided-feature | defect_fix",
    ]) {
      assert.ok(displayed.includes(identity), identity);
    }
    assert.match(out.text(), new RegExp(`Run ${runs[3]!.id} is completed`));
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
    rmSync(authority, { recursive: true, force: true });
  }
});

test("guided approval refuses a public key that differs from the signer frozen at intake", async () => {
  const root = workspace();
  const authority = `${root}-authority`;
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    mkdirSync(authority);
    const first = generateKeyPairSync("ed25519");
    const second = generateKeyPairSync("ed25519");
    const firstPath = join(authority, "first.pub");
    const secondPath = join(authority, "second.pub");
    writeFileSync(firstPath, first.publicKey.export({ type: "spki", format: "pem" }));
    writeFileSync(secondPath, second.publicKey.export({ type: "spki", format: "pem" }));
    process.env.BW_APPROVAL_PUBLIC_KEY = firstPath;
    repository(root);
    const run = createRun(root);
    parkForApproval(root, run);
    process.env.BW_APPROVAL_PUBLIC_KEY = secondPath;
    await assert.rejects(
      runGuidedCommand(root, {
        stdout: capture().stream,
        stderr: capture().stream,
        prompt: prompts([]),
      }),
      /is not the signer frozen at run start/,
    );
    assert.equal(existsSync(join(approvalHandoffDir(root, run.id), "payload.txt")), false);
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
    rmSync(authority, { recursive: true, force: true });
  }
});

test("guided approval archives an expired handoff and creates fresh canonical bytes", async () => {
  const root = workspace();
  const authority = `${root}-authority`;
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    mkdirSync(authority);
    const keys = generateKeyPairSync("ed25519");
    const publicPath = join(authority, "approval.pub");
    writeFileSync(publicPath, keys.publicKey.export({ type: "spki", format: "pem" }));
    process.env.BW_APPROVAL_PUBLIC_KEY = publicPath;
    repository(root);
    const run = createRun(root);
    parkForApproval(root, run);
    const expiredAt = "2020-01-01T00:00:00.000Z";
    const store = openStore(root, { readOnly: true });
    let expiredPayload: string;
    try {
      const bound = buildBinding(store, root, run.id, expiredAt);
      assert.ok(bound.ok, bound.ok ? "" : bound.reason);
      expiredPayload = approvalPayload(bound.binding);
    } finally {
      store.close();
    }
    const directory = approvalHandoffDir(root, run.id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "payload.txt"), expiredPayload);
    writeFileSync(join(directory, "signature.txt"), "not-base64");

    const out = capture();
    assert.equal(await runGuidedCommand(root, {
      stdout: out.stream,
      stderr: capture().stream,
      prompt: prompts([]),
    }), 3);
    const freshPayload = readFileSync(join(directory, "payload.txt"), "utf8");
    const freshExpiry = /^expiresAt: (.+)$/m.exec(freshPayload)![1]!;
    assert.ok(Date.parse(freshExpiry) > Date.now());
    assert.notEqual(freshPayload, expiredPayload);
    assert.equal(existsSync(join(directory, "signature.txt")), false);
    const archived = readdirSync(dirname(directory)).filter((name) => name.includes("expired"));
    assert.equal(archived.length, 1);
    assert.equal(
      readFileSync(join(dirname(directory), archived[0]!, "payload.txt"), "utf8"),
      expiredPayload,
    );
    assert.equal(
      readFileSync(join(dirname(directory), archived[0]!, "signature.txt"), "utf8"),
      "not-base64",
    );
    assert.match(out.text(), /Archived expired approval handoff/);

    writeFileSync(join(directory, "payload.txt"), freshPayload.replace(
      /^expiresAt: .+$/m,
      "expiresAt: not-a-date",
    ));
    const malformedOut = capture();
    await assert.rejects(
      runGuidedCommand(root, {
        stdout: malformedOut.stream,
        stderr: capture().stream,
        prompt: prompts([]),
      }),
      /retained approval payload expiry is invalid.*ISO 8601 UTC timestamp/,
    );
    assert.doesNotMatch(malformedOut.text(), /external approval authority/);
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
    rmSync(authority, { recursive: true, force: true });
  }
});

test("guided approval interactive menu presents options and handles modify guidance, rejection, and missing signature", async () => {
  const root = workspace();
  const authority = `${root}-authority`;
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    mkdirSync(authority);
    const keys = generateKeyPairSync("ed25519");
    const publicPath = join(authority, "approval.pub");
    writeFileSync(publicPath, keys.publicKey.export({ type: "spki", format: "pem" }));
    process.env.BW_APPROVAL_PUBLIC_KEY = publicPath;
    repository(root);
    const run = createRun(root);
    parkForApproval(root, run);

    // Test modify option (2)
    const modifyOut = capture();
    const modifyExit = await runGuidedCommand(root, {
      stdout: modifyOut.stream,
      stderr: capture().stream,
      prompt: prompts(["2"]),
    });
    assert.equal(modifyExit, 3);
    assert.match(modifyOut.text(), /Approval options:/);
    assert.match(modifyOut.text(), /In BuildWorks, specifications are generated from your design document/);
    assert.match(modifyOut.text(), /design\.md with your changes or feedback/);

    // Test reject option (3) confirmed
    const rejectOut = capture();
    const rejectExit = await runGuidedCommand(root, {
      stdout: rejectOut.stream,
      stderr: capture().stream,
      prompt: prompts(["3", "yes"]),
    });
    assert.equal(rejectExit, 3);
    assert.match(rejectOut.text(), /Approval rejected for run/);
    const store = openStore(root, { readOnly: true });
    try {
      const audits = store.getAuditEvents(run.id).filter((e) => e.action === "approval.refused");
      assert.equal(audits.length, 1);
      assert.match(audits[0]!.summary, /approval rejected by operator/);
    } finally {
      store.close();
    }

    // Test option 1 when signature missing, then option 4
    const missingOut = capture();
    const missingExit = await runGuidedCommand(root, {
      stdout: missingOut.stream,
      stderr: capture().stream,
      prompt: prompts(["1", "4"]),
    });
    assert.equal(missingExit, 3);
    assert.match(missingOut.text(), /Detached signature not found at/);
    assert.match(missingOut.text(), /remains paused awaiting external approval/);
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
    rmSync(authority, { recursive: true, force: true });
  }
});
