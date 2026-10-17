import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256Hex } from "../src/canonical.ts";
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
import { NARRATION_QUESTION_NAME, narrationQuestion } from "../src/narration-check.ts";
import { groundingQuestion, loadGroundingCases, loadNarrationCases } from "./systemone-format-cases.ts";

/**
 * The format-check evaluation (`docs/features/decision-1-format-checks/plan.md`,
 * Task 4). Every labelled grounding and narration case is asked once, and one
 * recorded failure of each check nine more times, scored under the adoption
 * rule the operator chose on 2026-10-17.
 *
 *   node scripts/systemone-format-evaluation.ts --dry-run
 *   node scripts/systemone-format-evaluation.ts --out <dir> --consent "<who, when, what>"
 *
 * As in the D6 script: one request at a time, each answer kept as
 * `<dir>/<label>.json`, kept answers skipped on a rerun, a stop at the first
 * failure with no retry, and a result fixture that is never overwritten.
 */

const RECORDED = join(import.meta.dirname, "..", "test", "fixtures", "recorded");
export const RESULT_PATH = join(RECORDED, "systemone-format-checks-evaluation.json");

export type CheckName = "grounding" | typeof NARRATION_QUESTION_NAME;

export interface CheckCase {
  id: string;
  state: string;
  question: ChoiceQuestion;
  label: string;
}

export interface Check {
  name: CheckName;
  /** The option that reports the failure the check exists to catch. */
  positive: string;
  negative: string;
  /** The recorded failure asked ten times for the determinism clause. */
  repeated: string;
  cases: CheckCase[];
}

export function loadChecks(): Check[] {
  return [
    {
      name: "grounding",
      positive: "does-not-support",
      negative: "supports",
      repeated: "R-906-1",
      cases: loadGroundingCases().map((c) => ({ id: c.id, state: c.state, question: groundingQuestion(c.kind), label: c.label })),
    },
    {
      name: NARRATION_QUESTION_NAME,
      positive: "contains-remark",
      negative: "criterion",
      repeated: "N-wc-numbering-L025",
      cases: loadNarrationCases().map((c) => ({ id: c.id, state: c.state, question: narrationQuestion(), label: c.label })),
    },
  ];
}

export const REPEATS = 9;

export interface PlanEntry {
  label: string;
  check: CheckName;
  caseId: string;
}

/** Every case once, check by check, then each check's repeated case nine more times. */
export function evaluationPlan(checks: Check[]): PlanEntry[] {
  return [
    ...checks.flatMap((check) => check.cases.map((c) => ({ label: `${check.name}-${c.id}`, check: check.name, caseId: c.id }))),
    ...checks.flatMap((check) =>
      Array.from({ length: REPEATS }, (_, i) => ({ label: `repeat-${check.repeated}-${i + 1}`, check: check.name, caseId: check.repeated }))
    ),
  ];
}

/** The hashes are of what the request carries, so a changed builder no longer matches a recorded request. */
export function buildRequest(check: Check, c: CheckCase): { request: SystemOneRequest; questionHash: string; stateHash: string } {
  const request: SystemOneRequest = { state: c.state, questions: { [check.name]: c.question } };
  return {
    request,
    questionHash: sha256Hex(JSON.stringify(request.questions[check.name])),
    stateHash: sha256Hex(request.state),
  };
}

// ---- scoring --------------------------------------------------------------------

export const THRESHOLD = 0.8;
export const INFORMATIONAL_THRESHOLDS = [0.5, 0.6, 0.7, 0.9, 0.95];
const DETERMINISM_SPREAD = 0.01;

export const ADOPTION_RULE = [
  "Each check is judged on its own. At threshold T = 0.8 a case is flagged when the check's failure option is chosen with probability at least T. A check passes only when all four hold:",
  "1. Validity: every one of its responses passes validation.",
  "2. Determinism: the 10 answers for its repeated recorded failure (grounding R-906-1, narration N-wc-numbering-L025) choose the same option, and their probabilities for that option differ by at most 0.01.",
  "3. No false alarms: no case labelled correct (supports, criterion) is flagged.",
  "4. Catches: every case labelled as the failure (does-not-support, contains-remark) is flagged.",
  "Cases labelled either are reported and not judged. Otherwise the check fails at this deployment, and the report names each clause that failed.",
].join("\n");

export interface CaseScore {
  id: string;
  label: string;
  chosen: string;
  pChosen: number;
  pPositive: number;
  flagged: boolean;
  verdict: "caught" | "missed" | "false-alarm" | "passed" | "either-flagged" | "either-passed";
}

export interface CheckScore {
  check: CheckName;
  threshold: number;
  cases: CaseScore[];
  repeats: Array<{ choice: string; pChoice: number }>;
  clauses: { validity: boolean; determinism: boolean; noFalseAlarms: boolean; catches: boolean };
  pass: boolean;
  brier: number;
}

/**
 * Score one check's answers, keyed by plan label. Clauses 3 and 4 and the Brier
 * score read each case's first answer; the repeats serve clause 2 only. A missing
 * answer fails validity and is scored as the negative option at probability 1.
 */
