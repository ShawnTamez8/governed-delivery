# Spec Section Membership Implementation Plan

**Status:** Implemented

**Goal:** Close the specification document's two structured sections on an
explicit membership rule stated at both boundaries — the parser refuses a
non-member line by naming the section's rule, and the prompts that request
those sections state that rule where they request it — and stop the spec
reviewer from raising a stable-ID numbering gap as a defect, so that the
failure class measured on 2026-09-05 (a prose `Note:` line answering a
numbering finding, $0.41049, run terminated at `spec_review`) cannot recur
through either the prose door or the finding that invited it.

**Source:** `docs/proposals/spec-reconciliation-prose-note-blocks-run.md` (the
measured incident and its three candidate remedies) as corrected by
`docs/proposals/2026-09-05-spec-reconciliation-prose-note-blocks-run-review.md`
(two high-risk findings, one medium concern, two missing areas, two
suggestions), and by the validity determination of 2026-09-05 recorded in
Task 8 of this plan, which verified every finding against source and rejected
the review's own mitigation for `## Declared artifacts` on recorded evidence.
`ARCHITECTURE.md` section 8 (a specification owns acceptance-criterion
identity; revision prompts require an existing obligation to keep its ID and a
new one to receive a greater unused ID; the parser proves only format and
uniqueness) and section 12's removal accounting (a deleted obligation must be
claimed and grounded; stable criterion identity does not authorize removal by
itself), which together make a gap in the numbering the *expected* residue of
a legitimate claimed removal. The recorded provider response at
`test/fixtures/recorded/spec-reconciliation-web-calculator-numbering-note.json`
is the evidence this plan's regression test is fed from.

**Hazards considered:** 3 (a constrained field must have its constraint stated
in the prompt) is the entry this plan belongs to, extended from the format of a
value to the membership rule of a section: the author obeyed the stated
criterion-ID format for all twenty-three criteria and was never told that the
section admits nothing else, so Task 3 states the rule in every prompt that
requests either section and Task 6 records the measured incident under that
entry. 17 (a reconciliation that answers a finding by deleting the obligation)
is why the reviewer half of this plan exists at all: its removal accounting is
what makes a numbering gap legitimate, so a reviewer prompt silent on stable-ID
semantics has the panel raising the correct output of another guard as a
defect — Task 3 states the semantics and Task 5 records them in section 8. 4
(fixtures and code agreeing while both are wrong) governs the verification
shape: Task 4's regression is fed from the committed recorded response rather
than a hand-written spec, and every guard added in Tasks 1 and 2 carries a
break-it step, because a test that passes on first write has shown only that
the author's reading matched the author's code. 7 (retries that vary nothing)
bears twice: the proposal declined a second paid run because the design, model
and prompts were unchanged, and Tasks 1-3 change the prompts, which is exactly
the systematic variation hazard 7 asks for — so Task 7's run is a permitted
experiment rather than a bare retry, and it is the only thing that can prove
the prompt half. 11 (a default installation that cannot complete a run) is the
cost side of Task 1: a membership rule tight enough to refuse prose is also
tight enough to refuse a legitimate declared path containing a space, which
Assumption 2 states and accepts rather than leaving to be discovered by a paid
run. 13 (specifications inventing obligations) is adjacent and deliberately
untouched: the note the author wrote was not an invented obligation but an
explanation of one that was never removed, so nothing here loosens the
no-invention rule. 1 and 2 are inherited: no parser of model output changes, and
no output is discarded — the refusal messages this plan rewrites are already
retained. 5, 6, 8, 9, 10, 12, 14, 15, 16 and 18 were read and bear on nothing
here: no promise is made for a later stage, no executable is spawned, no hook
is installed, no model alias is matched, no delivery or independence claim
changes, and the reconciliation loop is already aimed at the right artifact —
the author could see the section it had to fix and did fix it, which is why
this is a contract defect and not a routing one.

**Assumptions:** Four, each stated so it can be struck without disturbing the
rest.

1. **`## Declared artifacts` is closed on a whitespace rule, not a list
   marker.** The review's mitigation was to require every line to be exactly
   `- <repo-relative-file>`. That is refuted by committed evidence: the
   specifications inside
   `test/fixtures/recorded/spec-reconciliation-web-calculator-list-marker.json`
   write that section unbulleted (`web/calculator.html`), and
   `test/reconciliation.test.ts:993-998` asserts both of them parse; the
   specification inside the numbering-note fixture writes it unbulleted too
   (`index.html`, `css/styles.css`, `js/calculator.js`, `js/theme.js`). The
   prompts explain why: they ask for "one concrete, exact, repo-relative file
   path per line" and require a marker only for criteria. A bullet rule would
   refuse real provider output and break a recorded-evidence contract test, so
   the membership rule is that a declared-artifact line carries no internal
   whitespace.
