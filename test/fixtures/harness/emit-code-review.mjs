import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// One fixture serves every seat of the code-review panel, dispatching on
// EMIT_MODE (default "ok").
//
// The findings are built *from the prompt*, not from a literal: the agent id
// and the changed paths are read back out of the prompt the stage generated.
// A fixture carrying its own hardcoded path would agree with whatever the
// code produced and prove nothing about the changed-set binding — which is
// the failure mode hazard 4 names. A scrape that finds nothing throws: a
// broken fixture must fail loudly, never pass by falling back to a literal.
const stdin = readFileSync(0, "utf8");
const mode = process.env.EMIT_MODE ?? "ok";

// The line sequence of test/fixtures/recorded/harness-stream-json-envelope.json,
// reduced: init, one partial-message chunk, the assistant message, and the
// result line last. `test/harness-stream-fixtures.test.ts` checks the shape.
function emitRaw(resultText) {
  const session_id = "fixture-session";
  for (const line of [
    { type: "system", subtype: "init", session_id, model: "fixture-model" },
    {
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: resultText } },
      session_id,
    },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: resultText }] }, session_id },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: resultText,
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: { "fixture-model": { inputTokens: 1, outputTokens: 1 } },
    },
  ]) {
    console.log(JSON.stringify(line));
  }
}

function emit(agentResult) {
  emitRaw(JSON.stringify(agentResult));
}

// The code-review reconciler (docs/features/code-review-reconciler/plan.md).
// The finding ids and intent keys are scraped from the prompt's findings
// block, and a rejection's excerpt is the first acceptance criterion's text
// scraped from the prompt's own specification, never a literal (hazard 4).
// Every mode not named below keeps every finding, so the stage makes one call
// and remediates exactly what it did before the reconciler existed.
if (stdin.startsWith("you are the code-review reconciler")) {
  const listed = [...stdin.matchAll(/^- finding (\d+); location .*; intentKey (\S+)$/gm)].map((m) => ({
    findingId: Number(m[1]),
    intentKey: m[2],
  }));
  const specBlock = /\nApproved specification:\n\n([\s\S]*?)\n\nApproved plan:\n/.exec(stdin)?.[1];
  const criterion = specBlock === undefined ? undefined : /^- AC-\d{3,}: (.+)$/m.exec(specBlock)?.[1]?.trimEnd();
  if (listed.length === 0 || criterion === undefined) {
    throw new Error("emit-code-review: incomplete reconciler prompt");
  }
  const keep = (finding) => ({ findingId: finding.findingId, disposition: "keep", basis: "wrong-result" });
  const reject = (finding, excerpt) => ({
    findingId: finding.findingId,
    disposition: "reject",
    rationale: "The specification already states a workable baseline for this behavior.",
    excerpt,
  });
  let answer = mode;
  if (mode === "reconcile-split") {
    // The first call rejects, the second keeps: the two calls disagree.
    const stateDir = process.env.BW_TEST_RECONCILE_STATE_DIR;
    if (stateDir === undefined) throw new Error("emit-code-review: reconcile-split needs BW_TEST_RECONCILE_STATE_DIR");
    const counter = join(stateDir, "reconciler-calls");
    const calls = existsSync(counter) ? Number(readFileSync(counter, "utf8")) : 0;
    writeFileSync(counter, String(calls + 1));
    answer = calls === 0 ? "reconcile-reject-one" : "keep";
  }
  if (mode === "reconcile-exit") {
    process.stderr.write("fixture reconciler failure\n");
    process.exit(3);
  }
  if (mode === "reconcile-prose") {
    emitRaw("I judged every finding and keep them all.");
    process.exit(0);
  }
  if (mode === "reconcile-mutate") writeFileSync("reconciler-residue.txt", "fixture wrote this\n");
  const decisions = listed.map((finding) => {
    if (answer === "reconcile-reject-all-low" || answer === "reconcile-reject-all-high") return reject(finding, criterion);
    if (finding.intentKey !== "beyond-spec-hardening") return keep(finding);
    if (answer === "reconcile-reject-one") return reject(finding, criterion);
    if (answer === "reconcile-bad-excerpt") return reject(finding, "words the specification never says");
    return keep(finding);
  });
  emitRaw(JSON.stringify({ decisions }));
  process.exit(0);
}

