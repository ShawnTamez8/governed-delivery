# Project learnings — BuildWorks (governed-delivery)

## Current state (2026-09-11, doctor implemented; live chain blocked at code review)

This block is the resume point, rewritten in place. Session records below are
history; Current state wins when they disagree. This repository file is the
system of record. Machine-local memory is only a cache and never replaces
durable knowledge here (`docs/proposals/durable-knowledge-tiers.md`).

**Working state:** Rechecked branch `cs_candidate_b`, HEAD `fbda8dd` (merge of
`code-review-stage`); doctor implementation, evidence and issue write-up remain
uncommitted. Preserve the prior `AGENTS.md`/`CLAUDE.md` updates, effort-record
`.txt` to `.md` conversion and original reconciled design review. Earlier
working-state edits are in `1cc18a8`; `86af2c0` is also in this branch's history.

**Completed:** All six Candidate B tasks at
`docs\features\doctor-ambient-config\plan.md` are `Implemented`.
Design review: 5 accepted, 6 rejected, 2 deferred, 0 open. Code review
`2026-09-11-code-review.md` is reconciled: one Medium Windows lookup defect
fixed and separately re-reviewed; eight guard mutations retained. All 14 session
tracking rows are done. The CLI plan and first review remain complete/reconciled;
`docs\features\cli-operator\2026-09-10-code-review-2.md` remains open.

**Decision locked:** Retain both whole-file fingerprints, including
`.claude.json`; disclose sensitive comparison metadata when output is shared.
No credential-value hashing or new runtime persistence/transmission.

**Live result:** The separately authorized chain used 16 dispatches and cost
$2.4481306 ($2.44813 rounded). After one remediation, final high finding 5 blocked
code_review; no delivery. Native probe/ambient components passed afterwards.
Source inspection confirms all-button Enter deferral conflicts with AC-013;
native browser behavior and the optional generated-unit replay remain unverified.
`docs/proposals/code-review-remediation-contract-drift.md` recommends a defect
follow-up, not an automatic spike. This is a recommendation, not an approved
repair plan; a different interaction policy needs an explicit upstream decision.

**Running state:** No session-owned paid process remains. Shell
`doctor-live-20260911` ended exit 1; final writer absent. Retain:
`C:\Users\tamezs\buildWorks_test_repos\2026-09-11-doctor-ambient-config-173648`;
`paid\target` owns run 1 and `.governance\worktrees\1`; `paid\keys` owns disposable
keys, `smoke` the free target, and `paid.log` the transcript. All envelopes are in
`test/fixtures/recorded/doctor-ambient-config-web-calculator-live-chain.json`.
Owned diagnostic mirrors/helpers are gone. Prior targets/keys were not rechecked.

**Locked scope:** The implementation request superseded planning-only authority;
the separately authorized 17:36 Pacific full run included disposable signing and
is consumed. Later requests authorized issue documentation and compaction only.
No repair, second paid run, commit/push/merge, publication or target cleanup.
General CLI consent still ends at approval/terminalization, excludes signing and
later invocations, and preserves full arrays. Guided age refusal does not change
low-level spec/plan; accepted approval expiry does not revoke the grant. Only
code_review has bounded-remediation authorization.

**Open/deferred:** Pi needs a revision-grounded support evaluation and a deliberate
architecture sequencing decision; the binding build order has not been amended.
Pi remains additional support, not replacement or an emergency workaround.
Candidate A awaits real provider/intake work. Candidate B's optional interface
snippet and duplication-driven formatting helper remain deferred. Its execution
evidence is Windows-only: POSIX, privileged file symlinks, actual ACL launch denial,
UNC and explicit DOS-device input execution are not established. The CLI analysis
still owns inbound object/revision/provenance, executable tasks, Spike identity and
outbound ownership/App/visibility/publication questions. Intermediate stop control,
packaging, general repair, hard dollar caps, new stages, `--json-schema` and stronger
artifact verification remain excluded; QA should compose existing patch/verification
modules. Hot-journal behavior is measured, not an open experiment.

**Next up:** Await operator selection/authorization of the proposed
contract-preserving correction and event-level reproduction. The doctor feature
is complete; the separate live target stays blocked. No automatic spike or retry.

## Diagnostics quick-reference

Durable project facts belong here, regardless of whether a host also caches them.

