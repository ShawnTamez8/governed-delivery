import { readFileSync } from "node:fs";

// One fixture serves the plan author, the reviewers, and the revision rounds
// in runPlanStage's single-executor dispatch. It dispatches on the prompt's
// role text and echoes the reviewer's agent id (validateAgentResult's identity
// check requires it).
//
// The plan document is built *from the prompt*, not from a literal: the
// `plan_for` hash and the approved scope paths are read back out of the
// prompt the stage generated. A fixture carrying its own hardcoded hash would
// agree with whatever the code produced and prove nothing about the binding —
// which is the failure mode hazard 4 names.
const stdin = readFileSync(0, "utf8");

// `plan_for must be exactly: <64 hex>` — stated by buildPlanAuthorPrompt.
const specHash = /plan_for must be exactly: ([0-9a-f]{64})/.exec(stdin)?.[1] ?? "0".repeat(64);

// The scope block: `- <path>` lines between the "name only these:" line and
// the blank line that ends the list.
function scopePaths() {
  const block = /name only these:\n\n([\s\S]*?)\n\n/.exec(stdin)?.[1] ?? "";
  return block
    .split("\n")
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .filter((line) => line !== "");
}

function planDoc({ revised = false, selfCritiqued = false, outOfScope = false, planFor = specHash } = {}) {
  const paths = scopePaths();
  if (paths.length === 0) {
    // A scope scrape that finds nothing is a broken fixture, not an empty
    // scope: falling back to a literal path would let the happy path pass
    // while exercising none of the scope binding (hazard 4).
    throw new Error("emit-plan-stage: no scope paths found in the prompt");
  }
  const artifact = outOfScope ? "src/never-approved.ts" : paths[0];
  const second = paths[1] ?? paths[0];
  return `feature: demo
plan_for: ${planFor}

## Tasks

- Build the thing${revised ? " REVISED-plan" : ""}${selfCritiqued ? " SELFCRITIQUED" : ""}
- Test the thing

## Coverage

- the thing works -> ${artifact}
- it is observable -> not_applicable: observed at runtime, not asserted / checked in the smoke run's recorded output
- it stays working -> ${second}
`;
}

function emit(agentResult) {
  console.log(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: JSON.stringify(agentResult),
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: { "fixture-model": { inputTokens: 1, outputTokens: 1 } },
    })
  );
}

// Checked before the author branch: the self-critique prompt carries the
// author's role line too, so an author branch tested first would answer it
// with a draft and the stage would refuse the missing selfCritique payload.
if (stdin.includes("self-critique")) {
  emit({
    status: "proposed",
    agent: "plan-author",
    role: "author",
    executor: "claude-code",
    summary: "fixture plan self-critique",
    proposedContentChanges: {
      selfCritique: {
        critique: ["the tasks do not say what proves them"],
        artifact: planDoc({ selfCritiqued: true }),
        panelRequest: { size: 2, specialties: ["security"] },
      },
    },
  });
} else if (stdin.includes("plan reviewer")) {
  const agentId = /plan reviewer ([a-z-]+)/.exec(stdin)?.[1] ?? "spec-reviewer-traceability";
  const findings = stdin.includes("REVISED-plan")
    ? []
    : [
        {
          location: "## Coverage",
          intentKey: "coverage-gap",
          severity: "high",
          subject: "a criterion has no convincing coverage",
        },
        {
          location: "## Tasks",
          intentKey: "nit-pick",
          severity: "low",
          subject: "tasks could be ordered better",
        },
      ];
  emit({
    status: "proposed",
    agent: agentId,
    role: "reviewer",
    executor: "claude-code",
    summary: "fixture plan review",
    proposedContentChanges: { findings },
  });
} else if (stdin.includes("plan author")) {
  emit({
    status: "proposed",
    agent: "plan-author",
    role: "author",
    executor: "claude-code",
    summary: "fixture plan",
    proposedContentChanges: { plan: planDoc({ revised: stdin.includes("## Revision") }) },
  });
} else {
  emit({
    status: "failed",
    agent: "fixture",
    role: "author",
    executor: "claude-code",
    summary: "unrecognized prompt",
  });
}
