import { readFileSync, writeFileSync } from "node:fs";

// One fixture serves both seats of the code-review panel, dispatching on
// EMIT_MODE (default "ok").
//
// The findings are built *from the prompt*, not from a literal: the agent id
// and the changed paths are read back out of the prompt the stage generated.
// A fixture carrying its own hardcoded path would agree with whatever the
// code produced and prove nothing about the changed-set binding — which is
// the failure mode hazard 4 names. A scrape that finds nothing throws: a
// broken fixture must fail loudly, never pass by falling back to a literal.
const stdin = readFileSync(0, "utf8");

// `you are the code reviewer <id> with specialty <lens>` — stated by
// buildCodeReviewPrompt.
const agentMatch = /you are the code reviewer (\S+)/.exec(stdin);
if (!agentMatch) {
  throw new Error("emit-code-review: no agent id found in the prompt");
}
const agent = agentMatch[1];

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

const mode = process.env.EMIT_MODE ?? "ok";
const paths = changedPaths();
const first = paths[0];

// base.txt exists only in the worktree, so a retained raw output carrying
// this marker proves the harness ran with its cwd set to the worktree (a read
// failure throws and fails the dispatch instead).
const marker = readFileSync("base.txt", "utf8");

const CORRECTNESS = "code-reviewer-correctness";
const SECURITY = "code-reviewer-security";

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

/** Findings from one named seat only; the other seat reports nothing. */
function onlyFrom(seat, findings) {
  return proposed(agent === seat ? findings : []);
}

function emitRaw(resultText) {
  console.log(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: resultText,
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: { "fixture-model": { inputTokens: 1, outputTokens: 1 } },
    })
  );
}

function emit(agentResult) {
  emitRaw(JSON.stringify(agentResult));
}

let agentResult;
if (mode === "ok") {
  agentResult = proposed([]);
} else if (mode === "low") {
  agentResult = onlyFrom(CORRECTNESS, [finding({})]);
} else if (mode === "high") {
  agentResult = onlyFrom(SECURITY, [
    finding({ severity: "high", location: `${first}:12`, intentKey: "unsafe-input" }),
  ]);
} else if (mode === "shared") {
  // Both seats report the same canonical identity — one location, one
  // intentKey — at different severities: one finding, two immutable reports.
  agentResult = proposed([
    finding({
      severity: agent === SECURITY ? "high" : "low",
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
