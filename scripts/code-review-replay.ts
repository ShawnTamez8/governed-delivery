import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { CODE_REVIEW_REPLY_SCHEMA, validateAgentResult } from "../src/agent-result.ts";
import type { AgentDefinition } from "../src/agents.ts";
import { CODE_REVIEWER_CORRECTNESS } from "../src/agents/code-reviewer-correctness.ts";
import { CODE_REVIEWER_SECURITY } from "../src/agents/code-reviewer-security.ts";
import { CODE_REVIEWER_STATE_INTEGRITY } from "../src/agents/code-reviewer-state-integrity.ts";
import {
  validateCodeReviewReports,
  validateCodeReviewReproductions,
  type CodeReviewReproduction,
  type ReviewerReproduction,
} from "../src/code-review.ts";
import { confirmReproductions, type PendingReproduction } from "../src/code-review-stage.ts";
import { dockerReady, ensureImage } from "../src/container.ts";
import { CLAUDE_CODE } from "../src/executor.ts";
import { invokeHarness, parseEnvelope } from "../src/harness.ts";
import { seededSandbox, VERIFY_COMMAND_TIMEOUT_SECONDS, VERIFY_RETENTION_MAX_BYTES } from "../src/policy.ts";
import { buildCodeReviewPrompt } from "../src/prompts.ts";
import { upstreamPrefixFor, validateReviewerReports, type ReviewerReport } from "../src/reconciliation.ts";
import { controlTree, type Benchmark } from "./test-author-evaluation.ts";

/**
 * The code-review replay with reproductions (2026-10-23). It runs the seeded
 * three-reviewer panel (Haiku 5.5, `medium`) against each recorded web-calculator
 * commit that carries a known defect: b5d42890 (finding 9) and bc57eb74
 * (finding 10). Each prompt comes from the stage's own builder, the replies go
 * through the stage's own validators, and every validated reproduction runs
 * through the stage's own `confirmReproductions`. Each reproduction runs first at
 * the reviewed commit and then at the evaluation's control tree, which carries
 * neither defect. It spends money: it refuses to start without `--yes`. It stops
 * before a panel once the ledger reaches `--ceiling`, and a rerun with the same
 * `--out` skips the panels already in the ledger.
 *
 *   node scripts/code-review-replay.ts --out <dir> --repeats <n> --ceiling <usd> --yes
 *
 * The 2026-10-23 run is recorded in
 * test/fixtures/recorded/code-review-replay-web-calculator-reproductions-2026-10-23.json.
 */

const MODEL = "claude-haiku-5-5";
const EFFORT = "medium";
const PANEL: AgentDefinition[] = [CODE_REVIEWER_CORRECTNESS, CODE_REVIEWER_SECURITY, CODE_REVIEWER_STATE_INTEGRITY];
const SEVERITIES = ["low", "medium", "high", "critical"];
const SOURCE = join("test", "fixtures", "recorded", "code-review-web-calculator-remediation-regression.json");
const TREES: Record<string, string> = {
  b5d428908cabbaece955a816a72ba0a477d3422e: "finding 9: Enter on the focused theme control runs equals (round 1, state-integrity, medium)",
  bc57eb7482b4737fd1fe9e110e50652c630a0aa7: "finding 10: Enter after a click on an operator re-runs that operator (round 2, correctness, high)",
};
// The driver's scratch baseline: all the run's patch base held besides its documents.
const BASELINE: Record<string, string> = {
  ".gitignore": ".governance/\n",
  "governed.yaml": 'verify:\n  - name: node-version\n    command: ["node", "--version"]\n  - name: npm-version\n    command: ["npm", "--version"]\n',
};