2. **A declared artifact path may not contain a space, and that is a real
   cost.** A repository can legitimately hold `my dir/file.ts`. Refusing it is
   the price of closing the section without a marker rule; the alternative is
   the marker rule Assumption 1 rejects on evidence. The rule is stated in the
   prompts as well as enforced in the parser, so it is not a tolerance applied
   at one boundary — the defect this repository keeps re-learning.
3. **`## Acceptance criteria` needs a diagnostic, not new strictness.** That
   section is already closed: a non-criterion line either lacks a colon and
   refuses as an obsolete shape, or carries one and refuses as a malformed ID.
   Both refusals are true and neither names the rule. This plan adds no bullet
   requirement there — nothing in the measured evidence shows one is needed,
   and it would refuse unbulleted criteria that validate today.
4. **Remedy 2 of the proposal is rejected, not deferred.** Tolerating a
   non-criterion line under the heading would silently drop an unbulleted
   criterion from `SpecDoc.acceptanceCriteria`, after which
   `coverageMeetsCriteria` (`src/plan-gate.ts:88`, called from
   `src/plan-stage.ts:238`) has no ID to require from the plan and the
   obligation leaves the run unnoticed. Whether a specification may ever carry
   an explanatory note is a product question that would need its own note
   syntax; it is not this defect's fix.

**Approach:** Two parser changes, four prompt changes, one regression fed from
recorded output, and the document record. Each structured section gets a
membership predicate evaluated before the existing per-entry checks, so the
first thing a non-member line meets is a message naming the section's rule
rather than a message about a malformed member. `obsoleteCriterionShape`
narrows to what it was always meant to mean — a document written entirely in
the pre-ID prose shape — instead of firing on one bad line among twenty-three
good ones. The prompts state both membership rules and the stable-ID
semantics, so the parser and the prompt say the same thing. Nothing else in
the chain changes: no stage, no gate, no schema, no migration.

**Affected areas:** `src/spec-doc.ts` (`validateSpecDoc` only), `src/prompts.ts`
(four builders), `test/spec-doc.test.ts`, `test/prompts.test.ts`,
`test/reconciliation.test.ts` (one new contract test alongside the existing
recorded replays), `ARCHITECTURE.md` section 8, `docs/hazards.md` entry 3, and
the two proposal documents.

**Known blockers:** None blocking Tasks 1-6. Task 7 requires operator
authorization to spend money and cannot be executed without it — the same
standing as `docs/features/code-review-stage/plan.md` Task 10, which this
defect is what blocks. `npm test` intermittently leaks empty `moved` commits
and a stray `base.txt` into the real repository (root cause untraced,
`.claude/sessions/project-learnings.md`), so every suite run below is executed
in a disposable copy. A constraint string added to `CONSTRAINT_STRINGS` must
not be split across a line wrap inside a template literal in `src/prompts.ts`:
the scan reads the source text, and a wrapped phrase fails a prompt that reads
correctly (measured 2026-09-05 on `positive integer`).

**Blast radius:** `validateSpecDoc` has four production callers, all verified
by search: `writeSpecDoc` (`src/spec-doc.ts:194`), `runApprovalRequest`
(`src/approval-stage.ts:89`), the plan stage's panel sizing
(`src/plan-stage.ts:202`), and `test/prompts.test.ts:25`, which validates the
example documents the prompts advertise. Two of those callers read
`obsoleteCriterionShape` to append a repair sentence
(`src/approval-stage.ts:91`, `src/plan-stage.ts:204`), so Task 2's narrowing
changes the operator-facing text on exactly one input class: a specification
with some valid criteria and one non-member line, which today is told to start
a fresh run because its criteria are obsolete when twenty-three of them are
not. `SpecDoc.declaredArtifacts` flows to `computeScope` (`src/scope.ts:129`,
the paths the operator signs), `touchesProtected` (`src/scope.ts:112`),
`specNormativeNodes` (`src/reconciliation.ts:301`), and `deliveryCoverage`
(`src/delivery-coverage.ts:46`); Task 1 narrows what can enter all four, and
that is the point — a prose line under that heading is signed into scope today
and blocks terminally at `src/delivery-stage.ts:515-519` with "declared
artifact(s) never appear in the committed changes". The four prompt builders
have no callers outside `src/spec-stage.ts` and the tests. Recorded fixtures at
risk: `spec-reconciliation-web-calculator-list-marker.json` (replayed at
`test/reconciliation.test.ts:988-1000`) and
`plan-reconciliation-web-calculator.json` and `-prd.json` (replayed at
`test/reconciliation.test.ts:881` and `:1122`) — Task 4 confirms all three stay
green, which is the check Assumption 1 rests on. The harness fixture
`test/fixtures/harness/emit-spec-stage.mjs` emits bulleted, whitespace-free
paths and needs no change. Out of scope and named as a follow-up, not built:
`## Tasks` in `src/plan-doc.ts:68-84` has the same open membership — every
non-empty line becomes a task, so prose there becomes a normative node the
same way — and `## Coverage` is closed only by its `->` delimiter.

