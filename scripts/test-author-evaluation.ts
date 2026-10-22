import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  acceptanceCommand,
  ACCEPTANCE_STUB_PAGE,
  classifyAcceptance,
  readAcceptanceReport,
  validateAcceptanceSuite,
  type AcceptanceFile,
  type ClassifiedTest,
} from "../src/acceptance.ts";
import { WORKSPACE_REPLY_SCHEMA, parseWorkspaceReply, validateWorkspaceReply } from "../src/agent-result.ts";
import { ACCEPTANCE_TEST_AUTHOR } from "../src/agents/acceptance-test-author.ts";
import { createSandbox, destroySandbox, dockerClientEnv, ensureImage, execTarget, runInSandbox } from "../src/container.ts";
import { CLAUDE_CODE } from "../src/executor.ts";
import { invokeHarness, parseEnvelope, probeExecutor } from "../src/harness.ts";
import { seededSandbox } from "../src/policy.ts";
import { buildAcceptanceTestAuthorPrompt } from "../src/prompts.ts";
import { validateSpecDoc } from "../src/spec-doc.ts";

/**
 * The test author's evaluation on the recorded web-calculator run
 * (docs/features/protected-acceptance-tests/plan.md, Task 4), before the author
 * is wired into the chain. For each setting it makes three dispatches, each in a
 * fresh sandbox over a fresh target holding only what the driver's scratch
 * target holds (`governed.yaml`, `.gitignore` and the design). It checks each
 * suite by the validity gate against the blank stub page, then runs it against
 * the two reviewed trees and the control, and scores the thresholds the plan
 * registered before any answer was seen.
 *
 *   node scripts/test-author-evaluation.ts --dry-run
 *   node scripts/test-author-evaluation.ts --out <dir> --result <name> --ceiling <usd> [--setting <name>] --yes
 *   node scripts/test-author-evaluation.ts --rescore <dir> --result <name>
 *
 * One dispatch at a time, settings interleaved so a ceiling stop leaves every
 * setting sampled. Each sample is kept as `<dir>/<label>/sample.json` and
 * skipped on a rerun. The spend stops at the ceiling: each dispatch's
 * `--max-budget-usd` is the smaller of $2.00 and what remains. `--rescore`
 * dispatches nothing. The record, `test/fixtures/recorded/<name>.json`, is
 * never overwritten.
 */

const ROOT = join(import.meta.dirname, "..");
const RECORDED = join(ROOT, "test", "fixtures", "recorded");
const BENCHMARK = join(RECORDED, "code-review-web-calculator-remediation-regression.json");
const TOOL_SERVER = join(ROOT, "src", "tool-server.ts");
const DESIGN = join(ROOT, ".claude", "skills", "run-buildworks", "web-calculator-design.md");
const SLUG = "web-calculator";
const DIR = `acceptance/${SLUG}/`;
const DISPATCH_BUDGET_USD = 2;
/** Below this, a further dispatch could not finish usefully, so the run stops. */
const MIN_DISPATCH_USD = 0.5;
const SUITE_TIMEOUT_SECONDS = 900;

const FINDING_9_TREE = "b5d428908cabbaece955a816a72ba0a477d3422e";
const FINDING_10_TREE = "bc57eb7482b4737fd1fe9e110e50652c630a0aa7";
/**
 * The control: bc57eb74 with its Enter branch made spec-correct. The
 * specification has Enter do equals with focus on any element of the page
 * (AC-013 and its glossary) and the theme control change theme on each
 * activation (AC-018), so Enter always does equals, and on the theme control the
 * handler leaves the key's default alone so the control's own click still runs.
 * Finding 10 is the early return this removes; finding 9 is b5d42890's
 * `preventDefault`, which this skips on the theme control.
 */