interface ReviewerRecord {
  reviewer: string;
  rawFile: string;
  exitCode: number | null;
  durationMs: number;
  costUsd?: number | null;
  effectiveModel?: string | null;
  status?: "valid" | "output_invalid";
  reason?: string;
  findings?: ReviewerReport[];
  rawReproductionCount?: number;
  reproductions?: ReviewerReproduction[];
  reproductionRefusal?: string | null;
}
interface Ledger {
  spentUsd: number;
  calls: { label: string; tree: string; defect: string; reviewedCommit: string; changedPaths: string[]; panel: ReviewerRecord[] }[];
  confirmations: { label: string; tree: string; where: "reviewed" | "control"; root: string; results: CodeReviewReproduction[] }[];
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=replay", "-c", "user.email=replay@buildworks.invalid", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} in ${cwd} failed: ${r.stderr}`);
  return r.stdout;
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/** A fresh repository with the baseline commit and `files` committed on top. */
function repository(files: Record<string, string>): { root: string; base: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), "bw-cr-replay-"));
  git(root, "init", "-q");
  writeTree(root, BASELINE);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "baseline");
  const base = git(root, "rev-parse", "HEAD").trim();
  writeTree(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "reviewed tree");
  return { root, base, head: git(root, "rev-parse", "HEAD").trim() };
}

/** One reviewer's dispatch, validated as `runCodeReviewStage` validates it. */
async function review(
  out: string,
  label: string,
  reviewer: AgentDefinition,
  prompt: string,
  cwd: string,
  changedPaths: string[]
): Promise<ReviewerRecord> {
  const outcome = await invokeHarness(CLAUDE_CODE, { prompt, model: MODEL, effort: EFFORT, jsonSchema: CODE_REVIEW_REPLY_SCHEMA, cwd });
  const rawFile = join(out, `${label}-${reviewer.id}.jsonl`);
  writeFileSync(rawFile, outcome.raw); // retained before anything parses it
  const record: ReviewerRecord = { reviewer: reviewer.id, rawFile, exitCode: outcome.exitCode, durationMs: outcome.durationMs };
  try {
    const envelope = parseEnvelope(CLAUDE_CODE, outcome.raw, true);
    record.costUsd = envelope.cost;
    record.effectiveModel = envelope.effectiveModel;
    const result = validateAgentResult(reviewer.id, JSON.parse(envelope.resultText));
    if (!result.ok) throw new Error(`result refused: ${result.reason}`);
    const content = result.value.proposedContentChanges as { findings?: unknown; reproductions?: unknown } | undefined;
    const reports = validateReviewerReports(content?.findings, { agentId: reviewer.id, upstreamPrefix: upstreamPrefixFor("plan") });
    if (!reports.ok) throw new Error(`result refused: ${reports.reason}`);
    const refusal = validateCodeReviewReports(reports.value, changedPaths);
    if (refusal !== null) throw new Error(`result refused: ${refusal}`);
    const unfrozen = reports.value.find((report) => !SEVERITIES.includes(report.severity));
    if (unfrozen !== undefined) throw new Error(`result refused: severity ${unfrozen.severity} is not in the seeded severities`);
    const reproductions = validateCodeReviewReproductions(content?.reproductions, reports.value);
    record.status = "valid";
    record.findings = reports.value;
    record.rawReproductionCount = Array.isArray(content?.reproductions) ? content.reproductions.length : 0;
    record.reproductions = reproductions.ok ? reproductions.value : [];
    record.reproductionRefusal = reproductions.ok ? null : reproductions.reason;
  } catch (err) {
    record.status = "output_invalid";
    record.reason = (err as Error).message;
  }
  return record;
}

