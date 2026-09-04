# Project learnings — BuildWorks (governed-delivery)

**Current state** below is rewritten every pass, never appended to. It is the
resume point. Everything under **Session records** is history, ordered newest
first, and may name state that has since been superseded — when the two
disagree, Current state wins.

This file is the system of record. Harness auto memory mirrors some of its
durable one-liners so they load automatically, but the mirror is machine-local
and per-clone-path: nothing is ever removed from here on the grounds that
memory holds it (`docs/proposals/durable-knowledge-tiers.md`).

## Current state (2026-09-04, evening)

**Shipped and pushed.** Build order steps 1-8 are complete and step 9's
milestone — one complete run with queryable cost — is reached. Hazard 17 is
closed (`a2db2a0`), the list-marker remedy is in, and the driver's committed
design is the web calculator. `master` is the only local branch and is level
with `origin/master` at `a2db2a0`. Read the head with `git log -1` rather than
trusting a commit id written here.

**Committed on 2026-09-04, working tree clean:**
`docs/features/code-review-stage/plan.md` (Status `Reconciled`) and
`2026-09-04-plan-review.md` (Status `reconciled`, five findings accepted), in
the commit after `a2db2a0`. No source file has changed. Nothing is built, and
the operator said not to begin Task 1 in that session.

**The stop is lifted for exactly one deferred stage, by operator decision on
2026-09-04: `code_review`.** Every other deferred stage, the dashboard, and
notifications remain behind their own decision. The plan is the design of
record for the stage; its ten tasks are ordered so each leaves the suite green.
Read it before touching `src/select.ts`, `src/policy.ts`, `src/profile.ts`,
`src/delivery-stage.ts`, or `scripts/doc-check.mjs`, all of which it changes.

**Decisions locked in the plan (operator, 2026-09-04):**

- Placement `implementation -> verification -> code_review -> delivery_check`;
  a fixed panel of every registered reviewer with output kind `code-findings`
  (two seeded: correctness, security); item 4's specialist selection deferred
  until the stage exists.
- The gate blocks at or above the frozen `codeReviewBlockingSeverity` (seeded
  `high`), ordered by the frozen `policy.severities`, never a live constant.
- **Every upstream finding blocks the run for a human at any severity and
  writes a `blocking_dependency` proposal** through the existing proposal
  machinery, with the candidate derived from the finding. The operator first
  scoped the proposal to the threshold, then chose one rule for every severity.
- A block is terminal, a fresh run is the repair, and there is no operator
  waiver; both are recorded as deferred behaviours in section 12 by Task 8.
- **Task 10's paid run is load-bearing, not optional** (section 21): the plan
  is not complete until one real reviewer response is committed under
  `test/fixtures/recorded/` and replayed. Budget $1.25–$2.50. Outcome 5 — an
  abort on a location form the validator refuses, most likely a line range —
  is expected to be the first live result and is an operator decision, not a
  defect to fix on the spot.

**Reconciliation facts — read before touching that area:**

- Both stages abort on an unclaimed node *before* any decision row is inserted
  and before the `*.reconcile.record` summary is written; a failed round has
  only the `*.reconcile.invalid` event and the retained response.
- A recorded response cannot be replayed without the governing document it
  was dispatched with; all recorded fixtures carry their governing text.
- `test/spec-stage.test.ts` and `test/plan-stage.test.ts` each carry eight
  copies of their emitter's decision block as substitution strings — change
  the emitter's payload and those copies move with it.
- The coverage split in `src/plan-doc.ts` is the **first** `->`; `listItems`
  strips only `^-\s*`.
- Still unproven live: a `spec_review` pass over a spec-side replacement, where
  the list marker actually appears.

**Delivery stage facts:** the recorded patch base is the starting commit's
child; delivery enforces strict descent and certifies existence per declared
artifact with an `ls-tree` blob check; the record is written inside the final
transaction; terminal wedges name the repair (restore evidence or fresh run).

**Driver:** `.claude/skills/run-buildworks/web-calculator-design.md` is the
committed design, read by `driver.mjs`; a paid chain costs $1.00–$2.00 today
and the plan raises it to $1.25–$2.50; the free `smoke` (12 steps, 13 after
Task 8) spends nothing.

**Open and deferred:**

- A live spec-side replacement is unproven; needs its own authorization and a
  design shaped to provoke a criterion reword (hazard 7 forbids rerunning).
- The narrower ID-aware removal rule stays deferred; reopened only if a live
  run falsely refuses a legitimate reword.
- `scripts/doc-check.mjs` has no test — a committed test would write into the
  real `docs/` tree. Considered tradeoff.
- `npm test` intermittently leaks empty `moved` commits and a stray `base.txt`
  onto the real repo; root cause untraced; run the suite in a disposable copy.
  The code-review stage tests will add another real-repo fixture.
- Cosmetic: `taskArtifacts`'s checkbox regex reports the line one short.
- `docs/features/step6-trust-boundary/plan.md` names a session file that was
  never written; historical tier, so `check:docs` only warns.