- Boundary asymmetry caused seven defects, most recently in `validateCodeReviewLocations`; inspect both paths.
- Put field/section constraints in prompts: parser-only rules killed three paid runs. `CONSTRAINT_STRINGS` scans source, so wrapping a phrase can fail it.
- "Fenced block is not valid JSON" names the candidate, not the cause; retained `\UXXXXXXXX` bytes came from the provider, not terminal corruption.
- Native `claude.exe` needs no shell wrapper: removing the shim assumption avoids DEP0190 and preserves typed ENOENT.
- Hazard 1 omitted a shape that blocked a paid run despite all enumerated cases passing; fixtures do not prove universal parser coverage.
- A code_review block is a result, not a driver fault; a pass can retain findings. Read the final panel and frozen verification commands.
- Identify revisions by hash, not dispatch order; zero audit counters do not prove guards fired.
- Break-test doc-check in a mirror. `checkPaths()` recursively includes AGENTS/.agents; tiers classify, not select. Rooted-path recognition is narrower; section 5's deferred list is every backticked `[a-z_]+` token.
- Windows `TEMP=...\AppData\Local\Temp\1`, `PerSessionTempDir=1` and
  `DeleteTempDirsOnExit=1` put default driver targets on a logoff deletion timer.
  Four September 7/9 stores were lost by September 10; use a fresh child of
  `C:\Users\tamezs\buildWorks_test_repos` and extract load-bearing responses into
  `test/fixtures/recorded/` immediately. A non-temp path is not an independent backup.
- Query before driver clean deletes store/raw evidence. Cost joins through `stage_id`; the table is `audit`; finding IDs span document/code review.
- `| tail -N` buffered paid output; redirect logs and inspect state. A timed-out wait can leave the chain running; never relaunch it blindly.
- The driver signs Buffer bytes over stdin without a shell; historical PowerShell `cmd /c` redirection is approval transport, not a launch fix.
- Restore only the break mutation, hash before/after, anchor a unique expression rather than CRLF indentation. Shell-true `--test-name-pattern` lost `(`/`|` and exited 255.
- Bash heredocs/regex `node -e` were mangled; scratch `.mjs` worked. A bare Python heredoc hung on a host without Python.
- Shared validators prove subsets; callers project findings/commands/metadata. Malformed display fields get limitations, not stronger gates.
- `Store.exec` forbids audit writes; model a missing gate by not appending its event.
- Mechanical doc renames invented paths/binaries/model IDs; restore byte-exact originals. Missing status/disposition means unreconciled.
- Read every adjacent review before planning from a proposal.
- Read-only Git needs `--no-optional-locks` and `-c diff.autoRefreshIndex=false`; index refresh was measured without the latter.
- A hot journal made read-only SQLite return 776 without writes; explicit fixture migrate recovered committed rows without replay. Readers never repair.
- `envPassthrough` freezes names, not values/files. Doctor now supplies its captured filtered map; dispatch's bare probe still inherits by default. A doctor pass is not auth proof.
- Node `statSync` adds extended Windows path semantics; native executable lookup does not. Doctor's DOS-device attribute query preserves native normalization while selected/probed spelling stays unchanged.

## Session records

### PowerShell paid chain exercises remediation and completes (2026-09-09)

Unchanged driver/design, PowerShell 7.6.5 -> Node26.4.0 -> Claude2.1.263 without
cmd: high/medium findings, one patch, version checks, clean second panel/delivery;
$2.40174/16 dispatches, driver15/15, smoke13/13, valid audit. Five provider bodies,
provenance and records are in
`test/fixtures/recorded/code-review-web-calculator-powershell-remediation-chain.json`.
`2026-09-09-paid-powershell-chain.md` retains source hashes, commands and the
null-prototype export correction; no browser check or causal shell comparison.

### Copilot skill portability aligned (2026-09-08)

Canonical `.claude` project skills/shared learnings; six global workflows use
`.copilot/skills/` through `.agents` junctions. Records are not hooks.
`2026-09-08-copilot-skills-audit.md` preserves recovery paths and corrections to
names, oversized entries, unavailable calls, paths and task defaults; 17
frontmatters passed, with no runtime/paid target/global Codex or Claude edit.

### Paid evidence: implementation block, then clean completion (2026-09-07)

Two authorized 16-dispatch-bound chains: 11/$1.00548 blocked at
`implementation.content.invalid` (`\U0001f319`, offsets1911/9505); replacing only
those tokens validated five files, not a shell cause. Then 13/$1.39473 completed
with a clean first panel, four artifacts at `b0b1104dc0b045dbc3d8c116ba44e9ed894200e4`,
valid audit and operator manual calculator check (no detailed matrix). Five reviewer
fixtures, focused9/9 and types/docs/diff passed; prior821/822 with symlink skip.

### Extractor fixed; two chains correctly block at code_review (2026-09-06)

- `docs/features/unfenced-json-extraction/` fixed run 3's prose-before-JSON with
  remedies 1–3, not prompt remedy 4; prose-after remained unbuilt absent evidence.
  `a2db2a0` list-marker normalization is a different layer.
- Separately authorized runs 4/5 correctly blocked on high code findings, each
  13 dispatches ($1.15759/$1.40170); no gates weakened. Code-review Task 10 and
  plan-coverage Task 7 closed; two live panels produced task findings, not a second artifact.