async function main(): Promise<void> {
  const args = parseArgs({ options: { out: { type: "string" }, repeats: { type: "string" }, ceiling: { type: "string" }, yes: { type: "boolean" } } }).values;
  if (!args.yes || !args.out || !args.repeats || !args.ceiling) {
    process.stderr.write("usage: node scripts/code-review-replay.ts --out <dir> --repeats <n> --ceiling <usd> --yes (spends money)\n");
    process.exit(2);
  }
  const out = args.out;
  const repeats = Number(args.repeats);
  const ceiling = Number(args.ceiling);
  const benchmark = JSON.parse(readFileSync(SOURCE, "utf8")) as Benchmark;
  const ready = dockerReady(["docker"]);
  if (!ready.ok) throw new Error(`no Docker engine answered: ${ready.reason}`);
  const image = ensureImage(["docker"]);
  mkdirSync(out, { recursive: true });
  const ledgerPath = join(out, "ledger.json");
  const ledger: Ledger = existsSync(ledgerPath) ? (JSON.parse(readFileSync(ledgerPath, "utf8")) as Ledger) : { spentUsd: 0, calls: [], confirmations: [] };
  const save = () => writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  const control = controlTree(benchmark);

  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    for (const [tree, defect] of Object.entries(TREES)) {
      const label = `${tree.slice(0, 8)}-r${repeat}`;
      if (ledger.calls.some((call) => call.label === label)) continue;
      if (ledger.spentUsd >= ceiling) {
        process.stdout.write(`ceiling $${ceiling} reached at $${ledger.spentUsd.toFixed(5)}; stopping before ${label}\n`);
        return;
      }
      const files = benchmark.trees[tree]!;
      const reviewed = repository(files);
      const changedPaths = git(reviewed.root, "diff", "--name-only", reviewed.base, reviewed.head).split("\n").filter((path) => path !== "");
      const diff = git(reviewed.root, "diff", "--no-color", reviewed.base, reviewed.head);
      // The panel launches concurrently, as the stage's does.
      const panel = await Promise.all(
        PANEL.map((reviewer) =>
          review(out, label, reviewer, buildCodeReviewPrompt(
            reviewer, benchmark.approvedDocuments.specFull, benchmark.approvedDocuments.planFull, changedPaths, diff, reviewed.head, null, []
          ), reviewed.root, changedPaths)
        )
      );
      const spent = panel.reduce((sum, record) => sum + (record.costUsd ?? 0), 0);
      ledger.spentUsd += spent;
      ledger.calls.push({ label, tree, defect, reviewedCommit: reviewed.head, changedPaths, panel });
      save();

      // The replay records no findings, so each pending reproduction gets a synthetic
      // finding id: 100 times the reviewer's panel position plus the finding's index.
      const pending: PendingReproduction[] = panel.flatMap((record, position) =>
        (record.reproductions ?? []).map((reproduction) => ({
          findingId: 100 * (position + 1) + record.findings!.findIndex((f) => f.intentKey === reproduction.intentKey && f.location === reproduction.location),
          reviewer: record.reviewer,
          reproduction,
        }))
      );
      if (pending.length > 0) {
        for (const [where, target] of [["reviewed", files], ["control", control]] as const) {
          const confirmed = repository(target);
          const results = await confirmReproductions({
            rootDir: confirmed.root,
            runId: 1,
            round: 1,
            commit: confirmed.head,
            pending,
            sandbox: seededSandbox(image.imageId),
            timeoutSeconds: VERIFY_COMMAND_TIMEOUT_SECONDS,
            retentionMaxBytes: VERIFY_RETENTION_MAX_BYTES,
            audit: () => undefined,
          });
          ledger.confirmations.push({ label, tree, where, root: confirmed.root, results });
          save();
        }
      }
      process.stdout.write(
        `${label}: $${spent.toFixed(5)} (total $${ledger.spentUsd.toFixed(5)}); ` +
          panel
            .map((record) => `${record.reviewer.replace("code-reviewer-", "")}=${record.status} f${record.findings?.length ?? "-"} repro${record.reproductions?.length ?? "-"}${record.reproductionRefusal ? " (refused)" : ""}`)
            .join(", ") +
          "\n"
      );
    }
  }
  process.stdout.write(`done: $${ledger.spentUsd.toFixed(5)}; ${ledgerPath}\n`);
}

await main();