const CONTROL_FROM = [
  '      if (event.target && event.target.closest && event.target.closest("button")) {',
  "        // a focused button handles Enter through its own click",
  "        return;",
  "      }",
  "      calc.equals();",
].join("\n");
const CONTROL_TO = [
  "      calc.equals();",
  '      if (event.target && event.target.closest && event.target.closest("#theme-toggle")) {',
  "        // the theme control's own activation still runs",
  "        render();",
  "        return;",
  "      }",
].join("\n");
const FINDING_10_CRITERIA = ["AC-013", "AC-014", "AC-015", "AC-024"];

export const SETTINGS = [
  { name: "sonnet-5-5-medium", model: "claude-sonnet-5-5", effort: "medium" },
  { name: "opus-5-5-high", model: "claude-opus-5-5", effort: "high" },
] as const;
export const SAMPLES = 3;

export const THRESHOLDS = [
  "Registered 2026-10-21, before any answer under the corrected control and lint was seen. A setting passes only if it meets all four:",
  "1. Gate: at least 2 of 3 suites pass the validity gate.",
  "2. Catches finding 9: in each gate-passing suite, at least one AC-018 test fails at b5d42890 and passes on the control.",
  "3. Catches finding 10: in each gate-passing suite, at least one test under AC-013, AC-014, AC-015 or AC-024 fails at bc57eb74 and passes on the control.",
  "4. Precision: no test fails on the control in a gate-passing suite. Each control failure is read by hand against the control's code; one that exposes a real control defect corrects the control and is re-scored, never discounted.",
].join("\n");

