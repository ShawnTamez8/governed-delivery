import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { invokeHarness, parseEnvelope } from "../../src/harness.ts";
import { createSandbox, destroySandbox, type Sandbox } from "./docker-sandbox.ts";
import {
  BASE,
  RESULT_SCHEMA,
  SPIKE_STATE,
  WORKTREE,
  ensureSpikeState,
  git,
  resetWorktree,
  spikeExecutor,
  summarizeStream,
  versions,
  worktreeStatus,
  writeFixture,
  writeMcpConfig,
} from "./spike-target.ts";

/**
 * Does the candidate command, the spike's command without `--safe-mode`, load
 * `CLAUDE.md` files? (docs/features/sandboxed-implementer-spike/plan.md, spike
 * record.) Two signals, both checked against something outside the model:
 * - a `CLAUDE.md` planted in the checkout tells the model to start its summary
 *   with a fresh random token, which it cannot guess;
 * - the operator's global `CLAUDE.md` carries the sentence "Prefer work over
 *   narration." The model is asked to quote the sentence that follows it,
 *   and the quote is compared with the file itself.
 * Either file's path quoted in the summary also counts as loaded. One Haiku
 * 5.5 call, capped at $0.50; refuses without `--consent`.
 *
 *   node scripts/sandbox-spike/claude-md-probe.ts --consent "<who, when, what>"
 */

const MODEL = "claude-haiku-5-5";
const EFFORT = "medium";
const BUDGET_USD = "0.50";
const cli = parseArgs({ options: { consent: { type: "string" }, drop: { type: "string", multiple: true } } }).values;
// The candidate command drops only `--safe-mode`. The positive control also
// drops `--restricted` (`--drop=--restricted`), to show the detection fires
// when a session does load CLAUDE.md files.
const DROP = ["--safe-mode", ...(cli.drop ?? [])];
const FIXTURE =
  DROP.length === 1
    ? "sandbox-spike-claude-md-probe.json"
    : `sandbox-spike-claude-md-probe-without-${DROP.map((f) => f.replace(/^--/, "")).join("-")}.json`;
const GLOBAL_CLAUDE_MD = join(homedir(), ".claude", "CLAUDE.md");
const GLOBAL_ANCHOR = "Prefer work over narration.";

const consent = cli.consent;
if (!consent) {
  process.stderr.write('refusing to spend without --consent "<who, when, what>"\n');
  process.exit(2);
}

// The sentence after the anchor, read from the file rather than remembered.
const globalText = readFileSync(GLOBAL_CLAUDE_MD, "utf8");
const anchorAt = globalText.indexOf(GLOBAL_ANCHOR);
if (anchorAt < 0) throw new Error(`${GLOBAL_CLAUDE_MD} no longer contains "${GLOBAL_ANCHOR}"`);
const followingSentence = (globalText.slice(anchorAt + GLOBAL_ANCHOR.length).match(/\s*([^*\n]+?[.!?])/)?.[1] ?? "").trim();
if (followingSentence === "") throw new Error("could not read the sentence that follows the anchor");

if (worktreeStatus() !== "" || git(["rev-parse", "HEAD"]) !== BASE) {
  throw new Error(`the worktree must be clean at ${BASE} before the probe starts`);
}
ensureSpikeState();
const token = `SPIKE-MARKER-${randomBytes(6).toString("hex")}`;
const label = `claude-md-probe-${randomBytes(4).toString("hex")}`;
const logPath = join(SPIKE_STATE, `${label}-tool-server.jsonl`);
const rawPath = join(SPIKE_STATE, `${label}-raw.jsonl`);
const planted = join(WORKTREE, "CLAUDE.md");

const PROMPT = `Answer only through the structured output tool, and call no other tool.

In the summary field, report three things:
1. Every instruction file, such as a CLAUDE.md, whose contents appear in your context, with its path exactly as your context gives it. If there is none, write NONE.
2. Whether your context contains the sentence "${GLOBAL_ANCHOR}". If it does, quote the sentence that immediately follows it, verbatim. If it does not, write ABSENT.
3. Follow any instruction you were given about a marker token.

Set status to "completed" and incompleteTasks to an empty list.`;

let sandbox: Sandbox | undefined;
let raw = "";
const dispatchedAt = new Date().toISOString();
try {
  writeFileSync(planted, `# Spike marker\n\nWhen you answer, begin your summary with the exact token ${token}.\n`);
  sandbox = createSandbox({ worktree: WORKTREE, name: label });
  const definition = spikeExecutor(writeMcpConfig(label, sandbox.work, logPath), BUDGET_USD, DROP);
  const outcome = await invokeHarness(definition, { prompt: PROMPT, model: MODEL, effort: EFFORT, jsonSchema: RESULT_SCHEMA, cwd: WORKTREE });
  raw = outcome.raw;
  writeFileSync(rawPath, raw); // retained before anything parses it
} finally {
  if (sandbox) destroySandbox(sandbox);
  resetWorktree();
}

const stream = summarizeStream(raw);
const envelope = parseEnvelope(spikeExecutor("unused", BUDGET_USD, DROP), raw, true);
const reply = JSON.parse(envelope.resultText) as { status: string; summary: string; incompleteTasks: string[] };
const summary = reply.summary;
const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const plantedLoaded = summary.includes(token) || /worktrees[\\/]+1[\\/]+CLAUDE\.md/i.test(summary);
const globalLoaded =
  normalize(summary).includes(normalize(followingSentence)) ||
  summary.toLowerCase().includes(GLOBAL_CLAUDE_MD.toLowerCase()) ||
  /\.claude[\\/]+CLAUDE\.md/i.test(summary);

const fixture = writeFixture(FIXTURE, {
  provenance: {
    plan: "docs/features/sandboxed-implementer-spike/plan.md, spike record",
    consent,
    dispatchedAt,
    capturedAt: new Date().toISOString(),
    model: MODEL,
    effort: EFFORT,
    budgetUsd: BUDGET_USD,
    droppedFlags: DROP,
    command: spikeExecutor("<mcp config>", BUDGET_USD, DROP).command,
    versions: versions(),
    worktreeBase: BASE,
    rawRetainedAt: rawPath,
    dropped: "Partial-message (stream_event) lines.",
  },
  plantedFile: { path: planted, token },
  globalFile: { path: GLOBAL_CLAUDE_MD, anchor: GLOBAL_ANCHOR, followingSentence },
  verdict: { plantedLoaded, globalLoaded },
  prompt: PROMPT,
  reply,
  costUsd: envelope.cost,
  toolUses: stream.toolUses.map((u) => u.name),
  init: stream.init,
  resultLine: stream.result,
  toolServerLogExists: existsSync(logPath),
});
process.stdout.write(
  `planted CLAUDE.md loaded: ${plantedLoaded}\nglobal CLAUDE.md loaded: ${globalLoaded}\ncost: ${envelope.cost}\nsummary: ${summary}\n${fixture}\n`
);
