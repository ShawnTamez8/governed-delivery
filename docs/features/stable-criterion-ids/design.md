# Stable criterion IDs

**Status:** Reconciled

**Hazards considered:** 3 (every prompt must state the criterion-ID shape it asks a model to emit), 4 (tests must derive expected identity from the document contract and include a recorded real-output check), 6 (coverage still cannot promise artifacts outside the approved scope), 13 (only the specification may mint obligations and their IDs), 16 (planning cannot repair an upstream omission by inventing an ID), and 17 (pre-approval ID preservation and criterion deletion remain separate, explicit reconciliation-design gaps; this feature must not claim to close them mechanically).

## Problem

The plan gate currently identifies an acceptance criterion by normalized prose.
The specification contains criterion text, the plan restates that text in each
Coverage line, and `coverageMeetsCriteria` compares the two strings after only
case-folding and whitespace collapse. The plan-author prompts never require a
verbatim copy.

This creates two opposite failures at one boundary:

- A plan can cover the approved obligation faithfully but fail because it
  reformats or paraphrases the prose.
- A plan can add a Coverage line for an obligation the specification never
  declared and pass because the gate checks only specification-to-plan
  coverage, not plan-to-spec identity.

The calculator reproduction in
`.claude/sessions/2026-09-03-debug-plan-coverage-gate-paraphrase-mismatch.md`
demonstrates the first failure. All sixteen Coverage lines missed the string
comparison; at least two also dropped a testable qualifier. A looser prose
comparison cannot distinguish those cases safely.

## Outcome

Acceptance criteria have explicit identities in the approved specification.
Plans refer to those stable, approved identities instead of restating criterion
prose. The plan gate verifies an exact, one-to-one relationship in both
directions and reports missing, unknown, and duplicate identities separately.

Criterion wording remains part of the approved specification and therefore
remains bound by `specHash`. An ID changes only how downstream documents refer
to that wording; it does not permit a plan to weaken, replace, or bypass the
approved obligation.

## Specification contract

The `## Acceptance criteria` section uses one entry per list line:

```markdown
- AC-001: Opening `calculator/index.html` directly in a browser (no server, no build step) renders the calculator.
- AC-002: The implementation uses no external libraries, frameworks, or build tooling.
```

The parsed specification represents each criterion as an object containing its
`id` and `text`; criterion prose is no longer its identity.

Criterion IDs follow these rules:

- The format is uppercase `AC-` followed by the canonical decimal encoding of
  a positive integer, zero-padded to three digits below 1000 and with no extra
  leading zeroes: `^AC-(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})$`.
- IDs are unique within the specification.
- IDs are opaque references. The numeric suffix records minting order, not
  list position; reordering criteria never renumbers them.
- The specification is the sole minting authority. A plan, review, test, or
  reconciliation cannot introduce an ID absent from the specification it
  consumes.
- The initial specification draft mints IDs. Every later specification prompt
  requires the author to preserve an existing criterion's ID across wording
  changes and reordering, and to assign a genuinely new criterion an unused ID
  greater than every ID in the input specification.
- Deterministic document validation enforces canonical format, non-empty text,
  and uniqueness within each specification revision. It does not claim to
  distinguish a legitimate wording revision from semantic replacement under
  the same ID, or a legitimate deletion from renumbering. Those pre-approval
  continuity questions require the removed-node authorization contract in
  hazard 17 and remain outside this feature.

Every prompt that emits or revises a specification states the exact syntax and
the minting, preservation, and non-reuse rules. Every example ID in a prompt
must validate against the same parser that receives the resulting document.

## Plan coverage contract

The `## Coverage` section names criterion IDs only:

```markdown
- AC-001 -> test/calculator.test.ts
- AC-002 -> not_applicable: dependency absence is established by repository inspection / verify the committed dependency manifests and browser smoke result
```

Criterion prose is not accepted on the left side of the arrow. The approved
specification is already present in every plan-authoring and plan-reconciliation
prompt, so the author can read the full obligation while copying only its ID
into Coverage.

For a plan to pass:

- every specification criterion ID has exactly one Coverage entry;
- every Coverage entry names an ID in the approved specification;
- no criterion ID appears more than once in Coverage;
- every non-`not_applicable` artifact remains an exact member of the approved
  scope; and
- every `not_applicable` entry still carries both a rationale and an
  alternative verification.

The gate returns all violations in one deterministic result, grouped as
`missing`, `unknown`, and `duplicate` criterion IDs. Stage diagnostics preserve
those categories and name the IDs so the operator can distinguish an omitted
obligation from an invented or duplicated one without comparing prose.

ID comparison is exact after trimming only the surrounding field whitespace.
Case-folding, punctuation removal, markdown stripping, edit distance, and other
prose-normalization rules do not participate in identity.

## Review and reconciliation behavior

Review and reconciliation prompts ask an agent to cite the criterion ID when a
finding or change targets one criterion. The current `location` and
`changedLocations` contracts accept arbitrary non-empty strings, and code
cannot determine whether a finding semantically targets one criterion. ID
citation in these fields is therefore retained guidance, not a deterministic
lineage guarantee or a completion condition. Typed criterion lineage requires a
separate design and is not added implicitly here.