// The same executor also stands in for the frozen implementer between panel
// executions. Its patch is derived from the prompt and current checkout.
const remediationMatch = /you are the code-review remediator (\S+)/.exec(stdin);
if (remediationMatch) {
  const remediator = remediationMatch[1];
  const baseCommit = /baseCommit must be exactly ([0-9a-f]{40,64})/.exec(stdin)?.[1];
  const scopeBlock = /Approved scope:\n\n([\s\S]*?)\n\nFindings to remediate:/.exec(stdin)?.[1];
  if (!baseCommit || !scopeBlock) {
    throw new Error("emit-code-review: incomplete remediation prompt");
  }
  const scope = scopeBlock
    .split("\n")
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .filter((line) => line !== "");
  if (scope.length === 0) throw new Error("emit-code-review: empty remediation scope");
  const target = scope[0];
  // The prompt is not persisted, so the remediation input is checked here.
  if (mode === "reconcile-reject-one" && stdin.includes("beyond-spec-hardening")) {
    throw new Error("emit-code-review: a finding the reconciler rejected reached the remediation");
  }
  if (mode.startsWith("reconcile-") && !stdin.includes("intentKey needs-remediation")) {
    throw new Error("emit-code-review: a finding the reconciler kept is missing from the remediation");
  }
  if (
    ["reconcile-split", "reconcile-bad-excerpt", "reconcile-prose", "reconcile-exit"].includes(mode) &&
    !stdin.includes("intentKey beyond-spec-hardening")
  ) {
    throw new Error("emit-code-review: a finding no agreed rejection removed is missing from the remediation");
  }
  if (mode === "mixed-then-clean") {
    const reviewers = [
      "code-reviewer-correctness",
      "code-reviewer-security",
      "code-reviewer-state-integrity",
    ];
    const positions = reviewers.map((reviewer) => stdin.indexOf(`reviewer ${reviewer}`));
    if (positions.some((position) => position < 0) || !(positions[0] < positions[1] && positions[1] < positions[2])) {
      throw new Error("emit-code-review: remediation findings are not in canonical panel order");
    }
    const reviewBarrierDir = process.env.BW_TEST_REVIEW_BARRIER_DIR;
    if (reviewBarrierDir !== undefined) {
      writeFileSync(join(reviewBarrierDir, "remediation-order-verified"), "verified\n");
    }
  }
  const current = readFileSync(target, "utf8");
  const file = {
    path: mode === "remediation-outside-scope" ? "outside.txt" : target,
    action: "modify",
    content: `${current.trimEnd()}\ncode-review-remediated\n`,
  };
  if (mode === "remediation-mutate") writeFileSync("remediator-residue.txt", "fixture wrote this\n");
  emit({
    status: "proposed",
    agent: remediator,
    role: "author",
    executor: "claude-code",
    summary: "fixture remediated the panel findings",
    proposedPatches:
      mode === "remediation-empty"
        ? []
        : [
            {
              baseCommit: mode === "remediation-wrong-base" ? "0".repeat(40) : baseCommit,
              files: [file],
            },
          ],
  });
  process.exit(0);
}

// `you are the code reviewer <id> with specialty <lens>` — stated by
// buildCodeReviewPrompt.
const agentMatch = /you are the code reviewer (\S+)/.exec(stdin);
if (!agentMatch) {
  throw new Error("emit-code-review: no agent id found in the prompt");
}
const agent = agentMatch[1];

const barrierDir = process.env.BW_TEST_REVIEW_BARRIER_DIR;
const postMixedRemediation =
  mode === "mixed-then-clean" &&
  barrierDir !== undefined &&
  existsSync(join(barrierDir, "remediation-order-verified"));
