import { readFileSync } from "node:fs";

// One fixture serves the author, the self-critique, the reviewers, and the
// reconciliation in runSpecStage's single-executor dispatch. It dispatches on
// the prompt's role text and echoes the reviewer's agent id
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

- AC-001: the thing works
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

- AC-001: the thing works
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

// The document the author would write, shared by the draft and the
// self-critique branches. A test that swaps the spec has to swap it
// everywhere the fixture emits one, or the self-critique would hand the
// review stage a different document than the draft did.
function authoredSpec() {
  return BASE_SPEC;
}

// The artifact the reconciliation prompt embeds, scraped between the builder's
// markers. A clean round must return the document unchanged — rewriting it
// would replace the self-critiqued document the clean-run tests assert on.
function currentArtifact() {
  const block = stdin.split("The specification under review:")[1] ?? "";
  return (block.split("Findings to reconcile:")[0] ?? "").trim();
}

// The superseded half of the replacement `reconcile` makes: the acceptance
// criterion the revised document drops, in the node form the stage diffs
// (`<id>: <text>`). Scraped out of the artifact under review rather than
// written as a literal, for the same reason the document is built from the
// prompt — a fixture carrying its own copy of what the code produced agrees
// with it by construction and proves nothing (hazard 4).
function supersededCriterion(artifact) {
  const block = artifact.split("## Acceptance criteria")[1] ?? "";
  const line = block
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^- AC-\d/.test(l));
  if (line === undefined) {
    throw new Error("emit-spec-stage: no acceptance criterion found in the artifact under review");
  }
  return line.slice(2).trim();
}

// The reconciler's answer: revise when the round reported findings (so the
// next panel sees the REVISED marker and reports clean), otherwise hand the
// artifact back unchanged. When it revises, exactly one decision claims both
// halves of the replacement — the added criterion and the superseded one,
// grounded by the same excerpt. The stage derives both directions from the
// before/after parse (hazard 17), a second claim of one node is a duplicate
// and converts its decision, and a node left unclaimed in either direction
// fails the accounting. A round that already reviews the revised document
// revises nothing and claims nothing.
function reconcile() {
  const ids = [...stdin.matchAll(/finding (\d+)/g)].map((m) => Number(m[1]));
  const current = currentArtifact();
  const revising = ids.length > 0 && !current.includes("REVISED-spec");
  const artifact = revising ? REVISED_SPEC : current;
  const decisions = ids.map((id, index) => ({
    findingId: id,
    disposition: "addressed",
    rationale: "fixture addressed the finding",
    changedLocations: ["AC-001"],
    normativeChanges:
      revising && index === 0
        ? [
            {
              artifactLocation: "AC-001",
              artifactText: "AC-001: the thing works REVISED-spec",
              grounding: { source: "design", location: "# design", excerpt: "design" },
            },
            {
              artifactLocation: "AC-001",
              artifactText: supersededCriterion(current),
              grounding: { source: "design", location: "# design", excerpt: "design" },
            },
          ]
        : [],
  }));
  emit({
    status: "proposed",
    agent: "spec-author",
    role: "author",
    executor: "claude-code",
    summary: "fixture reconcile",
    proposedContentChanges: { spec: artifact, decisions },
  });
}

// Checked before the author branch: the self-critique prompt carries the
// author's role line too, so an author branch tested first would answer it
// with a draft and the stage would refuse the missing selfCritique payload.
// The reconcile branch is checked after the reviewer branch and before the
// author branch: its prompt carries the author's role line as well, and only
// the "reconcile" word distinguishes it.
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
        artifact: authoredSpec().replace("- AC-001: the thing works", "- AC-001: the thing works SELFCRITIQUED"),
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
          location: "AC-001",
          intentKey: "missing-traceability",
          severity: "high",
          classification: "current_artifact",
          subject: "criterion lacks a traceable origin",
        },
        {
          location: "## Declared artifacts",
          intentKey: "nit-pick",
          severity: "low",
          classification: "current_artifact",
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
} else if (stdin.includes("reconcile")) {
  reconcile();
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
