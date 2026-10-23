import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { lintSuiteFile } from "../src/acceptance.ts";
import { confirmReproductions, preserveCheck, runPreservedChecks } from "../src/code-review-stage.ts";
import type { CodeReviewPreservedCheck, CodeReviewReproduction } from "../src/code-review.ts";
import { dockerReady, ensureImage } from "../src/container.ts";
import { SEVERITIES } from "../src/finding.ts";
import { seededSandbox, VERIFY_COMMAND_TIMEOUT_SECONDS, VERIFY_RETENTION_MAX_BYTES } from "../src/policy.ts";
import { controlTree, type Benchmark } from "../scripts/test-author-evaluation.ts";

/**
 * The free benchmark (docs/features/reproduced-review-findings/plan.md, Task 9):
 * the stage's own confirmation and preserved-check functions, on the real
 * engine, over the recorded web-calculator trees. Every test skips, with a
 * named reason, when no Docker engine answers.
 *
 * The reproductions are recorded model output, never written here (hazard 4).
 * The expected outcomes come from the same record's per-tree results.
 */
const PROVENANCE = {
  sample: "sonnet-5-5-medium-1 of test/fixtures/recorded/test-author-evaluation-web-calculator-r1.json (Sonnet 5.5 medium, the seeded setting; its suite met plan 1's re-registered thresholds)",
  trees: "test/fixtures/recorded/code-review-web-calculator-remediation-regression.json trees b5d42890 and bc57eb74; the control is the evaluation script's own controlTree, as the r1 record's provenance.control names it",
  finding9: {
    file: "acceptance/web-calculator/theme-layout.spec.mjs",
    narrowing: "the AC-018 loop's array cut to [\"Enter\"]; every top-level declaration from the AC-019/AC-020 loop to the end of the file removed",
    recorded: "AC-018 (Enter) failed on a matcher at b5d42890 and passed at bc57eb74 and on the control",
  },
  finding10: {
    file: "acceptance/web-calculator/keyboard.spec.mjs",
    narrowing: "the CALCULATIONS array cut to its AC-013 row and the calculation loop's focus places to [\"1\"]; every top-level declaration from the AC-016/AC-017 loop to the end of the file removed",
    recorded: "AC-013 (1) failed on a matcher at bc57eb74 and passed at b5d42890 and on the control",
  },
};

const DOCKER = ["docker"];
const ready = dockerReady(DOCKER);
const skip = ready.ok ? false : "no Docker engine answered";
const image = ready.ok ? ensureImage(DOCKER) : null;

const RECORDED = join("test", "fixtures", "recorded");
const BENCHMARK = JSON.parse(readFileSync(join(RECORDED, "code-review-web-calculator-remediation-regression.json"), "utf8")) as Benchmark;
interface RecordedTest { title: string; file: string; outcome: string; message: string | null }
const SAMPLE = (JSON.parse(readFileSync(join(RECORDED, "test-author-evaluation-web-calculator-r1.json"), "utf8")) as {
  samples: { label: string; suite: { path: string; content: string }[]; trees: Record<string, { tests: RecordedTest[] }> }[];
}).samples.find((s) => s.label === "sonnet-5-5-medium-1")!;

const FINDING_9_TREE = "b5d428908cabbaece955a816a72ba0a477d3422e";
const FINDING_10_TREE = "bc57eb7482b4737fd1fe9e110e50652c630a0aa7";
const REVIEWER = "code-reviewer-correctness";

/** `content` with each edit made exactly once, cut before `cutFrom`. */
function narrow(content: string, edits: Array<[string, string]>, cutFrom: string): string {
  let out = content;
  for (const [from, to] of edits) {
    assert.equal(out.split(from).length, 2, `the narrowing ${JSON.stringify(from)} occurs exactly once`);
    out = out.replace(from, to);
  }
  assert.equal(out.split(cutFrom).length, 2, `the cut ${JSON.stringify(cutFrom)} occurs exactly once`);
  return `${out.slice(0, out.indexOf(cutFrom))}\n`;
}

function suiteFile(path: string): string {
  return SAMPLE.suite.find((f) => f.path === path)!.content;
}