**Verification:** `npm run typecheck` and `npm run check:docs` from the
repository root; `npm test` in a disposable copy (`robocopy /MIR` to a temp
path, run, delete), against the current baseline of 774 tests / 773 pass / 0
fail / 1 environmental skip; `node .claude/skills/run-buildworks/driver.mjs
smoke` for the unpaid chain (13/13); and, for the prompt half only, the
authorized paid run in Task 7. Every guard added in Tasks 1 and 2 is proved by
breaking what it guards — change the behaviour, confirm the named test fails,
restore, and confirm the file is byte-identical to its pre-mutation hash.

---

## Tasks

### Task 1: `## Declared artifacts` refuses a non-path line by naming its rule

**Depends on:** None

**Files:**
- Modify: `src/spec-doc.ts` — `validateSpecDoc`, the artifacts loop at lines
  59-90
- Validate: `test/spec-doc.test.ts`

**Steps:**

- **Step 1: add the membership check ahead of the existing path rules.** In
  `validateSpecDoc`, after the `artifacts.length === 0` refusal and before the
  `..`/absolute/trailing-slash/`tasks.md` loop, refuse any entry containing
  internal whitespace with a message that names the section's rule rather than
  the path rule: `every line under ## Declared artifacts must be one
  repo-relative file path with no whitespace; this line is not a path: <line>`.
  Test the entry after the existing `.trim().replace(/^-\s*/, "")` transform,
  so a leading marker and trailing spaces are still tolerated and only
  internal whitespace refuses.
  - Verify: `npm run typecheck`
  - Expected: exit 0.
- **Step 2: assert the refusal, the tolerance, and the survival of recorded
  shapes.** In `test/spec-doc.test.ts`, add a test that a prose line under the
  heading refuses with the new message — use the real line from the recorded
  run, `Note: AC-012 is intentionally unassigned. No requirement or criterion
  was`, so the assertion's expected value comes from outside this session —
  and that `- src/parser.ts`, `src/parser.ts` (unbulleted), and
  `  src/parser.ts  ` (padded) all still parse to the same declared artifact.
  - Verify: `node --test test/spec-doc.test.ts` in a disposable copy
  - Expected: the new test passes; every existing test in the file passes
    unchanged.
- **Step 3: break what the guard guards.** Record a SHA-256 of
  `src/spec-doc.ts`, delete the membership check, run
  `node --test test/spec-doc.test.ts`, confirm the new test fails and names the
  prose line, restore the check, and confirm the hash matches. Reverse the
  mutation by editing it back, never by `git checkout --`.
  - Verify: the recorded hash before and after
  - Expected: identical hashes; the test fails only while the guard is absent.

**Task completion evidence:** `src/spec-doc.ts` refuses a whitespace-bearing
declared artifact by name, the tolerance for markers and padding is asserted,
and the guard is proved by removal.

### Task 2: `## Acceptance criteria` names its membership rule, and the obsolete-shape signal narrows to what it means

**Depends on:** Task 1 (same function; sequence the edits to avoid two people
holding the file)

**Files:**
- Modify: `src/spec-doc.ts` — `validateSpecDoc`, the criteria loop at lines
  95-136
- Validate: `test/spec-doc.test.ts`

**Steps:**

- **Step 1: classify each line before checking it.** Define a criterion line
  as one that, after the existing marker-stripping transform, matches
  `/^AC-\S*\s*:/i` — an `AC-`-prefixed token followed by a colon. Every other
  non-blank line is a non-member and refuses with `every line under ##
  Acceptance criteria must be one criterion of the form '- AC-NNN: <criterion
  text>'; a note or explanation belongs in another section, and a criterion is
  never wrapped across lines; this line is not a criterion: <line>`. A line
  that *is* a criterion line continues through the existing ID-pattern,
  spacing, empty-text and duplicate checks with their existing messages
  unchanged. The `/i` flag is load-bearing, not cosmetic: `ac-001: text` is a
  malformed ID, not prose, and `test/spec-doc.test.ts:72-78` pins it as an ID
  refusal — a case-sensitive predicate would reclassify it as a non-member and
  answer a wrong-case ID with a message about section membership. With the
  flag, `AC-000`, `ac-001`, `AC-01` and `AC-0001` all keep the diagnostics that
  test already pins. Two shapes from the recorded run classify the other way
  and must: `Note: AC-012 is intentionally unassigned…` does not start with the
  prefix, and `AC-013 so that previously assigned criterion IDs are preserved
  unchanged.` has no colon after its first token, so both are non-members.
  - Verify: `npm run typecheck`
  - Expected: exit 0.
