import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256Hex } from "../src/canonical.ts";
import { agreedRejections, validateReconcilerReply, type ReconcilerDecision } from "../src/code-review-reconcile.ts";
import {
  askSystemOne,
  readSystemOneConfig,
  readSystemOneKey,
  validateSystemOneResponse,
  type ChoiceAnswer,
  type ChoiceQuestion,
  type SystemOneRequest,
  type SystemOneResponse,
} from "../src/systemone.ts";

/**
 * The D6 evaluation (`docs/features/decision-1-d6-evaluation/plan.md`, Task 5).
 * For each of the 26 labelled code-review reconciler cases from crew-chatter run
 * 6, ask Microsoft-Decision-1 which clause of the approved specification the
 * finding asks to go beyond, then score the answers against the labels under the
 * adoption rule the operator confirmed on 2026-10-16.
 *
 *   node scripts/systemone-d6-evaluation.ts --dry-run
 *   node scripts/systemone-d6-evaluation.ts --out <dir> --consent "<who, when, what>"
 *
 * Every input is a committed fixture. A paid run sends the requests in `PLAN`
 * order, one at a time, keeping each answer as `<dir>/<label>.json`. It skips any
 * label already kept there, stops at the first failure, and never retries. When
 * every answer is present it writes `RESULT_PATH` and refuses to overwrite it.
 */

const RECORDED = join(import.meta.dirname, "..", "test", "fixtures", "recorded");
export const RESULT_PATH = join(RECORDED, "systemone-d6-evaluation-crew-chatter-run-6.json");

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(RECORDED, name), "utf8")) as T;
}

interface PinnedSpecPlan {
  spec: string;
  plan: string;
}
export const PINNED = readFixture<PinnedSpecPlan>("crew-chatter-run-6-approved-spec-plan.json");

// ---- the specification's clauses ------------------------------------------------

export interface Clause {
  name: string;
  line: number;
  text: string;
}

/**
 * One clause per non-empty body line, excluding the front matter, the headings,
 * the `## Declared artifacts` section and bullets that are only a bold label.
 * Every bullet and paragraph of the pinned specification is one line.
 */
export function specClauses(spec: string): Clause[] {
  const lines = spec.split(/\r?\n/);
  const clauses: Clause[] = [];
  let index = 0;
  if (lines[0] === "---") {
    index = lines.indexOf("---", 1) + 1;
    if (index === 0) throw new Error("the specification's front matter is not closed");
  }
  let section = "";
  for (; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.trim() === "") continue;
    if (/^#/.test(line)) {
      section = line.trim();
      continue;
    }
    if (section === "## Declared artifacts") continue;
    const text = line.replace(/^\s*- /, "").trim();
    if (/^\*\*[^*]+\*\*$/.test(text)) continue;
    clauses.push({ name: `L${String(index + 1).padStart(3, "0")}`, line: index + 1, text });
  }
  return clauses;
}

// ---- the labelled cases ---------------------------------------------------------

export type Label = "keep" | "reject" | "either";

interface Report {
  reviewer: string;
  severity: string;
  subject: string;
}

export interface Case {
  findingId: number;
  location: string;
  reports: Report[];
  label: Label;
  baselines: string[];
}

interface StoredFinding {
  findingId: number;
  round?: number;
  location: string;
  reports: Report[];
}

interface RecordedCall {
  label: string;
  decisions: unknown[];
  verdict?: { wrongRejects: number[]; missedRejects: number[]; pass: boolean };
}

export interface ReplayFixture {
  provenance: { labels: string; result: string };
  reconcilerSource: string;
  calls: RecordedCall[];
}

export interface Test5Fixture {
  provenance: Record<string, string>;
  sets: Record<"5a" | "5b", { labels: Record<Label, number[]>; findings: StoredFinding[] }>;
  calls: RecordedCall[];
}

export const REPLAY = readFixture<ReplayFixture>("code-review-reconciler-replay-crew-chatter-run-6.json");
export const TEST5 = readFixture<Test5Fixture>("code-review-reconciler-test-5-crew-chatter-run-6.json");
const RUN6 = readFixture<{ codeReviewFindings: StoredFinding[] }>("code-review-crew-chatter-run-6.json");

/**
 * The replay set's labels, from the comment in its `reconcilerSource`:
 * "// Labels (fixed before any call): reject 200; keep 195 197 198 199 201 202"
 * continued on the next comment line with "// 203 204 205; either 196 206 207."
 */