- Delivery-check F3 and F12 deferred with triggers; `VERIFY_RETENTION_MAX_BYTES`
  is chosen, not derived; verification containment unbuilt; `.governance`
  location configuration deferred; durable knowledge tiers —
  `docs/proposals/durable-knowledge-tiers.md`.

**Nothing outside the repository is load-bearing.** Every recorded response a
test depends on is committed under `test/fixtures/recorded/` with provenance.
Scratch targets under `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\` are
disposable; query a store before `driver.mjs clean`.

**Next up:** Task 1 of the plan — the two failing registry assertions in
`test/agents.test.ts` — when the operator says to begin. Resuming starts from
`git log -1`, `git status`, this block, and the plan.

## Diagnostics quick-reference

Durable one-liners that recur, kept here because the file is the only tier
committed to the repository:

- **A tolerance applied at one boundary and not its sibling is a defect** —
  `normalizeText`, case-folding, PowerShell's BOM, `proposalIdentity`, the two
  task-artifact guards, and `normalizeNodeText` each caused one here.
- **Identify a recorded artifact revision by hash, never by dispatch order.**
  The revision on disk before reconciliation is the self-critique round's
  output, not the authoring dispatch's.
- **A zero counter in an audit summary is not evidence of a guard firing.**
  Prove the delta by replay with the mechanism's input suppressed.
- **Break-test `doc-check` against a scratchpad mirror, not the working tree.**
- **`doc-check` derives section 5's deferred list from every backticked
  `[a-z_]+` token in the whole section.** Prose added to section 5 must not
  backtick a stage name or it is counted as a deferred stage and fails the
  pin; decision records belong in sections 12 and 23.
- **Query a run's store before `driver.mjs clean`** — clean deletes the only
  record.
- **Byte-exact approval mechanics under PowerShell:** capture with
  `cmd /c "node <cli> approval-request ... > payload.json"` and sign with
  `cmd /c "node scripts/sign-approval.mjs sign --key <key> < payload.json"`.
- **Reverse a break-it mutation by editing it back, never `git checkout --`**,
  when the file also carries uncommitted work.
- **The Bash tool mangles long quoted heredocs and regex-bearing `node -e`.**
  Use the Write tool for documents and a scratch `.mjs` for escapes.
- **A shared validator reused by a new stage checks only what it was written
  for.** `validateReviewerReports` accepts any non-empty `current_artifact`
  location and checks the live `SEVERITIES`; a stage that needs a path set or
  a frozen vocabulary adds its own check and says so.

## Session records

### The code_review stage plan, reviewed and reconciled (2026-09-04)

Operator decision to build `code_review` next, minimal, fixed panel, on the
evidence of paid run 3: four artifacts delivered, every gate passed, nothing
read the code. Wrote `docs/features/code-review-stage/plan.md` via
`write-plan` (full path, ten tasks, one self-review pass, nine findings
reconciled), then reconciled the operator's standalone plan review
(`2026-09-04-plan-review.md`, five high-risk findings, all accepted). No
source touched, no spend.

#### Decisions and assumptions

- **Upstream route, decided in two steps:** first "block always, proposal at
  or above the threshold"; then, on the reconciler's recommendation, one rule
  — every upstream finding blocks and writes a `blocking_dependency` proposal.
  The candidate is derived from the finding's `subject` and decision key, so
  the shared report validator's field set does not change.
- **The paid run is the completion condition.** Section 21 and hard rule 5
  determined it, so the reconciler applied it without asking; the operator
  was told plainly that the plan cannot be called done without a $1.25–$2.50
  run.
- **The location rule is strict by design** (`path` or `path:<positive int>`)
  and a live reviewer writing a line range aborts the run. Recorded as
  outcome 5 with the remedy (accept ranges on both sides at once) named and
  not applied.
- **Severity gates here because there is no reconciliation dispatch**, and
  blocking on any finding would violate hazard 11; hazard 18 records the gap.

#### What failed

- **The plan's self-review missed four contract gaps the standalone review
  caught:** live `SEVERITIES` indexed instead of the frozen order; the shared
  validator's location tolerance; delivery not reading the code-review record
  from `last.output_ref`; the paid run marked optional against section 21.
  Each was a reuse described as stricter than the reused code is.
- **Task ordering defects in the first draft:** the CLI task extended the
  delivery fixture before delivery changed, and the policy test's module scan
  (`readFileSync`, unguarded) was fed a module that did not exist yet.

#### What worked

- **Verifying the reviewer's claims against source before dispositioning:**
  all five held (`src/reconciliation.ts:169-225`, `src/policy.ts:149-180`,
  `src/delivery-stage.ts:113-223`, `test/fixtures/recorded/`), so every
  finding was mechanical except the one product decision, which was asked
  once with symmetric options.
- **Reusing the proposal machinery as a third caller** (`writeProposalEvidence`,
  `proposalIdentity`, `store.upsertProposal`; the `route` CHECK already admits
  `blocking_dependency`) gave section 13's "somewhere to go" at near-zero code.

#### Verification

- `npm run check:docs` — clean after every edit pass; the only warnings are
  path references to files the plan will create.

#### Deferred and open

- Deferred: operator waiver for a mistaken block — recorded as a fifth
  deferred behaviour for section 12; a signed decision in the approval's shape.
- Deferred: chunked review for diffs beyond `PROMPT_MAX_BYTES` — the stage's
  reach is bounded by diff size and the plan says so.
- Open: whether a live reviewer meets the strict location form — settled only
  by Task 10.

#### Next time

- When a plan reuses a shared validator or parser, write down what it does
  *not* check for the new caller before claiming the constraint is enforced.
- Order fixture changes with the production change they depend on; a test
  helper extended one task early fails every dependent test in the interval.

#### Next up

- Task 1 of the plan, when the operator says to begin.

### Hazard 17 implemented, the list-marker remedy, three paid runs, and the driver design swap (2026-09-04, `a2db2a0`)

Executed `docs/features/normative-removal-accounting/plan.md` end to end: six
tasks, one code review (two findings, reconciled), an operator decision, and
three authorized paid runs totalling $1.98227. Run 3 completed a chain in
which a live author claimed both halves of a real replacement
(`unclaimedRemoved=0`, 11 dispatches, $1.34097). Evidence in
`docs/features/normative-removal-accounting/real-run-evidence.md`.

- **Both list-marker remedies were chosen**: `normalizeNodeText` on both sides
  of every claim comparison *and* a `nodeForm` argument stating the node form
  in the prompt. Hazards entry 3 carries the incident. General rule: "the exact
  text of X" is not a stated constraint until the prompt says what X's text
  is; the form the schema forces the author to read is the form sent back.
- **Run 2 blocked at `spec_review` for $0.39572** on that mismatch, not on the
  plan's change — measured, remedies named, none applied until the decision.
- **The clamp design was replaced by the web calculator** because a design too
  small to attract a finding exercises nothing; blast radius two constants plus
  the skill doc.
- **A rationale that cannot be broken is not a rationale** — the two claim
  counters were kept, with the comment saying what the break-it run showed.
- Suite in an isolated copy: 711 tests, 710 pass, 0 fail, 1 environmental
  skip; `HEAD` unmoved; no leak reproduced in four copies.

### Small-findings commit and the hazard 17 plan (2026-09-04, `c7fc5e0`)

Three tasks-as-state findings fixed and pushed with `9a12cba`; hazard 17
recommended and accepted on the argument that stable criterion IDs make the
symmetric delta cheap. Live proof was ruled supplementary for that plan; the
recorded replay plus deterministic tests carried it. Baseline 695/694/0/1.

### Stable criterion IDs shipped (2026-09-04, `9a12cba`)

Spec-minted canonical IDs and the exact bidirectional Coverage relation at
three plan checkpoints, proved by two paid chains (`stats` $0.63735,
`web-calculator` $0.84567). The last-arrow coverage split falsely refused
valid plans — re-derive a split when a constrained ID moves to one side of a
delimiter. Panel composition adapts to content: web-calculator seated a
security reviewer where `stats` drew consistency.

### Coverage-gate investigation and the knowledge-tier gap (2026-09-03)

No source changed; four scratch runs, $0.83080; diagnosis in
`.claude/sessions/2026-09-03-debug-plan-coverage-gate-paraphrase-mismatch.md`.
Hazard 17 was raised out of it. The repository already held the answer in
`docs/proposals/spec-kit-harness-review.md` and it was not found; a decision
that lives only in the narrative tier dies at the next compaction — durable
content belongs in `docs/hazards.md` or a proposal
(`docs/proposals/durable-knowledge-tiers.md`).

### Step 8: delivery check, the standalone review, the paid milestone (2026-09-02 to 2026-09-03)

Tasks 1-6 as `1890503`…`36a726d`, then `cf19f57`, `8646d75`, `d033595`.
Review reconciled 11 accepted, 1 deferred. The operator chose a billed
`configured_standalone` review over the in-session subagent (hazard 14) and it
earned its cost. A break mutation must change the outcome class the test pins.
The first paid attempt failed closed on an expired `claude` OAuth session with
the refusal audited. `doc-check` cannot see prose numbers.

### Step 5b: reviews, storage rebuild, proposals (2026-08-31 to 2026-09-03)

Tasks 1-13 across `60587fc`…`39d5432`. Only the operator rules on a wrong task
boundary. A reconciliation stamp is a claim, not evidence — trace the promised
result through prompt, parser, storage, and gate. A scratch `.mjs` can import
the repo's `.ts` modules via `await import(pathToFileURL(...).href)`.

### Steps 1-7: build order to the deliberate stop (2026-08-29 to 2026-08-31)

Steps 1-5 `83d88c0` and earlier; step 6 `32a714e`; step 7 smoke runs under
$0.08 each. `bw new-run` could never create a run in a repository that had not
gitignored `.governance/` (hazard 11). `resolveExisting` resolved dangling
links lexically — refuse what cannot be verified. Real smoke output must drive
prompt iteration. The plan stage mirrors the spec stage without a shared
abstraction (hard rule 4); its round-2 finding is the observation behind
hazard 16.