if (barrierDir !== undefined && !postMixedRemediation) {
  const expected = Number(process.env.BW_TEST_REVIEW_BARRIER_COUNT);
  if (!Number.isInteger(expected) || expected < 1) {
    throw new Error("emit-code-review: BW_TEST_REVIEW_BARRIER_COUNT must be a positive integer");
  }
  let delays = {};
  if (process.env.BW_TEST_REVIEW_DELAY_MS !== undefined) {
    delays = JSON.parse(process.env.BW_TEST_REVIEW_DELAY_MS);
  }
  const delayMs = delays[agent] ?? 0;
  if (!Number.isInteger(delayMs) || delayMs < 0) {
    throw new Error(`emit-code-review: invalid delay for ${agent}`);
  }
  mkdirSync(barrierDir, { recursive: true });
  writeFileSync(join(barrierDir, `started-${agent}`), "started\n");
  const deadline = Date.now() + 5_000;
  let startedCount = 0;
  while (startedCount < expected) {
    startedCount = readdirSync(barrierDir).filter((name) => name.startsWith("started-")).length;
    if (startedCount >= expected) break;
    if (Date.now() >= deadline) {
      throw new Error(
        `emit-code-review: barrier expired for ${agent} after seeing ${startedCount}/${expected} starts`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  writeFileSync(join(barrierDir, `finished-${agent}`), `started=${startedCount}\n`);
  if (
    (mode === "parallel-fail" && agent === "code-reviewer-correctness") ||
    (mode === "parallel-multi-fail" && (agent === "code-reviewer-correctness" || agent === "code-reviewer-state-integrity"))
  ) {
    process.stderr.write("fixture reviewer failure\n");
    process.exit(3);
  }
}

// The changed-paths block: `- <path>` lines between the "Changed paths:"
// heading and the blank line that ends the list.
function changedPaths() {
  const block = /Changed paths:\n\n([\s\S]*?)\n\n/.exec(stdin)?.[1];
  if (!block) {
    throw new Error("emit-code-review: no changed-paths block found in the prompt");
  }
  const paths = block
    .split("\n")
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .filter((line) => line !== "");
  if (paths.length === 0) {
    throw new Error("emit-code-review: no changed paths found in the prompt");
  }
  return paths;
}

const paths = changedPaths();
const first = paths[0];

// Read a committed project file from the worktree. Legacy fixtures carry
// base.txt; the generated static-web starter carries a root index.html.
const marker = readFileSync(existsSync("base.txt") ? "base.txt" : "index.html", "utf8");

const CORRECTNESS = "code-reviewer-correctness";
const SECURITY = "code-reviewer-security";
const STATE_INTEGRITY = "code-reviewer-state-integrity";

function finding(overrides) {
  return {
    severity: "low",
    classification: "current_artifact",
    location: first,
    intentKey: "fixture-concern",
    subject: "The fixture reports a concern.",
    ...overrides,
  };
}

function proposed(findings) {
  return {
    status: "proposed",
    agent,
    role: "reviewer",
    executor: "claude-code",
    summary: `fixture code review; base marker ${JSON.stringify(marker)}`,
    proposedContentChanges: { findings },
  };
}

/** Findings from one named seat only; the other seats report nothing. */
function onlyFrom(seat, findings) {
  return proposed(agent === seat ? findings : []);
}

let agentResult;
if (mode === "parallel-fail") {
  agentResult = onlyFrom(STATE_INTEGRITY, [
    finding({ intentKey: "retained-sibling", subject: "A valid sibling report survives another reviewer's failure." }),
  ]);
} else if (mode === "parallel-multi-fail") {
  agentResult = onlyFrom(SECURITY, [
    finding({ intentKey: "retained-sibling", subject: "A valid sibling report survives two reviewer failures." }),
  ]);
} else if (mode === "ok" || mode === "barrier") {
  agentResult = proposed([]);
} else if (mode === "low") {
  agentResult = onlyFrom(CORRECTNESS, [finding({})]);
} else if (mode === "high") {
  agentResult = onlyFrom(SECURITY, [
    finding({ severity: "high", location: `${first}:12`, intentKey: "unsafe-input" }),
  ]);
} else if (mode === "high-then-clean") {
  const remediated = readFileSync(first, "utf8").includes("code-review-remediated");
  agentResult = remediated
    ? proposed([])
    : onlyFrom(CORRECTNESS, [
        finding({ severity: "high", location: `${first}:1`, intentKey: "needs-remediation" }),
      ]);
} else if (mode === "mixed-then-clean") {
  const remediated = readFileSync(first, "utf8").includes("code-review-remediated");
  agentResult = remediated
    ? proposed([])
    : proposed([
        finding({
          severity: "high",
          location: `${first}:1`,
          intentKey: `needs-${agent.replace("code-reviewer-", "")}-remediation`,
          subject: `The ${agent} finding must retain canonical panel order.`,
        }),
      ]);
} else if (
  mode === "reconcile-reject-one" ||
  mode === "reconcile-split" ||
  mode === "reconcile-bad-excerpt" ||
  mode === "reconcile-prose" ||
  mode === "reconcile-exit" ||
  mode === "reconcile-mutate"
) {
  // Two findings before remediation: one the reconciler keeps and one it may
  // reject. After remediation every seat reports nothing, as high-then-clean.
  const remediated = readFileSync(first, "utf8").includes("code-review-remediated");
  agentResult = remediated
    ? proposed([])
    : agent === CORRECTNESS
      ? proposed([finding({ severity: "high", location: `${first}:1`, intentKey: "needs-remediation" })])
      : agent === SECURITY
        ? proposed([finding({ severity: "high", location: `${first}:2`, intentKey: "beyond-spec-hardening" })])
        : proposed([]);
} else if (mode === "reconcile-reject-all-low") {
  agentResult = onlyFrom(CORRECTNESS, [finding({ severity: "low", location: `${first}:1`, intentKey: "beyond-spec-hardening" })]);
} else if (mode === "reconcile-reject-all-high") {
  agentResult = onlyFrom(CORRECTNESS, [finding({ severity: "high", location: `${first}:1`, intentKey: "beyond-spec-hardening" })]);
} else if (
  mode === "remediation-empty" ||
  mode === "remediation-wrong-base" ||
  mode === "remediation-outside-scope" ||
  mode === "remediation-mutate"
) {
  agentResult = onlyFrom(CORRECTNESS, [
    finding({ severity: "high", location: `${first}:1`, intentKey: "needs-remediation" }),
  ]);
} else if (mode === "shared") {
  // All three seats report the same canonical identity — one location, one
  // intentKey — at different severities: one finding, three immutable reports.
  agentResult = proposed([
    finding({
      severity: agent === SECURITY ? "high" : agent === STATE_INTEGRITY ? "medium" : "low",
      location: first,
      intentKey: "shared-concern",
    }),
  ]);
} else if (mode === "upstream") {
  agentResult = onlyFrom(CORRECTNESS, [
    finding({
      severity: "low",
      classification: "upstream",
      location: "upstream:plan:missing-rounding-decision",
      intentKey: "rounding-unspecified",
      subject: "The approved plan does not state how monetary values are rounded.",
    }),
  ]);
} else if (mode === "bad-location") {
  // An upstream classification without the required prefix: the shared
  // validator's refusal, not this stage's location check.
  agentResult = onlyFrom(CORRECTNESS, [
    finding({ classification: "upstream", location: "## Rounding", intentKey: "rounding-unspecified" }),
  ]);
} else if (mode === "unchanged-path") {
  // README.md is committed at the base and never changed by the run.
  agentResult = onlyFrom(CORRECTNESS, [finding({ location: "README.md" })]);
} else if (mode === "bad-line") {
  agentResult = onlyFrom(CORRECTNESS, [finding({ location: `${first}:0` })]);
} else if (mode === "non-proposed") {
  agentResult = { ...proposed([]), status: "failed" };
} else if (mode === "mutate") {
  // The read-only boundary: a reviewer that writes into the checkout it was
  // given. The stage must refuse after the dispatch, before recording any
  // finding, rather than accept output from a run that moved the tree.
  writeFileSync("reviewer-residue.txt", "fixture wrote this\n");
  agentResult = proposed([]);
} else if (mode === "prose") {
  // A well-formed envelope carrying prose instead of a JSON body: the
  // envelope parses and `extractJsonBody` is what refuses, which is the
  // boundary this mode exists to exercise.
  emitRaw("I reviewed the change and found nothing of concern.");
  process.exit(0);
} else {
  throw new Error(`emit-code-review: unknown EMIT_MODE ${mode}`);
}
emit(agentResult);