interface Benchmark {
  trees: Record<string, Record<string, string>>;
  approvedDocuments: { specFull: string; planFull: string };
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} in ${cwd} failed: ${r.stderr}`);
  return r.stdout;
}

/** A Git repository at `dir` holding exactly `files`, committed. */
function repository(dir: string, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=evaluation", "-c", "user.email=evaluation@buildworks.invalid", "commit", "-q", "-m", "baseline");
}

function filesUnder(root: string, dir: string): AcceptanceFile[] {
  const base = join(root, dir);
  if (!existsSync(base)) return [];
  return (readdirSync(base, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[])
    .filter((e) => e.isFile())
    .map((e) => relative(root, join(e.parentPath, e.name)).split(sep).join("/"))
    .sort()
    .map((path) => ({ path, content: readFileSync(join(root, path), "utf8") }));
}

/** The paths the author changed, created or deleted, by Git. */
function changedPaths(target: string): string[] {
  return git(target, "status", "--porcelain=v1", "-z", "--untracked-files=all")
    .split("\0")
    .filter((e) => e !== "")
    .map((e) => e.slice(3));
}

interface SuiteRun {
  tree: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  reportError: string | null;
  tests: ClassifiedTest[];
}

/** Run the system command over `files` plus the suite in a fresh repository and sandbox; the log stays in `dir`. */
async function runSuite(imageId: string, dir: string, label: string, files: Record<string, string>, suite: AcceptanceFile[], runId: number): Promise<SuiteRun & { log: string; report: ReturnType<typeof readAcceptanceReport> }> {
  rmSync(dir, { recursive: true, force: true });
  repository(dir,{ ...files, ...Object.fromEntries(suite.map((f) => [f.path, f.content])) });
  const frozen = seededSandbox(imageId);
  const sandbox = createSandbox({ frozen, rootDir: dir, runId, label, worktreePath: dir });
  const logPath = join(dirname(dir), `${label}.log`);
  let outcome;
  try {
    outcome = await runInSandbox(execTarget(sandbox), imageId, acceptanceCommand(DIR, 2), {
      cwd: dir, timeoutSeconds: SUITE_TIMEOUT_SECONDS, maxBytes: 16 * 1024 * 1024, retentionMaxBytes: 64 * 1024 * 1024, evidencePath: logPath,
    });
  } finally {
    const teardown = destroySandbox(sandbox);
    if (!teardown.workContainerGone || teardown.failures.length > 0) throw new Error(`sandbox ${sandbox.name} teardown: ${teardown.failures.join("; ")}`);
  }
  const log = readFileSync(logPath, "utf8");
  const report = readAcceptanceReport(log);
  return {
    tree: label,
    exitCode: outcome.exitCode,
    durationMs: outcome.durationMs,
    timedOut: outcome.timedOut,
    reportError: report.ok ? null : report.reason,
    tests: report.ok ? classifyAcceptance(report.report, suite) : [],
    log,
    report,
  };
}

/** The cost on the stream's last result line, read even when the envelope is refused. */
function streamCost(raw: string): number | null {
  for (const line of raw.trim().split(/\r?\n/).reverse()) {
    try {
      const parsed = JSON.parse(line) as { type?: string; total_cost_usd?: unknown };
      if (parsed.type === "result" && typeof parsed.total_cost_usd === "number") return parsed.total_cost_usd;
    } catch {
      // not a JSON line
    }
  }
  return null;
}

interface Sample {
  label: string;
  setting: string;
  model: string;
  effort: string;
  promptSha256: string;
  budgetUsd: string;
  cost: number | null;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  reply: unknown;
  replyError: string | null;
  changedPaths: string[];
  outOfScope: string[];
  suite: AcceptanceFile[];
  gate: { ok: boolean; refusals: string[]; alreadySatisfied: string[]; tests: { title: string; outcome: string; failureClass: string | null; role: string | null }[] } | null;
  baseline: Omit<SuiteRun, "tests"> | null;
  trees: Record<string, SuiteRun>;
  toolCalls: number;
}

function brief(run: SuiteRun): SuiteRun {
  return { ...run, tests: run.tests.map((t) => ({ ...t, message: t.message?.split("\n")[0] ?? null })) };
}

interface Dispatched {
  raw: string;
  stderr: string;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
}

/** One test-author dispatch through the tool server, in a fresh sandbox over a fresh target. */
async function dispatchAuthor(input: {
  base: string;
  target: string;
  prompt: string;
  setting: (typeof SETTINGS)[number];
  imageId: string;
  budgetUsd: string;
  runId: number;
  toolLog: string;
}): Promise<Dispatched> {
  rmSync(input.base, { recursive: true, force: true });
  repository(input.target, {
    ".gitignore": ".governance/\n",
    "governed.yaml": 'verify:\n  - name: node-version\n    command: ["node", "--version"]\n  - name: npm-version\n    command: ["npm", "--version"]\n',
    [`docs/features/${SLUG}/design.md`]: readFileSync(DESIGN, "utf8"),
  });
  writeFileSync(join(input.base, "prompt.txt"), input.prompt);
  const sandbox = createSandbox({ frozen: seededSandbox(input.imageId), rootDir: input.target, runId: input.runId, label: "test-author", worktreePath: input.target });
  let outcome;
  try {
    outcome = await invokeHarness(CLAUDE_CODE, {
      prompt: input.prompt,
      model: input.setting.model,
      effort: input.setting.effort,
      jsonSchema: WORKSPACE_REPLY_SCHEMA,
      cwd: input.target,
      budgetUsd: input.budgetUsd,
      toolServer: {
        command: process.execPath,
        args: [
          TOOL_SERVER,
          "--container", sandbox.ids.work!,
          "--docker", JSON.stringify(sandbox.frozen.dockerCommand),
          "--docker-env", JSON.stringify(dockerClientEnv()),
          "--log", input.toolLog,
          "--timeout", String(sandbox.frozen.commandTimeoutSeconds),
        ],
        configPath: join(input.base, "mcp.json"),
      },
    });
  } finally {
    const teardown = destroySandbox(sandbox);
    if (!teardown.workContainerGone || teardown.failures.length > 0) throw new Error(`sandbox ${sandbox.name} teardown: ${teardown.failures.join("; ")}`);
  }
  return { raw: outcome.raw, stderr: outcome.stderr, durationMs: outcome.durationMs, exitCode: outcome.exitCode, timedOut: outcome.timedOut };
}

export async function sample(
  out: string,
  label: string,
  setting: (typeof SETTINGS)[number],
  benchmark: Benchmark,
  criteria: string[],
  imageId: string,
  budgetUsd: string,
  runId: number
): Promise<Sample> {
  const base = join(out, label);
  const target = join(base, "target");
  const prompt = buildAcceptanceTestAuthorPrompt(ACCEPTANCE_TEST_AUTHOR, benchmark.approvedDocuments.specFull, benchmark.approvedDocuments.planFull, DIR, acceptanceCommand(DIR, 2));
  const promptSha256 = createHash("sha256").update(prompt).digest("hex");
  const toolLog = join(base, "tools.jsonl");
  // A paid dispatch is kept the moment it ends, so a rerun after a later failure reuses it rather than paying again.
  const checkpoint = join(base, "dispatch.json");
  const outcome = existsSync(checkpoint)
    ? (JSON.parse(readFileSync(checkpoint, "utf8")) as Dispatched)
    : await dispatchAuthor({ base, target, prompt, setting, imageId, budgetUsd, runId, toolLog });
  if (!existsSync(checkpoint)) writeFileSync(checkpoint, JSON.stringify(outcome));
  writeFileSync(join(base, "raw.jsonl"), outcome.raw);
  if (outcome.stderr !== "") writeFileSync(join(base, "stderr.txt"), outcome.stderr);
  let reply: unknown = null;
  let replyError: string | null = null;
  let cost = streamCost(outcome.raw);
  try {
    const envelope = parseEnvelope(CLAUDE_CODE, outcome.raw, true);
    cost = envelope.cost ?? cost;
    const parsed = parseWorkspaceReply(envelope.resultText, validateWorkspaceReply);
    if (parsed.ok) reply = parsed.value;
    else replyError = parsed.reason;
  } catch (err) {
    replyError = (err as Error).message;
  }
  const changed = changedPaths(target);
  const outOfScope = changed.filter((p) => !p.startsWith(DIR));
  const suite = filesUnder(target, DIR);
  const toolCalls = existsSync(toolLog) ? readFileSync(toolLog, "utf8").split("\n").filter((l) => l.includes('"started"')).length : 0;
  const result: Sample = {
    label, setting: setting.name, model: setting.model, effort: setting.effort, promptSha256, budgetUsd, cost,
    durationMs: outcome.durationMs, exitCode: outcome.exitCode, timedOut: outcome.timedOut, reply, replyError,
    changedPaths: changed, outOfScope, suite, gate: null, baseline: null, trees: {}, toolCalls,
  };
  console.log(`${label}: cost $${cost?.toFixed(4) ?? "unknown"}, ${Math.round(outcome.durationMs / 1000)} s, ${toolCalls} tool calls, ${suite.length} suite files, reply ${replyError ?? (reply as { status: string }).status}${outOfScope.length > 0 ? `, OUT OF SCOPE ${outOfScope.join(", ")}` : ""}`);
  if (suite.length === 0) return result;

  const baseline = await runSuite(imageId, join(base, "baseline"), "baseline", { "index.html": ACCEPTANCE_STUB_PAGE }, suite, runId);
  const { log: _log, report, tests: _tests, ...baselineRecord } = baseline;
  result.baseline = baselineRecord;
  result.gate = gateOf(report, suite, criteria, outOfScope);
  console.log(`${label}: baseline ${Math.round(baseline.durationMs / 1000)} s, gate ${result.gate.ok ? "PASS" : `REFUSED (${result.gate.refusals.length}): ${result.gate.refusals.slice(0, 3).join(" | ")}`}`);

  const fixtureTree = (sha: string) => benchmark.trees[sha]!;
  for (const [name, files] of [["b5d42890", fixtureTree(FINDING_9_TREE)], ["bc57eb74", fixtureTree(FINDING_10_TREE)], ["control", controlTree(benchmark)]] as const) {
    const run = await runSuite(imageId, join(base, name), name, files, suite, runId);
    result.trees[name] = brief(run);
    console.log(`${label}: ${name} ${Math.round(run.durationMs / 1000)} s ${counts(run)}${run.reportError ? ` report error: ${run.reportError}` : ""}`);
  }
  return result;
}

function counts(run: SuiteRun): string {
  return JSON.stringify(run.tests.reduce((m, t) => ({ ...m, [t.outcome]: (m[t.outcome] ?? 0) + 1 }), {} as Record<string, number>));
}

function controlTree(benchmark: Benchmark): Record<string, string> {
  const tree = benchmark.trees[FINDING_10_TREE]!;
  return { ...tree, "src/app.js": tree["src/app.js"]!.replace(CONTROL_FROM, CONTROL_TO) };
}

/** The validity gate over a baseline report, plus any path the author changed outside the suite directory. */
function gateOf(report: ReturnType<typeof readAcceptanceReport>, suite: AcceptanceFile[], criteria: string[], outOfScope: string[]): NonNullable<Sample["gate"]> {
  if (!report.ok) return { ok: false, refusals: [`the baseline report is unreadable: ${report.reason}`], alreadySatisfied: [], tests: [] };
  const gate = validateAcceptanceSuite({ report: report.report, files: suite, criteria });
  const refusals = [...gate.refusals, ...outOfScope.map((p) => `the author changed ${p}, outside ${DIR}`)];
  return {
    ok: refusals.length === 0,
    refusals,
    alreadySatisfied: gate.alreadySatisfied,
    tests: gate.tests.map((t) => ({ title: t.title, outcome: t.outcome, failureClass: t.failureClass, role: t.role })),
  };
}

/**
 * Re-score a kept sample without dispatching: the gate is re-read from its
 * retained baseline log, the reviewed trees' runs are kept (neither tree nor
 * suite changed), and only the control is run again.
 */
async function rescore(out: string, label: string, benchmark: Benchmark, criteria: string[], imageId: string, runId: number): Promise<Sample> {
  const base = join(out, label);
  const s = JSON.parse(readFileSync(join(base, "sample.json"), "utf8")) as Sample;
  if (s.suite.length === 0) return s;
  s.gate = gateOf(readAcceptanceReport(readFileSync(join(base, "baseline.log"), "utf8")), s.suite, criteria, s.outOfScope);
  const run = await runSuite(imageId, join(base, "control-rescore"), "control-rescore", controlTree(benchmark), s.suite, runId);
  s.trees.control = brief({ ...run, tree: "control" });
  console.log(`${label}: gate ${s.gate.ok ? "PASS" : `REFUSED (${s.gate.refusals.length})`}; control ${Math.round(run.durationMs / 1000)} s ${counts(run)}${run.reportError ? ` report error: ${run.reportError}` : ""}`);
  return s;
}

/** One gate-passing suite's catches and control failures. */
export function scoreSuite(s: Sample): { finding9: boolean; finding10: boolean; controlFailures: { title: string; outcome: string; message: string | null }[] } {
  const outcome = (tree: string, title: string) => s.trees[tree]?.tests.find((t) => t.title === title)?.outcome;
  const titles = s.trees.control?.tests.map((t) => t.title) ?? [];
  const catches = (tree: string, ids: string[]) =>
    titles.some((title) => ids.some((id) => title.startsWith(`${id} `)) && outcome(tree, title) === "fail" && outcome("control", title) === "pass");
  return {
    finding9: catches("b5d42890", ["AC-018"]),
    finding10: catches("bc57eb74", FINDING_10_CRITERIA),
    controlFailures: (s.trees.control?.tests ?? []).filter((t) => t.outcome !== "pass").map((t) => ({ title: t.title, outcome: t.outcome, message: t.message })),
  };
}

function argument(args: string[], name: string): string | null {
  const at = args.indexOf(name);
  return at === -1 ? null : (args[at + 1] ?? null);
}

async function main(args: string[]): Promise<number> {
  const dryRun = args.includes("--dry-run");
  const out = argument(args, "--out");
  const rescoreDir = argument(args, "--rescore");
  const resultName = argument(args, "--result");
  if ([dryRun, out !== null, rescoreDir !== null].filter(Boolean).length !== 1 || (!dryRun && resultName === null)) {
    console.error("usage: --dry-run | --out <dir> --result <name> --ceiling <usd> [--setting <name>] --yes | --rescore <dir> --result <name>");
    return 2;
  }
  const benchmark = JSON.parse(readFileSync(BENCHMARK, "utf8")) as Benchmark;
  const spec = validateSpecDoc(benchmark.approvedDocuments.specFull);
  if (!spec.ok) throw new Error(`the recorded specification does not validate: ${spec.reason}`);
  const criteria = spec.value.acceptanceCriteria.map((c) => c.id);
  const controlApp = benchmark.trees[FINDING_10_TREE]!["src/app.js"]!;
  if (controlApp.split(CONTROL_FROM).length !== 2) throw new Error(`the control substitution does not occur exactly once in ${FINDING_10_TREE}'s src/app.js`);
  const prompt = buildAcceptanceTestAuthorPrompt(ACCEPTANCE_TEST_AUTHOR, benchmark.approvedDocuments.specFull, benchmark.approvedDocuments.planFull, DIR, acceptanceCommand(DIR, 2));
  console.log(`${criteria.length} criteria; prompt ${prompt.length} characters, sha256 ${createHash("sha256").update(prompt).digest("hex")}`);
  if (dryRun) {
    console.log("dry run: nothing dispatched");
    return 0;
  }
  const resultPath = join(RECORDED, `${resultName}.json`);
  if (existsSync(resultPath)) {
    console.error(`refusing to overwrite ${resultPath}`);
    return 2;
  }
  const image = ensureImage(["docker"]);
  console.log(`image ${image.tag} ${image.imageId}`);

  if (rescoreDir !== null) {
    const labels = readdirSync(rescoreDir).filter((l) => existsSync(join(rescoreDir, l, "sample.json"))).sort();
    const samples: Sample[] = [];
    for (const [index, label] of labels.entries()) samples.push(await rescore(rescoreDir, label, benchmark, criteria, image.imageId, 990 + index));
    writeResult(resultPath, {
      what: `A free re-score of the samples kept in ${rescoreDir}: the gate re-read from each retained baseline log, the control run again; nothing dispatched.`,
      consent: "None needed: no dispatch.",
      image,
      spent: 0,
      stopped: null,
    }, samples);
    return 0;
  }

  const ceilingUsd = Number(argument(args, "--ceiling"));
  if (!(ceilingUsd > 0)) {
    console.error("--ceiling <usd> is required for a paid round");
    return 2;
  }
  if (!args.includes("--yes")) {
    console.error(`--yes is required: this spends up to $${ceilingUsd}`);
    return 2;
  }
  const only = argument(args, "--setting");
  const settings = SETTINGS.filter((s) => only === null || s.name === only);
  if (settings.length === 0) {
    console.error(`unknown setting ${only}`);
    return 2;
  }
  probeExecutor(CLAUDE_CODE);
  mkdirSync(out!, { recursive: true });

  const order = Array.from({ length: SAMPLES }, (_, i) => settings.map((setting) => ({ setting, label: `${setting.name}-${i + 1}` }))).flat();
  const samples: Sample[] = [];
  let spent = 0;
  let stopped: string | null = null;
  for (const [index, { setting, label }] of order.entries()) {
    const kept = join(out!, label, "sample.json");
    if (existsSync(kept)) {
      const s = JSON.parse(readFileSync(kept, "utf8")) as Sample;
      samples.push(s);
      spent += s.cost ?? Number(s.budgetUsd);
      continue;
    }
    const remaining = ceilingUsd - spent;
    if (remaining < MIN_DISPATCH_USD) {
      stopped = `stopped before ${label}: $${spent.toFixed(4)} spent of the $${ceilingUsd} ceiling`;
      console.log(stopped);
      break;
    }
    const budgetUsd = Math.min(DISPATCH_BUDGET_USD, remaining).toFixed(2);
    const s = await sample(out!, label, setting, benchmark, criteria, image.imageId, budgetUsd, 950 + index);
    writeFileSync(kept, JSON.stringify(s, null, 2) + "\n");
    samples.push(s);
    // An unknown cost counts as the whole budget, so the ceiling holds.
    spent += s.cost ?? Number(budgetUsd);
    console.log(`spent $${spent.toFixed(4)} of $${ceilingUsd}`);
  }

  writeResult(resultPath, {
    what: "A paid round of the acceptance test author's evaluation on the recorded web-calculator run (docs/features/protected-acceptance-tests/plan.md, Task 4).",
    consent: "Operator, 2026-10-21: loop on paid rounds until the thresholds pass, up to $15 in total including Task 4's first $4.94.",
    image,
    spent,
    stopped,
  }, samples);
  return 0;
}