- **Step 2: narrow `obsoleteCriterionShape` to a section with no criterion
  lines at all.** Set the flag only when the section contains zero criterion
  lines by the Step 1 definition — the pre-ID prose-only document the two
  repair sentences at `src/approval-stage.ts:91` and `src/plan-stage.ts:204`
  are written for. One non-member line among valid criteria must not claim the
  specification uses the obsolete shape.
  - Verify: `npm run typecheck`
  - Expected: exit 0.
- **Step 3: update and extend the assertions.** In `test/spec-doc.test.ts`, the
  `proseOnly` case at lines 82-89 keeps `obsoleteCriterionShape === true` (its
  section has no criterion lines) and its expected reason becomes the new
  membership message. Add a case built from the recorded run: a section
  carrying the three-line `Note:` block above valid `- AC-001:` and `- AC-013:`
  lines refuses with the membership message naming the first note line, and
  `obsoleteCriterionShape` is `undefined`. Add the third note line —
  `AC-013 so that previously assigned criterion IDs are preserved unchanged.`,
  which has no colon — as its own case, since only line order kept it from
  being the line that refused, and today it would have told the operator to
  start a fresh run over an obsolete shape the document does not have.
  - Verify: `node --test test/spec-doc.test.ts` in a disposable copy
  - Expected: all pass.
- **Step 3a: confirm the two downstream repair tests still hold.**
  `grep -rn "obsolete prose-only" src/ test/` returns four sites, not two: the
  repair sentences at `src/approval-stage.ts:92` and `src/plan-stage.ts:205`,
  and two tests that assert them — `test/approval-stage.test.ts:423-443`, whose
  specification's only criterion line is `- It does the thing.`, and
  `test/plan-stage.test.ts:872-886`, which strips the `AC-00N: ` prefix from all
  three criteria. Both leave the section with zero criterion lines, so the
  narrowed flag still fires, and both assert only the appended repair sentence
  rather than `validateSpecDoc`'s own reason. They must pass unchanged; if
  either fails, the narrowing is wrong, not the test.
  - Verify: `node --test test/approval-stage.test.ts test/plan-stage.test.ts`
    in a disposable copy
  - Expected: both pass with no edit.
- **Step 4: break both guards.** With the file hash recorded: first widen the
  criterion-line predicate to accept any line, confirm the membership test
  fails; restore. Then set `obsoleteCriterionShape` unconditionally on any
  refusal, confirm the `undefined` assertion fails; restore. Confirm the hash.
  - Verify: the recorded hash before and after each mutation
  - Expected: identical hashes; each test fails only while its guard is
    mutated.

**Task completion evidence:** A non-criterion line refuses with a message
naming the section rule; the obsolete-shape repair no longer fires on a
document with valid criteria; both guards proved by mutation.

### Task 3: The prompts state both membership rules and the stable-ID semantics

**Depends on:** Tasks 1 and 2 (the prompt states the rule the parser enforces;
writing them in this order keeps the two boundaries from disagreeing at any
commit)

**Files:**
- Modify: `src/prompts.ts` — `buildSpecAuthorPrompt` (lines 25-34),
  `buildSpecSelfCritiquePrompt` (lines 144-154), `buildSpecReconcilePrompt`
  (lines 628-638), `buildSpecReviewPrompt` (lines 209-226)
- Modify: `test/prompts.test.ts` — `CONSTRAINT_STRINGS` (line 52) and the
  per-builder assertions
- Validate: `test/prompts.test.ts`

**Steps:**

