import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collapseWhitespace,
  deriveAddedNormativeNodes,
  groundingTextuallyFails,
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

- the thing works
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

- the thing works -> src/a.ts
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
  assert.deepEqual(specNormativeNodes(specDoc()), ["src/a.ts", "the thing works"]);
});

test("plan normative nodes are the tasks and the reconstructed coverage lines", () => {
  assert.deepEqual(planNormativeNodes(planDoc()), [
    "Build the thing",
    "the thing works -> src/a.ts",
  ]);
});

test("a not_applicable coverage line reconstructs in its line form", () => {
  const parsed = parsePlan(
    `feature: demo
plan_for: ${"a".repeat(64)}

## Tasks

- Build the thing

## Coverage

- it is observable -> not_applicable: observed at runtime / checked in the smoke run
`
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(planNormativeNodes(parsed.value), [
    "Build the thing",
    "it is observable -> not_applicable: observed at runtime / checked in the smoke run",
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
  assert.match(result.value.conversions[0].reason, /not an added node of this reconciliation claimed exactly once/);
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

test("an addressed decision may carry no claims — a deletion-only change adds nothing", () => {
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
