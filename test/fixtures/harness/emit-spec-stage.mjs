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

// Used by a scratch copy in test/spec-stage.test.ts (the env-var route cannot
// work: envPassthrough keeps it out of the spawned child).
// A spec whose artifact list is 11 entries but only 9 distinct paths. Risk is
// sized from the deduplicated count, so this is `low` (a panel of one); if the
// stage ever counted the raw list it would be `standard` (a panel of two), and
// the operator would sign a risk the deduplicated scope never justified.
const DUPLICATE_SPEC = `feature: demo
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
- src/a1.ts
- ./src/a2.ts

## Acceptance criteria

- the thing works
`;

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

// The document the author would write, shared by the draft, the legacy
// revision, and the self-critique branches. A test that swaps the spec has to
// swap it everywhere the fixture emits one, or the self-critique would hand
// the review stage a different document than the draft did.
function authoredSpec() {
  return stdin.includes("## Revision") ? REVISED_SPEC : BASE_SPEC;
}

// Checked before the author branch: the self-critique prompt carries the
// author's role line too, so an author branch tested first would answer it
// with a draft and the stage would refuse the missing selfCritique payload.
if (stdin.includes("self-critique")) {
  emit({
    status: "proposed",
    agent: "spec-author",
    role: "author",
    executor: "claude-code",
    summary: "fixture self-critique",
    proposedContentChanges: {
      selfCritique: {
        critique: ["the acceptance criterion does not say how it is observed"],
        artifact: authoredSpec().replace("- the thing works", "- the thing works SELFCRITIQUED"),
        panelRequest: { size: 2, specialties: ["security"] },
      },
    },
  });
} else if (stdin.includes("spec reviewer")) {
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
  const spec = authoredSpec();
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