- Three reviewer captures required real stage context; an invented AC-016 causal
  example failed review. Trace criteria and changed paths, not just stage order.
- Mirror 784 tests: 782 pass, one skip, one load flake (isolated 3/3); parse/reconcile
  59/59 and review-stage 39/39 before third replay. All replays passed; fallback
  removal broke four assertions, severity/location mutations broke both correctness
  replays, restorations were byte-exact; smoke 13/13 and types/docs passed.
- Historical branch point `a12f3cf` was then master/origin/master, not current-tip evidence.

### Two membership fixes and an agent-portability mirror (2026-09-05/06)

`spec-section-membership` (eight tasks) and `plan-coverage-single-artifact` (seven)
had two independent reviews each on code-review-stage. Coverage is a representative
delivery anchor; the invented separator heuristic was removed. Paid blocks at stage
5/$1.25141 and stage 1/$0.08103 proved membership live on the second before reading
the proposal review. Invented AGENTS/.agents paths/binary/models were restored;
reviews caught two missing `not_applicable` prompts and two overstated parser claims.

### The code_review stage implemented (2026-09-05, `6fb5412`, `4d71ad1`)

`docs/features/code-review-stage/plan.md` Tasks1-9 shipped with separate review
and 19 mutations; only code_review lifted step9. The code-only loop replaced its
original terminal-block/upstream-proposal policy. Reviews caught four overstated
reused contracts, then closed delivery-binding, verification-label and typed-patch
defects on September7. First paid attempt blocked at spec_review; panel size,
round count and severity stay independent.

### Hazard 17, the list-marker remedy, and the driver design swap (2026-09-04, `a2db2a0`)

Both `normalizeNodeText` sides and prompt `nodeForm` were chosen: specify what
"exact text" means. Web calculator replaced clamp to attract real findings;
run 3 completed at $1.34097 with a grounded replacement (`unclaimedRemoved=0`).
A rationale that cannot be broken is not a rationale.

### Earlier history (2026-08-29 to 2026-09-04)

- **Stable criterion IDs** (`9a12cba`): spec-minted canonical IDs and the exact
  bidirectional Coverage relation, proved by two paid chains.
- **Coverage-gate investigation** (2026-09-03): the answer already lived in
  `docs/proposals/spec-kit-harness-review.md` and was not found — a decision
  that lives only in the narrative tier dies at the next compaction.
- **Step 8, delivery check** (`d033595`): a billed standalone review beat an
  in-session subagent (hazard 14); a break mutation must change the outcome
  class the test pins; the recorded patch base is the starting commit's child.
- **Step 5b** (`60587fc`…`39d5432`): only the operator rules on a wrong task
  boundary; a reconciliation stamp is a claim, not evidence.
- **Steps 1-7** (`83d88c0`, `32a714e`): `bw new-run` could never create a run
  in a repository that had not gitignored `.governance/` (hazard 11);
  `resolveExisting` resolved dangling links lexically — refuse what cannot be
  verified; the plan stage mirrors the spec stage without a shared abstraction
  (hard rule 4).

### CLI planning groundwork and GitHub impact reconciled (2026-09-09)

Operator chose `2026-09-09-docs-cli-operator-analysis.md`, not the outbound proposal,
for 18 criteria/boundaries/transactional exceptions/distribution limits.
`docs/proposals/2026-09-09-github-project-projection-and-upstream-spikes-review.md`:
5 accepted/5 deferred/0 rejected/open; proposal unchanged.
`2026-09-09-cli-github-impact-analysis.md` is closed history; corrected age trace
names four downstream entries, not spec/plan. Types/docs/criterion assertions passed.

### CLI operator plan review reconciled (2026-09-10)

The 22 dispositions preserve full consent, complete arrays, raw approval bytes and
bootstrap criteria; three critical corrections require full-suite/bounded-probe/crash
recovery evidence. Planning assertions cover 18 criteria, nine tasks, 15 errors and
lifecycle with CRLF/unscoped-table corrections; reconciliation grants no spend.

### CLI operator implementation evidence (2026-09-10)

`2026-09-10-cli-operator-implementation.txt` retains commands, ten late mutations
and full approval testing after a contributor's external-signing filesystem limit.
Deviations: target-relative evidence, disabled diff refresh, shared extraction;
no stronger gate/schema. Standard I/O is the runner seam; stages own gates.
An invocation never retries failed groups, including rolled-back delivery.

Restored stderr beside JSON, counted attempts after fallible setup, reloaded
serialized profiles and set an explicit absent external key. Lowercase `# design`
was required grounding; ascending severity and unattempted-group accounting needed
correction. Failed dispatches return audited reasons, not separately retained stderr.
The stdout mutation failed `2 !== 1` at `operatorEnvelope`; TypeScript mirrors
under node_modules failed before assertions. Restorations were byte-exact; reviewer
ran initially sampled suites and withdrew the over-refusal-only guarantee.