export function replayLabels(source: string): Record<Label, number[]> {
  const match = /\/\/ Labels \(fixed before any call\): ([^\n]*)\n\/\/ ([^\n]*)/.exec(source);
  if (!match) throw new Error("reconcilerSource has no labels comment");
  const text = `${match[1]} ${match[2]}`;
  const ids = (name: Label) => {
    const part = new RegExp(`${name} ([\\d ]+)`).exec(text);
    if (!part) throw new Error(`the labels comment names no ${name} set`);
    return part[1]!.trim().split(/\s+/).map(Number);
  };
  return { reject: ids("reject"), keep: ids("keep"), either: ids("either") };
}

/**
 * Each reject-labelled case's correct clauses. #200: "spec baseline lines 47 and
 * 49" (the replay's `labels`). #905: "baseline \"Sign-out clears the cookie.\""
 * (test 5's `set5b`), which is line 47. Confirmed by the operator 2026-10-16.
 */
export const BASELINES: Readonly<Record<number, string[]>> = { 200: ["L047", "L049"], 905: ["L047"] };

/** Operator amendments to the fixture labels (plan, Operator confirmations): none. */
const LABEL_OVERRIDES: Readonly<Record<number, Label>> = {};

function labelOf(id: number, labels: Record<Label, number[]>): Label {
  const found = (["keep", "reject", "either"] as const).filter((label) => labels[label].includes(id));
  if (found.length !== 1) throw new Error(`finding ${id} carries ${found.length} labels`);
  return LABEL_OVERRIDES[id] ?? found[0]!;
}

function toCase(finding: StoredFinding, labels: Record<Label, number[]>): Case {
  const label = labelOf(finding.findingId, labels);
  const baselines = BASELINES[finding.findingId] ?? [];
  if ((label === "reject") !== baselines.length > 0) throw new Error(`finding ${finding.findingId} baselines do not match its label`);
  return {
    findingId: finding.findingId,
    location: finding.location,
    reports: finding.reports.map(({ reviewer, severity, subject }) => ({ reviewer, severity, subject })),
    label,
    baselines,
  };
}

/** The 26 cases in fixture order: the replay's 13 round-1 findings, then sets 5a and 5b. */
export function loadCases(): Case[] {
  const replay = replayLabels(REPLAY.reconcilerSource);
  const round1 = RUN6.codeReviewFindings.filter((f) => f.round === 1);
  return [
    ...round1.map((f) => toCase(f, replay)),
    ...TEST5.sets["5a"].findings.map((f) => toCase(f, TEST5.sets["5a"].labels)),
    ...TEST5.sets["5b"].findings.map((f) => toCase(f, TEST5.sets["5b"].labels)),
  ];
}

// ---- the request ----------------------------------------------------------------

export const QUESTION_NAME = "baseline";

export const QUESTION_TEXT =
  "The state holds one finding a code reviewer reported against code built from the approved specification, followed by that specification. " +
  "Which clause of the specification states a workable baseline that the finding asks to go beyond, by requesting protection, limits or policy the specification does not require? " +
  "Choose none when the finding reports code that fails a behaviour the specification states, or that breaks in ordinary use: it crashes, loses or corrupts data, returns a wrong result, or lets a user read or change data the specification does not allow. " +
  "When unsure, choose none.";

export const CLAUSE_RUBRIC_PREFIX = "The finding asks to go beyond this clause of the specification: ";
export const NONE_RUBRIC = "No clause: the implementer must fix the reported code.";

export function d6State(spec: string, finding: Pick<Case, "location" | "reports">): string {
  const reports = finding.reports.map((r) => `- reviewer ${r.reviewer}; severity ${r.severity}; subject ${r.subject}`);
  return ["Finding reported by code review:", `- location ${finding.location}`, ...reports, "", "Approved specification:", "", spec].join("\n");
}

export function buildD6Request(
  spec: string,
  finding: Pick<Case, "location" | "reports">
): { request: SystemOneRequest; questionHash: string; stateHash: string } {
  const criteria: Record<string, string> = {};
  for (const clause of specClauses(spec)) criteria[clause.name] = CLAUSE_RUBRIC_PREFIX + clause.text;
  criteria.none = NONE_RUBRIC;
  const question: ChoiceQuestion = { type: "choice", instructions: QUESTION_TEXT, criteria };
  const state = d6State(spec, finding);
  return {
    request: { state, questions: { [QUESTION_NAME]: question } },
    questionHash: sha256Hex(JSON.stringify(question)),
    stateHash: sha256Hex(state),
  };
}

