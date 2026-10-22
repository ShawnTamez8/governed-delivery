import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptanceCommand, readAcceptanceReport } from "../src/acceptance.ts";
import { verifyCommit } from "../src/commit-verification.ts";
import { createSandbox, destroySandbox, dockerReady, ensureImage, execTarget, runInSandbox } from "../src/container.ts";
import { seededSandbox } from "../src/policy.ts";

/**
 * The acceptance suite is read-only after its author, against real Docker
 * (docs/features/protected-acceptance-tests/plan.md, Task 7). The suite and its
 * page are the recorded Task 2 pass case (`acceptance-report-pass.json`), so
 * the acceptance run passes only if no write reached the suite before it.
 * Every test skips, with a named reason, when no Docker engine answers.
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

/** A repository whose commit holds the page and the suite, and a run worktree of it checked out LF. */
function makeTarget(): { root: string; worktree: string; head: string; cleanup: () => void } {
  const parent = mkdtempSync(join(tmpdir(), "bw-acceptance-engine-"));
  const root = join(parent, "target");
  mkdirSync(join(root, SUITE_DIR), { recursive: true });
  git(root, "init", "-q");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@t");
  writeFileSync(join(root, "index.html"), PAGE);
  writeFileSync(join(root, SUITE_FILE), RECORDED.files[0]!.content);
  git(root, "add", "index.html", SUITE_FILE);
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