One-profile CLI/approval/repeat-no-op, calibrated `gh` sentinel, and README
rows/files/index preservation passed; omission failed then restoration passed.
CLI108/full1071 passed plus one OS symlink skip; types/docs/diff passed.
CLAUDE/AGENTS matched, architecture stayed in sections15/19; no production rollback.

### Operator-requested follow-up code review (2026-09-10)

Fresh `gpt-5.5` HEAD/untracked review: nine index/key-isolation/delivery-retry cases
and docs/types/diff passed (63 warnings); full suite was prior evidence. Physical
EOF resolved nonempty-line counting; source/README hashes matched. DEP0190 had no
retained traced origin, so no runtime/fixture attribution was made.

### cc-switch reviewed and rejected as a harness abstraction (2026-09-11)

`docs/proposals/cc-switch-review.md`: switching is no adapter substitute;
MHA-03 argv/envelope and MHA-01 sequencing remain. Candidates A (frozen non-secret
env) and B (doctor reporting) do not discharge them. A new env field needs no
migration but invalidates canonical bindings; land between runs. Filtered overrides
do not contain ambient home files. No `~/.cc-switch` or `ANTHROPIC_*` was observed;
this was prevention, not a measured incident. Types/docs/paths passed, 63 warnings.

### Pi support assessment and retained Claude acceptance chain (2026-09-11)

Full research limits, findings, commands, retained paths and per-dispatch ledger:
`2026-09-11-pi-assessment-and-prior-claude-chain.md`. Pi remains additional support,
not an approved adapter. The earlier Claude2.1.269/Sonnet5 run completed with
16 dispatches/$2.0585392 and a non-blocking medium correctness finding after
remediation; its final panel was not clean. Six artifacts delivered at
`8cd5a2d9b959f4eb215b71feae690a9b1a14b2d2`; only version commands ran.
That prior run's external paths were not rechecked during this compaction.

### Doctor implementation, live block and triage (2026-09-11)

#### Decisions and assumptions

- Authorization progressed through implementation, one paid chain, issue
  write-up and compaction; no repair/publication/retry followed. The `retain`
  choice preserves same-size detection, not field inference.
- Planning review overstated a crash and inferred gaps from presentation;
  all 13 dispositions preserve the original evidence. Independent bare-name
  parity, non-gating AC-009 and narrow file errors remained the contract.

#### What failed

- Nested test registration produced wrapper-only greens; module-scope placement
  restored discovery. Native-valid `first.` exposed Node stat/native lookup
  divergence; the query-only correction has its own eighth mutation record.
- Owned-fixture teardown once returned `EPERM`; no child remained, explicit
  cleanup and unchanged rerun passed. Its transient cause remains unknown.
- The paid chain lasted20m17.831s,16 dispatches/$2.4481306. Correctness finding4
  triggered one patch; final high finding5 blocked. Security returned no findings.
  Final commit `511f64bbb34d3ed0c8066a7fd8fb4945dc6ba54e`; no delivery.
- AC-013 maps Enter to equals; remediation added an all-button exception and
  assertions blessing it. The first report's preferred Backspace outcome was not
  the requirement. Source conflict is established; native browser ordering is not.
- Optional unit replay never reached calculator assertions: bare-JSON extraction,
  inherited `type:module`, then an invalid package-identity check obstructed the
  diagnostic tooling. `2026-09-11-code-review-block-triage-evidence.txt` retains
  the limits; no product-suite pass/fail is claimed.

#### What worked and where to resume

- `2026-09-11-doctor-ambient-config-implementation.txt`:203 passes/four skips,
  seven prescribed mutations; post-fix52 passes/four skips, three ambient CLI
  passes and separate review closure. Planning/docs/types had63 historical warnings.
- `2026-09-11-doctor-ambient-config-live-run.txt` and the recorded live-chain JSON
  preserve all16 envelopes,13 artifacts, costs, hashes and unchanged runtime
  identities. Driver10/15 reflects the gate/no-delivery consequences; audit valid.
- Post-run doctor components passed; overall readiness refused the blocked boundary
  and generated untracked spec/plan. Frozen commands checked Node/npm versions
  only. No generated-test or browser result follows from them.
- Canonical environment reads preserve Windows key casing; owned home/native
  copies isolate bypass callers. Native execPath can retain dot-dot spelling;
  NTFS numeric identity mutations must actually differ. Detailed proofs remain
  in the implementation, discovery-debug and mutation records.

#### Next up

- Await operator authorization for the proposal's bounded correction/reproduction.
  Defect triage rather than automatic spike creation is a recommendation only.