- **Step 1: state the two membership rules in the three authoring prompts.** In
  each of `buildSpecAuthorPrompt`, `buildSpecSelfCritiquePrompt` and
  `buildSpecReconcilePrompt`, extend the `## Declared artifacts` bullet with
  `every non-blank line in this section is one path and nothing else; a path
  contains no whitespace`, and the `## Acceptance criteria` bullet with `every
  non-blank line in this section is one criterion and nothing else: no
  heading, no note, no explanation, and never one criterion wrapped across two
  lines; put an explanation of a numbering decision in your summary or an
  ordinary prose section, not inside this section`. The destination matters:
  the schema accepts any unvalidated prose section (`src/spec-doc.ts:31-34`),
  so the rule redirects the explanation rather than forbidding it. Keep each
  added phrase on a single source line — a phrase
  split across a template-literal line wrap fails the source scan even though
  the rendered prompt reads correctly.
  - Verify: `node --test test/prompts.test.ts` in a disposable copy
  - Expected: passes.
- **Step 2: state the stable-ID semantics in the reviewer prompt.** In
  `buildSpecReviewPrompt`, add: criterion IDs are stable identifiers, not a
  sequence; a gap in the numbering is not by itself a finding, because an
  obligation removed under the removal-accounting rules leaves its ID unused
  and every surviving criterion keeps the ID it was minted with. A finding
  about coverage must name the design obligation the specification is missing,
  never a missing number.
  - Verify: `node --test test/prompts.test.ts` in a disposable copy
  - Expected: passes.
- **Step 3: forbid renumbering as an answer in the two revising prompts.** In
  `buildSpecSelfCritiquePrompt` and `buildSpecReconcilePrompt`, beside the
  existing preserve-the-ID sentence, add `never renumber criteria to close a
  gap`. This is the corrected reading of the proposal, which listed renumbering
  among the honest resolutions while these prompts already forbid it, and it is
  what Task 6 strikes from that document.
  - Verify: `node --test test/prompts.test.ts` in a disposable copy
  - Expected: passes.
- **Step 4: pin every new constraint.** Add to `CONSTRAINT_STRINGS`, with a
  comment naming the measured incident: `a path contains no whitespace`, `one
  criterion and nothing else`, `not inside this section`, `not a sequence`, `a
  gap in the numbering is not by itself a finding`, `never renumber criteria to
  close a gap`. Add the reviewer-facing phrases to the generated-reviewer-prompt
  assertion at `test/prompts.test.ts:204-227` and the two section rules to the
  generated-author-prompt assertion at lines 187-202.
  - Verify: `node --test test/prompts.test.ts` in a disposable copy
  - Expected: passes.
- **Step 5: break the pin.** Delete one added sentence from `src/prompts.ts`,
  confirm the source scan at `test/prompts.test.ts:181` fails naming that
  constraint, restore, confirm the file hash.
  - Verify: the recorded hash before and after
  - Expected: identical hash; the scan fails only while the sentence is absent.

**Task completion evidence:** All four builders state the rules their consumers
enforce, each new phrase is pinned in the source scan, and the pin is proved by
deletion.

### Task 4: The recorded response is the regression, in both directions

**Depends on:** Tasks 1-3

**Files:**
- Modify: `test/reconciliation.test.ts` — beside the existing recorded replays
  at lines 881, 988 and 1122
- Validate: `test/fixtures/recorded/spec-reconciliation-web-calculator-numbering-note.json`

**Steps:**

- **Step 1: replay the blocking response through the parser it blocked in.**
  Load the numbering-note fixture and pass `envelope.result` — prose followed
  by a fenced JSON object — to `extractJsonBody` (`src/parse-output.ts:10`,
  the only export of that file). It returns a tagged result, not the body:
  assert `kind === "ok"`, then take
  `value.proposedContentChanges.spec`, and assert `validateSpecDoc` refuses it with
  the Task 2 membership message naming the `Note:` line, and that
  `obsoleteCriterionShape` is `undefined`. Assert the same document's
  `## Declared artifacts` section — unbulleted `index.html`, `css/styles.css`,
  `js/calculator.js`, `js/theme.js` — is not what refuses it, by asserting the
  refusal message names the criteria section. This is the contract the fix
  owes: the run still blocks, and the operator is now told which rule was
  broken.
  - Verify: `node --test test/reconciliation.test.ts` in a disposable copy
  - Expected: passes.
- **Step 2: assert the whitespace rule does not refuse real provider output.**
  In the same test, assert `validateSpecDoc` accepts the numbering-note
  document once its three note lines are removed and nothing else is changed,
  and confirm the existing `markerRunNodes` replay at
  `test/reconciliation.test.ts:993-998` still parses both recorded revisions.
  This is the assertion Assumption 1 rests on: a marker-based membership rule
  would fail here.
  - Verify: `node --test test/reconciliation.test.ts` in a disposable copy
  - Expected: passes; the two pre-existing recorded replays are untouched and
    green.