const FINDING_9 = {
  findingId: 9,
  fileName: "enter-on-theme-control.spec.mjs",
  content: narrow(
    suiteFile(PROVENANCE.finding9.file),
    [['for (const how of ["click", "Enter", "Space"]) {', 'for (const how of ["Enter"]) {']],
    '\nfor (const theme of ["dark", "light"]) {'
  ),
  title: "AC-018 The page shows a theme control; after it is activated once (Enter) the data-theme attribute of the html element is light or dark, each further activation changes it to the other value, and the body background-color differs between the two",
};
const FINDING_10 = {
  findingId: 10,
  fileName: "enter-on-focused-digit.spec.mjs",
  content: narrow(
    suiteFile(PROVENANCE.finding10.file),
    [
      ['  ["AC-014", "2, +, 3, Enter", ["2", "+", "3", "Enter"], "5"],\n', ""],
      ['  ["AC-015", "8, /, 4, Enter", ["8", "/", "4", "Enter"], "2"],\n', ""],
      ['  ["AC-024", "9, -, 4, Enter", ["9", "-", "4", "Enter"], "5"],\n', ""],
      ["  for (const place of FOCUS_PLACES) {\n    test(`${id} After", '  for (const place of ["1"]) {\n    test(`${id} After'],
    ],
    "\nfor (const place of FOCUS_PLACES) {\n  test(`AC-016"
  ),
  title: "AC-013 After a fresh page load, with focus on the page document (1), pressing the keyboard keys 9, *, 3, Enter in sequence results in the display area showing the value 27",
};
type Reproduction = typeof FINDING_9;

/** The recorded first line of the target test's failure at `tree`, or null where it passed. */
function recordedFailure(tree: string, title: string): string | null {
  const recorded = SAMPLE.trees[tree]!.tests.find((t) => t.title === title)!;
  return recorded.outcome === "pass" ? null : recorded.message!.split("\n")[0]!;
}