Specification normative nodes retain both ID and text, so changing criterion
wording remains a normative replacement under the existing reconciliation
accounting. Plan normative nodes retain the criterion ID and its coverage
target. Stable IDs do not turn document content into mutable state and do not
alter the approval hash, audit chain, or content-write boundary.

The separate deletion hole recorded as hazard 17 remains out of scope. This
feature makes an approved criterion unambiguous to the plan, but it does not
define which reconciliation disposition authorizes removing an obligation or
add removed-node grounding to the normative-delta gate. Until that design
lands, no documentation or diagnostic may claim that stable IDs make
pre-approval criterion deletion or renumbering safe.

## Compatibility and failure behavior

This repository has one current document schema and no compatibility layer.
After this feature lands, prose-only acceptance-criterion lines and prose-led
Coverage lines are invalid wherever a stage parses them. An in-progress run
whose next stage must parse an old specification or plan must start a fresh
run; that read boundary refuses with a diagnostic that names the obsolete
shape and the repair. A run already past the corresponding deterministic gate
may continue where downstream code treats the approved document as hash-bound,
opaque content instead of parsing it. Historical tracked documents and retained
raw evidence remain unchanged.

Malformed, missing, or duplicate IDs fail before a paid downstream panel is
dispatched. Unknown, missing, or duplicate plan coverage fails at each of the
three existing plan checkpoints: the initial plan, the self-critique revision,
and each reconciliation revision.

## Scope

In scope:

- the specification and plan document contracts;
- every specification- and plan-emitting prompt;
- plan coverage and scope diagnostics at all existing checkpoints;
- unenforced criterion-ID citation guidance in review and reconciliation
  prompts;
- normative-node rendering needed to preserve current reconciliation checks;
- the binding coverage and gate description in `ARCHITECTURE.md`;
- focused parser, gate, prompt, stage, and reconciliation regression coverage;
  and
- one real plan-stage validation using criteria with markdown and parenthetical
  qualifiers, with the harness envelope retained before it is turned into a
  fixture.

Out of scope:

- fuzzy or semantic comparison of criterion prose;
- plan- or review-minted acceptance criteria;
- a second document schema, migration adapter, or legacy compatibility mode;
- changing approval signing, `specHash`, scope, or delivery semantics;
- changing finding or decision database schemas;
- claiming typed or mechanically enforced criterion-level finding lineage;
- closing hazard 17's removed-normative-node authorization gap; and
- any deferred workflow stage, dashboard, notification, or second harness.

## Acceptance criteria

- A specification criterion with a valid unique ID and non-empty text parses
  into separate `id` and `text` fields; a missing, malformed, or duplicate ID
  is refused by name.
- Every specification-revision prompt requires IDs to survive wording changes
  and reordering and requires a higher unused ID for a new criterion; the
  architecture states that semantic continuity and deletion are not
  mechanically proved before approval.
- A plan with exactly one valid Coverage entry for every approved criterion ID
  passes regardless of markdown, punctuation, parenthetical qualifiers, or
  other prose in the criterion text because the plan does not restate it.
- A plan that omits an approved ID, names an unknown ID, or repeats an ID
  blocks before review and reports each category and exact ID independently.
- A plan cannot mint an obligation: every Coverage ID must exist in the
  specification whose normalized content hash equals `plan_for` and the
  operator-approved `specHash`.
- The existing artifact-scope and `not_applicable` rules continue to pass and
  refuse the same paths and incomplete decisions, now identifying the affected
  criterion by ID.
- The initial author, self-critique, and reconciliation paths enforce the same
  ID rules for both documents; no later checkpoint accepts a shape the first
  one refuses.
- Review and reconciliation prompts recommend criterion IDs in existing
  location fields while the architecture states that this guidance is not a
  typed or mechanically enforced lineage guarantee.
- Re-reading a prose-only specification or plan at a boundary that parses the
  document refuses before downstream dispatch and tells the operator to start
  a fresh run; no compatibility parser accepts both shapes, while a run already
  past that gate may continue through consumers that use only its bound hash and
  opaque content.
- The architecture describes the spec-only minting authority, exact
  bidirectional coverage invariant, compatibility refusal, and residual
  semantic limit. `npm run check:docs` reports clean.
- Focused parser and prompt tests, the full typecheck and test suite, and a real plan-stage run
  demonstrate both the original markdown/parenthetical reproduction and the
  missing, unknown, and duplicate refusal paths. The full test suite runs from
  a disposable checkout because the current suite has a recorded intermittent
  leak into the invoking repository.

## Success boundary

The feature is complete when plan coverage identity no longer depends on model
prose reproduction, both set directions and uniqueness are enforced at every
plan checkpoint, the approved specification remains the only minting authority,
the architecture and prompts distinguish enforced identity from pre-approval
guidance, and the real harness reaches `plan_review` for the original failure
class without weakening any criterion.
