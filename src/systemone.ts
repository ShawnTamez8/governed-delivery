import { SYSTEMONE_REQUEST_TIMEOUT_MS } from "./policy.ts";

/**
 * The Microsoft-Decision-1 client (`docs/proposals/decision-1-review.md`,
 * `docs/features/decision-1-d6-evaluation/plan.md`). One concrete `fetch` call to
 * the operator's Foundry resource, with no interface above it and no retry.
 *
 * The wire format is the one recorded by the probe,
 * `test/fixtures/recorded/systemone-probe-snitch-resource.json`, which matched
 * Microsoft Learn's "Deploy and use Microsoft-Decision-1 in Microsoft Foundry":
 * the body is `{model, state, questions}`, where `model` is the deployment name;
 * the key goes in the `api-key` header; the response is `{model, answers, usage}`,
 * where `model` names the underlying model, not the deployment.
 *
 * The endpoint, the deployment name and the deployment type are environment
 * variables because the operator expects them to change. `new-run` reads them
 * once and freezes them into the run profile (`docs/features/narration-check-spec-review/plan.md`);
 * the spec stage's narration check calls this client with the frozen values,
 * and the evaluation scripts read them at their start. The deployment type is the operator's declaration of where requests
 * are processed and is never sent. It is recorded as given, not checked against
 * a list of one vendor's offers, because the operator will move between
 * resources (decision 2026-10-17).
 */

export interface SystemOneConfig {
  endpoint: string;
  deployment: string;
  deploymentType: string;
}

export type ReadResult<T> = { ok: true; value: T } | { ok: false; reason: string };

type Env = Record<string, string | undefined>;

/** Hostnames as `URL` reports them, for which a plain-http endpoint never leaves the machine. */
const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "[::1]", "localhost"];

function setting(env: Env, name: string): string | null {
  const value = env[name];
  return value === undefined || value.trim() === "" ? null : value;
}

/** Read the three configuration variables. No reason quotes a value. */
export function readSystemOneConfig(env: Env): ReadResult<SystemOneConfig> {
  for (const name of ["SYSTEMONE_ENDPOINT", "SYSTEMONE_DEPLOYMENT", "SYSTEMONE_DEPLOYMENT_TYPE"]) {
    if (setting(env, name) === null) return { ok: false, reason: `${name} is not set` };
  }
  const endpoint = env.SYSTEMONE_ENDPOINT!;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, reason: "SYSTEMONE_ENDPOINT must be an absolute https URL" };
  }
  // The client sends the key to whatever this names, so it must be https unless
  // it never leaves the machine: plain http is accepted for a loopback host only.
  const loopback = LOOPBACK_HOSTS.includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    return { ok: false, reason: "SYSTEMONE_ENDPOINT must be an absolute https URL" };
  }
  return {
    ok: true,
    value: { endpoint, deployment: env.SYSTEMONE_DEPLOYMENT!, deploymentType: env.SYSTEMONE_DEPLOYMENT_TYPE! },
  };
}

/**
 * Read the API key. A key holding anything but printable ASCII is refused here,
 * because `fetch` rejects such a header value before sending it and reports only
 * "fetch failed" (the probe's first attempt, 2026-10-16).
 */
export function readSystemOneKey(env: Env): ReadResult<string> {
  const key = setting(env, "SYSTEMONE_API_KEY");
  if (key === null) return { ok: false, reason: "SYSTEMONE_API_KEY is not set" };
  if (!/^[\x21-\x7e]+$/.test(key)) {
    return {
      ok: false,
      reason: "SYSTEMONE_API_KEY contains a space, a control character or a non-ASCII character, so it cannot be sent as a header",
    };
  }
  return { ok: true, value: key };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** Option name to its description. */
  criteria: Record<string, string>;
}