/** A repository holding exactly `files`, committed, with `.governance/` ignored. */
function repository(files: Record<string, string>): { root: string; head: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "bw-repro-benchmark-"));
  const git = (...args: string[]) => {
    const r = spawnSync("git", ["-c", "core.autocrlf=false", ...args], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  for (const [path, content] of Object.entries({ ...files, ".gitignore": ".governance/\n" })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=benchmark", "-c", "user.email=benchmark@buildworks.invalid", "commit", "-q", "-m", "tree");
  return { root, head: git("rev-parse", "HEAD"), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** The stage's confirmation of `reproduction` with `tree` as the reviewed commit. */
async function confirm(tree: Record<string, string>, reproduction: Reproduction): Promise<CodeReviewReproduction> {
  const { root, head, cleanup } = repository(tree);
  try {
    const [result] = await confirmReproductions({
      rootDir: root,
      runId: 1,
      round: 1,
      commit: head,
      pending: [{
        findingId: reproduction.findingId,
        reviewer: REVIEWER,
        reproduction: { intentKey: "enter-activation", location: "src/app.js", fileName: reproduction.fileName, content: reproduction.content },
      }],
      sandbox: seededSandbox(image!.imageId),
      timeoutSeconds: VERIFY_COMMAND_TIMEOUT_SECONDS,
      retentionMaxBytes: VERIFY_RETENTION_MAX_BYTES,
      audit: () => undefined,
    });
    return result!;
  } finally {
    cleanup();
  }
}

/** The stage's preservation of `reproduction`, then its check at `tree`, as after a remediation. */
async function check(tree: Record<string, string>, reproduction: Reproduction): Promise<CodeReviewPreservedCheck> {
  const { root, head, cleanup } = repository(tree);
  try {
    const kept = preserveCheck({
      rootDir: root,
      runId: 1,
      round: 1,
      finding: {
        id: reproduction.findingId,
        location: "src/app.js",
        intentKey: "enter-activation",
        reports: [{ agent: REVIEWER, severity: "high", classification: "current_artifact", subject: reproduction.title }],
      },
      reviewer: REVIEWER,
      fileName: reproduction.fileName,
      content: reproduction.content,
      severities: SEVERITIES,
    });
    assert.ok(kept.ok, kept.ok ? "" : kept.reason);
    const [judged] = await runPreservedChecks({
      rootDir: root,
      runId: 1,
      round: 1,
      commit: head,
      checks: [kept.check],
      sandbox: seededSandbox(image!.imageId),
      timeoutSeconds: VERIFY_COMMAND_TIMEOUT_SECONDS,
      retentionMaxBytes: VERIFY_RETENTION_MAX_BYTES,
      audit: () => undefined,
    });
    return judged!.result;
  } finally {
    cleanup();
  }
}

test("the narrowed reproductions are the recorded files with only the named edits, each one test that passes the lint", () => {
  for (const reproduction of [FINDING_9, FINDING_10]) {
    assert.deepEqual(lintSuiteFile({ path: `/bw-checks/${reproduction.findingId}/${REVIEWER}/${reproduction.fileName}`, content: reproduction.content }), []);
    // One declaration, inside loops narrowed to one case each.
    assert.equal(reproduction.content.match(/^\s*test\(/gm)?.length, 1, "one test declaration");
  }
  // The recorded results the expectations below are read from.
  assert.equal(recordedFailure("b5d42890", FINDING_9.title), "Error: expect(locator).toHaveAttribute(expected) failed");
  assert.equal(recordedFailure("bc57eb74", FINDING_9.title), null);
  assert.equal(recordedFailure("control", FINDING_9.title), null);
  assert.equal(recordedFailure("bc57eb74", FINDING_10.title), "Error: expect(locator).toHaveText(expected) failed");
  assert.equal(recordedFailure("b5d42890", FINDING_10.title), null);
  assert.equal(recordedFailure("control", FINDING_10.title), null);
});

test("finding 9's reproduction confirms at b5d42890, the commit it was reviewed at", { skip }, async (t) => {
  const result = await confirm(BENCHMARK.trees[FINDING_9_TREE]!, FINDING_9);
  t.diagnostic(JSON.stringify(result));
  assert.equal(result.outcome, "confirmed", result.detail ?? "");
  assert.equal(result.detail, recordedFailure("b5d42890", FINDING_9.title));
});

test("finding 9's preserved check holds at bc57eb74, the remediated commit", { skip }, async (t) => {
  const result = await check(BENCHMARK.trees[FINDING_10_TREE]!, FINDING_9);
  t.diagnostic(JSON.stringify(result));
  assert.equal(result.outcome, "holds", result.detail ?? "");
});

test("finding 10's reproduction confirms at bc57eb74, the commit it was reviewed at", { skip }, async (t) => {
  const result = await confirm(BENCHMARK.trees[FINDING_10_TREE]!, FINDING_10);
  t.diagnostic(JSON.stringify(result));
  assert.equal(result.outcome, "confirmed", result.detail ?? "");
  assert.equal(result.detail, recordedFailure("bc57eb74", FINDING_10.title));
});

test("finding 10's preserved check holds on the control tree", { skip }, async (t) => {
  const result = await check(controlTree(BENCHMARK), FINDING_10);
  t.diagnostic(JSON.stringify(result));
  assert.equal(result.outcome, "holds", result.detail ?? "");
});

test("finding 9's preserved check holds on the control tree", { skip }, async (t) => {
  const result = await check(controlTree(BENCHMARK), FINDING_9);
  t.diagnostic(JSON.stringify(result));
  assert.equal(result.outcome, "holds", result.detail ?? "");
});

// --- The served page (docs/features/served-browser-pages/plan.md, Task 2) ---

interface DeliveredPage {
  manifest: { path: string; blob: string }[];
  files: { path: string; blob: string; content: string }[];
}

/** The delivered Target Tap tree, each file's bytes rehashed to its manifest blob ID first. */
function deliveredTree(): Record<string, string> {
  const page = JSON.parse(readFileSync(join(RECORDED, "target-tap-delivered-page.json"), "utf8")) as DeliveredPage;
  const tree: Record<string, string> = {};
  for (const file of page.files) {
    const bytes = Buffer.from(file.content, "utf8");
    const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(blob, page.manifest.find((e) => e.path === file.path)?.blob, `${file.path} is the committed blob`);
    tree[file.path] = file.content;
  }
  return tree;
}

/**
 * The two reproductions written from the approved Target Tap specification and
 * recorded `confirmed` from `file:///work/`, where the delivered page's module
 * script never loaded. Served, the same page met both criteria in the recorded
 * HTTP diagnostic (`reproduction-diagnostic-file-origin.json`: the ready message
 * showed, and `#start` hid after a click), so each must pass and be not reproduced.
 */
const FILE_ORIGIN = ["ac-014", "ac-016"].map((name) => {
  const file = (JSON.parse(readFileSync(join(RECORDED, `reproduction-report-file-origin-${name}.json`), "utf8")) as {
    files: { path: string; content: string }[];
  }).files[0]!;
  const [findingId, reviewer, fileName] = file.path.replace(/^\/bw-checks\//, "").split("/");
  assert.equal(reviewer, REVIEWER);
  return { findingId: Number(findingId), fileName: fileName!, content: file.content, title: name };
});

test("the Target Tap reproductions recorded confirmed from file:///work/ are not reproduced on the served delivered page", { skip }, async (t) => {
  const tree = deliveredTree();
  for (const reproduction of FILE_ORIGIN) {
    const result = await confirm(tree, reproduction);
    t.diagnostic(JSON.stringify(result));
    assert.equal(result.outcome, "not_reproduced", `${reproduction.fileName}: ${result.detail ?? ""}`);
  }
});