- **Step 3: break the fix against real output.** Restore the pre-Task-2
  ordering so the ID check runs before the membership check, confirm Step 1's
  assertion fails because the message names a malformed ID rather than the
  section rule, restore, confirm the hash.
  - Verify: the recorded hash before and after
  - Expected: identical hash; the assertion fails only under the old ordering.

**Task completion evidence:** A committed real provider response, not a
hand-written fixture, pins both halves of the parser change (hard rule 5,
section 21).

### Task 5: `ARCHITECTURE.md` records the membership contract and the gap semantics

**Depends on:** Tasks 1-3

**Files:**
- Modify: `ARCHITECTURE.md` — section 8, the Coverage decisions subsection
  (lines 259-267)

**Steps:**

- **Step 1: state the section contract.** Beside the existing sentence that the
  parser proves only format and uniqueness, record that each structured
  section of a specification admits only its own entry form — a
  declared-artifact line is one whitespace-free repo-relative path, an
  acceptance-criterion line is one `AC-NNN: <text>` entry — and that a
  non-member line is refused by a message naming the section's rule. State the
  list marker exactly as the parser treats it: section 8 already gives the
  canonical form as `- AC-001: <criterion text>`, and the parser tolerates its
  absence on both sections, so the sentence must not describe the marker as
  required. A design that reads stricter than the code is the failure this
  repository has caught before. Record
  that a gap in the criterion numbering is a legitimate residue of the removal
  accounting and that review prompts say so, so no reviewer is invited to
  report it as a defect.
  - Verify: `npm run check:docs`
  - Expected: exit 0. Section 8 carries no backticked stage name (the section 5
    hazard does not apply here, but the rule is worth honoring by habit).
- **Step 2: confirm nothing derived moved.** `scripts/doc-check.mjs` derives
  facts from `ARCHITECTURE.md` by heading and fence shape; adding prose to an
  existing subsection changes no heading and no fence.
  - Verify: `node scripts/doc-check.mjs --json`
  - Expected: exit 0, no finding against `ARCHITECTURE.md`, and no exit 2.

**Task completion evidence:** The design states the contract the parser and the
prompts now share.

### Task 6: The measured incident and the corrected record

**Depends on:** Tasks 1-5

**Files:**
- Modify: `docs/hazards.md` — entry 3
- Modify: `docs/proposals/spec-reconciliation-prose-note-blocks-run.md`
- Modify: `docs/proposals/2026-09-05-spec-reconciliation-prose-note-blocks-run-review.md`

**Steps:**

- **Step 1: record the incident under hazard 3.** Add a `**Measured,
  2026-09-05, $0.41049.**` paragraph in the shape of the existing
  2026-09-04 one: the author answered two numbering findings by explaining the
  gap in place, the section admitted nothing but criteria and never said so,
  the run blocked at the `spec_review` gate, and both boundaries were needed —
  the prompts state the membership rule and the parser names it when a model
  ignores it. Name the committed response as the contract test. Record the
  generalization: a constraint on the *membership of a section* is as much a
  constrained field as the format of a value, and the section a schema forces
  an author to write in is the section the author will answer a finding in.
  - Verify: `npm run check:docs`
  - Expected: exit 0.
- **Step 2: correct the proposal.** In
  `spec-reconciliation-prose-note-blocks-run.md`: strike renumbering from the
  honest resolutions (the reconciliation prompt forbids it, and every renumber
  is a removed node plus an added node that the reconciliation must claim and
  ground — `src/reconciliation.ts:362` and `:461-725`); correct "twenty-four
  real criteria" to twenty-three (AC-001 through AC-011 and AC-013 through
  AC-024, counted from the fixture; a naive count returns twenty-four because
  the note's third line begins `AC-013`); record that the effective authoring
  model was `claude-sonnet-5` (6,857 output tokens including 4,124 thinking,
  $0.115408 of the dispatch) and that the Haiku entry in `effectiveModels` is
  an auxiliary harness query (13 output tokens, $0.004302), so the fixture is
  not evidence that two models authored the response; mark remedy 2 rejected
  with Assumption 4's reason; and record that because remedies 1 and 3 change
  the prompts, a post-change paid run varies something systematically and is
  not the bare retry hazard 7 refuses.
  - Verify: `npm run check:docs`
  - Expected: exit 0; `docs/proposals/**` is reference tier, so paths must
    resolve.
