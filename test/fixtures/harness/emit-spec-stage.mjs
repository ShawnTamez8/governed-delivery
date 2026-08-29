import { readFileSync } from "node:fs";

// One fixture serves both roles in runSpecStage's single-executor dispatch.
// It dispatches on the prompt's role text and echoes the reviewer's agent id
// (validateAgentResult's identity check requires it). The spec declares 11
// artifacts so computeRisk yields standard risk and the panel reaches its
// full size of two. Output wraps the AgentResult in a claude-shaped envelope,
// because parseEnvelope reads the envelope's `result` field.
const stdin = readFileSync(0, "utf8");

const BASE_SPEC = `feature: demo
change_kind: feature

# Demo

## Declared artifacts

- src/a1.ts
- src/a2.ts
- src/a3.ts
- src/a4.ts
- src/a5.ts
- src/a6.ts
- src/a7.ts
- src/a8.ts
- src/a9.ts
- src/a10.ts
- src/a11.ts

## Acceptance criteria

- the thing works
`;

const REVISED_SPEC = BASE_SPEC.replace("the thing works", "the thing works REVISED-spec");

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

if (stdin.includes("spec reviewer")) {
  const agentId = /spec reviewer ([a-z-]+)/.exec(stdin)?.[1] ?? "spec-reviewer-traceability";
  const findings = stdin.includes("REVISED-spec")
    ? []
    : [
        {
          location: "## Acceptance criteria",
          intentKey: "missing-traceability",
          severity: "high",
          subject: "criterion lacks a traceable origin",
        },
        {
          location: "## Declared artifacts",
          intentKey: "nit-pick",
          severity: "low",
          subject: "artifact list could be grouped",
        },
      ];
  emit({
    status: "proposed",
    agent: agentId,
    role: "reviewer",
    executor: "claude-code",
    summary: "fixture review",
    proposedContentChanges: { findings },
  });
} else if (stdin.includes("spec author")) {
  const spec = stdin.includes("## Revision") ? REVISED_SPEC : BASE_SPEC;
  emit({
    status: "proposed",
    agent: "spec-author",
    role: "author",
    executor: "claude-code",
    summary: "fixture spec",
    proposedContentChanges: { spec },
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