export interface PlanEntry {
  label: string;
  findingId: number;
}

/** The 26 cases once each, then #905 nine more times: the determinism check. */
export function evaluationPlan(cases: Case[]): PlanEntry[] {
  return [
    ...cases.map((c) => ({ label: `case-${c.findingId}`, findingId: c.findingId })),
    ...Array.from({ length: 9 }, (_, i) => ({ label: `repeat-905-${i + 1}`, findingId: 905 })),
  ];
}

// ---- scoring --------------------------------------------------------------------

export const THRESHOLD = 0.8;
export const INFORMATIONAL_THRESHOLDS = [0.5, 0.6, 0.7, 0.9, 0.95];

export const ADOPTION_RULE = [
  "At threshold T = 0.8, D6 passes only when all four hold:",
  "1. Validity: all 35 responses pass validation.",
  "2. Determinism: the 10 answers for #905 choose the same option, and their probabilities for that option differ by at most 0.01.",
  "3. No wrong rejections: none of the 17 keep-labelled findings is withheld.",
  "4. Correct rejections: #200 and #905 are both withheld, each with one of its labelled baseline clauses.",
  "Otherwise D6 fails at this deployment, and the report names each clause that failed.",
].join("\n");

export type Verdict =
  | "correct-withhold"
  | "wrong-clause"
  | "missed"
  | "wrong-rejection"
  | "kept"
  | "either-withheld"
  | "either-kept";

export interface CaseScore {
  findingId: number;
  label: Label;
  chosen: string;
  pChosen: number;
  pNone: number;
  withheld: boolean;
  verdict: Verdict;
}

export interface D6Score {
  threshold: number;
  cases: CaseScore[];
  clauses: { validity: boolean; determinism: boolean; noWrongRejections: boolean; correctRejections: boolean };
  pass: boolean;
  brier: number;
}

const DETERMINISM_SPREAD = 0.01;

/**
 * Score the answers, keyed by plan label. Clauses 3 and 4 and the Brier score
 * read each case's first answer (`case-<id>`); the nine repeats serve clause 2
 * only. A missing answer fails validity and is scored as `none` at probability 1.
 */
export function scoreD6(answers: ReadonlyMap<string, ChoiceAnswer>, cases: Case[], threshold: number): D6Score {
  const plan = evaluationPlan(cases);
  const scored = cases.map((c): CaseScore => {
    const answer = answers.get(`case-${c.findingId}`);
    const chosen = answer?.choice ?? "none";
    const pChosen = answer?.probabilities[chosen] ?? 1;
    const pNone = answer?.probabilities.none ?? 1;
    const withheld = chosen !== "none" && pChosen >= threshold;
    let verdict: Verdict;
    if (c.label === "reject") verdict = !withheld ? "missed" : c.baselines.includes(chosen) ? "correct-withhold" : "wrong-clause";
    else if (c.label === "keep") verdict = withheld ? "wrong-rejection" : "kept";
    else verdict = withheld ? "either-withheld" : "either-kept";
    return { findingId: c.findingId, label: c.label, chosen, pChosen, pNone, withheld, verdict };
  });
  const repeats = plan.filter((entry) => entry.findingId === 905).map((entry) => answers.get(entry.label));
  const first = repeats[0];
  const determinism =
    first !== undefined &&
    repeats.every((a) => a !== undefined && a.choice === first.choice) &&
    (() => {
      const ps = repeats.map((a) => a!.probabilities[first.choice]!);
      return Math.max(...ps) - Math.min(...ps) <= DETERMINISM_SPREAD;
    })();
  const labelled = scored.filter((s) => s.label !== "either");
  const brier =
    labelled.reduce((sum, s) => sum + (1 - s.pNone - (s.label === "reject" ? 1 : 0)) ** 2, 0) / labelled.length;
  const clauses = {
    validity: plan.every((entry) => answers.has(entry.label)),
    determinism,
    noWrongRejections: !scored.some((s) => s.verdict === "wrong-rejection"),
    correctRejections: scored.filter((s) => s.label === "reject").every((s) => s.verdict === "correct-withhold"),
  };
  return { threshold, cases: scored, clauses, pass: Object.values(clauses).every(Boolean), brier };
}