- **Step 3: disposition every finding in the review record.** Record a
  disposition for each of the two high-risk findings, the medium concern, the
  two missing areas and the two suggestions: both high-risk findings accepted
  with a stated correction (HR-1's impact restated — renumbering is not free
  mechanically, and the harm available at this boundary is that findings cite
  AC IDs as their location, `src/prompts.ts:216-217`, so renumbering
  invalidates the locations of the very findings being reconciled, the plan not
  yet existing at stage 2; HR-2's mitigation replaced per Assumption 1 on
  recorded evidence); the medium concern accepted as Tasks 4 and 7; missing
  area 1 answered by Task 3 Step 2, which makes an explanation unnecessary
  rather than relocating it; missing area 2 accepted and verified against
  `src/profile.ts:192-199`, where every stage kind maps to the single
  `--model` value; both suggestions accepted. Set the record's `**Status:**` to
  `reconciled`. Do not edit the findings themselves — the record is the
  evidence of what was believed when written.
  - Verify: `npm run check:docs`
  - Expected: exit 0.
- **Step 4: full validation.** Run the three checks together, then the unpaid
  chain.
  - Verify: `npm run typecheck`, `npm run check:docs`, `npm test` in a
    disposable copy, `node .claude/skills/run-buildworks/driver.mjs smoke`
  - Expected: typecheck and check:docs exit 0; the suite reports the
    774/773/0/1 baseline plus the cases added in Tasks 1, 2 and 4, with 0
    failures and no existing expectation edited except the `proseOnly` reason
    in `test/spec-doc.test.ts` named in Task 2 Step 3; smoke 13/13.

**Task completion evidence:** The hazard entry, the corrected proposal, and a
review record in which every finding carries a disposition.

### Task 7: One authorized paid run that reaches past `spec_review`

**Depends on:** Tasks 1-6. **Requires the operator's authorization to spend
money and must not be executed without it.**

**Files:**
- Create: `docs/features/spec-section-membership/real-run-evidence.md`
- Create: `test/fixtures/recorded/` — one new response with a `provenance`
  block, if the run produces one that becomes load-bearing

**Steps:**

- **Step 1: state the cost before spending it.** The committed driver design is
  the twenty-requirement `web-calculator-design.md`; a full chain budgets
  $1.00-$2.00, and the 2026-09-05 attempt spent $0.41049 reaching stage 2 of 9.
  Confirm authorization, then run
  `node .claude/skills/run-buildworks/driver.mjs paid --yes`. Do not background
  it through `| tail` — that buffers everything until exit; read progress from
  the target's `state.db` (`agent_run.cost`, keyed by `stage_id`).
  - Verify: the driver's stage tally and the target's `state.db`
  - Expected: the chain passes `spec_review`. That is what this plan can claim.
    Reaching `code_review` is `docs/features/code-review-stage/plan.md` Task
    10's outcome, not this plan's.
- **Step 2: record the run whatever it does.** Write
  `real-run-evidence.md` with the dispatch table, the cost, the target, what
  the run establishes and what it does not, and a `**Hazards considered:**`
  line. Retain both the requested model — the single value `new-run --model`
  froze into every entry of `profile.modelMap` (`src/profile.ts:192-199`) — and
  the effective models each dispatch reports, distinguishing the authoring
  model from any auxiliary harness query, as the review's medium concern asks.
  Without both, a later reader cannot tell whether a behaviour change came from
  the new prompt text or from a different model. A run that blocks for a
  different reason is recorded under its own name rather than rounded into a
  nearer outcome.
  - Verify: `npm run check:docs`
  - Expected: exit 0.
- **Step 3: copy any load-bearing response into the repository immediately.**
  If a response from this run becomes load-bearing for a test or a claim,
  extract it to `test/fixtures/recorded/` with a `provenance` block naming the
  run, the dispatch time, the capture date, and what was dropped from the
  harness envelope, before `driver.mjs clean` runs. Query the target's store
  before cleaning it.
  - Verify: the committed fixture parses and the test that depends on it passes
  - Expected: nothing outside the repository is load-bearing when the task
    closes.

**Task completion evidence:** A dated evidence document, and either a committed
response with provenance or an explicit statement that the run produced nothing
load-bearing.

### Task 8: The validity determination this plan was corrected by

**Depends on:** None — already performed on 2026-09-05, recorded here because
the plan's Source cites it.

The review's seven items were each traced to source before being accepted:
`buildSpecReviewPrompt` at `src/prompts.ts:196-238` states no ID semantics;
`ARCHITECTURE.md:259-267` and `:549-553` make a gap the residue of a claimed
removal; `src/spec-doc.ts:59-62` and `:95-98` apply one marker-stripping
transform to both sections; a prose artifact line is signed by
`computeScope` (`src/scope.ts:129`) and blocks at `src/delivery-stage.ts:515-519`;
`src/profile.ts:192-199` maps every stage kind to one model; the fixture's
`modelUsage` separates the authoring model from the auxiliary query; and the
criterion count is twenty-three. The one mitigation rejected is HR-2's marker
rule, refuted by `test/reconciliation.test.ts:993-998` replaying two recorded
specifications whose declared artifacts carry no marker. No step remains.

