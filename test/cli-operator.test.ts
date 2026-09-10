import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { formatHelp } from "../src/cli-args.ts";
import { acquireLock, inspectLock } from "../src/lock.ts";
import { parseEnvelope, PROMPT_MAX_BYTES } from "../src/harness.ts";
import { openStore, type AgentRunRow, type Store } from "../src/store.ts";
import { appendAudit } from "../src/audit.ts";
import { approvalPayload, verifyApproval } from "../src/approval.ts";
import { buildBinding } from "../src/approval-stage.ts";
import { validateSpecDoc } from "../src/spec-doc.ts";
import { computeRisk } from "../src/select.ts";
import { computeScope, touchesProtected } from "../src/scope.ts";
import { APPROVAL_DEFAULT_LIFETIME_SECONDS } from "../src/policy.ts";
import { checkIntakeRepository, inspectReadiness } from "../src/readiness.ts";
import { CLAUDE_CODE } from "../src/executor.ts";
import { AGENTS, type AgentDefinition } from "../src/agents.ts";
import { dispatchOnce } from "../src/dispatch.ts";
import { loadPublicKey } from "../src/approval.ts";
import { buildPolicy, policyHash } from "../src/policy.ts";
import { loadVerifiedProfile, type Profile } from "../src/profile.ts";
import { staffingShortfall, codeReviewStaffingShortfall } from "../src/select.ts";
import { listMigrations } from "../src/migrate.ts";
import { proposalIdentity } from "../src/proposal.ts";
import type { RunSnapshot } from "../src/operator-state.ts";
import type { DoctorResult, OperatorResult, RunCommandResult } from "../src/operator-output.ts";
import { formatOperatorResult, snapshotText } from "../src/operator-output.ts";

const CLI = resolve("src", "cli.ts");
const SIGNER = resolve("scripts", "sign-approval.mjs");
const STORE_URL = pathToFileURL(resolve("src", "store.ts")).href;
const LOCK_URL = pathToFileURL(resolve("src", "lock.ts")).href;

function workspace(): string {
  const parent = resolve("node_modules", ".cli-operator-tests");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, "case-"));
}

function cli(cwd: string, boundary: string, ...args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(boundary), GIT_OPTIONAL_LOCKS: "1" },
  });
}