// ---- Haiku's recorded calls -----------------------------------------------------

export interface HaikuCall {
  label: string;
  wrongRejections: number[];
  missedRejections: number[];
  eitherRejected: number[];
}

export interface HaikuBaseline {
  calls: HaikuCall[];
  pairs: Array<{ set: string; pair: [string, string]; rejected: number[] }>;
}

/**
 * Haiku 5.5's 30 recorded reconciler calls, judged by the built validator over
 * the pinned specification and plan: a rejection counts only when it is valid.
 * The inputs differ from D6's: Haiku also had the plan, the full diff and the
 * checkout.
 */
export function haikuBaseline(cases: Case[]): HaikuBaseline {
  const sets: Array<{ set: string; calls: RecordedCall[]; ids: number[] }> = [
    { set: "replay", calls: REPLAY.calls, ids: RUN6.codeReviewFindings.filter((f) => f.round === 1).map((f) => f.findingId) },
    { set: "5a", calls: TEST5.calls.filter((c) => c.label.startsWith("5a-")), ids: TEST5.sets["5a"].findings.map((f) => f.findingId) },
    { set: "5b", calls: TEST5.calls.filter((c) => c.label.startsWith("5b-")), ids: TEST5.sets["5b"].findings.map((f) => f.findingId) },
  ];
  const labelOfId = new Map(cases.map((c) => [c.findingId, c.label]));
  const calls: HaikuCall[] = [];
  const pairs: HaikuBaseline["pairs"] = [];
  for (const { set, calls: recorded, ids } of sets) {
    const decided = recorded.map((call) => ({
      label: call.label,
      decisions: validateReconcilerReply(
        { decisions: call.decisions },
        { findingIds: ids, spec: PINNED.spec, plan: PINNED.plan, specLocation: "docs/features/crew-chatter-foundation/spec.md" }
      ).decisions,
    }));
    for (const { label, decisions } of decided) {
      const rejected = ids.filter((id) => decisions.get(id)?.disposition === "reject");
      calls.push({
        label,
        wrongRejections: rejected.filter((id) => labelOfId.get(id) === "keep"),
        missedRejections: ids.filter((id) => labelOfId.get(id) === "reject" && !rejected.includes(id)),
        eitherRejected: rejected.filter((id) => labelOfId.get(id) === "either"),
      });
    }
    for (let i = 0; i + 1 < decided.length; i += 2) {
      const pair: Array<ReadonlyMap<number, ReconcilerDecision>> = [decided[i]!.decisions, decided[i + 1]!.decisions];
      pairs.push({ set, pair: [decided[i]!.label, decided[i + 1]!.label], rejected: agreedRejections(pair, 2) });
    }
  }
  return { calls, pairs };
}

// ---- the run --------------------------------------------------------------------

interface Kept {
  label: string;
  findingId: number;
  status: number;
  at: string;
  requestIds: Record<string, string>;
  response: SystemOneResponse;
}

function argument(args: string[], name: string): string | null {
  const at = args.indexOf(name);
  return at === -1 ? null : (args[at + 1] ?? null);
}

