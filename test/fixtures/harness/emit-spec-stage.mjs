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

// The line sequence of test/fixtures/recorded/harness-stream-json-envelope.json,
// reduced: init, one partial-message chunk, the assistant message, and the
// result line last. `test/harness-stream-fixtures.test.ts` checks the shape.
function emit(agentResult) {
  const resultText = JSON.stringify(agentResult);
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

// The document the author would write, shared by the draft and the
// self-critique branches. A test that swaps the spec has to swap it
// everywhere the fixture emits one, or the self-critique would hand the
// review stage a different document than the draft did.
function authoredSpec() {
  // FIXTURE-DISCLOSE-OD in the design: the author discloses one open decision,
  // which the stage records as a round-1 finding.
  // The plain return stays a literal line: a stage test substitutes it.
  if (stdin.includes("FIXTURE-DISCLOSE-OD")) {
    return `${BASE_SPEC}\n## Open decisions\n\n- OD-001 (high): who may download the export archive\n`;
  }
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
// The operator-question modes (spec-operator-decisions). A test selects one by
// writing its marker into the design document, which every reconcile prompt
// carries — the env-var route cannot reach the spawned child. The first
// finding id receives the named disposition; the rest are addressed without a
// revision. The question and proposal shapes are the ones the spec reconcile
// prompt states and `validateReconciliation` accepts with `requireQuestions`
// (hazard 4: the shape comes from the validator's contract, not the stage).
const QUESTION = {
  text: "How long are exports retained?",
  options: [
    { label: "Thirty days", answer: "Exports are retained for thirty days." },
    { label: "Until deleted", answer: "Exports are retained until the operator deletes them." },
  ],
  recommended: 0,
  why: "the design names a short-lived export",
};
const PROPOSAL = {
  title: "Decide export retention",
  problem: "the design does not say how long exports are kept",
  whyUpstream: "retention is a product decision the design owns",
};
const MODES = [
  ["FIXTURE-ASK-OPERATOR", { disposition: "upstream_blocking", changedLocations: [], proposal: PROPOSAL, question: QUESTION }],
  ["FIXTURE-ASK-CANNOT", { disposition: "cannot_determine", changedLocations: [], question: QUESTION }],
  ["FIXTURE-FOLLOW-UP", { disposition: "upstream_follow_up", changedLocations: [], proposal: PROPOSAL }],
  // A rejection whose excerpt the design never contains: deterministic
  // validation converts it to cannot_determine, which carries no question.
  [
    "FIXTURE-UNGROUNDED-REJECTION",
    {
      disposition: "rejected_with_rationale",
      changedLocations: [],
      grounding: { source: "design", location: "# design", excerpt: "words no design in this suite contains" },
    },
  ],
];

function reconcile() {
  const ids = [...stdin.matchAll(/finding (\d+)/g)].map((m) => Number(m[1]));
  const current = currentArtifact();
  // FIXTURE-ASK-EVERY: every finding, disclosed or reviewer-raised, is
  // upstream_blocking with a question, so a test can answer several.
  // FIXTURE-RECONCILE-DROP-OD also drops OD-001 from the revision that asks
  // about it — only an added entry is refused at spec_review.
  if (stdin.includes("FIXTURE-ASK-EVERY")) {
    const decisions = ids.map((id) => ({
      findingId: id,
      rationale: "fixture asks the operator",
      disposition: "upstream_blocking",
      changedLocations: [],
      proposal: PROPOSAL,
      question: QUESTION,
    }));
    emit({
      status: "proposed",
      agent: "spec-author",
      role: "author",
      executor: "claude-code",
      summary: "fixture reconcile",
      proposedContentChanges: {
        spec: stdin.includes("FIXTURE-RECONCILE-DROP-OD") ? current.replace(/- OD-001 .*\n?/, "") : current,
        decisions,
      },
    });
    return;
  }
  const mode = MODES.find(([marker]) => stdin.includes(marker));
  if (mode !== undefined) {
    // FIXTURE-ASK-SECOND routes the second finding, so a disclosed open
    // decision (always recorded first) is addressed without a question.
    const routed = stdin.includes("FIXTURE-ASK-SECOND") ? 1 : 0;
    const decisions = ids.map((id, index) =>
      index === routed
        ? { findingId: id, rationale: "fixture routed the finding", ...mode[1] }
        : { findingId: id, disposition: "addressed", rationale: "fixture addressed the finding", changedLocations: [], normativeChanges: [] }
    );
    emit({
      status: "proposed",
      agent: "spec-author",
      role: "author",
      executor: "claude-code",
      summary: "fixture reconcile",
      proposedContentChanges: { spec: current, decisions },
    });
    return;
  }
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

// The spec decision fold. Everything it folds is read from the prompt the
// stage rendered — the folded answers, the denied finding ids, and the spec —
// never from a literal this file carries (hazard 4). By default each folded
// answer becomes one new acceptance criterion whose text is the answer,
// claimed by that finding's addressed decision and grounded in that answer.
// A FIXTURE-FOLD-* marker in the design breaks one rule for a refusal test.
function fold() {
  // The instructions name the heading too; the answers follow its last use.
  const at = stdin.lastIndexOf("Operator answers to fold:");
  const head = stdin.slice(0, at);
  const tail = stdin.slice(at);
  const spec = (head.split("The specification to revise:")[1] ?? "").trim() + "\n";
  const [foldedBlock, deniedBlock] = tail.split("Denied questions (leave open):");
  const folded = [...foldedBlock.matchAll(/- finding (\d+)\n  question: .*\n  operator answer \((approve|modify)\): (.*)/g)].map(
    (m) => ({ findingId: Number(m[1]), answer: m[3] })
  );
  const denied = [...(deniedBlock ?? "").matchAll(/- finding (\d+)/g)].map((m) => Number(m[1]));
  const lines = spec.split("\n");
  const criteria = lines.filter((l) => /^- AC-\d+:/.test(l));
  let next = Math.max(...criteria.map((l) => Number(/^- AC-(\d+):/.exec(l)[1]))) + 1;
  const added = folded.map((f) => ({ ...f, node: `AC-${String(next++).padStart(3, "0")}: ${f.answer}` }));
  if (stdin.includes("FIXTURE-FOLD-DENIED-NODE") && denied.length > 0) {
    added.push({ findingId: null, node: `AC-${String(next++).padStart(3, "0")}: the denied question is settled after all` });
  }
  const lastCriterion = lines.map((l) => /^- AC-\d+:/.test(l)).lastIndexOf(true);
  lines.splice(lastCriterion + 1, 0, ...added.map((a) => `- ${a.node}`));
  let revised = lines.join("\n");
  if (stdin.includes("FIXTURE-FOLD-ADD-OD")) revised = revised.replace(/(- OD-001 .*\n)/, "$1- OD-099 (low): a newly noticed question\n");
  if (stdin.includes("FIXTURE-FOLD-DROP-OD")) revised = revised.replace(/- OD-001 .*\n/, "");
  if (stdin.includes("FIXTURE-FOLD-RESEVERITY-OD")) revised = revised.replace("- OD-001 (high):", "- OD-001 (low):");
  if (stdin.includes("FIXTURE-FOLD-REWORD-OD")) revised = revised.replace("who may download the export archive", "who may download the archive");
  const decisions = folded.map((f, index) => {
    let excerpt = f.answer;
    if (stdin.includes("FIXTURE-FOLD-UNGROUNDED")) excerpt = "words the operator never wrote";
    if (stdin.includes("FIXTURE-FOLD-CROSS")) excerpt = folded[(index + 1) % folded.length].answer;
    return {
      findingId: f.findingId,
      disposition: "addressed",
      rationale: "fixture folded the operator's answer",
      changedLocations: ["## Acceptance criteria"],
      normativeChanges: added
        .filter((a) => a.findingId === f.findingId)
        .map((a) => ({
          artifactLocation: "## Acceptance criteria",
          artifactText: a.node,
          grounding: { source: "operator_decision", location: `finding ${f.findingId}`, excerpt },
        })),
    };
  });
  emit({
    status: "proposed",
    agent: "spec-author",
    role: "author",
    executor: "claude-code",
    summary: "fixture fold",
    proposedContentChanges: { spec: revised, decisions },
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
} else if (stdin.includes("Operator answers to fold:")) {
  fold();
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
