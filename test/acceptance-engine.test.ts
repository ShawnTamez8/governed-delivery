import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { acceptanceCommand, classifyFailure, readAcceptanceReport } from "../src/acceptance.ts";
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

// --- The served page (docs/features/served-browser-pages/plan.md, Task 2) ---

const RECORDED_DIR = join("test", "fixtures", "recorded");
const recorded = <T>(name: string): T => JSON.parse(readFileSync(join(RECORDED_DIR, `${name}.json`), "utf8")) as T;

/** The delivered Target Tap tree, each file's bytes rehashed to its manifest blob ID first. */
function deliveredTree(): Record<string, string> {
  const page = recorded<{ manifest: { path: string; blob: string }[]; files: { path: string; content: string }[] }>("target-tap-delivered-page");
  const tree: Record<string, string> = {};
  for (const file of page.files) {
    const bytes = Buffer.from(file.content, "utf8");
    const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(blob, page.manifest.find((e) => e.path === file.path)?.blob, `${file.path} is the committed blob`);
    tree[file.path] = file.content;
  }
  return tree;
}

/** A repository whose commit holds exactly `files`, and a run worktree of it checked out LF. */
function targetOf(files: Record<string, string>): { root: string; worktree: string; head: string; cleanup: () => void } {
  const parent = mkdtempSync(join(tmpdir(), "bw-acceptance-served-"));
  const root = join(parent, "target");
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@t");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(root, "-c", "core.autocrlf=false", "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  const worktree = join(root, ".governance", "worktrees", "1");
  git(root, "-c", "core.autocrlf=false", "-c", "core.eol=lf", "worktree", "add", "-q", worktree, "-b", "gov/t/1");
  return { root, worktree, head: git(worktree, "rev-parse", "HEAD"), cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

/** `commands` through `verifyCommit` on a commit of `files`, with each command's retained log. */
async function servedRun(files: Record<string, string>, commands: { name: string; command: string[] }[], readOnlyPaths: string[] = [SUITE_DIR]) {
  const target = targetOf(files);
  try {
    const evidenceDir = join(target.root, ".governance", "evidence");
    const result = await verifyCommit({
      rootDir: target.root,
      worktreePath: target.worktree,
      expectedCommit: target.head,
      commands,
      timeoutSeconds: 300,
      maxBytes: 64 * 1024 * 1024,
      retentionMaxBytes: 64 * 1024 * 1024,
      sandbox: seededSandbox(image!.imageId),
      runId: 1,
      label: "acceptance-served",
      readOnlyPaths,
      evidenceDir,
      audit: () => {},
    });
    const logs = Object.fromEntries(commands.map((c) => {
      const path = join(evidenceDir, `${c.name}.log`);
      return [c.name, existsSync(path) ? readFileSync(path, "utf8") : ""];
    }));
    return { result, logs };
  } finally {
    target.cleanup();
  }
}

function loaded(log: string) {
  const read = readAcceptanceReport(log);
  assert.ok(read.ok, read.ok ? "" : `${read.reason}\n${log}`);
  assert.deepEqual(read.report.loadErrors, [], "the server started and nothing it printed reached the log");
  return read.report;
}

/** The two reproductions recorded confirmed from file:///work/, as a suite. */
const FILE_ORIGIN_SUITE = Object.fromEntries(["ac-014", "ac-016"].map((name) => {
  const file = recorded<{ files: { path: string; content: string }[] }>(`reproduction-report-file-origin-${name}`).files[0]!;
  return [`${SUITE_DIR}${file.path.split("/").pop()}`, file.content];
}));
const NAVIGATION_FILE = recorded<{ files: { path: string; content: string }[] }>("acceptance-report-navigation").files[0]!;

test("the delivered Target Tap page passes the two criteria it was falsely confirmed against, served", { skip }, async () => {
  // The expectation is the recorded HTTP diagnostic's (reproduction-diagnostic-file-origin.json):
  // served, the ready message showed and #start hid after a click, as AC-014 and AC-016 require.
  const { result, logs } = await servedRun({ ...deliveredTree(), ...FILE_ORIGIN_SUITE }, [acceptanceCommand(SUITE_DIR, 2)]);
  const report = loaded(logs.acceptance!);
  assert.equal(report.tests.length, 2);
  assert.ok(report.tests.every((t) => t.results.length === 2 && t.results.every((r) => r.status === "passed")), JSON.stringify(report.tests));
  assert.equal(result.reason, null);
  assert.equal(result.record!.outcome, "pass");
});

test("a page the served tree does not hold fails navigation, as the missing file did from disk", { skip }, async () => {
  const suiteFile = { path: `${SUITE_DIR}navigation.spec.mjs`, content: NAVIGATION_FILE.content };
  const { result, logs } = await servedRun({ "index.html": PAGE, [suiteFile.path]: suiteFile.content }, [acceptanceCommand(SUITE_DIR, 2)]);
  const report = loaded(logs.acceptance!);
  const results = report.tests.flatMap((t) => t.results);
  assert.equal(results.length, 2);
  for (const r of results) assert.equal(classifyFailure(r, [suiteFile]), "navigation", r.errors[0]?.message);
  assert.equal(result.record!.outcome, "block");
});

test("the server starts without an index.html, so a tree with none fails each test on navigation", { skip }, async () => {
  const suiteFile = { path: SUITE_FILE, content: RECORDED.files[0]!.content };
  const { logs } = await servedRun({ [suiteFile.path]: suiteFile.content }, [acceptanceCommand(SUITE_DIR, 2)]);
  const report = loaded(logs.acceptance!);
  const results = report.tests.flatMap((t) => t.results);
  assert.equal(results.length, 2);
  for (const r of results) assert.equal(classifyFailure(r, [suiteFile]), "navigation", r.errors[0]?.message);
});

test("two runner invocations in one container both pass, so the first released the server's port", { skip }, async () => {
  const runner = acceptanceCommand(SUITE_DIR, 2);
  const { result, logs } = await servedRun({ "index.html": PAGE, [SUITE_FILE]: RECORDED.files[0]!.content }, [
    { name: "first", command: runner.command },
    runner,
  ]);
  for (const name of ["first", "acceptance"]) {
    const report = loaded(logs[name]!);
    assert.ok(report.tests.length > 0 && report.tests.every((t) => t.results.every((r) => r.status === "passed")), `${name}: ${JSON.stringify(report.tests)}`);
  }
  assert.equal(result.record!.outcome, "pass");
});

/**
 * Starts the system's page server inside the container, asks it each case in
 * turn over raw HTTP, and prints one JSON result. A file outside /work is
 * written first, so a refusal of the encoded traversal or the symlink case is
 * containment's, not a missing file's. The symlink case links that directory
 * into /work and removes the link before the probe exits.
 */
const PROBE = [
  'import { spawn } from "node:child_process";',
  'import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";',
  'import { request } from "node:http";',
  'import { connect } from "node:net";',
  'const server = spawn("node", ["/opt/bw-browser/serve.mjs"], { stdio: "ignore" });',
  "const listening = () => new Promise((resolve) => {",
  '  const socket = connect(47731, "127.0.0.1", () => { socket.end(); resolve(true); });',
  '  socket.on("error", () => resolve(false));',
  "});",
  "for (let i = 0; !(await listening()); i++) {",
  '  if (i === 200) throw new Error("the server never listened");',
  "  await new Promise((resolve) => setTimeout(resolve, 50));",
  "}",
  "const ask = (method, path) => new Promise((resolve) => {",
  '  const req = request({ host: "127.0.0.1", port: 47731, method, path, agent: false }, (res) => {',
  "    const chunks = [];",
  '    res.on("data", (chunk) => chunks.push(chunk));',
  '    res.on("end", () => resolve({',
  "      status: res.statusCode,",
  '      type: res.headers["content-type"] ?? null,',
  '      cache: res.headers["cache-control"] ?? null,',
  "      location: res.headers.location ?? null,",
  '      length: res.headers["content-length"] ?? null,',
  '      body: Buffer.concat(chunks).toString("utf8"),',
  "    }));",
  "  });",
  '  req.on("error", (err) => resolve({ closed: err.code }));',
  "  req.end();",
  "});",
  "/** The bytes the server sends back for a request line Node cannot parse. */",
  "const garbage = () => new Promise((resolve) => {",
  "  const chunks = [];",
  '  const socket = connect(47731, "127.0.0.1", () => socket.write("GARBAGE" + String.fromCharCode(13, 10, 13, 10)));',
  '  socket.on("data", (chunk) => chunks.push(chunk));',
  '  socket.on("error", () => {});',
  '  socket.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));',
  "});",
  'mkdirSync("/tmp/bw-outside", { recursive: true });',
  'writeFileSync("/tmp/bw-outside/secret.txt", "outside");',
  'const outside = readFileSync("/tmp/bw-outside/secret.txt", "utf8");',
  "const cases = {};",
  'for (const [method, path] of [["GET", "/"], ["GET", "/index.html"], ["HEAD", "/index.html"], ["GET", "/mod.mjs"], ["GET", "/data.unknownext"], ["GET", "/sub"], ["GET", "//sub"], ["GET", "/sub/"], ["GET", "/missing.html"], ["POST", "/index.html"], ["GET", "/%2e%2e/tmp/bw-outside/secret.txt"]]) {',
  "  cases[`${method} ${path}`] = await ask(method, path);",
  "}",
  "const malformed = await garbage();",
  'symlinkSync("/tmp/bw-outside", "/work/outside-link");',
  "try {",
  '  cases["GET /outside-link/secret.txt"] = await ask("GET", "/outside-link/secret.txt");',
  "} finally {",
  '  rmSync("/work/outside-link");',
  "}",
  "server.kill();",
  "console.log(JSON.stringify({ outside, malformed, cases }));",
  "",
].join("\n");

test("the page server answers by its stated contract: types, HEAD, directories, no-store, and no response outside /work", { skip }, async () => {
  const files = {
    "index.html": PAGE,
    "mod.mjs": "export const served = true;\n",
    "data.unknownext": "opaque\n",
    "sub/index.html": "<!doctype html><title>Sub</title>\n",
    "probe.mjs": PROBE,
  };
  const { result, logs } = await servedRun(files, [{ name: "probe", command: ["node", "probe.mjs"] }], []);
  const log = logs.probe!;
  assert.equal(result.reason, null, log);
  const { outside, malformed, cases } = JSON.parse(log.slice(log.indexOf("\n") + 1)) as {
    outside: string;
    malformed: string;
    cases: Record<string, { status?: number; type?: string | null; cache?: string | null; location?: string | null; length?: string | null; body?: string; closed?: string }>;
  };
  // The expected values are the contract in the plan's "Approach", not the server's code.
  const length = (text: string) => String(Buffer.byteLength(text));
  const html = { status: 200, type: "text/html; charset=utf-8", cache: "no-store", location: null };
  assert.deepEqual(cases["GET /"], { ...html, length: length(PAGE), body: PAGE });
  assert.deepEqual(cases["GET /index.html"], { ...html, length: length(PAGE), body: PAGE });
  // HEAD sends the headers GET would, Content-Length included, and no body.
  assert.deepEqual(cases["HEAD /index.html"], { ...html, length: length(PAGE), body: "" });
  assert.deepEqual(cases["GET /mod.mjs"], { status: 200, type: "text/javascript; charset=utf-8", cache: "no-store", location: null, length: length(files["mod.mjs"]), body: files["mod.mjs"] });
  assert.deepEqual(cases["GET /data.unknownext"], { status: 200, type: "application/octet-stream", cache: "no-store", location: null, length: length(files["data.unknownext"]), body: files["data.unknownext"] });
  const redirect = { status: 301, type: null, cache: "no-store", location: "/sub/", length: "0", body: "" };
  assert.deepEqual(cases["GET /sub"], redirect);
  // The same origin's path, never a protocol-relative `//sub/`.
  assert.deepEqual(cases["GET //sub"], redirect);
  assert.deepEqual(cases["GET /sub/"], { ...html, length: length(files["sub/index.html"]), body: files["sub/index.html"] });
  // The file both escapes reach exists, so only containment can refuse them.
  assert.equal(outside, "outside");
  for (const key of ["GET /missing.html", "POST /index.html", "GET /%2e%2e/tmp/bw-outside/secret.txt", "GET /outside-link/secret.txt"]) {
    assert.ok(cases[key]?.closed !== undefined, `${key} gets no response: ${JSON.stringify(cases[key])}`);
  }
  assert.equal(malformed, "", "a request Node cannot parse gets no response");
});