async function main(args: string[]): Promise<number> {
  const dryRun = args.includes("--dry-run");
  const out = argument(args, "--out");
  const consent = argument(args, "--consent");
  if (dryRun === (out !== null)) {
    console.error("usage: --dry-run | --out <dir> --consent <text>");
    return 2;
  }
  const config = readSystemOneConfig(process.env);
  if (!config.ok) {
    console.error(config.reason);
    return 2;
  }
  console.log(`endpoint ${config.value.endpoint}`);
  console.log(`deployment ${config.value.deployment} (${config.value.deploymentType})`);

  const cases = loadCases();
  const byId = new Map(cases.map((c) => [c.findingId, c]));
  const plan = evaluationPlan(cases);
  const built = new Map(plan.map((entry) => [entry.label, buildD6Request(PINNED.spec, byId.get(entry.findingId)!)]));

  if (dryRun) {
    const sizes = [...built.values()].map((b) => JSON.stringify(b.request).length);
    console.log(`requests ${plan.length}; clauses ${specClauses(PINNED.spec).length}; largest body ${Math.max(...sizes)} characters`);
    console.log("dry run: nothing sent");
    return 0;
  }
  if (consent === null || consent.trim() === "") {
    console.error("--consent is required for a paid run");
    return 2;
  }
  const key = readSystemOneKey(process.env);
  if (!key.ok) {
    console.error(key.reason);
    return 2;
  }
  if (existsSync(RESULT_PATH)) {
    console.error(`refusing to overwrite ${RESULT_PATH}`);
    return 2;
  }
  mkdirSync(out!, { recursive: true });
  const kept: Kept[] = [];
  for (const entry of plan) {
    const file = join(out!, `${entry.label}.json`);
    if (existsSync(file)) {
      kept.push(JSON.parse(readFileSync(file, "utf8")) as Kept);
      continue;
    }
    const at = new Date().toISOString();
    const outcome = await askSystemOne(config.value, key.value, built.get(entry.label)!.request);
    if (!outcome.ok) {
      writeFileSync(join(out!, `${entry.label}.failed.json`), JSON.stringify({ at, ...outcome }, null, 2) + "\n");
      console.error(`${entry.label}: stopped, status ${outcome.status ?? "none"}: ${outcome.reason}`);
      return 1;
    }
    const record: Kept = { label: entry.label, findingId: entry.findingId, status: outcome.status, at, requestIds: outcome.requestIds, response: outcome.response };
    writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
    kept.push(record);
    const answer = outcome.response.answers[QUESTION_NAME]!;
    console.log(`${entry.label}: ${answer.choice} ${answer.probabilities[answer.choice]!.toFixed(4)}, ${outcome.response.usage.input_tokens} tokens`);
  }

  for (const k of kept) {
    const problems = validateSystemOneResponse(k.response, built.get(k.label)!.request);
    if (problems.length > 0) throw new Error(`${k.label} no longer validates: ${problems.join("; ")}`);
  }
  const models = [...new Set(kept.map((k) => k.response.model))];
  const answers = new Map(kept.map((k) => [k.label, k.response.answers[QUESTION_NAME]!]));
  const score = scoreD6(answers, cases, THRESHOLD);
  const inputTokens = kept.reduce((sum, k) => sum + k.response.usage.input_tokens, 0);
  const fixture = {
    provenance: {
      what: "The D6 evaluation of Microsoft-Decision-1 (docs/features/decision-1-d6-evaluation/plan.md, Task 6): one choice question per request asking which clause of crew-chatter run 6's approved specification a code-review finding asks to go beyond, scored against the 26 labelled code-review reconciler cases.",
      consent,
      endpoint: config.value.endpoint,
      deployment: config.value.deployment,
      deploymentType: config.value.deploymentType,
      modelsReported: models,
      versionReported: "none: the response's model field names the model without a version",
      captured: new Date().toISOString().slice(0, 10),
      requests: kept.length,
      inputTokens,
      cost: `${inputTokens} input tokens at the published $0.042 per million: $${((inputTokens * 0.042) / 1e6).toFixed(6)}; output is free.`,
      inputs: "test/fixtures/recorded/crew-chatter-run-6-approved-spec-plan.json, code-review-crew-chatter-run-6.json, code-review-reconciler-replay-crew-chatter-run-6.json, code-review-reconciler-test-5-crew-chatter-run-6.json",
      dropped: "Request bodies (rebuilt from the committed inputs by buildD6Request; each request's questionHash and stateHash prove it). The API key. Every response header except those whose name contains request-id.",
    },
    adoptionRule: ADOPTION_RULE,
    labelsConfirmed: "2026-10-16",
    requests: plan.map((entry) => ({
      label: entry.label,
      findingId: entry.findingId,
      questionHash: built.get(entry.label)!.questionHash,
      stateHash: built.get(entry.label)!.stateHash,
    })),
    responses: kept.map(({ label, status, at, requestIds, response }) => ({ label, status, at, requestIds, body: response })),
    score: {
      verdict: score,
      informational: INFORMATIONAL_THRESHOLDS.map((t) => scoreD6(answers, cases, t)),
    },
    haiku: haikuBaseline(cases),
  };
  writeFileSync(RESULT_PATH, JSON.stringify(fixture, null, 2) + "\n", { flag: "wx" });
  console.log(`wrote ${RESULT_PATH}`);
  console.log(`D6 ${score.pass ? "passes" : "fails"} at T = ${THRESHOLD}: ${JSON.stringify(score.clauses)}; Brier ${score.brier.toFixed(4)}`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
