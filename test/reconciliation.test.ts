import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  collapseWhitespace,
  deriveAddedNormativeNodes,
  deriveRemovedNormativeNodes,
  groundingTextuallyFails,
  normalizeNodeText,
  planNormativeNodes,
  specNormativeNodes,
  validateReconciliation,
  validateReviewerReports,
} from "../src/reconciliation.ts";
import { validateSpecDoc } from "../src/spec-doc.ts";
import type { SpecDoc } from "../src/spec-doc.ts";
import type { PlanDoc } from "../src/plan-doc.ts";
import { validatePlanDoc as parsePlan } from "../src/plan-doc.ts";

// The shapes are the Task 1 prototype's measured output, not values invented
// beside the contract: findingId / disposition / rationale / grounding
// {source, location, excerpt} / proposal {title, problem, whyUpstream} are
// what the real reconciliation dispatches returned (evidence/
// 08-reconcile1.result.json and contracts.mjs in the retained bundle).
// changedLocations and normativeChanges are the plan's own binding additions.

const DESIGN = `# Design

The command reads stored activity records for one project. Any operator who
can run the command may export any project.

the thing works as described.

## Decisions

The retention window is not decided here.
`;

const SPEC = `feature: demo
change_kind: feature

## Declared artifacts

- src/a.ts

## Acceptance criteria

- AC-001: the thing works
`;

function specDoc(): SpecDoc {
  const parsed = validateSpecDoc(SPEC);
  assert.equal(parsed.ok, true);
  return (parsed as { ok: true; value: SpecDoc }).value;
}

function planDoc(): PlanDoc {
  const parsed = parsePlan(
    `feature: demo
plan_for: ${"a".repeat(64)}

## Tasks

- Build the thing

## Coverage

- AC-001 -> src/a.ts
`
  );
  assert.equal(parsed.ok, true);
  return (parsed as { ok: true; value: PlanDoc }).value;
}

/** A decision array under test, whatever shape the case needs. */
function decisions(entries: unknown[]): unknown[] {
  return entries;
}

function baseDecision(): Record<string, unknown> {
  return {
    findingId: 1,
    disposition: "addressed",
    rationale: "sharpened the criterion to say what the design already implies",
    changedLocations: ["## Acceptance criteria"],
  };
}

// --- reviewer reports --------------------------------------------------------