export interface SystemOneRequest {
  state: string;
  questions: Record<string, ChoiceQuestion>;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface SystemOneResponse {
  model: string;
  answers: Record<string, ChoiceAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** The recorded probabilities summed to 1 within 1e-15; this leaves room for rounding only. */
const PROBABILITY_SUM_TOLERANCE = 1e-6;

/** Check a 2xx body against the request it answers. Returns each problem found, in order. */
export function validateSystemOneResponse(value: unknown, request: SystemOneRequest): string[] {
  if (!isRecord(value)) return ["the response is not a JSON object"];
  const problems: string[] = [];
  if (typeof value.model !== "string" || value.model === "") problems.push("the response names no model");
  const usage = value.usage;
  if (!isRecord(usage) || !Number.isInteger(usage.input_tokens) || (usage.input_tokens as number) < 0) {
    problems.push("the response reports no input_tokens usage");
  }
  const answers = value.answers;
  if (!isRecord(answers)) return [...problems, "the response has no answers object"];
  const asked = Object.keys(request.questions);
  for (const name of Object.keys(answers)) {
    if (!asked.includes(name)) problems.push(`answer ${name} was not asked`);
  }
  for (const name of asked) {
    const answer = answers[name];
    if (!isRecord(answer)) {
      problems.push(`question ${name} has no answer`);
      continue;
    }
    const options = Object.keys(request.questions[name]!.criteria);
    if (answer.type !== "choice") problems.push(`answer ${name} has type ${JSON.stringify(answer.type)}, not "choice"`);
    if (typeof answer.choice !== "string" || !options.includes(answer.choice)) {
      problems.push(`answer ${name} chose ${JSON.stringify(answer.choice)}, which is not an option`);
    }
    if (!isProbability(answer.confidence)) problems.push(`answer ${name} confidence is not a probability`);
    const probabilities = answer.probabilities;
    if (!isRecord(probabilities)) {
      problems.push(`answer ${name} has no probabilities`);
      continue;
    }
    const given = Object.keys(probabilities);
    const missing = options.filter((option) => !given.includes(option));
    const extra = given.filter((option) => !options.includes(option));
    if (missing.length > 0) problems.push(`answer ${name} has no probability for ${missing.join(", ")}`);
    if (extra.length > 0) problems.push(`answer ${name} has a probability for unknown option ${extra.join(", ")}`);
    const values = Object.values(probabilities);
    if (!values.every(isProbability)) {
      problems.push(`answer ${name} has a probability outside [0, 1]`);
    } else {
      const sum = (values as number[]).reduce((total, p) => total + p, 0);
      if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) problems.push(`answer ${name} probabilities sum to ${sum}`);
    }
  }
  return problems;
}

/** `text` is the response body as received, retained by a caller before it acts on `response`. */
export type SystemOneOutcome =
  | { ok: true; status: number; response: SystemOneResponse; text: string; requestIds: Record<string, string>; durationMs: number }
  | { ok: false; status: number | null; reason: string; body: string | null; durationMs: number };

/**
 * Send one request and validate the answer. Every failure is returned, never
 * retried: a non-2xx status, a timeout, a network error, a body that is not
 * JSON, or one that fails validation. No reason or body contains the key.
 */
export async function askSystemOne(
  config: SystemOneConfig,
  key: string,
  request: SystemOneRequest,
  timeoutMs: number = SYSTEMONE_REQUEST_TIMEOUT_MS
): Promise<SystemOneOutcome> {
  const scrub = (text: string) => (key === "" ? text : text.split(key).join("<key>"));
  const started = Date.now();
  let response: Response;
  let text: string;
  try {
    response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "api-key": key },
      body: JSON.stringify({ model: config.deployment, ...request }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await response.text();
  } catch (error) {
    const durationMs = Date.now() - started;
    const e = error as Error & { cause?: { message?: string } };
    if (e.name === "TimeoutError") return { ok: false, status: null, reason: `timed out after ${timeoutMs} ms`, body: null, durationMs };
    const cause = e.cause?.message ? ` (${e.cause.message})` : "";
    return { ok: false, status: null, reason: scrub(`${e.name}: ${e.message}${cause}`), body: null, durationMs };
  }
  const durationMs = Date.now() - started;
  const status = response.status;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (status < 200 || status > 299) {
    // The recorded 404 carries `DeploymentNotFound`; the recorded 401 carries only "401".
    const code = isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.code === "string" ? parsed.error.code : "";
    const named = code === "" || code === String(status) ? "" : ` ${code}`;
    return { ok: false, status, reason: scrub(`HTTP ${status}${named}`), body: scrub(text), durationMs };
  }
  if (parsed === undefined) return { ok: false, status, reason: "the response body is not JSON", body: scrub(text), durationMs };
  const problems = validateSystemOneResponse(parsed, request);
  if (problems.length > 0) {
    return { ok: false, status, reason: `the response failed validation: ${problems.join("; ")}`, body: scrub(text), durationMs };
  }
  const requestIds: Record<string, string> = {};
  for (const [name, value] of response.headers) if (/request-id/i.test(name)) requestIds[name] = value;
  return { ok: true, status, response: parsed as SystemOneResponse, text: scrub(text), requestIds, durationMs };
}