/** Score `samples` against the thresholds and write the record, never over an existing one. */
function writeResult(
  path: string,
  run: { what: string; consent: string; image: { tag: string; imageId: string }; spent: number; stopped: string | null },
  samples: Sample[]
): void {
  const score = SETTINGS.filter((setting) => samples.some((s) => s.setting === setting.name)).map((setting) => {
    const mine = samples.filter((s) => s.setting === setting.name);
    const passing = mine.filter((s) => s.gate?.ok === true);
    const suites = passing.map((s) => ({ label: s.label, ...scoreSuite(s) }));
    const precision = suites.length > 0 && suites.every((s) => s.controlFailures.length === 0);
    return {
      setting: setting.name,
      samples: mine.length,
      gatePassing: passing.length,
      gate: passing.length >= 2,
      finding9: suites.length > 0 && suites.every((s) => s.finding9),
      finding10: suites.length > 0 && suites.every((s) => s.finding10),
      precision,
      suites,
      cost: mine.reduce((sum, s) => sum + (s.cost ?? 0), 0),
    };
  });
  const fixture = {
    provenance: {
      what: run.what,
      consent: run.consent,
      captured: new Date().toISOString().slice(0, 10),
      image: run.image.tag,
      imageId: run.image.imageId,
      benchmark: "test/fixtures/recorded/code-review-web-calculator-remediation-regression.json: approvedDocuments.specFull and planFull, and trees",
      control: `${FINDING_10_TREE}'s src/app.js with its Enter branch replaced: Enter always does equals, and on #theme-toggle the key's default is left to activate the control`,
      spent: run.spent,
      stopped: run.stopped,
      dropped: "Each dispatch's raw stream, tool log and prompt, and each suite run's full report log: kept only in the --out directory. Messages are cut to their first line.",
    },
    thresholds: THRESHOLDS,
    samples,
    score,
  };
  writeFileSync(path, JSON.stringify(fixture, null, 2) + "\n", { flag: "wx" });
  console.log(`wrote ${path}`);
  for (const s of score) {
    console.log(`${s.setting}: ${s.gatePassing}/${s.samples} gate-passing; gate ${s.gate}; finding 9 ${s.finding9}; finding 10 ${s.finding10}; precision ${s.precision}; cost $${s.cost.toFixed(4)}`);
    for (const suite of s.suites) console.log(`  ${suite.label}: finding9 ${suite.finding9}, finding10 ${suite.finding10}, control failures ${suite.controlFailures.length}`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