function inventory(root: string): unknown[] {
  return readdirSync(root).sort().flatMap((name): unknown[] => {
    const path = join(root, name);
    const stat = lstatSync(path);
    return stat.isDirectory()
      ? [[name, inventory(path)]]
      : [[name, stat.size, stat.mtimeMs, sha256Hex(readFileSync(path))]];
  });
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function repository(parent: string): string {
  const root = join(parent, "target with spaces");
  mkdirSync(root);
  git(root, "init", "-q");
  writeFileSync(join(root, ".gitignore"), ".governance/\n");
  writeFileSync(join(root, "governed.yaml"), 'verify:\n  - name: unit\n    command: ["node", "--version"]\n');
  writeFileSync(join(root, "tracked.txt"), "unchanged\n");
  git(root, "add", "-A");
  git(root, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base");
  return root;
}

const NEW_RUN = [
  "new-run", "--project", "p", "--feature", "f-1", "--slug", "s",
  "--change-kind", "feature", "--model", "test-model",
];

test("every help form succeeds without target resolution or state creation", () => {
  const parent = workspace();
  try {
    const missing = join(parent, "does not exist");
    const before = inventory(parent);
    const commands = [
      "migrate", "new-run", "stage-add", "stage-complete", "dispatch", "spec", "plan",
      "implement", "verify", "review", "deliver", "approval-request", "approve",
      "verify-audit", "proposal-export", "doctor", "runs", "status", "run",
    ];
    const helpForms = [
      ["--help"], ["help"], ["--repo", missing, "--help"],
      ["help", "--repo", missing],
      ...commands.flatMap((command) => [
        ["help", command, "--repo", missing],
        ["--repo", missing, command, "--help"],
      ]),
      ["status", "--help", "--json"],
    ];
    for (const args of helpForms) {
      const result = cli(parent, parent, ...args);
      assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
      assert.match(result.stdout, /usage: bw /);
      assert.deepEqual(inventory(parent), before, args.join(" "));
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("malformed command lines refuse before target resolution, lock, migration, or files", async (t) => {
  const parent = workspace();
  try {
    const cases: { args: string[]; reason: RegExp }[] = [
      { args: [], reason: /command/ },
      { args: ["unknown", "--help"], reason: /unknown command/ },
      { args: ["help", "unknown"], reason: /unknown command/ },
      { args: ["migrate", "--unknown"], reason: /unknown option --unknown/ },
      { args: ["spec", "--help", "--unknown"], reason: /unknown option --unknown/ },
      { args: ["help", "spec", "--unknown"], reason: /unknown option --unknown/ },
      { args: ["--help", "--unknown"], reason: /unknown option --unknown/ },
      { args: ["spec", "--run=1", "--run", "2"], reason: /duplicate option --run/ },
      { args: ["migrate", "junk"], reason: /unexpected argument/ },
      { args: ["help", "spec", "junk"], reason: /unexpected argument/ },
      { args: ["spec", "-h"], reason: /unknown option/ },
      { args: ["spec", "--run"], reason: /--run/ },
      { args: ["spec", "--run="], reason: /--run/ },
      { args: ["spec", "--run", "--model", "test-model"], reason: /--run/ },
      { args: ["spec", "--run=1", "--model"], reason: /--model/ },
      { args: ["spec", "--run=9007199254740992"], reason: /--run.*safe integer/ },
      { args: ["stage-add", "--run=1", "--kind=spec", "--input=9007199254740992"], reason: /--input.*safe integer/ },
      { args: ["spec", "--run=-1"], reason: /--run.*non-negative integer/ },
      { args: ["spec", "--run=1.2"], reason: /--run.*non-negative integer/ },
      { args: ["spec", "--run=0x1"], reason: /--run.*non-negative integer/ },
      { args: ["stage-complete", "--id=1", "--output=x", "--gate-result=unknown"], reason: /invalid gate_result/ },
      { args: ["dispatch", "--stage=1", "--agent=a", "--role=unknown", "--prompt-file=x"], reason: /invalid role/ },
      { args: ["run", "--run=1", "--yes=true"], reason: /--yes.*bare flag/ },
      { args: ["status", "--run=1", "--json=false"], reason: /--json.*bare flag/ },
      { args: ["status", "--help=true"], reason: /--help.*bare flag/ },
      { args: ["status", "--help", "--help"], reason: /duplicate option --help/ },
      { args: ["run", "--run=1", "--yes", "--yes"], reason: /duplicate option --yes/ },
      { args: ["run", "--run=1", "--model=test-model"], reason: /unknown option --model/ },
      { args: ["verify", "--run=1", "--model=test-model"], reason: /unknown option --model/ },
      { args: ["doctor", "--slug=s", "--run=1"], reason: /--slug.*--run.*mutually exclusive/ },
      { args: ["runs", "--limit=0"], reason: /--limit.*1.*100/ },
      { args: ["runs", "--limit=101"], reason: /--limit.*1.*100/ },
      { args: ["approve", "--run=1", "--expires=x", "--signature=a", "--signature-file=b"], reason: /--signature.*--signature-file.*mutually exclusive/ },
      { args: ["approve", "--run=1", "--expires=x"], reason: /--signature/ },
      { args: ["approval-request", "--run=1", "--out="], reason: /--out/ },
      { args: [...NEW_RUN, "--project=p"], reason: /duplicate option --project/ },
      { args: NEW_RUN.map((arg) => arg === "s" ? "../escape" : arg), reason: /invalid slug/ },
      { args: NEW_RUN.map((arg) => arg === "f-1" ? "f\nscope: all" : arg), reason: /invalid feature_id/ },
      { args: NEW_RUN.map((arg) => arg === "feature" ? "unknown" : arg), reason: /invalid change_kind/ },
      { args: NEW_RUN.map((arg) => arg === "test-model" ? "bad model" : arg), reason: /invalid model name/ },
      { args: ["spec", "--run=1", "--model=bad model"], reason: /invalid model name/ },
      { args: ["doctor", "--slug=Bad"], reason: /invalid slug/ },
      { args: ["proposal-export", "--proposal=1", "--name=Bad"], reason: /invalid --name/ },
      { args: ["--repo", parent, "migrate", "--repo", parent], reason: /duplicate option --repo/ },
      { args: ["--repo", parent, "help", "--repo=" + parent], reason: /duplicate option --repo/ },
      { args: ["migrate", "--repo"], reason: /--repo/ },
      { args: ["--repo=", "--help"], reason: /--repo/ },
    ];
    const root = repository(parent);
    const release = acquireLock(root);
    try {
      const before = inventory(parent);
      for (const { args, reason } of cases) {
        await t.test(args.join(" ") || "missing command", () => {
          const result = cli(parent, parent, ...args);
          assert.equal(result.status, 2, `${args.join(" ")}: ${result.stderr}`);
          assert.match(result.stderr, reason, args.join(" "));
          assert.deepEqual(inventory(parent), before, args.join(" "));
          if (!args.some((arg) => arg === "--repo" || arg.startsWith("--repo="))) {
            const locked = cli(parent, parent, "--repo", root, ...args);
            assert.equal(locked.status, 2, `${args.join(" ")}: ${locked.stderr}`);
            assert.match(locked.stderr, reason);
            assert.deepEqual(inventory(parent), before);
          }
        });
      }
    } finally {
      release();
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("canonical targeting shares one store across root, child, explicit paths, and junctions", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const child = join(root, "nested", "directory with spaces");
    mkdirSync(child, { recursive: true });
    const alias = join(parent, "junction alias");
    symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
    const created = cli(child, parent, ...NEW_RUN);
    assert.equal(created.status, 0, created.stderr);
    assert.match(created.stdout, /^\d+\r?\n$/);
    assert.ok(existsSync(join(root, ".governance", "state.db")));
    assert.ok(!existsSync(join(child, ".governance")));
    const runId = created.stdout.trim();
    const stage = cli(parent, parent, "--repo", alias, "stage-add", "--run=" + runId, "--kind=spec");
    assert.equal(stage.status, 0, stage.stderr);
    assert.match(stage.stdout, /^\d+\r?\n$/);
    const done = cli(parent, parent, "stage-complete", "--id", stage.stdout.trim(),
      "--output", "content:proof", "--gate-result=pass", "--repo", root);
    assert.equal(done.status, 0, done.stderr);
    assert.equal(done.stdout, stage.stdout);
    for (const cwd of [root, child, alias]) {
      const result = cli(cwd, parent, "verify-audit");
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), "chain valid");
    }
    assert.ok(!existsSync(join(parent, ".governance")));
    const profile = JSON.parse(readFileSync(join(root, ".governance", "profiles", runId, "profile.json"), "utf8"));
    assert.equal(profile.startingCommit, git(root, "rev-parse", "HEAD"));
    assert.equal(realpathSync(alias), realpathSync(root));
    const release = acquireLock(root);
    try {
      const before = inventory(root);
      const blocked = cli(parent, parent, "migrate", "--repo", alias);
      assert.equal(blocked.status, 1);
      assert.ok(blocked.stderr.includes(join(realpathSync(root), ".governance", "lock")));
      assert.deepEqual(inventory(root), before);
    } finally {
      release();
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("missing, non-directory, non-Git, and bare targets refuse without creating state", () => {
  const parent = workspace();
  try {
    const bare = join(parent, "bare.git");
    mkdirSync(bare);
    git(bare, "init", "--bare", "-q");
    const file = join(parent, "file.txt");
    writeFileSync(file, "not a directory");
    const before = inventory(parent);
    for (const target of [join(parent, "missing"), file, parent, bare]) {
      const result = cli(parent, parent, "migrate", "--repo", target);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /target_unavailable/);
      assert.deepEqual(inventory(parent), before);
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("target and intake Git observations do not refresh the index", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const tracked = join(root, "tracked.txt");
    const future = new Date(Date.now() + 60_000);
    utimesSync(tracked, future, future);
    const index = join(root, ".git", "index");
    const before = { bytes: readFileSync(index), mtime: statSync(index).mtimeMs };
    const result = cli(parent, parent, ...NEW_RUN, "--repo", root);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(index), before.bytes);
    assert.equal(statSync(index).mtimeMs, before.mtime);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("dispatch reads prompt files from the original invocation directory, not --repo", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const created = cli(parent, parent, ...NEW_RUN, "--repo", root);
    assert.equal(created.status, 0, created.stderr);
    const stage = cli(parent, parent, "stage-add", "--run", created.stdout.trim(), "--kind=spec", "--repo", root);
    assert.equal(stage.status, 0, stage.stderr);
    const prompt = "prompt file.txt";
    // The real dispatch ceiling refuses before probing. Wrong-root reads
    // cannot spend either: that path does not exist in the selected target.
    writeFileSync(join(parent, prompt), "x".repeat(PROMPT_MAX_BYTES + 1));
    const result = cli(parent, parent, "dispatch", "--stage", stage.stdout.trim(),
      "--agent=spec-author", "--role=author", "--prompt-file", prompt, "--repo", root);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.includes(`prompt exceeds ${PROMPT_MAX_BYTES} bytes`));
    assert.ok(!existsSync(join(root, ".governance", "raw")));
    assert.ok(!existsSync(join(parent, ".governance")));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("approval-request preserves raw canonical stdout for absolute and relative stored refs", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const created = cli(parent, parent, ...NEW_RUN, "--repo", root);
    assert.equal(created.status, 0, created.stderr);
    const runId = Number(created.stdout.trim());
    const spec = "feature: demo\nchange_kind: feature\n\n## Declared artifacts\n\n- src/thing.ts\n\n## Acceptance criteria\n\n- AC-001: The artifact is delivered.\n";
    const parsed = validateSpecDoc(spec);
    assert.ok(parsed.ok);
    const specPath = join(root, "docs", "features", "s", "spec.md");
    mkdirSync(dirname(specPath), { recursive: true });
    writeFileSync(specPath, spec);
    const store = openStore(root);
    let payload: string;
    const expires = new Date(Date.now() + APPROVAL_DEFAULT_LIFETIME_SECONDS * 1000).toISOString();
    try {
      const first = store.insertStage(runId, "spec", null);
      store.completeStage(first.id, specPath, "pass");
      const review = store.insertStage(runId, "spec_review", first.id);
      store.completeStage(review.id, specPath, "pass");
      const risk = computeRisk(parsed.value.changeKind, computeScope(parsed.value.declaredArtifacts).length,
        touchesProtected(parsed.value.declaredArtifacts, "s"));
      appendAudit(store, {
        runId, stageId: review.id, actor: "system", actorType: "cli", action: "spec.gate.pass",
        summary: `spec_review gate passed in round 1; specHash=${sha256Hex(normalizeText(spec))}; risk=${risk}`,
      });
      const bound = buildBinding(store, root, runId, expires);
      assert.ok(bound.ok, bound.ok ? "" : bound.reason);
      payload = approvalPayload(bound.binding);
    } finally {
      store.close();
    }
    for (const outputRef of [specPath, relative(root, specPath)]) {
      const state = openStore(root);
      try {
        const chain = state.getStageChain(runId);
        state.completeStage(chain[chain.length - 1].id, outputRef, "pass");
      } finally {
        state.close();
      }
      const result = cli(parent, parent, "--repo", root, "approval-request", "--run", String(runId), "--expires", expires);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, payload);
      assert.ok(!result.stdout.endsWith("\n"));
      assert.ok(result.stderr.includes(`expires: ${expires}`));
    }
    assert.ok(!existsSync(join(parent, ".governance")));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

function operatorEnvelope(result: ReturnType<typeof cli>, command: string): OperatorResult {
  assert.equal(result.error, undefined);
  assert.match(result.stdout, /\n$/, result.stderr);
  assert.equal(result.stdout.trimEnd().split(/\r?\n/).length, 1, result.stdout);
  const body = JSON.parse(result.stdout) as OperatorResult;
  assert.equal(result.stdout, `${JSON.stringify(body)}\n`);
  assert.deepEqual(Object.keys(body).sort(),
    ["command", "outcome", "repository", "runId", "errorCode", "reason", "observedAt", "result"].sort());
  assert.equal(body.command, command);
  assert.equal(typeof body.observedAt, "string");
  assert.ok(Number.isFinite(Date.parse(body.observedAt)));
  assert.doesNotMatch(result.stdout, /\u001b\[/);
  assert.doesNotMatch(result.stderr, /"command"\s*:\s*"(doctor|runs|status|run)"/);
  return body;
}

function doctorFixture(parent: string, externalPublicKey?: string) {
  const preload = join(parent, "version-probe.mjs");
  writeFileSync(preload, `
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    import { CLAUDE_CODE } from ${JSON.stringify(pathToFileURL(resolve("src", "executor.ts")).href)};
    const nativeSync = childProcess.spawnSync;
    const nativeSpawn = childProcess.spawn;
    childProcess.spawnSync = (command, args, options) => {
      if (command === CLAUDE_CODE.probe[0]) {
        if (JSON.stringify(args) !== JSON.stringify(CLAUDE_CODE.probe.slice(1))) {
          throw new Error("Only the configured no-spend version probe is permitted in this fixture");
        }
        return nativeSync(process.execPath, ["--version"], options);
      }
      return nativeSync(command, args, options);
    };
    childProcess.spawn = (command, ...args) => {
      if (command === CLAUDE_CODE.command[0]) throw new Error("Model dispatch is forbidden in this fixture");
      return nativeSpawn(command, ...args);
    };
    syncBuiltinESMExports();
  `);
  const keyPath = externalPublicKey ?? join(parent, "approval-public.pem");
  if (externalPublicKey === undefined) {
    const { publicKey } = generateKeyPairSync("ed25519");
    writeFileSync(keyPath, publicKey.export({ type: "spki", format: "pem" }));
  }
  const invoke = (root: string, args: string[], options: { input?: string; timeout?: number } = {}) => spawnSync(process.execPath,
    ["--import", pathToFileURL(preload).href, CLI, "--repo", root, ...args], {
      cwd: parent, encoding: "utf8", ...options,
      env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(parent), GIT_OPTIONAL_LOCKS: "1",
        BW_APPROVAL_PUBLIC_KEY: keyPath },
    });
  return {
    keyPath,
    preload,
    command: invoke,
    invoke: (root: string, ...args: string[]) => invoke(root, ["doctor", ...args]),
    createRun: (root: string) => invoke(root, NEW_RUN),
    run: (root: string, args: string[], options: { input?: string; timeout?: number } = {}) =>
      invoke(root, ["run", ...args], { timeout: 5000, ...options }),
  };
}

function doctorRun(parent: string, externalPublicKey?: string) {
  const root = repository(parent);
  const design = join(root, "docs", "features", "s", "design.md");
  mkdirSync(dirname(design), { recursive: true });
  writeFileSync(design, "Operator-authored design.\n");
  git(root, "add", "-A");
  git(root, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "design");
  const doctor = doctorFixture(parent, externalPublicKey);
  const created = doctor.createRun(root);
  assert.equal(created.status, 0, created.stderr);
  const runId = Number(created.stdout.trim());
  const store = openStore(root, { readOnly: true });
  try {
    const run = store.getRun(runId)!;
    const loaded = loadVerifiedProfile(root, run);
    assert.ok(loaded.ok, loaded.ok ? "" : loaded.reason);
    return { root, doctor, run, profile: loaded.profile,
      profilePath: join(root, ".governance", "profiles", String(runId), "profile.json") };
  } finally {
    store.close();
  }
}

test("Task 9 README inspection fence executes through Windows PowerShell from a separate spaced directory",
  { skip: process.platform !== "win32" }, () => {
    const parent = workspace();
    try {
      const checkout = realpathSync(resolve("."));
      const readme = readFileSync(join(checkout, "README.md"), "utf8").replace(/\r\n/g, "\n");
      const heading = /^### Inspect without spending[ \t]*$/m.exec(readme);
      assert.ok(heading, "README must contain the named no-spend inspection section");
      const following = readme.slice(heading.index + heading[0].length);
      const nextHeading = following.search(/^#{1,3} /m);
      const section = nextHeading < 0 ? following : following.slice(0, nextHeading);
      const fence = /^```powershell[ \t]*\n([\s\S]*?)^```[ \t]*$/m.exec(section);
      assert.ok(fence, "the first PowerShell fence in the inspection section is executable documentation");
      const commands = fence[1].split("\n").filter((line) => line.trim() !== "");
      for (const command of commands) {
        // Target correctness is checked from execution, not this no-spend allowlist.
        assert.match(command,
          /^& node \$BwCli (?:--help|help run|doctor(?: --repo \$Target)? --slug \$Slug|runs(?: --repo \$Target)? --json)$/,
          "only the documented no-spend inspection commands may execute in this regression");
      }
      const { root, doctor, run, profile } = doctorRun(parent);
      const invocation = join(parent, "separate PowerShell invocation");
      mkdirSync(invocation);
      assert.notEqual(invocation, checkout);
      assert.notEqual(invocation, root);
      assert.match(invocation, / /);
      assert.match(root, / /);
      const script = join(parent, "readme inspection.ps1");
      writeFileSync(script, [
        "param([string]$BuildWorksCheckout, [string]$Target, [string]$Slug)",
        "$ErrorActionPreference = 'Stop'",
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
        "$BwCli = Join-Path $BuildWorksCheckout 'src\\cli.ts'",
        fence[1],
        "exit $LASTEXITCODE",
      ].join("\n"), "utf8");
      const future = new Date(Date.now() + 60_000);
      utimesSync(join(root, "tracked.txt"), future, future);
      const before = inventory(root);
      const rows = durableCliRun(root, run.id);
      const index = join(root, ".git", "index");
      const indexBefore = { bytes: readFileSync(index), mtime: statSync(index).mtimeMs };
      const checkoutState = existsSync(join(checkout, ".governance"));
      const state = openStore(root, { readOnly: true });
      let runCount: number;
      try {
        assert.equal(state.query<{ user_version: number }>("PRAGMA user_version")[0].user_version,
          [...listMigrations(join(checkout, "src", "migrations"))].at(-1)!.index);
        runCount = state.query<{ n: number }>("SELECT COUNT(*) AS n FROM run")[0].n;
      } finally {
        state.close();
      }
      const shell = join(process.env.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const called = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", script, "-BuildWorksCheckout", checkout, "-Target", root, "-Slug", run.slug], {
        cwd: invocation, encoding: "utf8", timeout: 30_000,
        env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(doctor.preload).href}`,
          BW_APPROVAL_PUBLIC_KEY: doctor.keyPath,
          GIT_CEILING_DIRECTORIES: dirname(parent), GIT_OPTIONAL_LOCKS: "1" },
      });
      assert.equal(called.error, undefined);
      const stdout = called.stdout.replace(/\r\n/g, "\n");
      const help = formatHelp() + formatHelp("run");
      assert.ok(stdout.startsWith(help), "both README help commands must print the actual CLI help");
      const report = stdout.slice(help.length);
      assert.ok(report.startsWith(`doctor: ready\nRepository: ${realpathSync(root)}\n`),
        `README doctor must report ready for canonical target ${realpathSync(root)}:\n${report}\n${called.stderr}`);
      assert.equal(called.status, 0, called.stderr || called.stdout);
      for (const name of ["node", "git", "head", "working_tree", "governance_ignore", "verification_config",
        "design_readable", "design_committed", "approval_key", "executor_probe"]) {
        assert.match(report, new RegExp(`^PASS ${name}:`, "m"));
      }
      assert.doesNotMatch(report, /^FAIL /m);
      assert.ok(report.includes(profile.startingCommit!));
      assert.ok(report.includes(profile.approvalSigner!));
      assert.match(report, /authentication.*entitlement.*quota.*not checked/);
      assert.doesNotMatch(stdout, /\u001b\[/);
      const finalLine = stdout.trimEnd().split("\n").at(-1)!;
      assert.ok(stdout.endsWith(`${finalLine}\n`));
      assert.deepEqual(stdout.split("\n").filter((line) => line.startsWith('{"command":"runs"')), [finalLine]);
      const envelope = operatorEnvelope({ ...called, stdout: `${finalLine}\n` }, "runs");
      assert.equal(envelope.outcome, "ok");
      assert.equal(envelope.errorCode, null);
      assert.equal(envelope.repository, realpathSync(root));
      assert.equal(envelope.runId, null);
      const listing = envelope.result as { runs: { id: number; project: string; featureId: string; slug: string;
        status: string; phase: string; lastRecordedAt: string }[]; hasMore: boolean; limit: number };
      const lastRecordedAt = [run.created_at, run.updated_at, ...rows.audit.map((event) => event.created_at)].sort().at(-1)!;
      assert.deepEqual(listing.runs, [{ id: run.id, project: run.project, featureId: run.feature_id, slug: run.slug,
        status: run.status, phase: "ready", lastRecordedAt }]);
      assert.equal(listing.hasMore, runCount > listing.limit);
      assert.deepEqual(durableCliRun(root, run.id), rows);
      assert.deepEqual(inventory(root), before);
      assert.deepEqual(readFileSync(index), indexBefore.bytes);
      assert.equal(statSync(index).mtimeMs, indexBefore.mtime);
      assert.equal(existsSync(join(checkout, ".governance")), checkoutState);
      assert.ok(!existsSync(join(invocation, ".governance")));
      assert.ok(!existsSync(join(parent, ".governance")));
      assert.equal(inspectLock(root).status, "absent");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

function freezeDoctorProfile(root: string, runId: number, profile: Profile): void {
  const serialized = canonicalJson(profile);
  writeFileSync(join(root, ".governance", "profiles", String(runId), "profile.json"), serialized);
  const store = openStore(root);
  try {
    store.setProfileRef(runId, sha256Hex(serialized));
    const loaded = loadVerifiedProfile(root, store.getRun(runId)!);
    assert.ok(loaded.ok, loaded.ok ? "" : loaded.reason);
    assert.deepEqual(loaded.profile, profile);
    assert.equal(store.getStageChain(runId).length, 0, "fixture configuration freezes before execution");
  } finally {
    store.close();
  }
}

function preapprovalFixture(parent: string, externalPublicKey?: string) {
  const fixture = doctorRun(parent, externalPublicKey);
  fixture.profile.executor.command = [process.execPath, resolve("test", "fixtures", "harness", "emit-spec-stage.mjs")];
  fixture.profile.executor.probe = [process.execPath, "--version"];
  fixture.profile.executor.sandbox.envPassthrough = ["PATH", "SystemRoot", "TEMP", "TMP"];
  fixture.profile.executor.sandbox.idleTimeoutSeconds = 30;
  fixture.profile.executor.sandbox.absoluteTimeoutSeconds = 120;
  freezeDoctorProfile(fixture.root, fixture.run.id, fixture.profile);
  writeFileSync(join(fixture.root, "docs", "features", fixture.run.slug, "design.md"), "# design\n");
  return fixture;
}

function unstartedExecution(result: RunCommandResult, consent: "not_needed" | "required", groups: string[] = []) {
  assert.deepEqual(result.execution, {
    consent, groupsAttempted: [], groupsCompleted: [], remainingGroups: groups,
    startedAt: null, endedAt: null, elapsedMs: null,
  });
}

function approvalFixture(parent: string, externalPublicKey?: string) {
  const fixture = preapprovalFixture(parent, externalPublicKey);
  const profileBytes = readFileSync(fixture.profilePath);
  const called = fixture.doctor.run(fixture.root, ["--run", String(fixture.run.id), "--yes", "--json"], {
    timeout: fixture.profile.executor.sandbox.absoluteTimeoutSeconds * 1000,
  });
  const envelope = operatorEnvelope(called, "run");
  assert.equal(called.status, 3, called.stderr || called.stdout);
  assert.equal(envelope.outcome, "awaiting_approval");
  const snapshot = (envelope.result as RunCommandResult).snapshot!;
  assert.equal(snapshot.workflowAction.eligible, true);
  assert.deepEqual(readFileSync(fixture.profilePath), profileBytes);
  return { ...fixture, snapshot, envelope, profileBytes };
}

function actionValue(args: string[], name: string): string {
  const index = args.indexOf(name);
  assert.ok(index >= 0 && typeof args[index + 1] === "string", `missing ${name} in action`);
  return args[index + 1]!;
}

test("Task 7 approval pause text shows bound external steps and withholds unavailable submission", () => {
  const scratch = workspace();
  const parent = join(scratch, "operator's invocation");
  mkdirSync(parent);
  try {
    const { root, doctor, run, snapshot, envelope, profilePath, profileBytes } = approvalFixture(parent);
    const before = inventory(parent);
    const jsonBefore = JSON.stringify(envelope);
    const text = formatOperatorResult(envelope, false);
    const request = snapshot.operatorActions.find((action) => action.kind === "approval_request")!;
    const submit = snapshot.operatorActions.find((action) => action.kind === "approval_submit")!;
    const expires = actionValue(request.args, "--expires");
    assert.equal(actionValue(submit.args, "--expires"), expires);
    assert.ok(text.includes(`Reviewed specification: ${request.evidenceRef}`));
    assert.ok(text.includes(`Derived scope: ${JSON.stringify(snapshot.approval.scope)}`));
    assert.ok(text.includes(`Risk: ${snapshot.approval.risk}`));
    for (const field of ["specHash", "startingCommit", "profileHash"] as const) {
      assert.ok(text.includes(`${field}: ${snapshot.approval[field]}`), field);
    }
    assert.ok(text.includes(`Prospective expiry: ${expires}`));
    assert.ok(text.includes(`$Expires = '${expires}'`));
    assert.ok(text.includes(`$Target = '${root.replaceAll("'", "''")}'`));
    assert.match(text, /Approval submission: READY/);
    assert.match(text, /signing-key availability has not been checked/);
    assert.ok(text.includes(snapshot.configuration.approvalSigner!));
    assert.match(text, /\$BwCli = Join-Path \$BuildWorksCheckout 'src\\cli\.ts'/);
    assert.match(text, /\$BwSigner = Join-Path \$BuildWorksCheckout 'scripts\\sign-approval\.mjs'/);
    assert.match(text, /approval-request --repo \$Target --run \$RunId --expires \$Expires --out \$PayloadFile/);
    assert.match(text, /\$OutputEncoding = \[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
    assert.match(text, /Get-Content -LiteralPath \$PayloadFile -Raw -Encoding utf8 \| & node \$BwSigner sign --key \$OperatorKeyFile/);
    assert.match(text, /approve --repo \$Target --run \$RunId --expires \$Expires --signature-file \$SignatureFile/);
    assert.match(text, /run --repo \$Target --run \$RunId/);
    assert.match(text, /new execution consent/i);
    assert.match(text, /outside every repository/);
    assert.doesNotMatch(text, /BEGIN PUBLIC KEY|BEGIN PRIVATE KEY|approval\.key/);
    assert.equal(JSON.stringify(envelope), jsonBefore, "text rendering cannot mutate the JSON contract");
    assert.equal(formatOperatorResult(envelope, true), `${jsonBefore}\n`);
    assert.equal(snapshotText(snapshot), text.slice(text.indexOf(`${snapshot.configuration.systemName}: run `)));
    assert.deepEqual(inventory(parent), before);

    rmSync(doctor.keyPath);
    const missingBefore = inventory(parent);
    for (const command of ["status", "run"]) {
      const called = doctor.command(root, [command, "--run", String(run.id)]);
      assert.equal(called.status, command === "run" ? 3 : 0, called.stderr || called.stdout);
      assert.match(called.stdout, /Approval submission: NOT READY: approval public key not found/);
      assert.ok(called.stdout.includes(doctor.keyPath), "the explicit missing path must not fall back to the operator's default key");
      assert.match(called.stdout, /BW_APPROVAL_PUBLIC_KEY/);
      assert.doesNotMatch(called.stdout, /^& node \$BwCli approve /m);
      assert.doesNotMatch(called.stdout, /^\$Signature = .*sign --key/m);
      assert.match(called.stdout, /new execution consent/i);
      assert.deepEqual(inventory(parent), missingBefore);
    }
    assert.equal(inspectLock(root).status, "absent");
    assert.deepEqual(readFileSync(profilePath), profileBytes);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("Task 7 approval-request out preserves canonical bytes and exclusive original-cwd targeting", () => {
  const parent = workspace();
  try {
    const { root, doctor, run, snapshot, profilePath, profileBytes } = approvalFixture(parent);
    const expires = actionValue(snapshot.operatorActions.find((action) => action.kind === "approval_request")!.args, "--expires");
    const args = ["approval-request", "--run", String(run.id), "--expires", expires];
    const store = openStore(root, { readOnly: true });
    let expected: Buffer;
    try {
      const bound = buildBinding(store, root, run.id, expires);
      assert.ok(bound.ok, bound.ok ? "" : bound.reason);
      expected = Buffer.from(approvalPayload(bound.binding), "utf8");
    } finally {
      store.close();
    }
    const stateBefore = inventory(root);
    const raw = doctor.command(root, args);
    assert.equal(raw.status, 0, raw.stderr);
    assert.deepEqual(Buffer.from(raw.stdout, "utf8"), expected);
    const relativeOut = "approval payload.txt";
    const written = doctor.command(root, [...args, "--out", relativeOut]);
    assert.equal(written.status, 0, written.stderr);
    assert.equal(written.stdout, "");
    assert.ok(written.stderr.includes(join(parent, relativeOut)));
    assert.ok(written.stderr.includes(expires));
    const output = readFileSync(join(parent, relativeOut));
    assert.deepEqual(output, expected);
    assert.notEqual(output.subarray(0, 3).toString("hex"), "efbbbf");
    assert.notEqual(output.at(-1), 10);
    assert.ok(!existsSync(join(root, relativeOut)));
    assert.deepEqual(inventory(root), stateBefore);
    const directory = join(parent, "existing destination");
    mkdirSync(directory);
    const missingParent = join(parent, "do not create", "payload.txt");
    const before = inventory(parent);
    for (const path of [relativeOut, directory, missingParent]) {
      const refused = doctor.command(root, [...args, "--out", path]);
      assert.equal(refused.status, 1, refused.stderr);
      assert.equal(refused.stdout, "");
      assert.match(refused.stderr, /exist|overwrite|ENOENT|parent|directory/i);
      assert.deepEqual(inventory(parent), before);
    }
    assert.ok(!existsSync(dirname(missingParent)));
    assert.deepEqual(readFileSync(profilePath), profileBytes);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Task 7 signature-file rejects empty transport before mutation and preserves core refusal audits", () => {
  const parent = workspace();
  try {
    const { root, doctor, run, snapshot, profilePath, profileBytes } = approvalFixture(parent);
    const expires = actionValue(snapshot.operatorActions.find((action) => action.kind === "approval_submit")!.args, "--expires");
    const args = ["approve", "--run", String(run.id), "--expires", expires, "--signature-file"];
    for (const contents of ["", "\uFEFF \r\n\t"]) {
      writeFileSync(join(parent, "empty-signature.txt"), contents);
      const before = inventory(parent);
      const called = doctor.command(root, [...args, "empty-signature.txt"]);
      assert.equal(called.status, 2, called.stderr);
      assert.equal(called.stdout, "");
      assert.match(called.stderr, /empty|signature/i);
      assert.deepEqual(inventory(parent), before);
    }
    for (const path of ["missing-signature.txt", "."]) {
      const before = inventory(parent);
      const called = doctor.command(root, [...args, path]);
      assert.equal(called.status, 2, called.stderr);
      assert.equal(called.stdout, "");
      assert.match(called.stderr, /read|signature/i);
      assert.deepEqual(inventory(parent), before);
    }
    for (const [contents, expiry, reason] of [
      ["\uFEFF\r\nnot!base64\r\n", expires, /not valid base64/],
      ["QU JD", expires, /not valid base64/],
      ["QQ==", expires, /signature is 1 bytes/],
      ["not!base64", new Date(0).toISOString(), /approval expired/],
    ] as const) {
      const path = "signature transport.txt";
      writeFileSync(join(parent, path), contents);
      const before = openStore(root, { readOnly: true });
      const audit = before.getAuditEvents(run.id);
      const stages = before.getStageChain(run.id);
      before.close();
      const called = doctor.command(root, ["approve", "--run", String(run.id),
        "--expires", expiry, "--signature-file", path]);
      assert.equal(called.status, 1, called.stderr);
      assert.equal(called.stdout, "");
      assert.match(called.stderr, reason);
      const after = openStore(root, { readOnly: true });
      try {
        assert.deepEqual(after.getStageChain(run.id), stages);
        assert.equal(after.getApproval(run.id), undefined);
        assert.equal(after.getRun(run.id)!.status, "in_progress");
        const added = after.getAuditEvents(run.id).slice(audit.length);
        assert.equal(added.length, 1);
        assert.equal(added[0].action, "approval.refused");
        assert.match(added[0].summary, reason);
      } finally {
        after.close();
      }
      assert.ok(!existsSync(join(root, path)), "signature-file resolves at the invocation cwd, not the target");
    }
    assert.deepEqual(readFileSync(profilePath), profileBytes);
    assert.equal(inspectLock(root).status, "absent");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

function externalSigner() {
  const directory = mkdtempSync(join(tmpdir(), "bw-cli-approval-"));
  try {
    const created = spawnSync(process.execPath, [SIGNER, "keygen", "--out", directory], {
      cwd: process.cwd(), encoding: "utf8",
    });
    assert.equal(created.status, 0, created.stderr);
    return { directory, key: join(directory, "approval.key"), publicKey: join(directory, "approval.pub") };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function externallySign(key: string, bytes: Buffer): string {
  const signed = spawnSync(process.execPath, [SIGNER, "sign", "--key", key], {
    cwd: process.cwd(), input: bytes, timeout: 5000,
  });
  assert.equal(signed.status, 0, signed.stderr?.toString("utf8"));
  return signed.stdout.toString("utf8").trim();
}

interface CliSpawnObservation {
  kind: "process" | "spawn";
  method: string;
  file: string;
  args: string[];
  cwd: string;
  credentials: string[];
}

function journeyFixture(parent: string, externalPublicKey?: string) {
  const root = repository(parent);
  const design = join(root, "docs", "features", "s", "design.md");
  mkdirSync(dirname(design), { recursive: true });
  writeFileSync(design, "# design\n");
  writeFileSync(join(root, "base.txt"), "worktree-base-marker\n");
  git(root, "add", "-A");
  git(root, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "journey design and base");
  const doctor = doctorFixture(parent, externalPublicKey);
  const controlsPath = join(parent, "cli-observation-controls.json");
  const logPath = join(parent, "cli-spawns.jsonl");
  const sentinel = join(parent, "gh-was-invoked.txt");
  const preload = join(parent, "observe-cli.mjs");
  const controls = { advanceMs: 0, policyDrift: false };
  const configure = (values: Partial<typeof controls>) => {
    Object.assign(controls, values);
    writeFileSync(controlsPath, JSON.stringify(controls));
  };
  configure({});
  writeFileSync(logPath, "");
  writeFileSync(preload, `
    import childProcess from "node:child_process";
    import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
    import { basename } from "node:path";
    import { registerHooks, syncBuiltinESMExports } from "node:module";
    const settings = JSON.parse(readFileSync(${JSON.stringify(controlsPath)}, "utf8"));
    if (settings.advanceMs !== 0) {
      const OriginalDate = Date;
      globalThis.Date = class extends OriginalDate {
        constructor(...args) {
          if (args.length === 0) super(OriginalDate.now() + settings.advanceMs);
          else super(...args);
        }
        static now() { return OriginalDate.now() + settings.advanceMs; }
      };
    }
    if (settings.policyDrift) {
      registerHooks({ load(url, context, nextLoad) {
        const result = nextLoad(url, context);
        if (url !== ${JSON.stringify(pathToFileURL(resolve("src", "policy.ts")).href)}) return result;
        const source = String(result.source);
        const declaration = /^export const RUN_DURATION_LIMIT_SECONDS = (.+);$/m;
        if (!declaration.test(source)) throw new Error("policy observation fixture lost its source declaration");
        return { ...result, source: source.replace(declaration,
          "export const RUN_DURATION_LIMIT_SECONDS = ($1) + 1;") };
      } });
    }
    const credentialNames = (env) => Object.keys(env).filter((name) =>
      /^(GH_|GITHUB_)/i.test(name) && env[name] !== undefined).sort();
    const record = (kind, method, file, args, cwd, env) => {
      appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({
        kind, method, file, args, cwd: cwd ?? process.cwd(), credentials: credentialNames(env)
      }) + "\\n");
      const executable = basename(file).replace(/\\.(exe|cmd|bat)$/i, "").toLowerCase();
      if (executable === "gh" || (["cmd", "sh", "bash", "powershell", "pwsh"].includes(executable)
          && /\\bgh(?:\\.exe)?\\b/i.test(args.join(" ")))) {
        writeFileSync(${JSON.stringify(sentinel)}, "gh must not be invoked");
        throw new Error("GitHub sentinel: gh must not be invoked in the local CLI journey");
      }
    };
    record("process", "entry", process.execPath, process.argv.slice(1), process.cwd(), process.env);
    const synchronous = childProcess.spawnSync;
    childProcess.spawnSync = (file, args = [], options = {}) => {
      record("spawn", "spawnSync", file, args, options.cwd, options.env ?? process.env);
      return synchronous(file, args, options);
    };
    const asynchronous = childProcess.ChildProcess.prototype.spawn;
    childProcess.ChildProcess.prototype.spawn = function(options) {
      const env = Object.fromEntries(options.envPairs.map((pair) => {
        const equal = pair.indexOf("=");
        return [pair.slice(0, equal), pair.slice(equal + 1)];
      }));
      record("spawn", "spawn", options.file, options.args.slice(1), options.cwd, env);
      return asynchronous.call(this, options);
    };
    for (const method of ["exec", "execSync", "execFile", "execFileSync", "fork"]) {
      const original = childProcess[method];
      childProcess[method] = (...args) => {
        record("spawn", method, String(args[0]), Array.isArray(args[1]) ? args[1] : [],
          process.cwd(), process.env);
        return Reflect.apply(original, childProcess, args);
      };
    }
    syncBuiltinESMExports();
    await import(${JSON.stringify(pathToFileURL(doctor.preload).href)});
  `);
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) if (/^(GH_|GITHUB_)/i.test(name)) delete env[name];
  Object.assign(env, { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
    BW_APPROVAL_PUBLIC_KEY: doctor.keyPath, GIT_CEILING_DIRECTORIES: dirname(parent),
    GIT_OPTIONAL_LOCKS: "1", GIT_TERMINAL_PROMPT: "0" });
  const execute = (script: string, args: string[], options: { input?: string | Buffer; timeout?: number } = {}) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: parent, encoding: "utf8", timeout: 120_000, ...options, env,
    });
  const invoke = (args: string[], options: { input?: string | Buffer; timeout?: number } = {}) =>
    execute(CLI, ["--repo", root, ...args], options);
  const calibration = execute("-e", ['require("node:child_process").spawnSync("gh", ["--version"])']);
  assert.equal(calibration.status, 1, calibration.stderr);
  assert.match(calibration.stderr, /GitHub sentinel: gh must not be invoked/);
  assert.equal(readFileSync(sentinel, "utf8"), "gh must not be invoked");
  rmSync(sentinel);
  writeFileSync(logPath, "");
  const created = invoke(NEW_RUN);
  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout, /^\d+\r?\n$/);
  const runId = Number(created.stdout.trim());
  const store = openStore(root, { readOnly: true });
  const run = store.getRun(runId)!;
  const loaded = loadVerifiedProfile(root, run);
  store.close();
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.reason);
  const profile = loaded.profile;
  profile.executor.command = [process.execPath, resolve("test", "fixtures", "harness", "emit-cli-run.mjs"),
    "--implementation-mode", "ok", "--code-review-mode", "ok"];
  profile.executor.probe = [process.execPath, "--version"];
  profile.executor.sandbox.envPassthrough = ["PATH", "SystemRoot", "TEMP", "TMP", "NODE_OPTIONS"];
  profile.executor.sandbox.idleTimeoutSeconds = 30;
  profile.executor.sandbox.absoluteTimeoutSeconds = 120;
  freezeDoctorProfile(root, runId, profile);
  const profilePath = join(root, ".governance", "profiles", String(runId), "profile.json");
  const profileBytes = readFileSync(profilePath);
  const observations = (): CliSpawnObservation[] =>
    readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { root, run, profile, profilePath, profileBytes, invoke, execute, configure, observations, sentinel };
}

function durableCliRun(root: string, runId: number) {
  const store = openStore(root, { readOnly: true });
  try {
    return { run: store.getRun(runId), stages: store.getStageChain(runId), approval: store.getApproval(runId),
      audit: store.getAuditEvents(runId),
      agents: store.query<AgentRunRow>("SELECT a.* FROM agent_run a JOIN stage s ON s.id = a.stage_id WHERE s.run_id = ?", [runId]) };
  } finally {
    store.close();
  }
}

test("Task 8 CLI refuses early frozen age before consent without executing or changing state", () => {
  const parent = workspace();
  try {
    const fixture = journeyFixture(parent);
    const { root, run, profile, profilePath, profileBytes, invoke, configure } = fixture;
    configure({ advanceMs: Date.parse(run.created_at) + profile.policy.runDurationLimitSeconds * 1000 - Date.now() + 1000 });
    const before = inventory(root);
    const rows = durableCliRun(root, run.id);
    for (const consent of [[], ["--yes"]]) {
      const called = invoke(["run", "--run", String(run.id), "--json", ...consent]);
      const body = operatorEnvelope(called, "run");
      assert.equal(called.status, 1, called.stderr);
      assert.equal(body.outcome, "refused");
      assert.equal(body.errorCode, "run_aged");
      assert.match(body.reason!, /guided-entry precondition.*Low-level spec\/plan retain their narrower checks/);
      assert.ok(called.stderr.includes(body.reason!));
      unstartedExecution(body.result as RunCommandResult, "not_needed", ["spec"]);
      assert.doesNotMatch(called.stderr, /execution preview|Type yes|group .* start/);
      assert.deepEqual(durableCliRun(root, run.id), rows);
      assert.deepEqual(inventory(root), before);
    }
    assert.ok(!fixture.observations().some((entry) => entry.args.includes(profile.executor.command[1])));
    assert.deepEqual(readFileSync(profilePath), profileBytes);
    assert.equal(durableCliRun(root, run.id).run!.profile_ref, sha256Hex(profileBytes));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Task 8 CLI refuses missing or tampered reviewed evidence and changed current policy before approval", () => {
  const parent = workspace();
  try {
    const fixture = journeyFixture(parent);
    const { root, run, profilePath, profileBytes, invoke, configure } = fixture;
    const paused = invoke(["run", "--run", String(run.id), "--yes", "--json"]);
    const pause = operatorEnvelope(paused, "run");
    assert.equal(paused.status, 3, paused.stderr || paused.stdout);
    const snapshot = (pause.result as RunCommandResult).snapshot!;
    const reviewed = snapshot.stages.find((stage) => stage.kind === "spec_review")!;
    const specPath = resolve(root, reviewed.outputRef!);
    const original = readFileSync(specPath);
    const parsed = validateSpecDoc(original.toString("utf8"));
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.reason);
    const criterion = parsed.value.acceptanceCriteria[0];
    const changed = original.toString("utf8").replace(`${criterion.id}: ${criterion.text}`,
      `${criterion.id}: ${criterion.text} Unauthorized requirement change.`);
    assert.notEqual(changed, original.toString("utf8"));
    assert.equal(validateSpecDoc(changed).ok, true, "this is a valid document with a different reviewed hash");
    const rows = durableCliRun(root, run.id);
    for (const condition of ["missing", "tampered", "policy"]) {
      if (condition === "missing") rmSync(specPath);
      if (condition === "tampered") writeFileSync(specPath, changed);
      if (condition === "policy") configure({ policyDrift: true });
      try {
        const before = inventory(root);
        const status = invoke(["status", "--run", String(run.id), "--json"]);
        const observed = operatorEnvelope(status, "status").result as RunSnapshot;
        assert.equal(status.status, 0, status.stderr);
        assert.equal(observed.workflowAction.eligible, false);
        const code = condition === "policy" ? "policy_block" : "evidence_invalid";
        const reason = condition === "missing" ? /cannot read.*spec/ : condition === "tampered"
          ? /spec has changed since review/ : /policy has changed since intake/;
        assert.ok(observed.workflowAction.reasons.some((refusal) => refusal.code === code && reason.test(refusal.reason)));
        for (const consent of [[], ["--yes"]]) {
          const called = invoke(["run", "--run", String(run.id), "--json", ...consent]);
          const body = operatorEnvelope(called, "run");
          assert.equal(called.status, 1, called.stderr || called.stdout);
          assert.equal(body.outcome, "refused");
          assert.equal(body.errorCode, code);
          assert.match(body.reason!, reason);
          assert.ok(called.stderr.includes(body.reason!));
          unstartedExecution(body.result as RunCommandResult, "not_needed");
          assert.doesNotMatch(called.stderr, /execution preview|Type yes|group .* start/);
          assert.deepEqual(durableCliRun(root, run.id), rows);
          assert.deepEqual(inventory(root), before);
        }
        const requested = invoke(["approval-request", "--run", String(run.id), "--out", `refused-${condition}.txt`]);
        assert.equal(requested.status, 1, requested.stderr);
        assert.equal(requested.stdout, "");
        assert.match(requested.stderr, reason);
        assert.ok(!existsSync(join(parent, `refused-${condition}.txt`)));
        assert.deepEqual(durableCliRun(root, run.id), rows);
        assert.deepEqual(inventory(root), before);
      } finally {
        if (condition === "policy") configure({ policyDrift: false });
        else writeFileSync(specPath, original);
      }
    }
    assert.deepEqual(readFileSync(profilePath), profileBytes);
    assert.equal(durableCliRun(root, run.id).run!.profile_ref, sha256Hex(profileBytes));
    assert.equal(inspectLock(root).status, "absent");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Task 8 external CLI journey delivers every declared artifact without GitHub and keeps granted expiry informational", (t) => {
  const parent = workspace();
  let keys: ReturnType<typeof externalSigner> | undefined;
  try {
    keys = externalSigner();
    const fixture = journeyFixture(parent, keys.publicKey);
    const { root, run, profile, profilePath, profileBytes, invoke, execute, configure } = fixture;
    const architecture = normalizeText(readFileSync(resolve("ARCHITECTURE.md"), "utf8"));
    const sequence = /## 5\. Stage sequence\b[\s\S]*?```\n([\s\S]*?)```/.exec(architecture);
    assert.ok(sequence, "the architecture must supply the stage sequence");
    const expectedStages = sequence[1].split("->").map((value) => value.trim()).filter((value) => value !== "completed");
    const approvalIndex = expectedStages.indexOf("awaiting_approval");
    assert.ok(approvalIndex > 0);
    const expectedGroups = expectedStages.filter((kind) => !["spec_review", "plan_review", "awaiting_approval"].includes(kind));
    assert.equal(run.project, actionValue(NEW_RUN, "--project"));
    assert.equal(run.feature_id, actionValue(NEW_RUN, "--feature"));
    assert.equal(run.slug, actionValue(NEW_RUN, "--slug"));
    assert.equal(run.change_kind, actionValue(NEW_RUN, "--change-kind"));
    assert.ok(Object.values(profile.modelMap).every((model) => model === actionValue(NEW_RUN, "--model")));
    assert.equal(git(root, "rev-parse", "HEAD"), profile.startingCommit);
    assert.equal(git(root, "show", `${profile.startingCommit}:base.txt`), readFileSync(join(root, "base.txt"), "utf8").trim());
    const beforeInspection = inventory(root);
    assert.equal(invoke(["--help"]).status, 0);
    const doctor = invoke(["doctor", "--slug", run.slug, "--json"]);
    assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
    assert.equal(operatorEnvelope(doctor, "doctor").outcome, "ready");
    assert.deepEqual(inventory(root), beforeInspection);

    const first = invoke(["run", "--run", String(run.id), "--yes", "--json"]);
    const initial = operatorEnvelope(first, "run");
    assert.equal(first.status, 3, first.stderr || first.stdout);
    assert.equal(initial.outcome, "awaiting_approval");
    assert.equal(initial.errorCode, null);
    const initialResult = initial.result as RunCommandResult;
    assert.deepEqual(initialResult.execution.groupsCompleted, expectedGroups.slice(0, 1));
    assert.deepEqual(initialResult.snapshot!.stages.map((stage) => stage.kind), expectedStages.slice(0, approvalIndex));
    assert.equal(durableCliRun(root, run.id).approval, undefined);
    const reviewed = initialResult.snapshot!.stages.at(-1)!;
    const specification = validateSpecDoc(readFileSync(resolve(root, reviewed.outputRef!), "utf8"));
    assert.ok(specification.ok, specification.ok ? "" : specification.reason);
    const declared = computeScope(specification.value.declaredArtifacts);
    assert.deepEqual(initialResult.snapshot!.approval.scope, declared);
    const exportAndSign = (snapshot: RunSnapshot, name: string) => {
      const request = snapshot.operatorActions.find((action) => action.kind === "approval_request")!;
      assert.equal(request.eligible, true);
      const expires = actionValue(request.args, "--expires");
      const payloadPath = join(parent, `${name} payload.txt`);
      const exported = invoke(["approval-request", "--run", String(run.id), "--expires", expires, "--out", payloadPath]);
      assert.equal(exported.status, 0, exported.stderr);
      assert.equal(exported.stdout, "");
      const signed = execute(SIGNER, ["sign", "--key", keys!.key], { input: readFileSync(payloadPath) });
      assert.equal(signed.status, 0, signed.stderr);
      const signaturePath = join(parent, `${name} signature.txt`);
      writeFileSync(signaturePath, signed.stdout, "utf8");
      return { expires, signaturePath };
    };
    const expired = exportAndSign(initialResult.snapshot!, "expired");
    configure({ advanceMs: Date.parse(expired.expires) - Date.now() + 1000 });
    const beforeRefusal = durableCliRun(root, run.id);
    const refusal = invoke(["approve", "--run", String(run.id), "--expires", expired.expires,
      "--signature-file", expired.signaturePath]);
    assert.equal(refusal.status, 1, refusal.stderr);
    assert.equal(refusal.stdout, "");
    assert.ok(refusal.stderr.includes(`approval expired at ${expired.expires}`));
    const refusedRows = durableCliRun(root, run.id);
    assert.equal(refusedRows.approval, undefined);
    assert.deepEqual(refusedRows.stages, beforeRefusal.stages);
    assert.deepEqual(refusedRows.agents, beforeRefusal.agents);
    const addedAudit = refusedRows.audit.slice(beforeRefusal.audit.length);
    assert.equal(addedAudit.length, 1);
    assert.equal(addedAudit[0].action, "approval.refused");
    const waiting = invoke(["status", "--run", String(run.id), "--json"]);
    assert.equal(waiting.status, 0, waiting.stderr);
    const approval = exportAndSign(operatorEnvelope(waiting, "status").result as RunSnapshot, "valid");
    assert.ok(Date.parse(approval.expires) > Date.parse(expired.expires));
    const granted = invoke(["approve", "--run", String(run.id), "--expires", approval.expires,
      "--signature-file", approval.signaturePath]);
    assert.equal(granted.status, 0, granted.stderr);
    assert.match(granted.stdout, /^\d+\r?\n$/);
    const accepted = durableCliRun(root, run.id);
    assert.ok(accepted.approval);
    assert.ok(Date.parse(accepted.approval.created_at) < Date.parse(accepted.approval.expires_at));
    assert.deepEqual(accepted.stages.map((stage) => stage.kind), expectedStages.slice(0, approvalIndex + 1));
    assert.deepEqual(accepted.agents, refusedRows.agents, "signature acceptance is not execution consent");
    configure({ advanceMs: Date.parse(approval.expires) - Date.now() + 1000 });
    const oldGrant = invoke(["status", "--run", String(run.id), "--json"]);
    const oldEnvelope = operatorEnvelope(oldGrant, "status");
    assert.equal(oldGrant.status, 0, oldGrant.stderr);
    const oldSnapshot = oldEnvelope.result as RunSnapshot;
    assert.ok(Date.parse(oldEnvelope.observedAt) > Date.parse(oldSnapshot.approval.expiresAt!));
    assert.equal(oldSnapshot.approval.state, "granted");
    assert.equal(oldSnapshot.workflowAction.eligible, true);
    assert.equal(oldSnapshot.workflowAction.group, expectedGroups[1]);
    assert.deepEqual(durableCliRun(root, run.id).approval, accepted.approval);
    assert.deepEqual(readFileSync(profilePath), profileBytes);

    const continued = invoke(["run", "--run", String(run.id), "--yes", "--json"]);
    const completed = operatorEnvelope(continued, "run");
    assert.equal(continued.status, 0, continued.stderr || continued.stdout);
    assert.equal(completed.outcome, "completed");
    assert.equal(completed.errorCode, null);
    const result = completed.result as RunCommandResult;
    assert.equal(result.execution.consent, "granted");
    assert.deepEqual(result.execution.groupsAttempted, expectedGroups.slice(1));
    assert.deepEqual(result.execution.groupsCompleted, expectedGroups.slice(1));
    assert.deepEqual(result.execution.remainingGroups, []);
    const snapshot = result.snapshot!;
    assert.equal(snapshot.run.status, "completed");
    assert.equal(snapshot.phase, "completed");
    assert.deepEqual(snapshot.stages.map((stage) => stage.kind), expectedStages);
    assert.ok(snapshot.stages.every((stage) => stage.status === "passed" && stage.gateResult === "pass"));
    const delivery = snapshot.delivery;
    assert.ok(delivery.worktreePath);
    const worktree = delivery.worktreePath;
    const head = git(worktree, "rev-parse", "HEAD");
    const branch = git(worktree, "symbolic-ref", "--short", "HEAD");
    assert.equal(delivery.outcome, "pass");
    assert.equal(delivery.branch, branch);
    assert.equal(delivery.deliveredCommit, head);
    assert.equal(delivery.finalReviewedCommit, head);
    assert.equal(delivery.initialVerifiedCommit, head, "this fixture uses a clean first code-review panel");
    const worktrees = git(root, "worktree", "list", "--porcelain").split(/\r?\n/)
      .filter((line) => line.startsWith("worktree ")).map((line) => resolve(line.slice("worktree ".length)));
    assert.ok(worktrees.includes(resolve(worktree)));
    const changed = git(worktree, "diff", "--name-only", `${delivery.patchBase}..${head}`, "--").split(/\r?\n/).filter(Boolean).sort();
    assert.deepEqual(changed, declared);
    assert.deepEqual(delivery.changedPaths, changed);
    assert.deepEqual(delivery.declaredPaths, declared);
    assert.deepEqual(delivery.deliveredPaths, declared);
    assert.deepEqual(delivery.missingPaths, []);
    for (const artifact of declared) assert.ok(statSync(resolve(worktree, ...artifact.split("/"))).isFile(), artifact);
    assert.ok(delivery.verification.length > 0);
    for (const verification of delivery.verification) {
      assert.equal(verification.outcome, "pass");
      assert.equal(verification.commit, head);
      assert.deepEqual(verification.commands.map(({ name, argv }) => ({ name, argv })),
        profile.verification.commands.map(({ name, command }) => ({ name, argv: command })));
      for (const command of verification.commands) {
        assert.equal(command.exitCode, 0);
        assert.deepEqual(command.argv.slice(1), ["--version"]);
        assert.ok(existsSync(resolve(root, command.evidenceRef)));
      }
    }
    assert.ok(snapshot.limitations.includes("Configured standalone reviewers and passed frozen commands do not prove product correctness."));
    assert.equal(profile.executor.sandbox.network, "inherit");
    assert.equal(snapshot.cost.knownUsd, 0);
    const persisted = durableCliRun(root, run.id);
    assert.deepEqual(persisted.approval, accepted.approval);
    assert.ok(persisted.agents.every((row) => row.requested_model === actionValue(NEW_RUN, "--model")));
    assert.equal(persisted.run!.profile_ref, sha256Hex(profileBytes));
    assert.deepEqual(readFileSync(profilePath), profileBytes);
    const beforeRepeat = inventory(root);
    const status = invoke(["status", "--run", String(run.id), "--json"]);
    assert.equal(status.status, 0, status.stderr);
    const settled = operatorEnvelope(status, "status").result as RunSnapshot;
    assert.equal(settled.writer.status, "absent");
    assert.deepEqual(settled, { ...snapshot, writer: settled.writer });
    const listed = invoke(["runs", "--json"]);
    assert.equal(listed.status, 0, listed.stderr);
    const listing = operatorEnvelope(listed, "runs").result as { runs: { id: number; status: string; phase: string }[]; hasMore: boolean };
    assert.deepEqual(listing.runs.map(({ id, status, phase }) => ({ id, status, phase })),
      [{ id: run.id, status: "completed", phase: "completed" }]);
    assert.equal(listing.hasMore, false);
    const text = invoke(["status", "--run", String(run.id)]);
    assert.equal(text.status, 0, text.stderr);
    for (const value of [branch, head, JSON.stringify(worktree)]) assert.ok(text.stdout.includes(value), value);
    assert.match(text.stdout, /do not prove product correctness/);
    for (const consent of [[], ["--yes"]]) {
      const repeated = invoke(["run", "--run", String(run.id), "--json", ...consent]);
      const done = operatorEnvelope(repeated, "run");
      assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
      assert.equal(done.outcome, "completed");
      unstartedExecution(done.result as RunCommandResult, "not_needed");
      assert.deepEqual((done.result as RunCommandResult).snapshot, settled);
      assert.doesNotMatch(repeated.stderr, /execution preview|Type yes|group .* start/);
      assert.deepEqual(durableCliRun(root, run.id), persisted);
      assert.deepEqual(inventory(root), beforeRepeat);
    }
    const observed = fixture.observations();
    assert.ok(observed.length > 0);
    assert.ok(observed.every((entry) => entry.credentials.length === 0));
    assert.ok(!existsSync(fixture.sentinel));
    const spawns = observed.filter((entry) => entry.kind === "spawn");
    assert.ok(spawns.some((entry) => /(?:^|[\\/])git(?:\.exe)?$/i.test(entry.file)));
    assert.ok(spawns.some((entry) => entry.file === process.execPath && entry.args.includes(profile.executor.command[1])));
    assert.ok(observed.some((entry) => entry.kind === "process" && entry.args.includes(SIGNER)));
    for (const entry of spawns) {
      assert.ok(["spawn", "spawnSync"].includes(entry.method), JSON.stringify(entry));
      assert.doesNotMatch(entry.file, /(?:^|[\\/])gh(?:\.(?:exe|cmd|bat))?$/i);
      assert.doesNotMatch([entry.file, ...entry.args].join(" "), /github(?:usercontent)?\.com|\b(?:fetch|push|pull|ls-remote|clone)\b/i);
    }
    t.diagnostic("Observed local Git/Node/fixture argv with GitHub variables absent and a calibrated failing gh sentinel. Verification ran version commands only; neither arbitrary verification nor the real provider is claimed network-sandboxed.");
  } finally {
    rmSync(parent, { recursive: true, force: true });
    if (keys !== undefined) rmSync(keys.directory, { recursive: true, force: true });
  }
});

test("Task 7 external Node approval round trip retains scope hash key and duplicate core guards", () => {
  const parent = workspace();
  let keys: ReturnType<typeof externalSigner> | undefined;
  try {
    keys = externalSigner();
    const { root, doctor, run, snapshot, profilePath, profileBytes } = approvalFixture(parent, keys.publicKey);
    const request = snapshot.operatorActions.find((action) => action.kind === "approval_request")!;
    const expires = actionValue(request.args, "--expires");
    const payloadFile = join(parent, "node payload.txt");
    const output = doctor.command(root, ["approval-request", "--run", String(run.id),
      "--expires", expires, "--out", payloadFile]);
    assert.equal(output.status, 0, output.stderr);
    assert.equal(output.stdout, "");
    const bytes = readFileSync(payloadFile);
    const raw = doctor.command(root, ["approval-request", "--run", String(run.id), "--expires", expires]);
    assert.equal(raw.status, 0, raw.stderr);
    assert.deepEqual(bytes, Buffer.from(raw.stdout, "utf8"));
    const signature = externallySign(keys.key, bytes);
    assert.deepEqual(verifyApproval(bytes.toString("utf8"), signature, createPublicKey(readFileSync(keys.publicKey))), { ok: true });
    const submit = (value: string) => {
      writeFileSync(join(parent, "node signature.txt"), value);
      return doctor.command(root, ["approve", "--run", String(run.id), "--expires", expires,
        "--signature-file", "node signature.txt"]);
    };
    const refused = (value: string, reason: RegExp) => {
      const before = openStore(root, { readOnly: true });
      const events = before.getAuditEvents(run.id);
      const stages = before.getStageChain(run.id);
      const approval = before.getApproval(run.id);
      before.close();
      const called = submit(value);
      assert.equal(called.status, 1, called.stderr);
      assert.equal(called.stdout, "");
      assert.match(called.stderr, reason);
      const after = openStore(root, { readOnly: true });
      try {
        assert.deepEqual(after.getStageChain(run.id), stages);
        assert.deepEqual(after.getApproval(run.id), approval);
        const added = after.getAuditEvents(run.id).slice(events.length);
        assert.equal(added.length, 1);
        assert.equal(added[0].action, "approval.refused");
        assert.match(added[0].summary, reason);
      } finally {
        after.close();
      }
    };
    const payload = bytes.toString("utf8");
    assert.ok(snapshot.approval.scope!.length > 0);
    for (const [field, oldValue] of [
      ["scope", snapshot.approval.scope![0]],
      ["specHash", snapshot.approval.specHash!],
      ["profileHash", snapshot.approval.profileHash!],
      ["startingCommit", snapshot.approval.startingCommit!],
    ]) {
      const changed = field === "scope"
        ? payload.replace(oldValue, `${oldValue}.unauthorized`)
        : payload.replace(`${field}: ${oldValue}`, `${field}: ${"0".repeat(oldValue.length)}`);
      assert.notEqual(changed, payload, field);
      refused(externallySign(keys.key, Buffer.from(changed, "utf8")), /signature does not verify/);
    }
    refused(`${signature.slice(0, 12)} ${signature.slice(12)}`, /not valid base64/);
    const publicBytes = readFileSync(keys.publicKey);
    const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
    writeFileSync(keys.publicKey, other);
    try {
      refused(signature, /not the key frozen at run start/);
    } finally {
      writeFileSync(keys.publicKey, publicBytes);
    }
    const approved = submit(`\uFEFF \r\n\t${signature}\r\n `);
    assert.equal(approved.status, 0, approved.stderr);
    const store = openStore(root, { readOnly: true });
    try {
      const approval = store.getApproval(run.id)!;
      assert.equal(approval.signature, signature);
      assert.equal(approval.expires_at, expires);
      assert.equal(approval.signer, snapshot.configuration.approvalSigner);
      assert.equal(approval.spec_hash, snapshot.approval.specHash);
      assert.equal(approval.profile_hash, snapshot.approval.profileHash);
      assert.equal(approval.starting_commit, snapshot.approval.startingCommit);
      assert.deepEqual(JSON.parse(approval.scope), snapshot.approval.scope);
      const chain = store.getStageChain(run.id);
      assert.equal(chain.length, snapshot.stages.length + 1);
      assert.equal(chain.at(-1)!.kind, "awaiting_approval");
      assert.equal(chain.at(-1)!.status, "passed");
    } finally {
      store.close();
    }
    refused(signature, /already has an awaiting_approval stage/);
    assert.deepEqual(readFileSync(profilePath), profileBytes);
    assert.equal(inspectLock(root).status, "absent");
  } finally {
    rmSync(parent, { recursive: true, force: true });
    if (keys !== undefined) rmSync(keys.directory, { recursive: true, force: true });
  }
});

test("Task 7 external Windows PowerShell transport signs original BOM CRLF input and submits a signature file",
  { skip: process.platform !== "win32" }, () => {
    const parent = workspace();
    let keys: ReturnType<typeof externalSigner> | undefined;
    try {
      keys = externalSigner();
      const { root, doctor, run, snapshot, profilePath, profileBytes } = approvalFixture(parent, keys.publicKey);
      const expires = actionValue(snapshot.operatorActions.find((action) => action.kind === "approval_request")!.args, "--expires");
      const payloadFile = join(parent, "powershell payload.txt");
      const signatureFile = join(parent, "powershell signature.txt");
      const transportedFile = join(parent, "powershell transport input.bin");
      const script = join(parent, "approval transport.ps1");
      writeFileSync(script, [
        "param([string]$Node, [string]$BwCli, [string]$BwSigner, [string]$Target, [long]$RunId, [string]$Expires, [string]$OperatorKeyFile)",
        "$ErrorActionPreference = 'Stop'",
        "$OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
        "$PayloadFile = Join-Path $PWD 'powershell payload.txt'",
        "$SignatureFile = Join-Path $PWD 'powershell signature.txt'",
        "& $Node $BwCli approval-request --repo $Target --run $RunId --expires $Expires --out 'powershell payload.txt'",
        "if ($LASTEXITCODE -ne 0) { throw 'Payload export failed' }",
        "$Payload = Get-Content -LiteralPath $PayloadFile -Raw -Encoding utf8",
        "$Crlf = [System.Environment]::NewLine",
        "$Transport = [string][char]0xFEFF + $Payload.Replace([string][char]10, $Crlf) + $Crlf + $Crlf",
        "[System.IO.File]::WriteAllText((Join-Path $PWD 'powershell transport input.bin'), $Transport, $OutputEncoding)",
        "$Signature = $Transport | & $Node $BwSigner sign --key $OperatorKeyFile",
        "if ($LASTEXITCODE -ne 0) { throw 'External signing failed' }",
        "[System.IO.File]::WriteAllText($SignatureFile, [string][char]0xFEFF + ' ' + $Crlf + $Signature.Trim() + $Crlf + ' ', $OutputEncoding)",
        "& $Node $BwCli approve --repo $Target --run $RunId --expires $Expires --signature-file 'powershell signature.txt'",
        "if ($LASTEXITCODE -ne 0) { throw 'Approval failed' }",
      ].join("\r\n"), "utf8");
      const shell = join(process.env.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const called = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", script, "-Node", process.execPath, "-BwCli", CLI, "-BwSigner", SIGNER,
        "-Target", root, "-RunId", String(run.id), "-Expires", expires, "-OperatorKeyFile", keys.key], {
        cwd: parent, encoding: "utf8", timeout: 30000,
        env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(parent), GIT_OPTIONAL_LOCKS: "1",
          BW_APPROVAL_PUBLIC_KEY: keys.publicKey },
      });
      assert.equal(called.status, 0, called.stderr || called.error?.message);
      assert.match(called.stdout, /^\d+\r?\n$/);
      assert.ok(called.stderr.includes(payloadFile));
      assert.ok(called.stderr.includes(expires));
      const payload = readFileSync(payloadFile);
      assert.notEqual(payload.subarray(0, 3).toString("hex"), "efbbbf");
      assert.notEqual(payload.at(-1), 10);
      const shellBytes = readFileSync(transportedFile);
      assert.deepEqual(shellBytes, Buffer.from(`\uFEFF${payload.toString("utf8").replace(/\n/g, "\r\n")}\r\n\r\n`, "utf8"));
      const signatureBytes = readFileSync(signatureFile);
      assert.equal(signatureBytes.subarray(0, 3).toString("hex"), "efbbbf");
      const signature = signatureBytes.toString("utf8").replace(/^\uFEFF/, "").trim();
      assert.deepEqual(verifyApproval(payload.toString("utf8"), signature,
        createPublicKey(readFileSync(keys.publicKey))), { ok: true });
      const store = openStore(root, { readOnly: true });
      try {
        const approval = store.getApproval(run.id)!;
        assert.equal(approval.signature, signature);
        assert.equal(approval.expires_at, expires);
        assert.equal(approval.signer, snapshot.configuration.approvalSigner);
        assert.equal(store.getStageChain(run.id).at(-1)!.kind, "awaiting_approval");
        assert.equal(store.getStageChain(run.id).at(-1)!.status, "passed");
        assert.ok(store.getAuditEvents(run.id).some((event) => event.action === "approval.granted"));
      } finally {
        store.close();
      }
      assert.ok(!existsSync(join(root, "powershell payload.txt")));
      assert.ok(!existsSync(join(root, "powershell signature.txt")));
      assert.deepEqual(readFileSync(profilePath), profileBytes);
      assert.equal(inspectLock(root).status, "absent");
    } finally {
      rmSync(parent, { recursive: true, force: true });
      if (keys !== undefined) rmSync(keys.directory, { recursive: true, force: true });
    }
  });

test("Task 6 run returns named state and schema refusals without consent or mutation", async (t) => {
  const supported = [...listMigrations(resolve("src", "migrations"))].at(-1)!.index;
  for (const condition of ["missing", "unknown", "older", "newer", "corrupt"]) {
    await t.test(condition, () => {
      const parent = workspace();
      try {
        const root = repository(parent);
        const fixture = doctorFixture(parent);
        if (condition !== "missing") {
          const store = openStore(root);
          if (condition === "older") store.exec(`PRAGMA user_version = ${supported - 1}`);
          if (condition === "newer") store.exec(`PRAGMA user_version = ${supported + 1}`);
          store.close();
          if (condition === "corrupt") writeFileSync(join(root, ".governance", "state.db"), "not a SQLite database");
        }
        const before = inventory(parent);
        for (const consent of [[], ["--yes"]]) {
          const called = fixture.run(root, ["--run=1", "--json", ...consent]);
          const body = operatorEnvelope(called, "run");
          assert.equal(called.status, 1, called.stderr || called.stdout);
          assert.equal(body.outcome, "refused");
          assert.equal(body.errorCode, condition === "missing" ? "state_missing" : condition === "unknown" ? "run_missing"
            : condition === "corrupt" ? "state_unavailable" : "schema_unsupported");
          assert.equal(body.repository, realpathSync(root));
          assert.equal(body.runId, 1);
          assert.ok(body.reason);
          assert.ok(called.stderr.includes(body.reason));
          const result = body.result as RunCommandResult;
          assert.equal(result.snapshot, null);
          unstartedExecution(result, "not_needed");
          if (condition === "missing") assert.match(body.reason, /state\.db/);
          if (condition === "unknown") assert.match(body.reason, /run 1 does not exist/);
          if (condition === "older") assert.match(body.reason, /migrate --repo/);
          if (condition === "newer") assert.match(body.reason, /matching checkout.*do not downgrade/);
          if (condition === "corrupt") assert.match(body.reason, /SQLITE.*not a database/);
          assert.doesNotMatch(called.stderr, /execution preview|group spec start|Type yes/);
          assert.deepEqual(inventory(parent), before);
        }
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    });
  }
});

test("Task 6 run refuses partial chains and reports persisted blocks without starting work", async (t) => {
  for (const condition of ["partial", "blocked"]) {
    await t.test(condition, () => {
      const parent = workspace();
      try {
        const { root, doctor, run } = preapprovalFixture(parent);
        const store = openStore(root);
        let expectedStages;
        try {
          if (condition === "blocked") store.setRunStatus(run.id, "blocked");
          else {
            const stage = store.insertStage(run.id, "spec", null);
            appendAudit(store, { runId: run.id, stageId: stage.id, actor: "system", actorType: "cli",
              action: "spec.stage.create", summary: `created spec stage ${stage.id}` });
          }
          expectedStages = store.getStageChain(run.id);
        } finally {
          store.close();
        }
        const before = inventory(parent);
        for (const consent of [[], ["--yes"]]) {
          const called = doctor.run(root, ["--run", String(run.id), "--json", ...consent]);
          const body = operatorEnvelope(called, "run");
          assert.equal(called.status, 1, called.stderr || called.stdout);
          assert.equal(body.outcome, condition === "blocked" ? "blocked" : "refused");
          assert.equal(body.errorCode, condition === "blocked" ? "policy_block" : "chain_incomplete");
          assert.match(body.reason!, condition === "blocked" ? /run \d+ is blocked/ : /partial.*cannot be replayed/);
          assert.ok(called.stderr.includes(body.reason!));
          const result = body.result as RunCommandResult;
          assert.equal(result.snapshot!.run.status, condition === "blocked" ? "blocked" : "in_progress");
          assert.equal(result.snapshot!.phase, condition === "blocked" ? "blocked" : "interrupted_or_inconsistent");
          assert.deepEqual(result.snapshot!.stages.map((stage) => [stage.id, stage.status]),
            expectedStages.map((stage) => [stage.id, stage.status]));
          unstartedExecution(result, "not_needed");
          assert.doesNotMatch(called.stderr, /execution preview|group spec start|Type yes/);
          assert.deepEqual(inventory(parent), before);
        }
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    });
  }
});

test("Task 6 run JSON usage and target errors remain a single refusal envelope", () => {
  const parent = workspace();
  try {
    const fixture = doctorFixture(parent);
    const missing = join(parent, "missing repository");
    const before = inventory(parent);
    for (const args of [
      ["--json"], ["--run=1", "--unknown", "--json"], ["--run=1", "--yes=true", "--json"],
    ]) {
      const called = fixture.run(missing, args);
      const body = operatorEnvelope(called, "run");
      assert.equal(called.status, 2, called.stderr || called.stdout);
      assert.equal(body.outcome, "refused");
      assert.equal(body.errorCode, "usage");
      assert.equal(body.repository, null);
      assert.equal(body.result, null);
      assert.ok(body.reason);
      assert.doesNotMatch(called.stdout, /usage: bw /);
      assert.deepEqual(inventory(parent), before);
    }
    const called = fixture.run(missing, ["--run=1", "--json"]);
    const body = operatorEnvelope(called, "run");
    assert.equal(called.status, 1, called.stderr || called.stdout);
    assert.equal(body.outcome, "refused");
    assert.equal(body.errorCode, "target_unavailable");
    assert.equal(body.repository, null);
    assert.equal(body.result, null);
    assert.ok(body.reason!.includes(missing));
    assert.deepEqual(inventory(parent), before);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Task 6 run requires explicit consent for JSON and redirected input and prints only the frozen preview on stderr", () => {
  const parent = workspace();
  try {
    const { root, doctor, run, profile } = preapprovalFixture(parent);
    profile.policy.specReviewRounds += 1;
    profile.policy.codeReviewMaxRounds = 1;
    profile.policyHash = policyHash(profile.policy);
    profile.modelMap.spec = "frozen-preview-model";
    freezeDoctorProfile(root, run.id, profile);
    const before = inventory(parent);
    for (const json of [true, false]) {
      for (const input of ["", "yes\n"]) {
        const called = doctor.run(root, ["--run", String(run.id), ...(json ? ["--json"] : [])], { input });
        assert.equal(called.error, undefined, "noninteractive consent must return inside the process timeout");
        assert.equal(called.status, 1, called.stderr || called.stdout);
        if (json) {
          const body = operatorEnvelope(called, "run");
          assert.equal(body.outcome, "consent_required");
          assert.equal(body.errorCode, "consent_required");
          assert.equal(body.repository, realpathSync(root));
          assert.equal(body.runId, run.id);
          assert.ok(called.stderr.includes(body.reason!));
          const result = body.result as RunCommandResult;
          unstartedExecution(result, "required", ["spec"]);
          assert.equal(result.snapshot!.workflowAction.eligible, true);
          assert.equal(result.snapshot!.phase, "ready");
          assert.deepEqual(result.snapshot!.configuration.modelMap, profile.modelMap);
        } else {
          assert.match(called.stdout, /^run: consent_required\r?\n/);
          assert.match(called.stdout, /"consent": "required"/);
          assert.match(called.stdout, /"groupsAttempted": \[\]/);
          assert.doesNotMatch(called.stdout, /\u001b\[/);
        }
        assert.doesNotMatch(called.stdout, /execution preview|Canonical target:|Dispatch ceilings|group spec start/);
        assert.ok(called.stderr.includes(`Canonical target: ${realpathSync(root)}`));
        assert.ok(called.stderr.includes(`Frozen models: ${JSON.stringify(profile.modelMap)}`));
        assert.ok(called.stderr.includes(`Frozen verification commands: ${JSON.stringify(
          profile.verification.commands.map((command) => ({ name: command.name, argv: command.command })))}`));
        assert.match(called.stderr, /Remaining groups: spec\r?\n/);
        const ceiling = 2 + profile.policy.specReviewRounds * (profile.policy.panelSizeMax + 1);
        assert.ok(called.stderr.includes(`Dispatch ceilings for this range: spec=${ceiling}; total ${ceiling}.`));
        assert.ok(called.stderr.includes(`spec ${profile.policy.specReviewRounds} round(s)`));
        assert.ok(called.stderr.includes(`${profile.policy.codeReviewPanelSize} reviewers * ${profile.policy.codeReviewMaxRounds} panel(s)`));
        assert.match(called.stderr, /Consent covers EVERY listed group.*not only the next group/);
        assert.match(called.stderr, /no intermediate voluntary stop control or hard monetary cap/);
        assert.match(called.stderr, /Consent does not sign approval, export proposals, publish, or authorize a later invocation/);
        assert.doesNotMatch(called.stderr, /Type yes to consent|group spec start|group spec end|REVISED-spec/);
        assert.deepEqual(inventory(parent), before, "consent refusal must not acquire a lock, write rows, or dispatch");
      }
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Task 6 run executes the actual spec group once and repeats an approval pause without consent", () => {
  const parent = workspace();
  try {
    const { root, doctor, run, profile, profilePath } = preapprovalFixture(parent);
    const profileBytes = readFileSync(profilePath);
    const called = doctor.run(root, ["--run", String(run.id), "--yes", "--json"], {
      timeout: profile.executor.sandbox.absoluteTimeoutSeconds * 1000,
    });
    const body = operatorEnvelope(called, "run");
    assert.equal(called.status, 3, called.stderr || called.stdout);
    assert.equal(body.outcome, "awaiting_approval");
    assert.equal(body.errorCode, null);
    assert.equal(body.reason, null);
    const result = body.result as RunCommandResult;
    assert.equal(result.execution.consent, "granted");
    assert.deepEqual(result.execution.groupsAttempted, ["spec"]);
    assert.deepEqual(result.execution.groupsCompleted, ["spec"]);
    assert.deepEqual(result.execution.remainingGroups, []);
    assert.ok(Number.isFinite(Date.parse(result.execution.startedAt!)));
    assert.ok(Date.parse(result.execution.endedAt!) >= Date.parse(result.execution.startedAt!));
    assert.ok(result.execution.elapsedMs! >= 0);
    const snapshot = result.snapshot!;
    assert.equal(snapshot.phase, "awaiting_approval");
    assert.equal(snapshot.run.status, "in_progress");
    assert.equal(snapshot.workflowAction.group, "approval");
    assert.equal(snapshot.workflowAction.eligible, true);
    assert.deepEqual(snapshot.stages.map((stage) => stage.kind), ["spec", "spec_review"]);
    assert.ok(snapshot.stages.every((stage) => stage.status === "passed" && stage.gateResult === "pass"));
    const spec = readFileSync(snapshot.stages[1].outputRef!, "utf8");
    const parsed = validateSpecDoc(spec);
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.reason);
    assert.deepEqual(snapshot.approval.scope, computeScope(parsed.value.declaredArtifacts));
    assert.equal(snapshot.approval.specHash, sha256Hex(normalizeText(spec)));
    assert.equal(snapshot.approval.state, "missing");
    assert.equal(snapshot.cost.knownUsd, 0);
    assert.ok(snapshot.cost.agentRows > 0);
    const store = openStore(root, { readOnly: true });
    try {
      const authorCount = store.query<{ n: number }>("SELECT COUNT(*) n FROM agent_run WHERE role = 'author'")[0].n;
      const reviewers = store.query<{ round: number; n: number }>(
        "SELECT f.round, COUNT(DISTINCT ar.agent) n FROM finding f JOIN finding_report fr ON fr.finding_id = f.id JOIN agent_run ar ON ar.id = fr.agent_run_id GROUP BY f.round");
      const expectedDispatches = 2 + profile.policy.specReviewRounds + reviewers.reduce((total, round) => total + round.n, 0);
      assert.equal(authorCount, 2 + profile.policy.specReviewRounds);
      assert.equal(snapshot.cost.agentRows, expectedDispatches);
      assert.equal(store.getApproval(run.id), undefined);
      assert.ok(store.getAuditEvents(run.id).some((event) => event.action === "spec.gate.pass"));
      assert.equal(store.query("SELECT * FROM stage WHERE kind = 'awaiting_approval'").length, 0);
    } finally {
      store.close();
    }
    assert.equal(called.stderr.match(/group spec start/g)?.length, 1);
    assert.equal(called.stderr.match(/group spec end/g)?.length, 1);
    assert.match(called.stderr, /passed boundary recorded/);
    assert.doesNotMatch(called.stdout, /group spec start|group spec end|execution preview/);
    assert.doesNotMatch(called.stderr, /REVISED-spec|fixture reconcile|"proposedContentChanges"/);
    assert.deepEqual(readFileSync(profilePath), profileBytes);
    assert.equal(inspectLock(root).status, "absent");
    const before = inventory(parent);
    for (const args of [[], ["--yes"]]) {
      const repeated = doctor.run(root, ["--run", String(run.id), "--json", ...args]);
      const paused = operatorEnvelope(repeated, "run");
      assert.equal(repeated.status, 3, repeated.stderr || repeated.stdout);
      assert.equal(paused.outcome, "awaiting_approval");
      assert.equal(paused.errorCode, null);
      const pausedResult = paused.result as RunCommandResult;
      unstartedExecution(pausedResult, "not_needed");
      assert.equal(pausedResult.snapshot!.cost.agentRows, snapshot.cost.agentRows);
      assert.deepEqual(pausedResult.snapshot!.stages, snapshot.stages);
      assert.doesNotMatch(repeated.stderr, /execution preview|group spec start|Type yes/);
      assert.deepEqual(inventory(parent), before, "a separate approval-pause invocation must not replay spec");
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Task 5 doctor --run keeps frozen configuration separate from current defaults and signer", () => {
  const parent = workspace();
  try {
    const { root, doctor, run, profile } = doctorRun(parent);
    profile.systemName = "Frozen operator test";
    profile.policy.runDurationLimitSeconds += 60;
    profile.policy.specReviewRounds += 1;
    profile.policy.codeReviewMaxRounds = 1;
    profile.policyHash = policyHash(profile.policy);
    profile.modelMap.spec = "frozen-spec-model";
    freezeDoctorProfile(root, run.id, profile);
    writeFileSync(join(root, "governed.yaml"), 'verify:\n  - name: current-only\n    command: ["npm", "--version"]\n');
    git(root, "add", "-A");
    git(root, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "current config");
    const { publicKey } = generateKeyPairSync("ed25519");
    writeFileSync(doctor.keyPath, publicKey.export({ type: "spki", format: "pem" }));
    const before = inventory(parent);
    const result = doctor.invoke(root, "--run", String(run.id), "--json");
    const body = operatorEnvelope(result, "doctor");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(body.outcome, "ready");
    assert.equal(body.errorCode, null);
    assert.equal(body.runId, run.id);
    assert.equal(body.repository, realpathSync(root));
    const report = body.result as DoctorResult;
    assert.deepEqual(Object.keys(report).sort(), ["checks", "current", "frozen", "limitations"]);
    const policy = profile.policy;
    assert.deepEqual(report.frozen, {
      systemName: profile.systemName, profileHash: sha256Hex(canonicalJson(profile)),
      policyHash: profile.policyHash, startingCommit: profile.startingCommit, modelMap: profile.modelMap,
      verificationCommands: profile.verification.commands.map((command) => ({ name: command.name, argv: command.command })),
      documentReview: { panelSizeMin: policy.panelSizeMin, panelSizeMax: policy.panelSizeMax,
        specReviewRounds: policy.specReviewRounds, planReviewRounds: policy.planReviewRounds,
        requiredSpecialties: policy.requiredSpecialties },
      codeReview: { panelSize: policy.codeReviewPanelSize, maxRounds: policy.codeReviewMaxRounds,
        blockingSeverity: policy.codeReviewBlockingSeverity, severities: policy.severities },
      deadline: new Date(Date.parse(run.created_at) + policy.runDurationLimitSeconds * 1000).toISOString(),
      approvalSigner: profile.approvalSigner,
    });
    assert.deepEqual(report.current.policy, buildPolicy());
    assert.notEqual(report.current.policyHash, report.frozen!.policyHash);
    assert.notEqual(report.current.startingCommit, report.frozen!.startingCommit);
    assert.notEqual(report.current.approvalSigner, report.frozen!.approvalSigner);
    assert.deepEqual(report.current.verification, { commands: [{ name: "current-only", command: ["npm", "--version"] }] });
    for (const name of ["run_state", "frozen_profile", "frozen_models", "frozen_verification",
      "frozen_deadline", "frozen_approval_signer", "frozen_executor_probe"]) {
      assert.equal(report.checks.find((check) => check.name === name)!.status, "pass", name);
    }
    assert.match(report.checks.find((check) => check.name === "run_state")!.evidence,
      /persisted in_progress; phase ready; 0 recorded stage\(s\)/);
    assert.deepEqual(inventory(parent), before);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Task 5 doctor --run does not impose current intake cleanliness or config on a continuing run", () => {
  const parent = workspace();
  try {
    const { root, doctor, run, profile } = doctorRun(parent);
    const spec = "feature: f-1\nchange_kind: feature\n\n## Declared artifacts\n\n- src/thing.ts\n\n## Acceptance criteria\n\n- AC-001: The artifact is delivered.\n";
    const parsed = validateSpecDoc(spec);
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.reason);
    const specPath = join(root, "docs", "features", "s", "spec.md");
    writeFileSync(specPath, spec);
    const store = openStore(root);
    try {
      let previous: number | null = null;
      for (const kind of ["spec", "spec_review"]) {
        const stage = store.insertStage(run.id, kind, previous);
        appendAudit(store, { runId: run.id, stageId: stage.id, actor: "system", actorType: "cli",
          action: `${kind}.stage.create`, summary: `created ${kind} stage ${stage.id}` });
        store.completeStage(stage.id, specPath, "pass");
        previous = stage.id;
      }
      const risk = computeRisk(parsed.value.changeKind, computeScope(parsed.value.declaredArtifacts).length,
        touchesProtected(parsed.value.declaredArtifacts, run.slug));
      appendAudit(store, { runId: run.id, stageId: previous, actor: "system", actorType: "cli",
        action: "spec.gate.pass",
        summary: `spec_review gate passed after 1 round(s); specHash=${sha256Hex(normalizeText(spec))}; risk=${risk}` });
    } finally {
      store.close();
    }
    writeFileSync(join(root, "governed.yaml"), "not a verification configuration\n");
    git(root, "add", "--", "governed.yaml");
    git(root, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "current invalid config");
    writeFileSync(join(root, "tracked.txt"), "operator's uncommitted change\n");
    const before = inventory(parent);
    const current = doctor.invoke(root, "--json");
    const currentBody = operatorEnvelope(current, "doctor");
    assert.equal(current.status, 1);
    assert.equal(currentBody.errorCode, "setup_required");
    const selected = doctor.invoke(root, "--run", String(run.id), "--json");
    const body = operatorEnvelope(selected, "doctor");
    assert.equal(selected.status, 0, selected.stderr || selected.stdout);
    assert.equal(body.outcome, "ready");
    assert.equal(body.errorCode, null);
    assert.equal(body.reason, null);
    const report = body.result as DoctorResult;
    for (const name of ["working_tree", "verification_config"]) {
      const currentCheck = (currentBody.result as DoctorResult).checks.find((check) => check.name === name)!;
      assert.equal(currentCheck.status, "fail");
      assert.deepEqual(report.checks.find((check) => check.name === name), currentCheck);
    }
    assert.equal(report.current.verification, null);
    assert.match(report.checks.find((check) => check.name === "run_state")!.evidence,
      /persisted in_progress; phase awaiting_approval; 2 recorded stage\(s\)/);
    assert.deepEqual(report.frozen!.verificationCommands,
      profile.verification.commands.map((command) => ({ name: command.name, argv: command.command })));
    assert.equal(report.checks.find((check) => check.name === "frozen_verification")!.status, "pass");
    assert.deepEqual(inventory(parent), before);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Task 5 doctor --run preserves readable state and original invalid-profile diagnostics", async (t) => {
  for (const condition of ["missing_ref", "missing_file", "unreadable", "malformed_json", "malformed_shape", "hash_invalid"]) {
    await t.test(condition, () => {
      const parent = workspace();
      try {
        const { root, doctor, run, profile, profilePath } = doctorRun(parent);
        const store = openStore(root);
        let reason: string;
        let stageId: number;
        try {
          stageId = store.insertStage(run.id, "spec", null).id;
          if (condition === "missing_ref") store.exec("UPDATE run SET profile_ref = NULL WHERE id = ?", [run.id]);
          if (condition === "missing_file" || condition === "unreadable") rmSync(profilePath);
          if (condition === "unreadable") mkdirSync(profilePath);
          if (condition === "malformed_json") writeFileSync(profilePath, "{");
          if (condition === "malformed_shape") {
            const malformed = { ...profile, modelMap: null };
            const serialized = canonicalJson(malformed);
            writeFileSync(profilePath, serialized);
            store.setProfileRef(run.id, sha256Hex(serialized));
          }
          if (condition === "hash_invalid") {
            profile.modelMap.spec = "not-the-frozen-model";
            writeFileSync(profilePath, canonicalJson(profile));
          }
          const loaded = loadVerifiedProfile(root, store.getRun(run.id)!);
          assert.equal(loaded.ok, false, condition);
          assert.ok(!loaded.ok);
          reason = loaded.reason;
        } finally {
          store.close();
        }
        const before = inventory(parent);
        const result = doctor.invoke(root, "--run", String(run.id), "--json");
        const body = operatorEnvelope(result, "doctor");
        assert.equal(result.status, 1, result.stderr || result.stdout);
        assert.equal(body.outcome, "not_ready");
        assert.equal(body.errorCode, "evidence_invalid");
        assert.equal(body.repository, realpathSync(root));
        assert.equal(body.runId, run.id);
        assert.ok(body.reason!.includes(reason));
        const report = body.result as DoctorResult;
        assert.deepEqual(report.frozen, { systemName: null, profileHash: null, policyHash: null,
          startingCommit: null, modelMap: null, verificationCommands: null, documentReview: null,
          codeReview: null, deadline: null, approvalSigner: null });
        assert.equal(report.current.startingCommit, profile.startingCommit);
        assert.deepEqual(report.current.verification, profile.verification);
        assert.equal(report.checks.find((check) => check.name === "executor_probe")!.status, "pass");
        const stateCheck = report.checks.find((check) => check.name === "run_state")!;
        assert.equal(stateCheck.status, "pass");
        assert.match(stateCheck.evidence, /persisted in_progress; phase interrupted_or_inconsistent; 1 recorded stage\(s\)/);
        const failedProfile = report.checks.find((check) => check.name === "frozen_profile")!;
        assert.equal(failedProfile.status, "fail");
        assert.equal(failedProfile.evidence, reason);
        assert.ok(failedProfile.repair);
        for (const name of ["frozen_models", "frozen_verification", "frozen_deadline",
          "frozen_approval_signer", "frozen_executor_probe"]) {
          const check = report.checks.find((entry) => entry.name === name)!;
          assert.equal(check.status, "not_checked", name);
          assert.ok(check.evidence, name);
        }
        assert.ok(report.limitations.includes(reason));
        assert.ok(report.checks.some((check) => check.name === "boundary_evidence_invalid"
          && check.status === "fail" && check.evidence.includes(reason)));
        const status = cli(parent, parent, "status", "--repo", root, "--run", String(run.id), "--json");
        const snapshot = operatorEnvelope(status, "status").result as RunSnapshot;
        assert.equal(status.status, 0, status.stderr);
        assert.deepEqual(snapshot.configuration, report.frozen);
        assert.deepEqual(snapshot.stages.map((stage) => stage.id), [stageId]);
        if (condition === "malformed_json") {
          const text = doctor.invoke(root, "--run", String(run.id));
          assert.equal(text.status, 1);
          assert.match(text.stdout, /^FAIL frozen_profile:/m);
          assert.match(text.stdout, /^NOT CHECKED frozen_models:/m);
          assert.match(text.stdout, /^PASS run_state:/m);
          assert.ok(text.stdout.includes(reason));
        }
        assert.deepEqual(inventory(parent), before);
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    });
  }
});

test("Task 5 doctor --run never executes an arbitrary retained frozen probe", () => {
  const parent = workspace();
  try {
    const { root, doctor, run, profile } = doctorRun(parent);
    const sentinel = join(parent, "retained-probe-must-not-run.txt");
    profile.executor.probe = [process.execPath, "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "unexpected retained probe execution")`];
    freezeDoctorProfile(root, run.id, profile);
    const before = inventory(parent);
    const result = doctor.invoke(root, "--run", String(run.id), "--json");
    const body = operatorEnvelope(result, "doctor");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(body.outcome, "ready");
    const report = body.result as DoctorResult;
    assert.equal(report.checks.find((check) => check.name === "executor_probe")!.status, "pass");
    const frozenProbe = report.checks.find((check) => check.name === "frozen_executor_probe")!;
    assert.equal(frozenProbe.status, "not_checked");
    assert.match(frozenProbe.evidence, /frozen executor differs.*retained probe was not executed/);
    assert.ok(report.limitations.includes(frozenProbe.evidence));
    assert.ok(!existsSync(sentinel));
    assert.ok(!existsSync(join(root, ".governance", "raw")));
    assert.deepEqual(inventory(parent), before);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Task 5 doctor --run reports the reader's frozen-age refusal without changing the run", () => {
  const parent = workspace();
  try {
    const { root, doctor, run, profile } = doctorRun(parent);
    profile.policy.runDurationLimitSeconds = 1;
    profile.policyHash = policyHash(profile.policy);
    freezeDoctorProfile(root, run.id, profile);
    const createdAt = new Date(Date.now() - (profile.policy.runDurationLimitSeconds + 1) * 1000).toISOString();
    assert.ok((Date.now() - Date.parse(createdAt)) / 1000 < buildPolicy().runDurationLimitSeconds);
    const store = openStore(root);
    try {
      store.exec("UPDATE run SET created_at = ? WHERE id = ?", [createdAt, run.id]);
    } finally {
      store.close();
    }
    const before = inventory(parent);
    const result = doctor.invoke(root, "--run", String(run.id), "--json");
    const body = operatorEnvelope(result, "doctor");
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(body.outcome, "not_ready");
    assert.equal(body.errorCode, "run_aged");
    assert.match(body.reason!, /guided-entry precondition/);
    assert.match(body.reason!, /Low-level spec\/plan retain their narrower checks/);
    assert.match(body.reason!, /cannot make aged downstream delivery eligible/);
    const report = body.result as DoctorResult;
    const boundary = report.checks.find((check) => check.name === "boundary_run_aged")!;
    assert.equal(boundary.status, "fail");
    assert.equal(boundary.evidence, body.reason);
    assert.equal(report.checks.find((check) => check.name === "run_state")!.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "frozen_deadline")!.status, "pass");
    assert.equal(report.frozen!.deadline,
      new Date(Date.parse(createdAt) + profile.policy.runDurationLimitSeconds * 1000).toISOString());
    assert.deepEqual(inventory(parent), before);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Task 5 doctor --run preserves state, run, schema, and SQLite error envelopes", async (t) => {
  const supported = [...listMigrations(resolve("src", "migrations"))].at(-1)!.index;
  for (const condition of ["missing", "empty", "older", "newer", "corrupt"]) {
    await t.test(condition, () => {
      const parent = workspace();
      try {
        const root = repository(parent);
        const doctor = doctorFixture(parent);
        if (condition !== "missing") {
          const store = openStore(root);
          if (condition === "older") store.exec(`PRAGMA user_version = ${supported - 1}`);
          if (condition === "newer") store.exec(`PRAGMA user_version = ${supported + 1}`);
          store.close();
          if (condition === "corrupt") writeFileSync(join(root, ".governance", "state.db"), "not a SQLite database");
        }
        const before = inventory(parent);
        const result = doctor.invoke(root, "--run=1", "--json");
        const body = operatorEnvelope(result, "doctor");
        assert.equal(result.status, 1, result.stderr || result.stdout);
        assert.equal(body.outcome, "error");
        assert.equal(body.errorCode, condition === "missing" ? "state_missing" : condition === "empty" ? "run_missing"
          : condition === "corrupt" ? "state_unavailable" : "schema_unsupported");
        assert.equal(body.repository, realpathSync(root));
        assert.equal(body.runId, 1);
        assert.equal(body.result, null);
        assert.ok(body.reason);
        assert.ok(result.stderr.includes(body.reason), "stderr retains the same original diagnostic as JSON");
        if (condition === "missing") assert.match(body.reason, /state\.db/);
        if (condition === "empty") assert.match(body.reason, /run 1 does not exist/);
        if (condition === "older") assert.match(body.reason, /migrate --repo/);
        if (condition === "newer") assert.match(body.reason, /matching checkout.*do not downgrade/);
        if (condition === "corrupt") assert.match(body.reason, /SQLITE.*not a database/);
        assert.deepEqual(inventory(parent), before);
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    });
  }
});

test("Task 5 doctor --run observes committed state under a writer and bounds exclusive contention", async () => {
  for (const mode of ["live", "exclusive"] as const) {
    const parent = workspace();
    let writer: ChildProcess | undefined;
    try {
      const { root, doctor, run } = doctorRun(parent);
      writer = await heldWriter(root, mode);
      const before = inventory(parent);
      const started = Date.now();
      const result = doctor.invoke(root, "--run", String(run.id), "--json");
      const body = operatorEnvelope(result, "doctor");
      assert.equal(result.status, 1, result.stderr || result.stdout);
      if (mode === "live") {
        assert.equal(body.outcome, "not_ready");
        assert.equal(body.errorCode, "writer_contention");
        const report = body.result as DoctorResult;
        assert.match(report.checks.find((check) => check.name === "run_state")!.evidence, /persisted in_progress; phase ready/);
        assert.equal(report.checks.find((check) => check.name === "boundary_writer_contention")!.status, "fail");
        assert.equal(report.checks.find((check) => check.name === "frozen_profile")!.status, "pass");
      } else {
        assert.ok(Date.now() - started < 5000, "doctor retains the bounded read-only wait");
        assert.equal(body.outcome, "error");
        assert.equal(body.errorCode, "state_unavailable");
        assert.equal(body.result, null);
        assert.match(body.reason!, /SQLITE.*locked|SQLITE.*busy/i);
        assert.match(body.reason!, /migrate --repo/);
        assert.ok(result.stderr.includes(body.reason!));
      }
      assert.equal(inspectLock(root).pid, writer.pid);
      assert.deepEqual(inventory(parent), before);
    } finally {
      if (writer) await stopFixtureWriter(writer);
      rmSync(parent, { recursive: true, force: true });
    }
  }
});

test("Task 4 doctor current and slug presentation is one no-spend report without state creation", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const doctor = doctorFixture(parent);
    let before = inventory(parent);
    const current = doctor.invoke(root, "--json");
    let body = operatorEnvelope(current, "doctor");
    assert.equal(current.status, 0, current.stderr || current.stdout);
    assert.equal(body.outcome, "ready");
    assert.equal(body.errorCode, null);
    assert.equal(body.reason, null);
    assert.equal(body.repository, realpathSync(root));
    assert.equal(body.runId, null);
    let report = body.result as DoctorResult;
    assert.deepEqual(Object.keys(report).sort(), ["checks", "current", "frozen", "limitations"]);
    assert.equal(report.frozen, null);
    assert.equal(report.current.startingCommit, git(root, "rev-parse", "HEAD"));
    assert.equal(report.checks.find((check) => check.name === "design_readable")!.status, "not_checked");
    assert.ok(report.checks.every((check) => check.status !== "fail"));
    for (const check of report.checks) {
      assert.deepEqual(Object.keys(check).sort(), ["name", "status", "evidence", "repair"].sort());
    }
    assert.match(report.limitations.join(" "), /authentication.*entitlement.*quota.*not checked/);
    assert.doesNotMatch(current.stdout, /BEGIN PUBLIC KEY/);
    assert.deepEqual(inventory(parent), before);

    const missingDesign = doctor.invoke(root, "--slug=s", "--json");
    body = operatorEnvelope(missingDesign, "doctor");
    assert.equal(missingDesign.status, 1);
    assert.equal(body.outcome, "not_ready");
    assert.equal(body.errorCode, "setup_required");
    report = body.result as DoctorResult;
    assert.equal(report.checks.find((check) => check.name === "design_readable")!.status, "fail");
    assert.equal(report.checks.find((check) => check.name === "design_committed")!.status, "fail");
    assert.ok(body.reason);
    assert.deepEqual(inventory(parent), before);

    const design = join(root, "docs", "features", "s", "design.md");
    mkdirSync(dirname(design), { recursive: true });
    writeFileSync(design, "Operator-authored design.\n");
    git(root, "add", "-A");
    git(root, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "design");
    before = inventory(parent);
    const ready = doctor.invoke(root, "--slug=s", "--json");
    body = operatorEnvelope(ready, "doctor");
    assert.equal(ready.status, 0, ready.stderr || ready.stdout);
    assert.equal(body.outcome, "ready");
    assert.ok((body.result as DoctorResult).checks.every((check) => check.status === "pass"));
    assert.deepEqual(inventory(parent), before);

    rmSync(doctor.keyPath);
    before = inventory(parent);
    const text = doctor.invoke(root);
    assert.equal(text.status, 1);
    assert.match(text.stdout, /^PASS node:/m);
    assert.match(text.stdout, /^FAIL approval_key: approval public key not found/m);
    assert.match(text.stdout, /^NOT CHECKED design_readable:.*No --slug/m);
    assert.match(text.stdout, /^Repair:.*BW_APPROVAL_PUBLIC_KEY/m);
    assert.match(text.stdout, /authentication.*entitlement.*quota.*not checked/);
    assert.doesNotMatch(text.stdout, /\u001b\[/);
    assert.deepEqual(inventory(parent), before);
    assert.ok(!existsSync(join(root, ".governance")));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Task 4 runs distinguishes absent and empty state from its bounded newest-first inventory", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    let before = inventory(parent);
    const missing = cli(parent, parent, "runs", "--json", "--repo", root);
    let body = operatorEnvelope(missing, "runs");
    assert.equal(missing.status, 1);
    assert.equal(body.outcome, "state_missing");
    assert.equal(body.errorCode, "state_missing");
    assert.equal(body.repository, realpathSync(root));
    assert.equal(body.runId, null);
    assert.equal(body.result, null);
    assert.match(body.reason!, /state\.db/);
    assert.deepEqual(inventory(parent), before);
    openStore(root).close();
    before = inventory(parent);
    const empty = cli(parent, parent, "runs", "--json", "--repo", root);
    body = operatorEnvelope(empty, "runs");
    assert.equal(empty.status, 0, empty.stderr);
    assert.equal(body.outcome, "ok");
    assert.equal(body.errorCode, null);
    assert.deepEqual(body.result, { runs: [], limit: 20, hasMore: false });
    assert.deepEqual(inventory(parent), before);

    const store = openStore(root);
    const rows = Array.from({ length: 23 }, (_, index) =>
      store.insertRun(`project-${index}`, `feature-${index}`, `slug-${index}`, "feature"));
    store.setRunStatus(rows.at(-1)!.id, "blocked");
    const expected = rows.toReversed().map((row) => store.getRun(row.id)!);
    store.close();
    before = inventory(parent);
    for (const limit of [undefined, 1, 3, 100]) {
      const listed = cli(parent, parent, "runs", "--json", "--repo", root,
        ...(limit === undefined ? [] : [`--limit=${limit}`]));
      body = operatorEnvelope(listed, "runs");
      assert.equal(listed.status, 0, listed.stderr);
      assert.equal(body.outcome, "ok");
      const result = body.result as { runs: { id: number; project: string; featureId: string; slug: string;
        status: string; phase: string; lastRecordedAt: string }[]; limit: number; hasMore: boolean };
      assert.deepEqual(Object.keys(result).sort(), ["runs", "limit", "hasMore"].sort());
      assert.equal(result.limit, limit ?? 20);
      assert.equal(result.hasMore, expected.length > result.limit);
      assert.deepEqual(result.runs, expected.slice(0, result.limit).map((row) => ({
        id: row.id, project: row.project, featureId: row.feature_id, slug: row.slug, status: row.status,
        phase: row.status === "blocked" ? "blocked" : "ready", lastRecordedAt: row.updated_at,
      })));
      assert.deepEqual(inventory(parent), before);
    }
    const text = cli(parent, parent, "runs", "--limit=1", "--repo", root);
    assert.equal(text.status, 0);
    assert.ok(text.stdout.includes(expected[0].project));
    assert.ok(!text.stdout.includes(expected[1].project));
    assert.doesNotMatch(text.stdout, /\u001b\[/);
    assert.deepEqual(inventory(parent), before);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Task 4 bare json survives malformed arguments and target failures without stdout banners", () => {
  const parent = workspace();
  try {
    const missing = join(parent, "missing target");
    const before = inventory(parent);
    for (const args of [
      ["doctor", "--slug=Bad", "--json"],
      ["doctor", "--slug=s", "--run=1", "--json"],
      ["doctor", "--unknown", "--json"],
      ["runs", "--limit=0", "--json"],
      ["runs", "--json", "--json"],
      ["status", "--run", "--json"],
      ["status", "--run=9007199254740992", "--json"],
      ["status", "--run=1", "--unknown", "--json"],
      ["status", "--json=false", "--run=1", "--json"],
    ]) {
      const result = cli(parent, parent, "--repo", missing, ...args);
      const body = operatorEnvelope(result, args[0]);
      assert.equal(result.status, 2, result.stderr || result.stdout);
      assert.equal(body.outcome, "error");
      assert.equal(body.errorCode, "usage");
      assert.equal(body.repository, null);
      assert.equal(body.result, null);
      assert.ok(body.reason);
      assert.doesNotMatch(result.stdout, /usage: bw /);
      assert.deepEqual(inventory(parent), before);
    }
    for (const command of ["doctor", "runs", "status"]) {
      const result = cli(parent, parent, "--repo", missing, command, "--json",
        ...(command === "status" ? ["--run=1"] : []));
      const body = operatorEnvelope(result, command);
      assert.equal(result.status, 1);
      assert.equal(body.outcome, "error");
      assert.equal(body.errorCode, "target_unavailable");
      assert.equal(body.repository, null);
      assert.equal(body.result, null);
      assert.ok(body.reason!.includes(missing));
      assert.deepEqual(inventory(parent), before);
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Task 4 status and runs retain named missing, schema, and SQLite errors", () => {
  const supported = [...listMigrations(resolve("src", "migrations"))].at(-1)!.index;
  for (const condition of ["missing", "empty", "older", "newer", "corrupt"]) {
    const parent = workspace();
    try {
      const root = repository(parent);
      if (condition !== "missing") {
        const store = openStore(root);
        if (condition === "older") store.exec(`PRAGMA user_version = ${supported - 1}`);
        if (condition === "newer") store.exec(`PRAGMA user_version = ${supported + 1}`);
        store.close();
        if (condition === "corrupt") writeFileSync(join(root, ".governance", "state.db"), "not a SQLite database");
      }
      const before = inventory(parent);
      for (const command of condition === "empty" ? ["status"] : ["status", "runs"]) {
        const result = cli(parent, parent, command, "--repo", root, "--json",
          ...(command === "status" ? ["--run=1"] : []));
        const body = operatorEnvelope(result, command);
        assert.equal(result.status, 1);
        const code = condition === "missing" ? "state_missing" : condition === "empty" ? "run_missing"
          : condition === "corrupt" ? "state_unavailable" : "schema_unsupported";
        assert.equal(body.errorCode, code);
        assert.equal(body.outcome, code === "state_missing" || code === "run_missing" ? code : "error");
        assert.equal(body.repository, realpathSync(root));
        assert.equal(body.runId, command === "status" ? 1 : null);
        assert.equal(body.result, null);
        if (condition === "older") assert.match(body.reason!, /migrate --repo/);
        if (condition === "newer") assert.match(body.reason!, /matching checkout.*do not downgrade/);
        if (condition === "corrupt") assert.match(body.reason!, /SQLITE.*not a database/);
        if (condition === "empty") assert.match(body.reason!, /run 1 does not exist/);
        assert.deepEqual(inventory(parent), before);
      }
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }
});

test("Task 4 inspection bypasses a live repository lock and maps exclusive SQLite contention", async () => {
  for (const mode of ["live", "exclusive"] as const) {
    const parent = workspace();
    let writer: ChildProcess | undefined;
    try {
      const root = repository(parent);
      const store = openStore(root);
      const run = store.insertRun("inspection", "inspection", "inspection", "feature");
      store.close();
      writer = await heldWriter(root, mode);
      const before = inventory(parent);
      for (const command of ["status", "runs"]) {
        const started = Date.now();
        const result = cli(parent, parent, command, "--repo", root, "--json",
          ...(command === "status" ? ["--run", String(run.id)] : []));
        const body = operatorEnvelope(result, command);
        if (mode === "live") {
          assert.equal(result.status, 0, result.stderr || result.stdout);
          assert.equal(body.outcome, "ok");
          if (command === "status") {
            const snapshot = body.result as RunSnapshot;
            assert.equal(snapshot.run.status, run.status);
            assert.equal(snapshot.writer.status, "live");
            assert.equal(snapshot.writer.pid, writer.pid);
          }
        } else {
          assert.ok(Date.now() - started < 5000, "inspection must retain the bounded reader wait");
          assert.equal(result.status, 1);
          assert.equal(body.outcome, "error");
          assert.equal(body.errorCode, "state_unavailable");
          assert.match(body.reason!, /SQLITE.*locked|SQLITE.*busy/i);
          assert.match(body.reason!, /migrate --repo/);
          assert.equal(body.result, null);
        }
        assert.deepEqual(inventory(parent), before);
      }
    } finally {
      if (writer) await stopFixtureWriter(writer);
      rmSync(parent, { recursive: true, force: true });
    }
  }
});

function recordedAgent(store: Store, stageId: number, agent: string, rawRef: string) {
  const recorded = readFileSync(new URL("./fixtures/harness/claude-code-envelope.json", import.meta.url), "utf8");
  const parsed = parseEnvelope(CLAUDE_CODE, recorded);
  return store.insertAgentRun({
    stageId, agent, role: "reviewer", executor: CLAUDE_CODE.id,
    requestedModel: parsed.effectiveModel!, effectiveModel: parsed.effectiveModel, fallback: parsed.fallback,
    tokensIn: parsed.tokensIn, tokensOut: parsed.tokensOut, cacheRead: parsed.cacheRead, cacheWrite: parsed.cacheWrite,
    cost: parsed.cost, durationMs: JSON.parse(recorded).duration_ms,
    inputHash: sha256Hex("CLI presentation transport"), outputHash: sha256Hex(recorded), rawOutputRef: rawRef,
    independence: "configured_standalone",
  });
}

test("Task 4 blocked status preserves complete structured arrays and excludes raw evidence and signatures", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const store = openStore(root);
    const selected = store.insertRun("selected project", "selected", "selected", "feature");
    const other = store.insertRun("other project", "other", "other", "feature");
    const raw = readFileSync(new URL("./fixtures/harness/claude-code-envelope.json", import.meta.url), "utf8");
    const rawRef = ".governance/retained-response.json";
    writeFileSync(resolve(root, rawRef), raw);
    const stages = [store.insertStage(selected.id, "spec", null)];
    store.completeStage(stages[0].id, rawRef, "pass");
    stages.push(store.insertStage(selected.id, "spec_review", stages[0].id));
    for (const stage of stages) {
      const agents = ["reviewer-one", "reviewer-two"].map((name) => recordedAgent(store, stage.id, name, rawRef));
      for (const intent of ["first-report", "second-report"]) {
        const finding = store.upsertCanonicalFinding(stage.id, 1, intent, "tracked.txt:1");
        for (const agent of agents) {
          store.insertFindingReport({ findingId: finding.id, agentRunId: agent.id,
            severity: "high", classification: "current_artifact",
            subject: `Recorded report ${finding.id} from agent row ${agent.id}` });
        }
      }
    }
    const otherStage = store.insertStage(other.id, "spec", null);
    store.upsertCanonicalFinding(otherStage.id, 1, "other-run-only", "tracked.txt:1");
    store.setStageStatus(stages[1].id, "blocked", "block");
    store.setRunStatus(selected.id, "blocked");
    const signature = "signature-content-must-not-be-presented";
    store.insertApproval({ runId: selected.id, featureId: selected.feature_id, specHash: sha256Hex(raw),
      startingCommit: git(root, "rev-parse", "HEAD"), profileHash: sha256Hex("missing profile"),
      risk: "low", scope: JSON.stringify(["tracked.txt"]), expiresAt: new Date().toISOString(),
      signature, signer: sha256Hex("test signer identity") });
    const expectedStages = store.getStageChain(selected.id);
    const expectedFindings = expectedStages.flatMap((stage) => store.getCanonicalFindings(stage.id));
    const expectedReports = expectedFindings.flatMap((finding) => store.getFindingReports(finding.id));
    store.close();
    const before = inventory(parent);
    const result = cli(parent, parent, "status", "--run", String(selected.id), "--repo", root, "--json");
    const body = operatorEnvelope(result, "status");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(body.outcome, "ok");
    assert.equal(body.errorCode, null);
    assert.equal(body.reason, null);
    assert.equal(body.runId, selected.id);
    const snapshot = body.result as RunSnapshot;
    assert.deepEqual(Object.keys(snapshot).sort(), ["run", "phase", "stages", "workflowAction",
      "operatorActions", "proposals", "configuration", "approval", "cost", "activity",
      "writer", "delivery", "evidence", "limitations"].sort());
    assert.equal(snapshot.run.status, "blocked");
    assert.equal(snapshot.phase, "blocked");
    assert.equal(snapshot.workflowAction.eligible, false);
    assert.equal(snapshot.writer.status, "absent");
    assert.deepEqual(snapshot.stages.map((stage) => stage.id), expectedStages.map((stage) => stage.id));
    assert.deepEqual(snapshot.evidence.findings.map((finding) => finding.id), expectedFindings.map((finding) => finding.id));
    assert.deepEqual(snapshot.evidence.findings.flatMap((finding) => finding.reports.map((report) => report.id)),
      expectedReports.map((report) => report.id));
    assert.deepEqual(snapshot.cost.byStage.map((stage) => stage.stageId), expectedStages.map((stage) => stage.id));
    assert.deepEqual(snapshot.cost.byAgent.map((agent) => agent.agent), ["reviewer-one", "reviewer-two"]);
    assert.ok(snapshot.operatorActions.some((action) => action.command === "verify-audit"));
    assert.ok(snapshot.limitations.some((reason) => /profile/i.test(reason)));
    assert.ok(snapshot.evidence.references.some((reference) => reference.ref === rawRef));
    assert.doesNotMatch(result.stdout, /other-run-only/);
    for (const hidden of [signature, JSON.parse(raw).session_id, JSON.parse(raw).uuid]) {
      assert.ok(!result.stdout.includes(hidden));
      assert.ok(!result.stderr.includes(hidden));
    }
    const text = cli(parent, parent, "status", "--run", String(selected.id), "--repo", root);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /blocked/);
    for (const report of expectedReports) assert.ok(text.stdout.includes(report.subject), report.subject);
    assert.ok(text.stdout.includes(rawRef));
    assert.ok(!text.stdout.includes(signature));
    assert.ok(!text.stdout.includes(JSON.parse(raw).session_id));
    assert.doesNotMatch(text.stdout, /\u001b\[/);
    assert.deepEqual(inventory(parent), before);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("Task 4 terminal proposal inspection preserves independent export bytes, collisions, and audit", () => {
  for (const status of ["blocked", "completed"]) {
    const parent = workspace();
    try {
      const root = repository(parent);
      const store = openStore(root);
      const run = store.insertRun("proposal project", "proposal", "proposal", "feature");
      const stage = store.insertStage(run.id, "spec_review", null);
      const findings = ["first-source", "second-source"].map((intent) =>
        store.upsertCanonicalFinding(stage.id, 1, intent, `upstream:design:${intent}`));
      const title = "Missing rate-limit decision";
      const problem = "The design never says whether retries are rate-limited.";
      const identity = proposalIdentity(stage.id, title, problem, "follow_up");
      const proposals = findings.map((finding) => store.upsertProposal({
        runId: run.id, stageId: stage.id, findingId: finding.id, title, problem,
        whyUpstream: "The specification cannot invent an unstated policy.",
        route: "follow_up", evidenceRef: ".governance/proposals/retained-missing.json",
      }, identity).proposal);
      const proposal = proposals[0];
      const sources = store.getProposalSources(proposal.id);
      store.close();
      const baseline = cli(parent, parent, "proposal-export", "--repo", root,
        "--proposal", String(proposal.id));
      assert.equal(baseline.status, 0, baseline.stderr);
      const existingPath = join(root, "docs", "proposals", "missing-rate-limit-decision.md");
      const existingBytes = readFileSync(existingPath);
      const terminal = openStore(root);
      terminal.setRunStatus(run.id, status);
      const expectedRun = terminal.getRun(run.id);
      const expectedStages = terminal.getStageChain(run.id);
      const beforeAudit = terminal.getAuditEvents(run.id);
      terminal.close();

      const before = inventory(parent);
      const inspected = cli(parent, parent, "status", "--repo", root, "--run", String(run.id), "--json");
      const body = operatorEnvelope(inspected, "status");
      assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
      assert.equal(body.outcome, "ok");
      const snapshot = body.result as RunSnapshot;
      assert.equal(snapshot.run.status, status);
      assert.equal(snapshot.workflowAction.eligible, false);
      assert.deepEqual(snapshot.proposals.map((entry) => entry.id), [proposal.id]);
      assert.deepEqual(snapshot.proposals[0].sourceFindingIds, sources);
      assert.equal(snapshot.proposals[0].route, proposal.route);
      assert.equal(snapshot.proposals[0].evidenceRef, proposal.evidence_ref);
      const action = snapshot.operatorActions.find((entry) => entry.proposalId === proposal.id)!;
      assert.ok(action);
      assert.equal(action.command, "proposal-export");
      assert.equal(action.eligible, true);
      assert.equal(action.route, proposal.route);
      assert.equal(action.title, proposal.title);
      assert.equal(action.evidenceRef, proposal.evidence_ref);
      assert.ok(action.args.includes(root));
      assert.ok(action.args.includes(String(proposal.id)));
      assert.ok(action.args.includes("--name"));
      assert.match(action.reason!, /exists|overwrite/i);
      assert.ok(snapshot.evidence.references.some((entry) =>
        entry.ref === proposal.evidence_ref && entry.availability === "missing"));
      assert.ok(snapshot.limitations.some((reason) => reason.includes(proposal.evidence_ref)));
      assert.deepEqual(inventory(parent), before);

      const collision = cli(parent, parent, "proposal-export", "--repo", root, "--proposal", String(proposal.id));
      assert.equal(collision.status, 1);
      assert.equal(collision.stdout, "");
      assert.match(collision.stderr, /refusing to overwrite/);
      assert.deepEqual(readFileSync(existingPath), existingBytes);
      const invalid = cli(parent, parent, "proposal-export", "--repo", root,
        "--proposal", String(proposal.id), "--name=Bad");
      assert.equal(invalid.status, 2);
      const afterRefusals = openStore(root, { readOnly: true });
      assert.deepEqual(afterRefusals.getAuditEvents(run.id), beforeAudit);
      afterRefusals.close();
      const exported = cli(parent, parent, "proposal-export", "--repo", root,
        "--proposal", String(proposal.id), "--name=terminal-export");
      assert.equal(exported.status, 0, exported.stderr);
      assert.equal(exported.stdout.trim(), "docs/proposals/terminal-export.md");
      assert.deepEqual(readFileSync(join(root, "docs", "proposals", "terminal-export.md")), existingBytes);
      assert.ok(!existsSync(join(parent, "docs")));
      const after = openStore(root, { readOnly: true });
      try {
        assert.deepEqual(after.getRun(run.id), expectedRun);
        assert.deepEqual(after.getStageChain(run.id), expectedStages);
        const added = after.getAuditEvents(run.id).slice(beforeAudit.length);
        assert.equal(added.length, 1);
        assert.equal(added[0].action, "proposal.export");
        assert.equal(added[0].actor, "operator");
        assert.equal(added[0].actor_type, "human");
        assert.equal(added[0].stage_id, stage.id);
        assert.match(added[0].summary, /exported proposal .*docs\/proposals\/terminal-export\.md/);
      } finally {
        after.close();
      }
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }
});

async function heldWriter(root: string, mode: "live" | "exclusive" | "spill"): Promise<ChildProcess> {
  const script = `
    import { DatabaseSync } from "node:sqlite";
    import { join } from "node:path";
    import { acquireLock } from ${JSON.stringify(LOCK_URL)};
    const root = process.argv[1];
    const mode = process.argv[2];
    const release = acquireLock(root);
    const db = new DatabaseSync(join(root, ".governance", "state.db"));
    db.exec("PRAGMA journal_mode = DELETE");
    if (mode === "spill") db.exec("PRAGMA cache_size = 5; PRAGMA cache_spill = ON");
    db.exec(mode === "exclusive" ? "BEGIN EXCLUSIVE" : "BEGIN IMMEDIATE");
    if (mode === "spill") db.prepare("UPDATE run SET project = ?").run("x".repeat(16384));
    else db.exec("UPDATE run SET status = 'blocked'");
    process.on("message", () => { db.exec("ROLLBACK"); db.close(); release(); process.exit(0); });
    process.send({ ready: true });
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, root, mode], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([
      once(child, "message"),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`writer did not become ready: ${stderr}`)), 5000); }),
    ]);
    return child;
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  } finally {
    clearTimeout(timer!);
  }
}

async function stopFixtureWriter(child: ChildProcess, crash = false): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, "exit");
  if (crash) child.kill("SIGKILL");
  else child.send("rollback");
  await ended;
}

function readStateProcess(root: string) {
  const script = `
    import { openStore } from ${JSON.stringify(STORE_URL)};
    let store;
    try {
      store = openStore(process.argv[1], { readOnly: true });
      console.log(JSON.stringify({ ok: true, runs: store.readSnapshot(() => store.query("SELECT * FROM run ORDER BY id")) }));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, code: error.code, reason: error.message }));
      process.exitCode = 1;
    } finally { store?.close(); }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, root], {
    encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.error, undefined, result.stderr);
  return { status: result.status, body: JSON.parse(result.stdout) };
}

test("read-only subprocess observes committed rows under a live writer without taking its lock", async () => {
  const parent = workspace();
  let writer: ChildProcess | undefined;
  try {
    const root = repository(parent);
    const seed = openStore(root);
    const run = seed.insertRun("p", "f", "s", "feature");
    seed.close();
    writer = await heldWriter(root, "live");
    assert.equal(inspectLock(root).pid, writer.pid);
    const before = inventory(root);
    const result = readStateProcess(root);
    assert.equal(result.status, 0, result.body.reason);
    assert.deepEqual(result.body.runs, JSON.parse(JSON.stringify([run])));
    assert.deepEqual(inventory(root), before);
    assert.equal(inspectLock(root).status, "live");
  } finally {
    if (writer) await stopFixtureWriter(writer);
    rmSync(parent, { recursive: true, force: true });
  }
});

test("read-only subprocess bounds exclusive-writer contention with the original SQLite error", async () => {
  const parent = workspace();
  let writer: ChildProcess | undefined;
  try {
    const root = repository(parent);
    const seed = openStore(root);
    seed.insertRun("p", "f", "s", "feature");
    seed.close();
    writer = await heldWriter(root, "exclusive");
    const before = inventory(root);
    const started = Date.now();
    const result = readStateProcess(root);
    assert.ok(Date.now() - started < 5000);
    assert.equal(result.status, 1);
    assert.equal(result.body.code, "state_unavailable");
    assert.match(result.body.reason, /locked|busy/i);
    assert.match(result.body.reason, /migrate --repo/);
    assert.deepEqual(inventory(root), before);
  } finally {
    if (writer) await stopFixtureWriter(writer);
    rmSync(parent, { recursive: true, force: true });
  }
});

test("a killed spilled writer leaves hot-journal recovery to explicit migrate, not inspection", async (t) => {
  const parent = workspace();
  let writer: ChildProcess | undefined;
  try {
    const root = repository(parent);
    const seed = openStore(root);
    for (let index = 0; index < 64; index++) seed.insertRun("p", `f-${index}`, "s", "feature");
    const run = seed.getRun(1)!;
    const stage = seed.insertStage(run.id, "spec", null);
    seed.completeStage(stage.id, "content:retained", "pass");
    const expectedRuns = JSON.parse(JSON.stringify(seed.query("SELECT * FROM run ORDER BY id")));
    const expectedStages = JSON.parse(JSON.stringify(seed.getStageChain(run.id)));
    seed.close();
    writer = await heldWriter(root, "spill");
    const journalPath = join(root, ".governance", "state.db-journal");
    assert.ok(statSync(journalPath).size > 512);
    assert.ok(readFileSync(journalPath).subarray(0, 8).some((byte) => byte !== 0), "journal header is hot after page spill");
    await stopFixtureWriter(writer, true);
    assert.equal(inspectLock(root).status, "dead");
    const before = inventory(root);
    const result = readStateProcess(root);
    if (result.status === 0) {
      assert.deepEqual(result.body.runs, expectedRuns);
      t.diagnostic("Supported runtime read the hot journal without writes");
    } else {
      assert.equal(result.status, 1);
      assert.equal(result.body.code, "state_unavailable");
      assert.match(result.body.reason, /readonly|read-only/i);
      assert.match(result.body.reason, /migrate --repo/);
      t.diagnostic(result.body.reason);
    }
    assert.deepEqual(inventory(root), before);
    const recovered = cli(parent, parent, "migrate", "--repo", root);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(inspectLock(root).status, "absent");
    const after = openStore(root, { readOnly: true });
    try {
      assert.deepEqual(JSON.parse(JSON.stringify(after.query("SELECT * FROM run ORDER BY id"))), expectedRuns);
      assert.deepEqual(JSON.parse(JSON.stringify(after.getStageChain(run.id))), expectedStages);
      assert.deepEqual(after.getAuditEvents(run.id), []);
    } finally {
      after.close();
    }
  } finally {
    if (writer) await stopFixtureWriter(writer);
    rmSync(parent, { recursive: true, force: true });
  }
});

function fixtureProbe(t: TestContext) {
  const original = childProcess.spawnSync;
  const calls: unknown[][] = [];
  const mocked = t.mock.method(childProcess, "spawnSync", (...args: unknown[]) => {
    calls.push(args);
    if (args[0] === CLAUDE_CODE.probe[0]) {
      return original(process.execPath, ["--version"], { encoding: "utf8", shell: false });
    }
    return Reflect.apply(original, childProcess, args);
  });
  syncBuiltinESMExports();
  return {
    calls,
    restore: () => { mocked.mock.restore(); syncBuiltinESMExports(); },
  };
}

test("shared intake diagnostics and new-run preserve the same repository refusal", () => {
  for (const condition of ["missing_config", "invalid_config", "dirty", "no_head", "unignored_state"]) {
    const parent = workspace();
    try {
      let root: string;
      if (condition === "no_head") {
        root = join(parent, "target");
        mkdirSync(root);
        git(root, "init", "-q");
      } else {
        root = repository(parent);
        if (condition === "missing_config") rmSync(join(root, "governed.yaml"));
        if (condition === "invalid_config") writeFileSync(join(root, "governed.yaml"), "checks:\n");
        if (condition === "unignored_state") rmSync(join(root, ".gitignore"));
        if (condition !== "dirty") {
          git(root, "add", "-A");
          git(root, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", condition);
        }
        if (condition === "dirty") writeFileSync(join(root, "operator.txt"), "uncommitted\n");
        if (condition === "unignored_state") {
          mkdirSync(join(root, ".governance"));
          writeFileSync(join(root, ".governance", "retained.txt"), "local state\n");
        }
      }
      const before = inventory(root);
      const intake = checkIntakeRepository(root);
      assert.deepEqual(inventory(root), before);
      const result = cli(parent, parent, ...NEW_RUN, "--repo", root);
      assert.equal(result.status, intake.ok ? 0 : 1, result.stderr);
      if (!intake.ok) assert.ok(result.stderr.includes(intake.reason!), result.stderr);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }
});

test("readiness returns independent current setup and feature checks without writing or spending", (t) => {
  const parent = workspace();
  const mocked = fixtureProbe(t);
  const keyBefore = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    const root = repository(parent);
    const keyPath = join(parent, "test-public.pem");
    const { publicKey } = generateKeyPairSync("ed25519");
    writeFileSync(keyPath, publicKey.export({ type: "spki", format: "pem" }));
    process.env.BW_APPROVAL_PUBLIC_KEY = keyPath;
    const key = loadPublicKey(root);
    assert.ok(key.ok);
    let before = inventory(parent);
    let report = inspectReadiness(root);
    assert.deepEqual(inventory(parent), before);
    assert.equal(report.current.approvalSigner, key.signer);
    assert.equal(report.current.startingCommit, git(root, "rev-parse", "HEAD"));
    assert.deepEqual(report.current.policy, buildPolicy());
    assert.deepEqual(report.current.agentIds, AGENTS.map((agent) => agent.id));
    assert.equal(report.checks.find((check) => check.name === "design_readable")!.status, "not_checked");
    assert.ok(report.checks.every((check) => check.status !== "fail"));
    assert.match(report.limitations.join(" "), /authentication.*entitlement.*quota.*not checked/);
    assert.ok(!existsSync(join(root, ".governance")));

    report = inspectReadiness(root, { slug: "s" });
    assert.equal(report.checks.find((check) => check.name === "design_readable")!.status, "fail");
    assert.equal(report.checks.find((check) => check.name === "design_committed")!.status, "fail");
    assert.deepEqual(inventory(parent), before);
    const design = join(root, "docs", "features", "s", "design.md");
    mkdirSync(dirname(design), { recursive: true });
    writeFileSync(design, "Operator-authored design.\n");
    report = inspectReadiness(root, { slug: "s" });
    assert.equal(report.checks.find((check) => check.name === "design_readable")!.status, "pass");
    assert.equal(report.checks.find((check) => check.name === "design_committed")!.status, "fail");
    git(root, "add", "-A");
    git(root, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "design");
    before = inventory(parent);
    report = inspectReadiness(root, { slug: "s" });
    assert.ok(report.checks.every((check) => check.status === "pass"));
    assert.deepEqual(inventory(parent), before);
    rmSync(design);
    report = inspectReadiness(root, { slug: "s" });
    assert.equal(report.checks.find((check) => check.name === "design_readable")!.status, "fail");
    assert.equal(report.checks.find((check) => check.name === "design_committed")!.status, "pass");
    process.env.BW_APPROVAL_PUBLIC_KEY = join(parent, "missing-public.pem");
    report = inspectReadiness(root);
    assert.equal(report.current.approvalSigner, null);
    assert.equal(report.checks.find((check) => check.name === "approval_key")!.status, "fail");
    assert.ok(report.checks.find((check) => check.name === "approval_key")!.repair);
    rmSync(join(root, ".gitignore"));
    report = inspectReadiness(root);
    assert.equal(report.checks.find((check) => check.name === "governance_ignore")!.status, "fail");
    assert.ok(!mocked.calls.some((args) => args[0] === "gh"));
  } finally {
    mocked.restore();
    if (keyBefore === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = keyBefore;
    rmSync(parent, { recursive: true, force: true });
  }
});

test("readiness names actual current staffing and capability failures using receiving rules", (t) => {
  const parent = workspace();
  const mocked = fixtureProbe(t);
  const registry = AGENTS as AgentDefinition[];
  const saved = [...registry];
  const capabilities = [...CLAUDE_CODE.capabilities];
  try {
    const root = repository(parent);
    registry.splice(0, registry.length, ...saved.filter((agent) => !agent.outputs.includes("findings")));
    let report = inspectReadiness(root);
    const policy = buildPolicy();
    assert.equal(report.checks.find((check) => check.name === "document_review_staffing")!.evidence,
      staffingShortfall(registry, policy.panelSizeMax, policy.requiredSpecialties, [], CLAUDE_CODE.id));
    registry.splice(0, registry.length, ...saved.filter((agent) => !agent.outputs.includes("code-findings")));
    report = inspectReadiness(root);
    assert.equal(report.checks.find((check) => check.name === "code_review_staffing")!.evidence,
      codeReviewStaffingShortfall(registry, policy.codeReviewPanelSize, CLAUDE_CODE.id));
    CLAUDE_CODE.capabilities = [];
    report = inspectReadiness(root);
    assert.equal(report.checks.find((check) => check.name === "executor_capabilities")!.status, "fail");
    registry.splice(0, registry.length, ...saved.filter((agent) => agent.id !== "spec-author"));
    report = inspectReadiness(root);
    assert.equal(report.checks.find((check) => check.name === "author_bindings")!.status, "fail");
    assert.match(report.checks.find((check) => check.name === "author_bindings")!.evidence, /configured agent spec-author is missing/);
  } finally {
    registry.splice(0, registry.length, ...saved);
    CLAUDE_CODE.capabilities = capabilities;
    mocked.restore();
    rmSync(parent, { recursive: true, force: true });
  }
});

test("readiness and real dispatch share direct probe executable and argv", async (t) => {
  const parent = workspace();
  const mocked = fixtureProbe(t);
  try {
    const root = repository(parent);
    inspectReadiness(root);
    const store = openStore(root);
    try {
      const run = store.insertRun("p", "f", "s", "feature");
      const stage = store.insertStage(run.id, "spec", null);
      const executor = { ...CLAUDE_CODE, command: [process.execPath, resolve("test", "fixtures", "harness", "echo-json.mjs")] };
      const result = await dispatchOnce(store, executor, {
        stageId: stage.id, agent: "spec-author", role: "author", requestedModel: "test-model", prompt: "transport only",
      }, root);
      assert.ok(result.ok, result.ok ? "" : result.reason);
      const probes = mocked.calls.filter((args) => args[0] === CLAUDE_CODE.probe[0]);
      assert.equal(probes.length, 2);
      for (const [command, args, options] of probes) {
        assert.equal(command, CLAUDE_CODE.probe[0]);
        assert.deepEqual(args, CLAUDE_CODE.probe.slice(1));
        assert.equal((options as { shell: boolean }).shell, false);
      }
      assert.equal((probes[0][2] as { timeout: number }).timeout, 5000);
      assert.equal((probes[1][2] as { timeout?: number }).timeout, undefined);
    } finally {
      store.close();
    }
  } finally {
    mocked.restore();
    rmSync(parent, { recursive: true, force: true });
  }
});

test("readiness distinguishes unavailable tools, skipped dependent checks, and an unsupported Node", (t) => {
  const parent = workspace();
  const root = repository(parent);
  const original = childProcess.spawnSync;
  const descriptor = Object.getOwnPropertyDescriptor(process.versions, "node")!;
  const minimum = Number(JSON.parse(readFileSync(resolve("package.json"), "utf8")).engines.node.slice(2));
  const mocked = t.mock.method(childProcess, "spawnSync", (...args: unknown[]) => {
    if (args[0] === "git" || args[0] === CLAUDE_CODE.probe[0]) {
      return original("buildworks-test-unresolvable-executable", [], { encoding: "utf8", shell: false });
    }
    return Reflect.apply(original, childProcess, args);
  });
  syncBuiltinESMExports();
  Object.defineProperty(process.versions, "node", { ...descriptor, value: `${minimum - 1}.0.0` });
  try {
    const before = inventory(root);
    const report = inspectReadiness(root, { slug: "s" });
    const check = (name: string) => report.checks.find((entry) => entry.name === name)!;
    assert.equal(check("node").status, "fail");
    assert.equal(report.current.minimumNodeMajor, minimum);
    assert.equal(check("git").status, "fail");
    assert.match(check("git").evidence, /ENOENT/);
    assert.equal(check("head").status, "fail");
    assert.equal(check("working_tree").status, "not_checked");
    assert.equal(check("verification_config").status, "not_checked");
    assert.equal(check("design_committed").status, "not_checked");
    assert.equal(check("executor_probe").status, "fail");
    assert.match(check("executor_probe").evidence, /probe failed.*ENOENT/);
    assert.equal(report.current.startingCommit, null);
    assert.equal(report.current.verification, null);
    assert.deepEqual(inventory(root), before);
  } finally {
    Object.defineProperty(process.versions, "node", descriptor);
    mocked.mock.restore();
    syncBuiltinESMExports();
    rmSync(parent, { recursive: true, force: true });
  }
});