---

## Gate

The plan is complete when Tasks 1-6 are executed, `npm run typecheck` and
`npm run check:docs` exit 0, the suite passes in a disposable copy with no
regression against the 774/773/0/1 baseline, the smoke chain is 13/13, and
every guard added in Tasks 1-4 has been proved by breaking what it guards with
a byte-identical restore. The status stays `Reconciled` until Task 7's
authorized run exists: Tasks 1-6 prove the parser half against recorded output
and prove nothing at all about whether a live author obeys the new prompt
sentences, and only a paid run can close that gap.

---

## Implementation note (2026-09-05)

All eight tasks executed on branch `code-review-stage`, by the operator's
choice to keep this fix on the branch whose Task 10 it unblocks rather than
opening a second one. The gate above is met and Task 7's run exists, so the
status is `Implemented`.

**What the run proved, and what it did not.** The paid chain passed `spec` and
`spec_review` — the two stages the run before this fix never got past — and
blocked four stages later at `plan_review` for an unrelated reason. Ten
dispatches, $1.25141. The load-bearing observation is that the author, needing
to explain that two withdrawn obligations left `AC-027` and `AC-028` unused,
wrote a `## Notes on criteria numbering` section outside the structured
sections: the same decision the blocked run's author made, placed where the
schema admits it. No reviewer raised the unused IDs as a defect. One sample
cannot show the prompt sentence caused that; it records that the finding class
did not recur on the first chain carrying the sentence. Full detail in
`real-run-evidence.md`.

**Four deviations from the plan as written.**

1. **Per-builder prompt assertions were added beyond Task 3 Step 4.** The
   plan pinned the three membership phrases in the file-wide
   `CONSTRAINT_STRINGS` scan and the author-prompt assertion only. Deleting the
   rule from the self-critique builder left the suite green, because the scan
   passes while any one of the three builders still carries the phrase. The
   self-critique and reconciliation prompt tests now assert the phrases
   directly, as they already did for the panel bounds.
2. **The artifacts membership check runs last within each path's checks, not
   as a separate pass before them.** Task 1 Step 1 specified a pass ahead of
   the path rules; the independent review showed that a line breaking both
   rules — `docs/my feature/tasks.md` is the one that matters — then loses the
   architecture section 14 prohibition and is told only that it is not a path.
   The membership message must not assert something false about a line that
   really is a path.
3. **The obsolete-shape flag tests for a criterion ID anywhere in the section,
   not for a well-formed criterion line.** Task 2 Step 2's rule fired the
   fresh-run repair on a section bulleted with `*`, `+`, a number, or an en
   dash, because only the ASCII hyphen is stripped as a marker — telling an
   operator to discard a run and re-mint IDs the document already carried, over
   a bullet character.
4. **One clause was cut from the reviewer prompt.** "and neither is an ID that
   no longer appears" is unobservable to a spec reviewer, which is handed only
   the design and the current specification, and it reads as licence to
   suppress exactly the report hazard 17 leaves the round-2 panel as the only
   lens on.

**The independent review raised six findings; all six are reconciled.** Four
were defects in this work (the two above, plus two sentences in
`ARCHITECTURE.md` that described the parser as stricter than it is: the
membership rules do not close either section against everything that is not an
entry, and a wrong-case or wrongly padded ID is deliberately answered by the ID
message rather than the section message). One was the plan's own `**Status:**`
contradicting this gate. The sixth is the reviewer-prompt clause above.

**One finding was corrected in the document rather than the code, and it names
a real gap.** The whitespace rule does not close `## Declared artifacts`
against a path wearing Markdown decoration — a backticked filename still parses
as a declared artifact, is signed into scope, and can then only fail at
`delivery_check`. That is the same terminal shape this plan closed for prose,
reached by a decoration a model applies readily. Closing it is not what
Assumption 1 authorized, and no measured run has produced it, so the code is
unchanged, `ARCHITECTURE.md` now says what the rule actually proves, and this
is the named follow-up.

**Follow-ups, none built.** The Markdown-decoration gap above; the plan
document's `## Tasks` section, which has the same open membership every
non-empty line becomes a task; and
`docs/proposals/plan-coverage-single-artifact-blocks-run.md`, the defect Task
7's run measured at the next boundary — a Coverage line admits exactly one
artifact path and no prompt says so, which is this plan's own defect one
document later.
