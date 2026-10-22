import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptanceCommand, readAcceptanceReport } from "../src/acceptance.ts";
import { verifyCommit } from "../src/commit-verification.ts";
import { createSandbox, destroySandbox, dockerReady, ensureImage, execTarget, runInSandbox } from "../src/container.ts";
import { seededSandbox } from "../src/policy.ts";
import { commitWorkspace } from "../src/workspace-commit.ts";

/**
 * The acceptance suite is read-only after its author, against real Docker
 * (docs/features/protected-acceptance-tests/plan.md, Tasks 7 and 12). The suite
 * and its page are the recorded Task 2 pass case (`acceptance-report-pass.json`),
 * so the acceptance run passes only if no write reached the suite before it.
 * Every test skips, with a named reason, when no Docker engine answers; the two
 * case-alias tests also skip by name on an engine whose filesystem is
 * case-sensitive, where the alias does not exist.
 */

const DOCKER = ["docker"];
const ready = dockerReady(DOCKER);
const skip = ready.ok ? false : "no Docker engine answered";
const image = ready.ok ? ensureImage(DOCKER) : null;
const SUITE_DIR = "acceptance/s/";
const SUITE_FILE = `${SUITE_DIR}s.spec.mjs`;
const RECORDED = JSON.parse(readFileSync(join("test", "fixtures", "recorded", "acceptance-report-pass.json"), "utf8")) as {
  files: { content: string }[];
};
/** The page the recorded pass case describes: an h1, an output #out and a Go button. */
const PAGE =
  '<!doctype html><html><head><title>Spike page</title></head><body><h1>Spike page</h1><output id="out"></output><button id="go" onclick="document.getElementById(\'out\').textContent=\'clicked\'">Go</button></body></html>\n';

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** A repository whose commit holds the page, the suite and `extra`, and a run worktree of it checked out LF. */
function makeTarget(page = PAGE, extra: Record<string, string> = {}): { root: string; worktree: string; head: string; cleanup: () => void } {
  const parent = mkdtempSync(join(tmpdir(), "bw-acceptance-engine-"));
  const root = join(parent, "target");
  mkdirSync(join(root, SUITE_DIR), { recursive: true });
  git(root, "init", "-q");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@t");
  writeFileSync(join(root, "index.html"), page);
  writeFileSync(join(root, SUITE_FILE), RECORDED.files[0]!.content);
  for (const [path, content] of Object.entries(extra)) writeFileSync(join(root, path), content);
  git(root, "add", "index.html", SUITE_FILE, ...Object.keys(extra));
  git(root, "commit", "-q", "-m", "base");
  const worktree = join(root, ".governance", "worktrees", "1");
  git(root, "-c", "core.autocrlf=false", "-c", "core.eol=lf", "worktree", "add", "-q", worktree, "-b", "gov/t/1");
  return { root, worktree, head: git(worktree, "rev-parse", "HEAD"), cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

test("verification holds the suite read-only through a direct write, a detached writer and the acceptance run", { skip }, async () => {
  const target = makeTarget();
  try {
    const before = readFileSync(join(target.worktree, SUITE_FILE));
    const evidenceDir = join(target.root, ".governance", "evidence");
    const result = await verifyCommit({
      rootDir: target.root,
      worktreePath: target.worktree,
      expectedCommit: target.head,
      commands: [
        // Each writer reports its own exit and exits 0, so the run reaches the next command.
        { name: "direct", command: ["sh", "-c", `echo tampered > ${SUITE_FILE}; echo "direct write exit $?"`] },
        {
          name: "detached",
          command: ["sh", "-c", `(sleep 2; echo tampered > ${SUITE_FILE}; echo "detached write exit $?") > /tmp/bw-writer.log 2>&1 &`],
        },
        acceptanceCommand(SUITE_DIR, 2),
        {
          name: "writer-log",
          command: ["sh", "-c", "for i in $(seq 1 60); do grep -q 'write exit' /tmp/bw-writer.log 2>/dev/null && break; sleep 1; done; cat /tmp/bw-writer.log"],
        },
      ],
      timeoutSeconds: 300,
      maxBytes: 1024 * 1024,
      retentionMaxBytes: 64 * 1024 * 1024,
      sandbox: seededSandbox(image!.imageId),
      runId: 1,
      label: "acceptance-ro",
      readOnlyPaths: [SUITE_DIR],
      evidenceDir,
      audit: () => {},
    });
    assert.equal(result.reason, null);
    assert.equal(result.record!.outcome, "pass");
    assert.deepEqual(readFileSync(join(target.worktree, SUITE_FILE)), before, "the suite is byte-identical");
    const log = (name: string) => readFileSync(join(evidenceDir, `${name}.log`), "utf8");
    assert.match(log("direct"), /read-only file system/i);
    assert.match(log("direct"), /direct write exit [1-9]/);
    assert.match(log("writer-log"), /read-only file system/i);
    assert.match(log("writer-log"), /detached write exit [1-9]/);
    const report = readAcceptanceReport(log("acceptance"));
    assert.ok(report.ok, report.ok ? "" : report.reason);
    assert.deepEqual(report.report.loadErrors, []);
    assert.ok(report.report.tests.length > 0);
    assert.ok(report.report.tests.every((t) => t.results.length === 2 && t.results.every((r) => r.status === "passed")), JSON.stringify(report.report.tests));
  } finally {
    target.cleanup();
  }
});

test("a write under a read-only path fails inside a work container, and the rest of /work stays writable", { skip }, async () => {
  const target = makeTarget();
  const sandbox = createSandbox({
    frozen: seededSandbox(image!.imageId),
    rootDir: target.root,
    runId: 1,
    label: "acceptance-ro",
    worktreePath: target.worktree,
    readOnlyPaths: [SUITE_DIR],
  });
  try {
    const run = (name: string, script: string) =>
      runInSandbox(execTarget(sandbox), null, { name, command: ["sh", "-c", script] }, {
        cwd: target.worktree,
        timeoutSeconds: 60,
        maxBytes: 1024 * 1024,
        retentionMaxBytes: 1024 * 1024,
        evidencePath: join(target.root, ".governance", "evidence", `${name}.log`),
      });
    const log = (name: string) => readFileSync(join(target.root, ".governance", "evidence", `${name}.log`), "utf8");
    const suite = await run("suite", `echo x > ${SUITE_DIR}new.txt`);
    assert.notEqual(suite.exitCode, 0);
    assert.match(log("suite"), /read-only file system/i);
    const mounts = await run("mounts", "cat /proc/mounts");
    const point = log("mounts").split("\n").map((l) => l.split(" ")).find((f) => f[1] === "/work/acceptance/s");
    assert.ok(point?.[3]?.split(",").includes("ro"), log("mounts"));
    assert.equal(mounts.exitCode, 0);
    // Positive control: beside the suite, and in the suite's parent, a write lands on the host.
    const other = await run("other", "echo y > other.txt && echo z > acceptance/beside.txt");
    assert.equal(other.exitCode, 0, log("other"));
    assert.equal(readFileSync(join(target.worktree, "other.txt"), "utf8"), "y\n");
    assert.equal(readFileSync(join(target.worktree, "acceptance", "beside.txt"), "utf8"), "z\n");
  } finally {
    const teardown = destroySandbox(sandbox);
    target.cleanup();
    assert.deepEqual(teardown.failures, []);
  }
});

// --- Task 12: the suite is mounted from the commit, so a case alias of /work reaches nothing that runs ---

/** The page the recorded pass suite fails on: its heading is not "Spike page". */
const OTHER_PAGE = "<!doctype html><html><head><title>Other page</title></head><body><h1>Other page</h1></body></html>\n";
/** What the probe writes through the alias: the same title, an assertion `OTHER_PAGE` satisfies. */
const TAMPERED = RECORDED.files[0]!.content.replace('name: "Spike page"', 'name: "Other page"');
const ALIAS_DIR = `/work/${SUITE_DIR.replace(/^acceptance/, "Acceptance")}`;

test("a rewrite through a case alias while the suite runs changes nothing that runs (the review's probe)", { skip }, async (t) => {
  assert.notEqual(TAMPERED, RECORDED.files[0]!.content);
  // probe/ is ignored, so the tampered copy and the writer's log never dirty the worktree.
  const target = makeTarget(OTHER_PAGE, { ".gitignore": "probe/\n" });
  try {
    mkdirSync(join(target.worktree, "probe"));
    writeFileSync(join(target.worktree, "probe", "tampered.spec.mjs"), TAMPERED);
    const evidenceDir = join(target.root, ".governance", "evidence");
    // A detached writer waits for the runner to start, rewrites the suite
    // through the alias, and restores it once the runner has exited. The
    // pattern `cli\.j[s]` matches the runner's argv and not the writer's own.
    const writer = [
      "(",
      "if ! test -e /work/ACCEPTANCE; then echo alias_not_found; exit 0; fi",
      "until grep -qs 'cli\\.j[s]' /proc/[0-9]*/cmdline; do sleep 0.05; done",
      `cp ${ALIAS_DIR}s.spec.mjs /tmp/original`,
      `cat probe/tampered.spec.mjs > ${ALIAS_DIR}s.spec.mjs; echo "alias_exit=$?"`,
      "while grep -qs 'cli\\.j[s]' /proc/[0-9]*/cmdline; do sleep 0.1; done",
      `cat /tmp/original > ${ALIAS_DIR}s.spec.mjs; echo "restored=$?"`,
      ") > probe/writer.log 2>&1 &",
    ].join("\n");
    const result = await verifyCommit({
      rootDir: target.root,
      worktreePath: target.worktree,
      expectedCommit: target.head,
      commands: [{ name: "writer", command: ["sh", "-c", writer] }, acceptanceCommand(SUITE_DIR, 2)],
      timeoutSeconds: 300,
      maxBytes: 1024 * 1024,
      retentionMaxBytes: 64 * 1024 * 1024,
      sandbox: seededSandbox(image!.imageId),
      runId: 1,
      label: "acceptance-alias",
      readOnlyPaths: [SUITE_DIR],
      evidenceDir,
      audit: () => {},
    });
    const writerLog = readFileSync(join(target.worktree, "probe", "writer.log"), "utf8");
    if (writerLog.includes("alias_not_found")) {
      t.skip("the engine's filesystem is case-sensitive, so /work/ACCEPTANCE does not exist");
      return;
    }
    // The alias write itself still succeeds: it lands in the worktree, which the runner no longer reads.
    assert.match(writerLog, /alias_exit=0/, writerLog);
    const report = readAcceptanceReport(readFileSync(join(evidenceDir, "acceptance.log"), "utf8"));
    assert.ok(report.ok, report.ok ? "" : report.reason);
    assert.deepEqual([...new Set(report.report.tests.map((t) => t.title))], ["AC-001 the heading shows"]);
    assert.ok(
      report.report.tests.every((t) => t.results.length === 2 && t.results.every((r) => r.status === "failed")),
      `the committed suite ran and failed: ${JSON.stringify(report.report.tests.map((t) => t.results.map((r) => r.status)))}`
    );
    assert.equal(result.record!.outcome, "block");
    assert.equal(result.record!.blockingCommand, "acceptance");
  } finally {
    target.cleanup();
  }
});

test("a file written through a case alias and left behind is refused at the commit boundary as a suite change", { skip }, async (t) => {
  const target = makeTarget();
  try {
    const sandbox = createSandbox({
      frozen: seededSandbox(image!.imageId),
      rootDir: target.root,
      runId: 1,
      label: "acceptance-alias",
      worktreePath: target.worktree,
      readOnlyPaths: [SUITE_DIR],
    });
    const evidencePath = join(target.root, ".governance", "evidence", "alias.log");
    let exitCode: number | null = null;
    try {
      const run = await runInSandbox(execTarget(sandbox), null, {
        name: "alias",
        command: ["sh", "-c", `if ! test -e /work/ACCEPTANCE; then echo alias_not_found; exit 0; fi; echo planted > ${ALIAS_DIR}planted.spec.mjs`],
      }, { cwd: target.worktree, timeoutSeconds: 60, maxBytes: 1024 * 1024, retentionMaxBytes: 1024 * 1024, evidencePath });
      exitCode = run.exitCode;
    } finally {
      assert.deepEqual(destroySandbox(sandbox).failures, []);
    }
    // The output after the evidence header, which repeats the command.
    const log = readFileSync(evidencePath, "utf8").split("\n").slice(1).join("\n");
    if (log.includes("alias_not_found")) {
      t.skip("the engine's filesystem is case-sensitive, so /work/ACCEPTANCE does not exist");
      return;
    }
    assert.equal(exitCode, 0, log);
    const planted = `${SUITE_DIR}planted.spec.mjs`;
    // The scope admits the path, so only the suite's own cause can refuse it.
    const result = commitWorkspace({
      worktreePath: target.worktree,
      base: target.head,
      scope: [planted],
      slug: "t",
      derivedPaths: [],
      protectedPaths: [SUITE_DIR],
      sandbox: seededSandbox(image!.imageId),
      message: "alias probe",
      onAudit: () => {},
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.kind, "refused");
    assert.ok(result.reason.includes(`changes ${planted} in the acceptance suite: the system refuses agent edits to it`), result.reason);
  } finally {
    target.cleanup();
  }
});

test("the read-only suite is the commit's bytes, not the worktree's, and its copy is removed at teardown", { skip }, async () => {
  const target = makeTarget();
  // An uncommitted edit in the worktree, which the container must not see.
  writeFileSync(join(target.worktree, SUITE_FILE), TAMPERED);
  const sandbox = createSandbox({
    frozen: seededSandbox(image!.imageId),
    rootDir: target.root,
    runId: 1,
    label: "acceptance-copy",
    worktreePath: target.worktree,
    readOnlyPaths: [SUITE_DIR],
  });
  try {
    assert.notEqual(sandbox.mountDir, null);
    const evidencePath = join(target.root, ".governance", "evidence", "copy.log");
    const run = await runInSandbox(execTarget(sandbox), null, { name: "copy", command: ["cat", `/work/${SUITE_FILE}`] }, {
      cwd: target.worktree,
      timeoutSeconds: 60,
      maxBytes: 1024 * 1024,
      retentionMaxBytes: 1024 * 1024,
      evidencePath,
    });
    assert.equal(run.exitCode, 0);
    const seen = readFileSync(evidencePath, "utf8");
    assert.equal(seen.slice(seen.indexOf("\n") + 1), RECORDED.files[0]!.content, "the committed suite");
    assert.equal(readFileSync(join(target.worktree, SUITE_FILE), "utf8"), TAMPERED, "the worktree keeps its own edit");
  } finally {
    const teardown = destroySandbox(sandbox);
    try {
      assert.deepEqual(teardown.failures, []);
      assert.equal(existsSync(sandbox.mountDir!), false, "the copy is removed");
    } finally {
      target.cleanup();
    }
  }
});