export function scoreCheck(answers: ReadonlyMap<string, ChoiceAnswer>, check: Check, threshold: number): CheckScore {
  const plan = evaluationPlan([check]);
  const scored = check.cases.map((c): CaseScore => {
    const answer = answers.get(`${check.name}-${c.id}`);
    const chosen = answer?.choice ?? check.negative;
    const pChosen = answer?.probabilities[chosen] ?? 1;
    const pPositive = answer?.probabilities[check.positive] ?? 0;
    const flagged = chosen === check.positive && pChosen >= threshold;
    let verdict: CaseScore["verdict"];
    if (c.label === check.positive) verdict = flagged ? "caught" : "missed";
    else if (c.label === check.negative) verdict = flagged ? "false-alarm" : "passed";
    else verdict = flagged ? "either-flagged" : "either-passed";
    return { id: c.id, label: c.label, chosen, pChosen, pPositive, flagged, verdict };
  });
  const repeatAnswers = plan.filter((entry) => entry.caseId === check.repeated).map((entry) => answers.get(entry.label));
  const first = repeatAnswers[0];
  const determinism =
    first !== undefined &&
    repeatAnswers.every((a) => a !== undefined && a.choice === first.choice) &&
    (() => {
      const ps = repeatAnswers.map((a) => a!.probabilities[first.choice]!);
      return Math.max(...ps) - Math.min(...ps) <= DETERMINISM_SPREAD;
    })();
  const labelled = scored.filter((s) => s.label !== "either");
  const brier = labelled.reduce((sum, s) => sum + (s.pPositive - (s.label === check.positive ? 1 : 0)) ** 2, 0) / labelled.length;
  const clauses = {
    validity: plan.every((entry) => answers.has(entry.label)),
    determinism,
    noFalseAlarms: !scored.some((s) => s.verdict === "false-alarm"),
    catches: scored.filter((s) => s.label === check.positive).every((s) => s.verdict === "caught"),
  };
  return {
    check: check.name,
    threshold,
    cases: scored,
    repeats: repeatAnswers.filter((a) => a !== undefined).map((a) => ({ choice: a!.choice, pChoice: a!.probabilities[a!.choice]! })),
    clauses,
    pass: Object.values(clauses).every(Boolean),
    brier,
  };
}

// ---- the run --------------------------------------------------------------------

interface Kept {
  label: string;
  check: CheckName;
  caseId: string;
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

  const checks = loadChecks();
  const byName = new Map(checks.map((check) => [check.name, check]));
  const plan = evaluationPlan(checks);
  const built = new Map(
    plan.map((entry) => {
      const check = byName.get(entry.check)!;
      return [entry.label, buildRequest(check, check.cases.find((c) => c.id === entry.caseId)!)];
    })
  );

  if (dryRun) {
    const sizes = [...built.values()].map((b) => JSON.stringify(b.request).length);
    const total = sizes.reduce((sum, s) => sum + s, 0);
    console.log(`requests ${plan.length}; largest body ${Math.max(...sizes)} characters; all bodies ${total} characters`);
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
    const record: Kept = { ...entry, status: outcome.status, at, requestIds: outcome.requestIds, response: outcome.response };
    writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
    kept.push(record);
    const answer = outcome.response.answers[entry.check]!;
    console.log(`${entry.label}: ${answer.choice} ${answer.probabilities[answer.choice]!.toFixed(4)}, ${outcome.response.usage.input_tokens} tokens`);
  }

  for (const k of kept) {
    const problems = validateSystemOneResponse(k.response, built.get(k.label)!.request);
    if (problems.length > 0) throw new Error(`${k.label} no longer validates: ${problems.join("; ")}`);
  }
  const models = [...new Set(kept.map((k) => k.response.model))];
  const answers = new Map(kept.map((k) => [k.label, k.response.answers[k.check]!]));
  const inputTokens = kept.reduce((sum, k) => sum + k.response.usage.input_tokens, 0);
  const fixture = {
    provenance: {
      what: "The format-check evaluation of Microsoft-Decision-1 (docs/features/decision-1-format-checks/plan.md, Task 4): one choice question per request, the grounding check over 23 recorded excerpt citations and the narration check over 131 recorded Acceptance criteria entries, scored against the labels the operator confirmed.",
      consent,
      endpoint: config.value.endpoint,
      deployment: config.value.deployment,
      deploymentType: config.value.deploymentType,
      modelsReported: models,
      captured: new Date().toISOString().slice(0, 10),
      requests: kept.length,
      inputTokens,
      cost: `${inputTokens} input tokens at the published $0.042 per million: $${((inputTokens * 0.042) / 1e6).toFixed(6)}; output is free.`,
      inputs: "scripts/systemone-format-cases.ts over the fixtures it names",
      dropped: "Request bodies (rebuilt from the committed inputs by buildRequest; each request's questionHash and stateHash prove it). The API key. Every response header except those whose name contains request-id.",
    },
    adoptionRule: ADOPTION_RULE,
    labelsConfirmed: "2026-10-17",
    requests: plan.map((entry) => ({ ...entry, questionHash: built.get(entry.label)!.questionHash, stateHash: built.get(entry.label)!.stateHash })),
    responses: kept.map(({ label, status, at, requestIds, response }) => ({ label, status, at, requestIds, body: response })),
    score: checks.map((check) => ({
      verdict: scoreCheck(answers, check, THRESHOLD),
      informational: INFORMATIONAL_THRESHOLDS.map((t) => scoreCheck(answers, check, t)),
    })),
  };
  writeFileSync(RESULT_PATH, JSON.stringify(fixture, null, 2) + "\n", { flag: "wx" });
  console.log(`wrote ${RESULT_PATH}`);
  for (const { verdict } of fixture.score) {
    console.log(`${verdict.check} ${verdict.pass ? "passes" : "fails"} at T = ${THRESHOLD}: ${JSON.stringify(verdict.clauses)}; Brier ${verdict.brier.toFixed(4)}`);
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
