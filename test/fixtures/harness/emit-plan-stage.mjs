import { readFileSync } from "node:fs";

// One fixture serves the plan author, the reviewers, the self-critique, and
// the reconciliation in runPlanStage's single-executor dispatch. It dispatches
// on the prompt's role text and echoes the reviewer's agent id
// (validateAgentResult's identity check requires it).
//
// The plan document is built *from the prompt*, not from a literal: the
// `plan_for` hash and the approved scope paths are read back out of the
// prompt the stage generated. A fixture carrying its own hardcoded hash would
// agree with whatever the code produced and prove nothing about the binding —
// which is the failure mode hazard 4 names.
const stdin = readFileSync(0, "utf8");

// `plan_for must be exactly: <64 hex>` — stated by buildPlanAuthorPrompt,
// buildPlanSelfCritiquePrompt, and buildPlanReconcilePrompt alike.
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

// The approved specification is the authority for criterion IDs. The schema
// examples earlier in the prompt also mention AC-001, so scrape only the
// block after the approved-specification marker. Coverage lines use `->`, not
// `:`, and therefore cannot be mistaken for spec criteria on later prompts.
function criterionIds() {
  const block = stdin.split("Approved specification:")[1] ?? "";
  return [
    ...new Set(
      [...block.matchAll(/^- (AC-(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})): .+$/gm)].map(
        (match) => match[1]
      )
    ),
  ];
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
  const ids = criterionIds();
  if (ids.length === 0) {
    throw new Error("emit-plan-stage: no criterion IDs found in the approved specification");
  }
  const coverage = ids
    .map((id, index) =>
      index === 1
        ? `- ${id} -> not_applicable: observed at runtime, not asserted / checked in the smoke run's recorded output`
        : `- ${id} -> ${index === 0 ? artifact : second}`
    )
    .join("\n");
  return `feature: demo
plan_for: ${planFor}

## Tasks

- Build the thing${revised ? " REVISED-plan" : ""}${selfCritiqued ? " SELFCRITIQUED" : ""}
- Test the thing

## Coverage

${coverage}
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

// The artifact the reconciliation prompt embeds, scraped between the builder's
// markers. A clean round must return the plan unchanged — rewriting it would
// replace the self-critiqued plan the clean-run tests assert on.
function currentArtifact() {
  const block = stdin.split("The plan under review:")[1] ?? "";
  return (block.split("Findings to reconcile:")[0] ?? "").trim();
}

// The superseded half of the replacement `reconcile` makes: the task line the
// revised plan drops. Scraped out of the artifact under review rather than
// written as a literal, for the same reason the `plan_for` hash and the scope
// paths are read back out of the prompt — a fixture carrying its own copy of
// what the code produced agrees with it by construction (hazard 4).
function supersededTask(artifact) {
  const block = artifact.split("## Tasks")[1] ?? "";
  const line = block
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("- "));
  if (line === undefined) {
    throw new Error("emit-plan-stage: no task line found in the artifact under review");
  }
  return line.slice(2).trim();
}

// The reconciler's answer: revise when the round reported findings (so the
// next panel sees the REVISED marker and reports clean), otherwise hand the
// plan back unchanged. When it revises, exactly one decision claims both
// halves of the replacement — the added task line and the superseded one,
// grounded by the same excerpt. The stage derives both directions from the
// before/after parse (hazard 17), a second claim of one node is a duplicate
// and converts its decision, and a node left unclaimed in either direction
// fails the accounting. A round that already reviews the revised plan revises
// nothing and claims nothing. The grounding excerpt is the criterion text from
// the approved spec, which the plan reconcile prompt embeds as the governing
// input.
function reconcile() {
  const ids = [...stdin.matchAll(/finding (\d+)/g)].map((m) => Number(m[1]));
  const current = currentArtifact();
  const revising = ids.length > 0 && !current.includes("REVISED-plan");
  const artifact = revising ? planDoc({ revised: true }) : current;
  const decisions = ids.map((id, index) => ({
    findingId: id,
    disposition: "addressed",
    rationale: "fixture addressed the finding",
    changedLocations: ["## Tasks"],
    normativeChanges:
      revising && index === 0
        ? [
            {
              artifactLocation: "## Tasks",
              artifactText: "Build the thing REVISED-plan",
              grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
            },
            {
              artifactLocation: "## Tasks",
              artifactText: supersededTask(current),
              grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
            },
          ]
        : [],
  }));
  emit({
    status: "proposed",
    agent: "plan-author",
    role: "author",
    executor: "claude-code",
    summary: "fixture reconcile",
    proposedContentChanges: { plan: artifact, decisions },
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
          location: criterionIds()[0] ?? "## Coverage",
          intentKey: "coverage-gap",
          severity: "high",
          classification: "current_artifact",
          subject: "a criterion has no convincing coverage",
        },
        {
          location: "## Tasks",
          intentKey: "nit-pick",
          severity: "low",
          classification: "current_artifact",
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
} else if (stdin.includes("reconcile")) {
  reconcile();
} else if (stdin.includes("plan author")) {
  emit({
    status: "proposed",
    agent: "plan-author",
    role: "author",
    executor: "claude-code",
    summary: "fixture plan",
    proposedContentChanges: { plan: planDoc() },
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