test("a report set with a mixed classification validates and normalizes locations", () => {
  const result = validateReviewerReports(
    [
      {
        location: "## Acceptance criteria:",
        intentKey: "missing-traceability",
        severity: "high",
        classification: "current_artifact",
        subject: "criterion lacks a traceable origin",
      },
      {
        location: "upstream:design:retention-window",
        intentKey: "retention-undecided",
        severity: "low",
        classification: "upstream",
        subject: "the design leaves the window undecided",
      },
    ],
    { agentId: "spec-reviewer-security", upstreamPrefix: "upstream:design:" }
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // The trailing colon is normalized away on the artifact side; the upstream
  // token is already canonical and kept verbatim.
  assert.deepEqual(result.value.map((r) => r.location), [
    "## Acceptance criteria",
    "upstream:design:retention-window",
  ]);
});

test("a duplicate canonical identity inside one reviewer's result is refused", () => {
  const report = {
    location: "## Acceptance criteria",
    intentKey: "missing-traceability",
    severity: "high",
    classification: "current_artifact",
    subject: "criterion lacks a traceable origin",
  };
  const result = validateReviewerReports([report, report], {
    agentId: "spec-reviewer-security",
    upstreamPrefix: "upstream:design:",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /reported the same canonical identity twice/);
});

test("an upstream report must carry the exact token for its artifact's source", () => {
  const base = {
    intentKey: "retention-undecided",
    severity: "low",
    classification: "upstream",
    subject: "the design leaves the window undecided",
  };
  const cases: { location: string; prefix: string; reason: RegExp }[] = [
    // A plan review citing the design source is the wrong token for that
    // artifact — each review stage has exactly one upstream source.
    { location: "upstream:design:retention-window", prefix: "upstream:specification:", reason: /is not upstream:specification:<decision-key>/ },
    { location: "upstream:design:Retention-Window", prefix: "upstream:design:", reason: /is not upstream:design:<decision-key>/ },
    { location: "upstream:design:", prefix: "upstream:design:", reason: /is not upstream:design:<decision-key>/ },
    { location: "upstream:design:missing decision", prefix: "upstream:design:", reason: /is not upstream:design:<decision-key>/ },
  ];
  for (const { location, prefix, reason } of cases) {
    const result = validateReviewerReports([{ ...base, location }], {
      agentId: "spec-reviewer-security",
      upstreamPrefix: prefix,
    });
    assert.equal(result.ok, false, `${location} must not validate`);
    if (result.ok) return;
    assert.match(result.reason, reason);
  }
});

test("an upstream decision key longer than 64 characters is refused", () => {
  const result = validateReviewerReports(
    [
      {
        location: `upstream:design:${"a".repeat(65)}`,
        intentKey: "retention-undecided",
        severity: "low",
        classification: "upstream",
        subject: "the design leaves the window undecided",
      },
    ],
    { agentId: "spec-reviewer-security", upstreamPrefix: "upstream:design:" }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /exceeds 64 characters/);
});

test("a current_artifact report must not use an upstream location", () => {
  const result = validateReviewerReports(
    [
      {
        location: "upstream:design:retention-window",
        intentKey: "retention-undecided",
        severity: "low",
        classification: "current_artifact",
        subject: "the design leaves the window undecided",
      },
    ],
    { agentId: "spec-reviewer-security", upstreamPrefix: "upstream:design:" }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /current_artifact finding uses an upstream location/);
});

test("shape refusals name the reviewer and the cause", () => {
  const good = {
    location: "## Acceptance criteria",
    intentKey: "missing-traceability",
    severity: "high",
    classification: "current_artifact",
    subject: "criterion lacks a traceable origin",
  };
  const cases: { entry: unknown; reason: RegExp }[] = [
    { entry: null, reason: /finding entry is not an object/ },
    { entry: { ...good, severity: "catastrophic" }, reason: /severity "catastrophic" is not one of low, medium, high, critical/ },
    { entry: { ...good, classification: "question" }, reason: /classification "question" is not one of current_artifact, upstream/ },
    { entry: { ...good, location: "" }, reason: /missing a non-empty location/ },
    { entry: { ...good, intentKey: "Bad Key!" }, reason: /not lowercase kebab-case within 64 characters/ },
    { entry: { ...good, subject: "" }, reason: /missing a non-empty subject/ },
  ];
  for (const { entry, reason } of cases) {
    const result = validateReviewerReports([entry], {
      agentId: "spec-reviewer-security",
      upstreamPrefix: "upstream:design:",
    });
    assert.equal(result.ok, false, `${JSON.stringify(entry)} must not validate`);
    if (result.ok) return;
    assert.match(result.reason, /spec-reviewer-security/);
    assert.match(result.reason, reason);
  }
});

test("a non-array report set is refused as a missing payload", () => {
  const result = validateReviewerReports({ findings: [] }, {
    agentId: "spec-reviewer-security",
    upstreamPrefix: "upstream:design:",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /missing proposedContentChanges\.findings/);
});

// --- grounding -----------------------------------------------------------------

test("a hard-wrapped excerpt matches after whitespace collapses", () => {
  // The measured Task 1 case: a correct quotation spanning a line break in a
  // hard-wrapped governing document must match. "Any operator who can run the
  // command may export any project" spans the wrap in DESIGN above.
  const grounding = {
    source: "design",
    location: "## Design",
    excerpt: "Any operator who can run the command may export any project",
  };
  assert.equal(groundingTextuallyFails(grounding, "design", DESIGN), null);
});

test("a BOM and CRLF in the governing input do not defeat a match", () => {
  const text = "﻿line one\r\nline two";
  assert.equal(
    groundingTextuallyFails({ source: "design", location: "x", excerpt: "line one line two" }, "design", text),
    null
  );
});

test("grounding content failures name what failed", () => {
  const cases: { grounding: { source: string; location: string; excerpt: string }; reason: RegExp }[] = [
    {
      grounding: { source: "specification", location: "## Acceptance criteria", excerpt: "the thing works" },
      reason: /source "specification" is not the governing design/,
    },
    { grounding: { source: "design", location: "", excerpt: "the thing works" }, reason: /location is empty/ },
    { grounding: { source: "design", location: "## Acceptance criteria", excerpt: "  " }, reason: /excerpt is empty/ },
    {
      grounding: { source: "design", location: "## Acceptance criteria", excerpt: "words the design never wrote" },
      reason: /does not occur in the governing design/,
    },
  ];
  for (const { grounding, reason } of cases) {
    const failure = groundingTextuallyFails(grounding, "design", DESIGN);
    assert.ok(failure !== null, `${JSON.stringify(grounding)} must fail`);
    assert.match(failure, reason);
  }
});

test("the artifact under review can never be the grounding source", () => {
  // The only accepted sources are the names `design` and `specification` —
  // there is no vocabulary value that names the artifact itself, which is the
  // point: `source: "spec"` fails exactly like any other wrong source.
  assert.ok(
    groundingTextuallyFails({ source: "spec", location: "x", excerpt: "the thing works" }, "design", DESIGN) !== null
  );
});

// --- normative nodes ----------------------------------------------------------

test("spec normative nodes are the declared artifacts and acceptance criteria", () => {
  assert.deepEqual(specNormativeNodes(specDoc()), ["src/a.ts", "AC-001: the thing works"]);
});

test("criterion wording under one ID remains a normative replacement, and the added set stays addition-only", () => {
  assert.deepEqual(
    deriveAddedNormativeNodes(["AC-001: the thing works"], ["AC-001: the thing works precisely"]),
    ["AC-001: the thing works precisely"]
  );
  // This derivation stays addition-only, deliberately: a deletion is not an
  // addition, and hazard 17 is closed by the sibling function deriving the
  // other direction, not by widening this one.
  assert.deepEqual(deriveAddedNormativeNodes(["AC-001: the thing works"], []), []);
});

test("plan normative nodes are the tasks and the reconstructed coverage lines", () => {
  assert.deepEqual(planNormativeNodes(planDoc()), [
    "Build the thing",
    "AC-001 -> src/a.ts",
  ]);
});

test("a not_applicable coverage line reconstructs in its line form", () => {
  const parsed = parsePlan(
    `feature: demo
plan_for: ${"a".repeat(64)}

## Tasks

- Build the thing

## Coverage

- AC-002 -> not_applicable: observed at runtime / checked in the smoke run
`
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(planNormativeNodes(parsed.value), [
    "Build the thing",
    "AC-002 -> not_applicable: observed at runtime / checked in the smoke run",
  ]);
});

test("the added set is a multiset difference with whitespace collapsed", () => {
  assert.deepEqual(deriveAddedNormativeNodes(["old"], ["old", "new"]), ["new"]);
  // A replacement: the old node is gone and the new one is the added half.
  assert.deepEqual(deriveAddedNormativeNodes(["the thing works"], ["the thing works now"]), ["the thing works now"]);
  // Deletion only: nothing added.
  assert.deepEqual(deriveAddedNormativeNodes(["a", "b"], ["a"]), []);
  // Two occurrences of one added node are two claims owed.
  assert.deepEqual(deriveAddedNormativeNodes(["a"], ["a", "b", "b"]), ["b", "b"]);
  // Whitespace spelling is not a change: the collapsed nodes are identical.
  assert.deepEqual(deriveAddedNormativeNodes(["a  b"], ["a b"]), []);
});

test("the removed set is the same multiset difference the other way round", () => {
  // Hazard 17: a node present before reconciliation and absent after is a
  // deleted obligation, and it is derived here so an `addressed` decision has
  // to claim it rather than discharge a finding by deletion.
  assert.deepEqual(deriveRemovedNormativeNodes(["AC-001: the thing works"], []), [
    "AC-001: the thing works",
  ]);
  // A pure addition removes nothing.
  assert.deepEqual(deriveRemovedNormativeNodes(["old"], ["old", "new"]), []);
  // A replacement has one node in each direction.
  assert.deepEqual(deriveRemovedNormativeNodes(["the thing works"], ["the thing works now"]), [
    "the thing works",
  ]);
  // Two occurrences deleted are two claims owed.
  assert.deepEqual(deriveRemovedNormativeNodes(["a", "b", "b"], ["a"]), ["b", "b"]);
  // The same whitespace tolerance the added set applies, on both sides.
  assert.deepEqual(deriveRemovedNormativeNodes(["a  b"], ["a b"]), []);
});

// --- reconciliation validation --------------------------------------------------

function ctx(overrides: Partial<Parameters<typeof validateReconciliation>[1]> = {}): Parameters<typeof validateReconciliation>[1] {
  return {
    canonicalFindingIds: [1],
    governingSource: "design",
    governingText: DESIGN,
    beforeNormativeNodes: ["the thing works"],
    afterNormativeNodes: ["the thing works"],
    ...overrides,
  };
}

function validate(
  raw: unknown,
  overrides: Partial<Parameters<typeof validateReconciliation>[1]> = {}
) {
  return validateReconciliation(raw, ctx(overrides));
}

test("a complete addressed decision with one claim validates and carries its fields through", () => {
  const result = validate(
    decisions([
      {
        ...baseDecision(),
        normativeChanges: [
          {
            artifactLocation: "## Acceptance criteria",
            artifactText: "the thing works precisely",
            grounding: { source: "design", location: "## Design", excerpt: "Any operator who can run the command may export any project" },
          },
        ],
      },
    ]),
    { beforeNormativeNodes: ["the thing works"], afterNormativeNodes: ["the thing works precisely"] }
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.equal(result.value.decisions.length, 1);
  assert.equal(result.value.decisions[0].disposition, "addressed");
  assert.equal(result.value.decisions[0].normativeChanges?.length, 1);
  assert.deepEqual(result.value.unclaimedNodes, []);
  assert.deepEqual(result.value.conversions, []);
});

test("structural refusals: extras, duplicates, omissions, unknowns, misplaced fields", () => {
  const claim = [
    {
      artifactLocation: "## Acceptance criteria",
      artifactText: "the thing works precisely",
      grounding: { source: "design", location: "## Design", excerpt: "the thing works" },
    },
  ];
  const withDelta = {
    beforeNormativeNodes: ["the thing works"],
    afterNormativeNodes: ["the thing works precisely"],
  };
  const cases: { raw: unknown; overrides?: Partial<Parameters<typeof validateReconciliation>[1]>; reason: RegExp }[] = [
    { raw: "not an array", reason: /missing proposedContentChanges\.decisions/ },
    { raw: null, reason: /missing proposedContentChanges\.decisions/ },
    { raw: decisions([null]), reason: /decision entry is not an object/ },
    { raw: decisions([{ ...baseDecision(), findingId: "1" }]), reason: /findingId "1" is not an integer/ },
    { raw: decisions([{ ...baseDecision(), findingId: 2 }]), reason: /names finding 2, which is not a canonical finding of this round/ },
    { raw: decisions([baseDecision(), { ...baseDecision(), rationale: "second answer" }]), reason: /two decisions for finding 1/ },
    { raw: decisions([{ ...baseDecision(), disposition: "deferred" }]), reason: /disposition "deferred" for finding 1 is not one of/ },
    { raw: decisions([{ ...baseDecision(), rationale: "" }]), reason: /missing a non-empty rationale/ },
    { raw: decisions([{ ...baseDecision(), changedLocations: "## Acceptance criteria" }]), reason: /missing changedLocations/ },
    { raw: decisions([{ ...baseDecision(), changedLocations: ["ok", 3] }]), reason: /changedLocations entry that is not a non-empty string/ },
    { raw: decisions([{ ...baseDecision(), impact: "follow_up" }]), reason: /returned an impact field/ },
    // rejected_with_rationale without grounding
    { raw: decisions([{ ...baseDecision(), disposition: "rejected_with_rationale" }]), reason: /rejected_with_rationale without a grounding object/ },
    // grounding on a disposition that forbids it
    { raw: decisions([{ ...baseDecision(), grounding: { source: "design", location: "x", excerpt: "y" } }]), reason: /carries grounding on disposition addressed/ },
    // normativeChanges on a non-addressed disposition
    { raw: decisions([{ ...baseDecision(), disposition: "cannot_determine", normativeChanges: claim }]), reason: /carries normativeChanges on disposition cannot_determine/ },
    // proposal on a non-upstream disposition
    { raw: decisions([{ ...baseDecision(), proposal: { title: "t", problem: "p", whyUpstream: "w" } }]), reason: /carries a proposal candidate on disposition addressed/ },
    // upstream without a proposal
    { raw: decisions([{ ...baseDecision(), disposition: "upstream_follow_up" }]), reason: /upstream_follow_up without a proposal candidate/ },
    // incomplete proposal
    { raw: decisions([{ ...baseDecision(), disposition: "upstream_follow_up", proposal: { title: "t", problem: "p" } }]), reason: /missing a non-empty whyUpstream/ },
    // omission: canonical id with no decision
    { raw: [], overrides: { ...ctx(), canonicalFindingIds: [1, 2] }, reason: /incomplete: no decision for canonical finding id\(s\) 1, 2/ },
    // normativeChanges not an array
    { raw: decisions([{ ...baseDecision(), normativeChanges: "one claim" }]), overrides: withDelta, reason: /normativeChanges must be an array/ },
    // a normativeChange entry without grounding
    { raw: decisions([{ ...baseDecision(), normativeChanges: [{ artifactLocation: "## Acceptance criteria", artifactText: "the thing works precisely" }] }]), overrides: withDelta, reason: /without a grounding object/ },
    // a normativeChange entry missing its artifactText
    { raw: decisions([{ ...baseDecision(), normativeChanges: [{ artifactLocation: "## Acceptance criteria", artifactText: "", grounding: { source: "design", location: "x", excerpt: "y" } }] }]), overrides: withDelta, reason: /missing a non-empty artifactText/ },
  ];
  for (const { raw, overrides, reason } of cases) {
    const result = validate(raw, overrides);
    assert.equal(result.ok, false, `${JSON.stringify(raw)} must not validate`);
    if (result.ok) return;
    assert.match(result.reason, reason);
  }
});

test("a rejection whose grounding does not match converts to cannot_determine", () => {
  const result = validate(
    decisions([
      {
        ...baseDecision(),
        disposition: "rejected_with_rationale",
        grounding: { source: "design", location: "## Decisions", excerpt: "words the design never wrote" },
      },
    ])
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  const decision = result.value.decisions[0];
  assert.equal(decision.disposition, "cannot_determine");
  assert.equal(decision.grounding, null, "the failed grounding is dropped, not retained as valid");
  assert.match(decision.rationale, /\[deterministic validation: grounding excerpt does not occur in the governing design\]/);
  assert.ok(decision.rationale.includes("sharpened the criterion"), "the author's rationale is retained");
  assert.deepEqual(result.value.conversions, [
    { findingId: 1, from: "rejected_with_rationale", reason: "grounding excerpt does not occur in the governing design" },
  ]);
});

test("a rejection grounding citing the wrong source converts, and a matching one stands", () => {
  const wrong = validate(
    decisions([
      {
        ...baseDecision(),
        disposition: "rejected_with_rationale",
        grounding: { source: "specification", location: "x", excerpt: "the thing works" },
      },
    ])
  );
  assert.equal(wrong.ok, true, wrong.ok ? "" : wrong.reason);
  if (!wrong.ok) return;
  assert.equal(wrong.value.decisions[0].disposition, "cannot_determine");
  assert.match(wrong.value.conversions[0].reason, /not the governing design/);

  const right = validate(
    decisions([
      {
        ...baseDecision(),
        disposition: "rejected_with_rationale",
        grounding: { source: "design", location: "## Decisions", excerpt: "The retention window is not decided here." },
      },
    ])
  );
  assert.equal(right.ok, true, right.ok ? "" : right.reason);
  if (!right.ok) return;
  const decision = right.value.decisions[0];
  assert.equal(decision.disposition, "rejected_with_rationale");
  assert.deepEqual(decision.grounding, {
    source: "design",
    location: "## Decisions",
    excerpt: "The retention window is not decided here.",
  });
  assert.deepEqual(right.value.conversions, []);
});

test("a claim naming a node that was not added converts, and the real added node is unclaimed", () => {
  const result = validate(
    decisions([
      {
        ...baseDecision(),
        normativeChanges: [
          {
            artifactLocation: "## Acceptance criteria",
            artifactText: "something else entirely",
            grounding: { source: "design", location: "## Design", excerpt: "the thing works" },
          },
        ],
      },
    ]),
    {
      beforeNormativeNodes: ["the thing works"],
      afterNormativeNodes: ["the thing works precisely"],
    }
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.equal(result.value.decisions[0].disposition, "cannot_determine");
  assert.match(
    result.value.conversions[0].reason,
    /not an added or removed node of this reconciliation claimed exactly once/
  );
  assert.deepEqual(result.value.unclaimedNodes, ["the thing works precisely"]);
});

test("two decisions claiming one added node convert the second, never both", () => {
  const claim = {
    artifactLocation: "## Acceptance criteria",
    artifactText: "the thing works precisely",
    grounding: { source: "design", location: "## Design", excerpt: "the thing works" },
  };
  const result = validate(
    decisions([
      { ...baseDecision(), findingId: 1, normativeChanges: [claim] },
      { ...baseDecision(), findingId: 2, rationale: "second answer", normativeChanges: [claim] },
    ]),
    {
      canonicalFindingIds: [1, 2],
      beforeNormativeNodes: ["the thing works"],
      afterNormativeNodes: ["the thing works precisely"],
    }
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  const [first, second] = result.value.decisions;
  assert.equal(first.disposition, "addressed");
  assert.equal(second.disposition, "cannot_determine");
  assert.deepEqual(result.value.unclaimedNodes, [], "the first claim consumed the node");
  assert.deepEqual(result.value.conversions.map((c) => c.findingId), [2]);
});

test("a claim with unmatched grounding converts and its node surfaces as unclaimed", () => {
  const result = validate(
    decisions([
      {
        ...baseDecision(),
        normativeChanges: [
          {
            artifactLocation: "## Acceptance criteria",
            artifactText: "the thing works precisely",
            grounding: { source: "design", location: "## Design", excerpt: "words the design never wrote" },
          },
        ],
      },
    ]),
    {
      beforeNormativeNodes: ["the thing works"],
      afterNormativeNodes: ["the thing works precisely"],
    }
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.equal(result.value.decisions[0].disposition, "cannot_determine");
  assert.deepEqual(result.value.unclaimedNodes, ["the thing works precisely"]);
});

test("a deletion adds nothing and is still owed a claim, reported as a removal", () => {
  // The two directions are reported apart because the repairs differ: an
  // unclaimed addition is an obligation nobody grounded, an unclaimed removal
  // is an obligation nobody accounted for deleting (hazard 17).
  const result = validate(
    decisions([baseDecision()]),
    {
      beforeNormativeNodes: ["the thing works", "old node"],
      afterNormativeNodes: ["the thing works"],
    }
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.equal(result.value.decisions[0].disposition, "addressed");
  assert.deepEqual(result.value.unclaimedNodes, []);
  assert.deepEqual(result.value.unclaimedRemovals, ["old node"]);
  assert.deepEqual(result.value.conversions, []);
});

test("an addressed decision claiming both halves of a replacement validates", () => {
  const claim = (text: string) => ({
    artifactLocation: "## Acceptance criteria",
    artifactText: text,
    grounding: { source: "design", location: "## Design", excerpt: "the thing works" },
  });
  const result = validate(
    decisions([
      {
        ...baseDecision(),
        normativeChanges: [claim("the thing works precisely"), claim("the thing works")],
      },
    ]),
    {
      beforeNormativeNodes: ["the thing works"],
      afterNormativeNodes: ["the thing works precisely"],
    }
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.equal(result.value.decisions[0].disposition, "addressed");
  assert.equal(result.value.decisions[0].normativeChanges?.length, 2);
  assert.deepEqual(result.value.unclaimedNodes, []);
  assert.deepEqual(result.value.unclaimedRemovals, []);
  assert.deepEqual(result.value.conversions, []);
});

test("one decision may claim the same removed text twice when the node was there twice", () => {
  // Why the accounting keeps a provisional counter per direction rather than
  // one keyed by text: a node can appear twice in an artifact, so deleting
  // both copies owes two claims of one string. A single shared counter would
  // decrement the wrong direction's budget and convert a valid decision.
  const claim = (text: string) => ({
    artifactLocation: "## Acceptance criteria",
    artifactText: text,
    grounding: { source: "design", location: "## Design", excerpt: "the thing works" },
  });
  const both = validate(
    decisions([{ ...baseDecision(), normativeChanges: [claim("dup node"), claim("dup node")] }]),
    { beforeNormativeNodes: ["dup node", "dup node"], afterNormativeNodes: [] }
  );
  assert.equal(both.ok, true, both.ok ? "" : both.reason);
  if (!both.ok) return;
  assert.equal(both.value.decisions[0].disposition, "addressed");
  assert.deepEqual(both.value.conversions, []);
  assert.deepEqual(both.value.unclaimedRemovals, []);

  // And the under-claim: one claim for two deletions leaves one owed.
  const one = validate(
    decisions([{ ...baseDecision(), normativeChanges: [claim("dup node")] }]),
    { beforeNormativeNodes: ["dup node", "dup node"], afterNormativeNodes: [] }
  );
  assert.equal(one.ok, true, one.ok ? "" : one.reason);
  if (!one.ok) return;
  assert.deepEqual(one.value.unclaimedRemovals, ["dup node"]);
  assert.deepEqual(one.value.conversions, []);

  // An over-claim of a removal converts the whole decision, all-or-nothing,
  // and releases the addition it claimed legitimately alongside it.
  const over = validate(
    decisions([
      { ...baseDecision(), normativeChanges: [claim("new node"), claim("old node"), claim("old node")] },
    ]),
    { beforeNormativeNodes: ["old node"], afterNormativeNodes: ["new node"] }
  );
  assert.equal(over.ok, true, over.ok ? "" : over.reason);
  if (!over.ok) return;
  assert.equal(over.value.decisions[0].disposition, "cannot_determine");
  assert.match(over.value.conversions[0].reason, /"old node" is not an added or removed node/);
  assert.deepEqual(over.value.unclaimedNodes, ["new node"]);
  assert.deepEqual(over.value.unclaimedRemovals, ["old node"]);
});

test("a removal claim inherits the grounding requirement rather than adding a second check", () => {
  // Every normativeChanges entry already passes through the grounding check
  // before it reaches the accounting, so hazard 17's requirement that a
  // removal be grounded like an addition needs no parallel code — but it does
  // need proving, because "inherited" is a claim about a code path.
  const result = validate(
    decisions([
      {
        ...baseDecision(),
        normativeChanges: [
          {
            artifactLocation: "## Acceptance criteria",
            artifactText: "old node",
            grounding: { source: "design", location: "## Design", excerpt: "words the design never wrote" },
          },
        ],
      },
    ]),
    {
      beforeNormativeNodes: ["the thing works", "old node"],
      afterNormativeNodes: ["the thing works"],
    }
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.equal(result.value.decisions[0].disposition, "cannot_determine");
  assert.match(result.value.conversions[0].reason, /does not occur in the governing design/);
  assert.deepEqual(result.value.unclaimedRemovals, ["old node"], "the dropped claim releases the removal");
});

test("a round with no addressed decision has no channel to claim a removal, so it fails closed", () => {
  // `normativeChanges` is forbidden on every disposition except `addressed`,
  // which is exactly hazard 17's "a disposition that permits removal". A
  // reconciliation that deletes a node while every decision rejects or routes
  // upstream therefore leaves the removal unclaimed, with nothing converted —
  // the shape the stage-level abort depends on.
  const result = validate(
    decisions([
      {
        ...baseDecision(),
        disposition: "rejected_with_rationale",
        grounding: { source: "design", location: "## Decisions", excerpt: "The retention window is not decided here." },
      },
    ]),
    {
      beforeNormativeNodes: ["the thing works", "old node"],
      afterNormativeNodes: ["the thing works"],
    }
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.equal(result.value.decisions[0].disposition, "rejected_with_rationale");
  assert.deepEqual(result.value.conversions, []);
  assert.deepEqual(result.value.unclaimedRemovals, ["old node"]);
  assert.deepEqual(result.value.unclaimedNodes, []);
});

test("claims on a prose-only reconciliation are extras and convert", () => {
  const result = validate(
    decisions([
      {
        ...baseDecision(),
        normativeChanges: [
          {
            artifactLocation: "## Acceptance criteria",
            artifactText: "the thing works",
            grounding: { source: "design", location: "## Design", excerpt: "the thing works" },
          },
        ],
      },
    ])
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.equal(result.value.decisions[0].disposition, "cannot_determine");
  assert.deepEqual(result.value.unclaimedNodes, []);
});

test("an added node left unclaimed by every decision is reported, not invented for", () => {
  const result = validate(
    decisions([baseDecision()]),
    {
      beforeNormativeNodes: ["the thing works"],
      afterNormativeNodes: ["the thing works precisely"],
    }
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.equal(result.value.decisions[0].disposition, "addressed");
  assert.deepEqual(result.value.unclaimedNodes, ["the thing works precisely"]);
  assert.deepEqual(result.value.conversions, []);
});

test("several added nodes may be claimed across several decisions, once each", () => {
  const claim = (text: string) => ({
    artifactLocation: "## Acceptance criteria",
    artifactText: text,
    grounding: { source: "design", location: "## Design", excerpt: "the thing works" },
  });
  const result = validate(
    decisions([
      { ...baseDecision(), findingId: 1, normativeChanges: [claim("first addition")] },
      { ...baseDecision(), findingId: 2, rationale: "second", normativeChanges: [claim("second addition"), claim("third addition")] },
      { ...baseDecision(), findingId: 3, rationale: "third", disposition: "cannot_determine" },
    ]),
    {
      canonicalFindingIds: [1, 2, 3],
      beforeNormativeNodes: ["the thing works"],
      afterNormativeNodes: ["the thing works", "first addition", "second addition", "third addition"],
    }
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.deepEqual(result.value.unclaimedNodes, []);
  assert.deepEqual(result.value.conversions, []);
  assert.ok(result.value.decisions.every((d) => d.findingId === 1 || d.findingId === 2 || d.findingId === 3));
});

test("a converted upstream decision is impossible by construction: upstream dispositions carry no grounding", () => {
  // upstream_follow_up and upstream_blocking have no content check to fail —
  // their only conditional field is the proposal, which is structural. The
  // vocabulary therefore routes them exactly as the author wrote them.
  const result = validate(
    decisions([
      {
        ...baseDecision(),
        disposition: "upstream_blocking",
        proposal: {
          title: "Decide the retention window",
          problem: "the design defers it",
          whyUpstream: "the design says the product owner owes the decision",
        },
      },
    ])
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  const decision = result.value.decisions[0];
  assert.equal(decision.disposition, "upstream_blocking");
  assert.deepEqual(decision.proposal, {
    title: "Decide the retention window",
    problem: "the design defers it",
    whyUpstream: "the design says the product owner owes the decision",
  });
});

test("an artifactText claim matches after whitespace collapses", () => {
  // The artifact line and the author's copy of it may differ only in
  // typography; the same tolerance the grounding check applies keeps that
  // from being read as an extra claim.
  const result = validate(
    decisions([
      {
        ...baseDecision(),
        normativeChanges: [
          {
            artifactLocation: "## Acceptance criteria",
            artifactText: "the thing works  precisely",
            grounding: { source: "design", location: "## Design", excerpt: "the thing works" },
          },
        ],
      },
    ]),
    {
      beforeNormativeNodes: ["the thing works"],
      afterNormativeNodes: ["the thing works precisely"],
    }
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.equal(result.value.decisions[0].disposition, "addressed");
  assert.deepEqual(result.value.unclaimedNodes, []);
});

// --- the recorded contract replay ---------------------------------------------

/**
 * One real plan reconciliation, replayed through the seam the plan stage uses.
 * `ARCHITECTURE.md` section 21 puts contract tests fed by recorded real output
 * above test-driven work, and hard rule 5 forbids a hand-written fixture from
 * defining correctness — so the pair below is what the removal accounting's
 * verification claim rests on, not the invented payloads above. The response,
 * the two plan revisions it sits between, and the approved specification that
 * governed it are committed together with a `provenance` block naming the run,
 * the dispatch time, the capture date, and what was dropped.
 */
const RECORDED = JSON.parse(
  readFileSync(new URL("./fixtures/recorded/plan-reconciliation-web-calculator.json", import.meta.url), "utf8")
) as {
  specification: string;
  beforePlan: string;
  afterPlan: string;
  decisions: {
    findingId: number;
    normativeChanges?: { artifactLocation: string; artifactText: string; grounding: unknown }[];
  }[];
};

/** The recorded pair, parsed and diffed exactly as `src/plan-stage.ts` does. */
function recordedNodes(): { before: string[]; after: string[] } {
  const before = parsePlan(RECORDED.beforePlan);
  const after = parsePlan(RECORDED.afterPlan);
  assert.equal(before.ok, true, "the recorded plan revision before reconciliation must parse");
  assert.equal(after.ok, true, "the recorded plan revision after reconciliation must parse");
  if (!before.ok || !after.ok) throw new Error("unreachable");
  return { before: planNormativeNodes(before.value), after: planNormativeNodes(after.value) };
}

function validateRecorded(decisionList: unknown) {
  const { before, after } = recordedNodes();
  return validateReconciliation(decisionList, {
    canonicalFindingIds: RECORDED.decisions.map((d) => d.findingId),
    governingSource: "specification",
    governingText: RECORDED.specification,
    beforeNormativeNodes: before,
    afterNormativeNodes: after,
  });
}

/**
 * The superseded half of the recorded replacement: the 282-character
 * theme-toggle task the reconciliation reworded into a 407-character one.
 * Derived from the recorded revisions rather than pasted, so an edit to
 * `planNormativeNodes` that changed what counts as a node could not leave this
 * asserting against a stale literal.
 */
function recordedRemoval(): string {
  const { before, after } = recordedNodes();
  const removed = deriveRemovedNormativeNodes(before, after);
  assert.equal(removed.length, 1);
  return removed[0];
}

test("the recorded reconciliation's delta is two additions and one removal", () => {
  // Asserted as counts, not only as an unclaimed-removal outcome: a later
  // change to what counts as a normative node could otherwise turn the two
  // replay tests below into tautologies that pass over an empty delta.
  const { before, after } = recordedNodes();
  assert.equal(deriveAddedNormativeNodes(before, after).length, 2);
  assert.equal(deriveRemovedNormativeNodes(before, after).length, 1);
  assert.equal(recordedRemoval().length, 282, "the superseded theme-toggle task, verbatim");
});

test("the recorded response as returned reports its superseded task as an unclaimed removal", () => {
  // The negative case, and the reason hazard 17 is a hazard: this response
  // passed the shipped validator, because the delta it accounted for was
  // additions only. Both additions are claimed; the deletion is claimed by
  // nothing, and now blocks.
  const result = validateRecorded(RECORDED.decisions);
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.deepEqual(result.value.conversions, [], "the real response is well-formed and grounded");
  assert.deepEqual(result.value.unclaimedNodes, [], "both added nodes are claimed");
  assert.deepEqual(result.value.unclaimedRemovals, [recordedRemoval()]);
});

test("the same recorded response with the superseded half claimed validates cleanly", () => {
  // The positive case, one claim away from the negative one: the two tests are
  // visibly the same real response, so the accepted path is demonstrated
  // against model output rather than against a payload invented beside the
  // code that consumes it. The added-half claim's own grounding excerpt is
  // reused, which is what the prompt tells the author it may do.
  const twoClaim = structuredClone(RECORDED.decisions);
  const reworded = twoClaim.find((d) => (d.normativeChanges ?? []).some((c) => c.artifactText.length === 407));
  assert.ok(reworded, "the recorded response claims the added half of the replacement");
  const addedHalf = reworded.normativeChanges!.find((c) => c.artifactText.length === 407)!;
  reworded.normativeChanges!.push({
    artifactLocation: "## Tasks",
    artifactText: recordedRemoval(),
    grounding: addedHalf.grounding,
  });

  const result = validateRecorded(twoClaim);
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.deepEqual(result.value.conversions, [], "claiming the removal converts nothing");
  assert.deepEqual(result.value.unclaimedNodes, []);
  assert.deepEqual(result.value.unclaimedRemovals, []);
  assert.equal(result.value.decisions.find((d) => d.findingId === reworded.findingId)?.disposition, "addressed");
});

// --- the list-marker tolerance ------------------------------------------------

/**
 * The second recorded contract replay, and the reason the tolerance exists.
 * This is the spec reconciliation from the operator-authorized run of
 * 2026-09-04 that blocked at the `spec_review` gate: the author answered three
 * findings, claimed both halves of an AC-020 replacement exactly as the prompt
 * asks, and every claim was refused because each `artifactText` carried the
 * `- ` list marker the artifact line carries while `specNormativeNodes`
 * renders a criterion as `<id>: <text>` without one.
 */
const MARKER_RUN = JSON.parse(
  readFileSync(
    new URL("./fixtures/recorded/spec-reconciliation-web-calculator-list-marker.json", import.meta.url),
    "utf8"
  )
) as { design: string; beforeSpec: string; afterSpec: string; decisions: unknown[] };

function markerRunNodes(): { before: string[]; after: string[] } {
  const before = validateSpecDoc(MARKER_RUN.beforeSpec);
  const after = validateSpecDoc(MARKER_RUN.afterSpec);
  assert.equal(before.ok, true, "the recorded specification revision before reconciliation must parse");
  assert.equal(after.ok, true, "the recorded specification revision after reconciliation must parse");
  if (!before.ok || !after.ok) throw new Error("unreachable");
  return { before: specNormativeNodes(before.value), after: specNormativeNodes(after.value) };
}

test("a claim carrying the artifact's list marker matches the derived node", () => {
  // The tolerance, in both directions, on the smallest case that shows it: the
  // author copies the line it is looking at, marker and all.
  const claim = (text: string) => ({
    artifactLocation: "## Acceptance criteria",
    artifactText: text,
    grounding: { source: "design", location: "## Design", excerpt: "the thing works" },
  });
  const result = validate(
    decisions([
      {
        ...baseDecision(),
        normativeChanges: [claim("- AC-001: the thing works precisely"), claim("- AC-001: the thing works")],
      },
    ]),
    {
      beforeNormativeNodes: ["AC-001: the thing works"],
      afterNormativeNodes: ["AC-001: the thing works precisely"],
    }
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.equal(result.value.decisions[0].disposition, "addressed");
  assert.deepEqual(result.value.conversions, []);
  assert.deepEqual(result.value.unclaimedNodes, []);
  assert.deepEqual(result.value.unclaimedRemovals, []);
});

test("a refusal names the text the author sent, marker included", () => {
  // The tolerance must not make the diagnostic lie: a claim that matches
  // nothing is reported as it was written, not as the matcher rewrote it.
  const result = validate(
    decisions([
      {
        ...baseDecision(),
        normativeChanges: [
          {
            artifactLocation: "## Acceptance criteria",
            artifactText: "- AC-001: a criterion this reconciliation never touched",
            grounding: { source: "design", location: "## Design", excerpt: "the thing works" },
          },
        ],
      },
    ]),
    {
      beforeNormativeNodes: ["AC-001: the thing works"],
      afterNormativeNodes: ["AC-001: the thing works precisely"],
    }
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.match(
    result.value.conversions[0].reason,
    /"- AC-001: a criterion this reconciliation never touched" is not an added or removed node/
  );
});

test("normalizeNodeText drops one leading list marker and nothing else", () => {
  assert.equal(normalizeNodeText("- AC-001: text"), "AC-001: text");
  assert.equal(normalizeNodeText("*  AC-001: text"), "AC-001: text");
  assert.equal(normalizeNodeText("+ AC-001: text"), "AC-001: text");
  // One marker, not a run of them, and nothing mid-string is touched.
  assert.equal(normalizeNodeText("- - AC-001: text"), "- AC-001: text");
  assert.equal(normalizeNodeText("AC-001: a - b"), "AC-001: a - b");
  // A dash that is not a list marker stays: no following whitespace.
  assert.equal(normalizeNodeText("-AC-001: text"), "-AC-001: text");
  // The whitespace collapse its sibling applies still happens first.
  assert.equal(normalizeNodeText("﻿-   AC-001:   the  thing\r\nworks"), "AC-001: the thing works");
});

test("the blocked run's recorded response validates once the marker is tolerated", () => {
  // The contract test for the fix, fed by the response that measured the
  // defect. Its delta is two additions and one removal — the reworded AC-020
  // and the new AC-033 — and the author claimed all three, so with the
  // tolerance nothing converts and nothing is left owed in either direction.
  const { before, after } = markerRunNodes();
  assert.equal(deriveAddedNormativeNodes(before, after).length, 2);
  assert.equal(deriveRemovedNormativeNodes(before, after).length, 1);

  const result = validateReconciliation(MARKER_RUN.decisions, {
    canonicalFindingIds: (MARKER_RUN.decisions as { findingId: number }[]).map((d) => d.findingId),
    governingSource: "design",
    governingText: MARKER_RUN.design,
    beforeNormativeNodes: before,
    afterNormativeNodes: after,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.deepEqual(result.value.conversions, [], "the marker was the only reason this response failed");
  assert.deepEqual(result.value.unclaimedNodes, []);
  assert.deepEqual(result.value.unclaimedRemovals, []);
  assert.deepEqual(
    result.value.decisions.map((d) => d.disposition),
    ["addressed", "addressed", "addressed"]
  );
  // The claim that makes this response worth committing: one decision claimed
  // both halves of the replacement, unprompted, against a live provider.
  const reworded = result.value.decisions.find((d) => (d.normativeChanges ?? []).length === 2);
  assert.ok(reworded, "the AC-020 decision claims the superseded half and its replacement");
});

// --- the accepted path, recorded from a completed run ------------------------

/**
 * The third recorded contract replay, and the only one taken from a run that
 * finished. The two fixtures above are a reconciliation that owed a claim it
 * never made and one that made every claim in the wrong shape; this is a plan
 * author answering a reviewer finding by *replacing* a normative task and
 * claiming both halves — the superseded text and its replacement — grounded in
 * the approved specification, on a run that then passed `plan_review` and
 * completed all eight stages.
 *
 * Its three documents were identified by hashing each against the
 * `planHashBefore`, `planHashAfter` and `specHash` values in the run's own
 * audit trail, not by dispatch order, which is how the before-revision turned
 * out to be the self-critique round's artifact rather than the authoring
 * dispatch's. The `provenance` block records that and what was dropped.
 */
const PRD_RUN = JSON.parse(
  readFileSync(
    new URL("./fixtures/recorded/plan-reconciliation-web-calculator-prd.json", import.meta.url),
    "utf8"
  )
) as { specification: string; beforePlan: string; afterPlan: string; decisions: { findingId: number }[] };

function prdRunNodes(): { before: string[]; after: string[] } {
  const before = parsePlan(PRD_RUN.beforePlan);
  const after = parsePlan(PRD_RUN.afterPlan);
  assert.equal(before.ok, true, "the recorded plan revision before reconciliation must parse");
  assert.equal(after.ok, true, "the recorded plan revision after reconciliation must parse");
  if (!before.ok || !after.ok) throw new Error("unreachable");
  return { before: planNormativeNodes(before.value), after: planNormativeNodes(after.value) };
}

function validatePrdRun(decisionList: unknown, nodes?: { before: string[]; after: string[] }) {
  const { before, after } = nodes ?? prdRunNodes();
  return validateReconciliation(decisionList, {
    canonicalFindingIds: PRD_RUN.decisions.map((d) => d.findingId),
    governingSource: "specification",
    governingText: PRD_RUN.specification,
    beforeNormativeNodes: before,
    afterNormativeNodes: after,
  });
}

test("a completed run's replacement claim validates in both directions", () => {
  // Counts first, so a later change to what counts as a normative node cannot
  // quietly turn this into a tautology over an empty delta: 39 nodes before,
  // 41 after, three added and one removed.
  const { before, after } = prdRunNodes();
  assert.equal(before.length, 39);
  assert.equal(after.length, 41);
  const added = deriveAddedNormativeNodes(before, after);
  const removed = deriveRemovedNormativeNodes(before, after);
  assert.equal(added.length, 3);
  assert.deepEqual(removed, ["Link css/styles.css and js/calculator.js and js/theme.js from index.html"]);

  const result = validatePrdRun(PRD_RUN.decisions, { before, after });
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.deepEqual(result.value.conversions, [], "every claim matched a node in one direction");
  assert.deepEqual(result.value.unclaimedNodes, []);
  assert.deepEqual(result.value.unclaimedRemovals, []);
  assert.deepEqual(
    result.value.decisions.map((d) => d.disposition),
    ["addressed", "addressed"]
  );
  // The decision this fixture exists for: one `addressed` decision whose two
  // entries are the two halves of one replacement, the removed half first.
  const replacement = result.value.decisions.find((d) =>
    (d.normativeChanges ?? []).some((c) => c.artifactText === removed[0])
  );
  assert.ok(replacement, "one decision claims the superseded task");
  assert.equal(replacement.normativeChanges?.length, 2);
});

test("addition-only accounting would have refused that same response", () => {
  // What makes the run above evidence rather than a coincidence. Suppressing
  // the removal from the before-set reproduces the accounting that shipped
  // before this feature — the added set is unchanged at three, the removed set
  // is empty — and the replacement claim then matches nothing, converting the
  // decision and blocking the round. Same response, same governing text, one
  // input difference.
  const { before, after } = prdRunNodes();
  const removed = new Set(deriveRemovedNormativeNodes(before, after));
  const beforeWithoutRemoval = before.filter((n) => !removed.has(n));
  assert.equal(deriveAddedNormativeNodes(beforeWithoutRemoval, after).length, 3);
  assert.equal(deriveRemovedNormativeNodes(beforeWithoutRemoval, after).length, 0);

  const result = validatePrdRun(PRD_RUN.decisions, { before: beforeWithoutRemoval, after });
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  if (!result.ok) return;
  assert.equal(result.value.conversions.length, 1);
  assert.match(
    result.value.conversions[0].reason,
    /"Link css\/styles\.css and js\/calculator\.js and js\/theme\.js from index\.html" is not an added or removed node/
  );
  assert.equal(
    result.value.decisions.find((d) => d.findingId === result.value.conversions[0].findingId)?.disposition,
    "cannot_determine"
  );
});

test("collapseWhitespace strips a BOM, normalizes CRLF, and collapses runs", () => {
  assert.equal(collapseWhitespace("﻿first\r\n  second\tthird  "), "first second third");
});

test("unknown fields are refused at every model-returned level, by name", () => {
  // The plan's step 7 says "refuse extras". A field the contract does not
  // name is a second shape for the same thing, and silently dropping it
  // conceals producer/schema drift — so every object level checks its exact
  // allowed keys, and the refusal names the offending field.
  const good = {
    location: "## Acceptance criteria",
    intentKey: "missing-traceability",
    severity: "high",
    classification: "current_artifact",
    subject: "criterion lacks a traceable origin",
  };
  const reportCases: { entry: unknown; reason: RegExp }[] = [
    { entry: { ...good, extra: "x" }, reason: /unknown field extra: allowed fields are severity, classification, location, intentKey, subject/ },
  ];
  for (const { entry, reason } of reportCases) {
    const result = validateReviewerReports([entry], {
      agentId: "spec-reviewer-security",
      upstreamPrefix: "upstream:design:",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, reason);
  }

  const cases: { raw: unknown; overrides?: Partial<Parameters<typeof validateReconciliation>[1]>; reason: RegExp }[] = [
    // An unknown decision member.
    { raw: decisions([{ ...baseDecision(), unexpected: 1 }]), reason: /carries an unknown field unexpected/ },
    // A nested proposal impact — impact is derived at every level it appears.
    {
      raw: decisions([
        {
          ...baseDecision(),
          disposition: "upstream_follow_up",
          proposal: { title: "t", problem: "p", whyUpstream: "w", impact: "follow_up" },
        },
      ]),
      reason: /proposal candidate returned an impact field: impact is derived from the disposition/,
    },
    // An unknown proposal member.
    {
      raw: decisions([
        {
          ...baseDecision(),
          disposition: "upstream_follow_up",
          proposal: { title: "t", problem: "p", whyUpstream: "w", extra: 1 },
        },
      ]),
      reason: /proposal candidate carries an unknown field extra/,
    },
    // An unknown grounding member on a rejection.
    {
      raw: decisions([
        {
          ...baseDecision(),
          disposition: "rejected_with_rationale",
          grounding: { source: "design", location: "x", excerpt: "the thing works", wrong: "y" },
        },
      ]),
      reason: /grounding carries an unknown field wrong/,
    },
    // An unknown member on a normativeChange entry, and on its nested grounding.
    {
      raw: decisions([
        {
          ...baseDecision(),
          normativeChanges: [
            {
              artifactLocation: "## Acceptance criteria",
              artifactText: "the thing works precisely",
              grounding: { source: "design", location: "## Design", excerpt: "the thing works" },
              extra: 1,
            },
          ],
        },
      ]),
      overrides: { beforeNormativeNodes: ["the thing works"], afterNormativeNodes: ["the thing works precisely"] },
      reason: /normativeChange entry with an unknown field extra/,
    },
    {
      raw: decisions([
        {
          ...baseDecision(),
          normativeChanges: [
            {
              artifactLocation: "## Acceptance criteria",
              artifactText: "the thing works precisely",
              grounding: { source: "design", location: "## Design", excerpt: "the thing works", extra: 1 },
            },
          ],
        },
      ]),
      overrides: { beforeNormativeNodes: ["the thing works"], afterNormativeNodes: ["the thing works precisely"] },
      reason: /normativeChange grounding with an unknown field extra/,
    },
  ];
  for (const { raw, overrides, reason } of cases) {
    const result = validate(raw, overrides);
    assert.equal(result.ok, false, `${JSON.stringify(raw)} must not validate`);
    if (result.ok) return;
    assert.match(result.reason, reason);
  }
});
