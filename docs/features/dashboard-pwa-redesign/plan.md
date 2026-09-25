# Dashboard PWA Redesign Implementation Plan

**Status:** Reconciled. Revision 2 of the mockup, with its follow-ups (repository scoping, run progression, the usage pair, and the Models view), was approved by the operator on 2026-09-24. The Task 1 mockup was reviewed by the operator on 2026-09-24 (`mockup-feedback.md`, reconciled), and revision 2 was built the same day. Task 2 is complete (2026-09-24): the `byAgent` test passes, it failed under both break mutations, `operator-state` and `cli-operator` pass 189 of 189 from the tool shell, and `npm run typecheck` is clean. Tasks 3, 4, and 5 are complete (2026-09-24; see their Results). Task 6 is next; until it lands, five structure-pinning tests in `test/dashboard-ui.test.ts` fail as that task expects.

**Goal:** Replace the dashboard's presentation with a dense, restrained operator console built on the TheSnitch design language, installable as a per-launch Progressive Web App. It observes runs through a bounded, read-only auto-refresh, keeps every read-only, loopback, and presentation-honesty guarantee, and corrects four existing honesty defects.

**Source:**
- The operator's 2026-09-24 request: a complete UX redesign using `C:\Repositories\AI.Tools\TheSnitch\public\style.css` as the foundation, refactored as a Progressive Web App. It is to be dense, enterprise-grade, accessible, and restrained, with light workflow-state animation. Excluded: Tailwind, shadcn, a Bootstrap look, gradients, glow, glassmorphism, and decorative empty space.
- Operator decisions on 2026-09-24:
  - **Per-launch install.** A manifest, icons, and a service worker that caches only the static shell and never `/api/`. No port, token, or security-boundary change.
  - **Review gate.** This plan plus a static mockup built from real recorded run data, approved in both themes before `src/dashboard/app.js` changes.
- The operator's review of the first mockup, `docs/features/dashboard-pwa-redesign/mockup-feedback.md`, and the three decisions taken while reconciling it:
  - **Page tabs under the header**, becoming a bottom bar on phones.
  - **Authorize read-only polling**: a bounded, visible-only auto-refresh, recorded as a new `ARCHITECTURE.md` decision.
  - **Extend the projection.** `RunSnapshot.cost.byAgent` carries each agent's recorded roles, requested and effective models, and summed duration. Removing it later means deleting the fields and their rendering; `Unavailable` stays the fallback wherever `effective_model` is null.
- The operator's follow-up on revision 2 (2026-09-24):
  - the repository select must visibly scope the views;
  - the stage map's title ("Where runs are · recorded stage order") read as an implementation concept;
  - Tokens and Known cost should be presented as a related pair.
- Governing constraints: `ARCHITECTURE.md` hard rule 2 and the section 23 dashboard authorization, `CLAUDE.md`, `docs/hazards.md`, and `.claude/sessions/project-learnings.md`.

**Hazards considered:**
- **2.** Evidence availability stays explicit. Stale, loading, unavailable, and unreported values keep their labels. The header status pill names the freshness of what is on screen. Method explanations move behind an on-demand control, but no qualifier that changes how a visible value reads is removed.
- **4.** The existing test pinning `auditIntegrity === "verified"` agreed with a fabricated implementation. Every new expected value therefore comes from real `Store` rows or the recorded snapshots named below, and every new guard is break-tested.
- **10.** Recorded model identifiers stay verbatim. The agents table shows each agent's recorded effective model, with the requested model on hover, exactly as the row stored it. It shows `Unavailable` where `effective_model` is null, with no alias matching or inference.
- **12.** Each configured repository keeps its own identity and refusal state. There is no cross-repository merge of configuration.
- **14.** Recorded reviewer identity is shown as recorded, never as an independence claim. The required-specialist check says `Not evaluated`, because the record binds no specialty to an agent.
- **18.** A passed stage or verification observation is shown as recorded evidence, never as product correctness. The Verification check states that the frozen commands are version checks only, and the redesign removes the one place that asserted an unproven property.
- **Weighed and not bearing: 1, 3, 5–9, 11, 13, 15–17.** They concern provider output, prompts, stage execution, and Windows launch, none of which this presentation-and-projection change touches.

**Assumptions:**
1. The CLAUDE.md rule against importing patterns from other codebases targets design and code assumptions. The operator's explicit direction to use the Snitch stylesheet is honoured for visual tokens and component vocabulary only. Snitch patterns that conflict with this repository are excluded:
   - `outline: none` (`.denial-steering-input:focus`);
   - `backdrop-filter`;
   - glow `box-shadow`s;
   - emoji glyph icons;
   - `!important` outside the reduced-motion block;
   - the inline theme `<script>` (the dashboard CSP is `script-src 'self'`).
2. The existing token *names* remain the stylesheet contract, so the contrast tests keep guarding every theme. They are `--background`, `--panel`, `--text`, `--muted`, `--primary`, `--success`, `--warning`, `--error`, `--critical`, `--active`, `--neutral`, `--surface-raised`, `--surface-sunken`, `--accent`, `--accent-wash`, and `--focus`. Snitch values are mapped into them.
3. The six views, their `ALLOWED_TABS` identifiers, and the `routeHash`/`parseRoute` format stay unchanged.
4. An installed app is bound to one launch's origin. After `bw dashboard` restarts, the operator opens the newly printed URL. This is the accepted limitation of the per-launch decision, not a defect.
5. Recorded evidence for the mockup comes from three retained stores under `C:\Users\tamezs\buildWorks_test_repos` (durable target storage per `CLAUDE.md`), observed through the dashboard API at 2026-09-24T08:15:57Z:
   - `target-tap-live-2\target` run 1: blocked at `code_review`, 13 findings, $3.5893264.
   - `target-tap-live\target` run 1: blocked at `plan_review`, 6 findings, $1.553664.
   - `target` run 1: `web-calculator`, completed, 10 findings, $2.0585392.

   Per-agent role, model, and duration values come from a read-only query of those stores' `agent_run` rows. The stores are the durable source. The session-scratchpad copies can be re-fetched by relaunching the free, read-only dashboard against `C:\Users\tamezs\buildWorks_test_repos\dashboard-repositories.json`. Tests never read these stores.
6. Liveness is observable only through the repository writer lock (`src/lock.ts` `inspectLock`: `live`, `dead`, `absent`, `unreadable`, re-checked with `isAlive(pid)` on every read). The lock is repository-wide and names a process, not a run or an agent (`README.md`: "Neither a lock PID nor heartbeat identifies an active agent"). The live signal therefore says "Writer live in this repository" and nothing stronger.
7. The auto-refresh interval (15 seconds) is a dashboard presentation constant, not run configuration. Hard rule 6 governs run configuration, which the dashboard never changes.

**Approach:** Build the design system as a standalone stylesheet and exercise it in a static mockup whose values come from the real projection functions over the three recorded snapshots. The operator reviewed revision 1, and revision 2 absorbs that review; stop again for approval. Then:
1. Extend the `byAgent` projection test-first.
2. Correct the model's honesty defects and add the new pure projections test-first.
3. Record the observation decision and add the bounded auto-refresh.
4. Replace the renderer view by view against the approved markup.
5. Add the PWA shell: manifest, icons, static-only service worker, server routes, and CSP directives.
6. Rewrite the structure-pinning tests to pin the new invariants, and update the current-tier documents.

**Affected areas:**
- `src/dashboard/`: all four assets plus new PWA assets.
- `src/dashboard-server.ts`: static route map and CSP only.
- `src/operator-state.ts`: `cost.byAgent` gains five additive fields.
- Tests: `test/operator-state.test.ts`, `test/dashboard-ui.test.ts`, `test/dashboard-server.test.ts`.
- One new icon generator under `scripts/`.
- `README.md`: the dashboard section, including the "no polling" sentence.
- `ARCHITECTURE.md` section 23: one dated observation decision and one service-worker sentence.
- `docs/features/dashboard-pwa-redesign/`.

No change to `src/operator-read.ts`, `src/store.ts`, migrations, CLI commands, policy, harness, or stages.

**Known blockers:** None unresolved. Verified constraints:
- The server serves exactly four static routes. Its CSP `default-src 'none'` blocks a manifest and a worker until `manifest-src 'self'` and `worker-src 'self'` are added (`src/dashboard-server.ts`, `SECURITY_HEADERS` and `assets`).
- Each launch mints a new port and bearer token held in `sessionStorage`, so installation is per launch.
- The CSP forbids inline style and inline script, so theme and state are class- and attribute-driven, and proportion bars are SVG geometry, not style.
- `README.md` line 399 states "there is no polling, push, or WebSocket connection". `ARCHITECTURE.md` section 23 forbids WebSockets and notifications but says nothing about polling. Task 4 records the new decision before any timer lands.
- `test/dashboard-ui.test.ts` forbids `setInterval` in `app.js`, and `app.js` has no `setTimeout` today.
- The repository has no DOM or service-worker runtime. Browser behaviour is therefore proved by pure-function tests, a `node:vm` harness for the worker, and an operator visual pass.
- `test/cli-operator.test.ts:1394` fails when the suite runs from the assistant's tool shell and passes in the operator's terminal (`.claude/sessions/project-learnings.md`). A full-suite result from the tool shell reports it separately.

**Blast radius:** Verified by search on 2026-09-24.
- **Dashboard assets.**
  - `src/dashboard/dashboard-model.js` is imported only by `src/dashboard/app.js` and `test/dashboard-ui.test.ts`.
  - `src/dashboard/app.js` is imported only by `test/dashboard-ui.test.ts` and loaded by `src/dashboard/index.html`.
  - `src/dashboard-server.ts` reads the dashboard assets by path and is exercised by `test/dashboard-server.test.ts`.
- **Type-check programs.** `tsconfig.dashboard.json` type-checks `src/dashboard/*.js` and `test/dashboard-ui.test.ts` with DOM libraries. Its glob would pull in a new `src/dashboard/sw.js`, whose `webworker` globals conflict with the DOM lib, so Task 10 excludes it there and checks it as its own program.
- **Removed model functions.** `portfolioStatusBanner`, `commandCenterKpis`, `deliveryPipelineStages`, `governanceHealthSummary`, `modelAssignmentsSummary`, and `dataQualitySummary` have no caller outside `app.js` and `test/dashboard-ui.test.ts`. The only other mention is the historical `docs/features/dashboard-redesign-3/plan.md`, which is not edited.
- **`RunSnapshot.cost.byAgent`.** Built at `src/operator-state.ts:377` and typed at `:129`. It is read by `src/dashboard/dashboard-model.js`, `test/cli-operator.test.ts:2404`, and `test/operator-state.test.ts:140,143,286`. A recorded fixture under `test/fixtures/recorded/` contains a `byAgent` array that no test references. The new fields are additive, so existing readers keep working. `status --json` gains the same fields, which is acceptable because nothing has shipped (hard rule 3).
- **Unavailability sites.** The extension makes three existing statements false, so they are changed with it:
  - `AGENT_MODEL_UNAVAILABLE` (`dashboard-model.js:44`, used at `:484`; tests at `test/dashboard-ui.test.ts:490,823`);
  - `AVERAGE_EXECUTION_UNAVAILABLE_REASON` (`:45`, `:366`; `app.js:782`; test `:294`);
  - `dataQualitySummary.missingExecutionDuration` (`:1691`; test `:413`).
- **Unchanged.** The HTTP API routes and envelopes are unchanged.

**Verification:**
- `npm run typecheck`.
- `npm test`. The `test/cli-operator.test.ts:1394` environment exception is reported separately and never diagnosed from the tool shell.
- `npm run check:docs`.
- A break-test for every new or changed guard: change the behaviour, see the named test fail, and restore by reversing only that edit.
- A free, read-only `bw dashboard` launch against `C:\Users\tamezs\buildWorks_test_repos\dashboard-repositories.json`. Inspect it:
  - at 1440, 1024, 390, and 320 CSS pixels;
  - in light and dark themes;
  - under forced colours;
  - with keyboard only;
  - with the browser's installability report.
- No provider spend.

**Self-review:** One end-to-end critical pass on 2026-09-24; six material findings reconciled inline:
1. *Removal ordering:* deleting model functions before the renderer is replaced would break every test in `test/dashboard-ui.test.ts`, because it imports `app.js`, which imports them. Removals therefore happen in Task 5 Step 3.
2. *Worker type-checking:* the DOM and `webworker` libs conflict in one program. Task 10 creates `tsconfig.worker.json` and excludes `sw.js` from the dashboard program.
3. *Existing tests pin Defects B and C:* `seedPartialRun` records an addressed high finding, which the command-center test requires to appear in the attention queue, and the banner assertion requires "1 open finding". Tasks 3 and 5 change or remove those assertions deliberately (hazard 4).
4. *Decision helper:* `insertFindingDecision` is a `Store` method that requires grounding for `rejected_with_rationale`. Task 3 Step 2 names it correctly.
5. *Documented but absent shortcut:* `README.md` documents `?` for the shortcuts dialog, and no code handles it. Tasks 5 and 6 add and pin it.
6. *Top-bar width contract:* the `#repository-filter` `min(32rem, 100%)` assertion cannot hold in the header. Task 6 changes that literal deliberately.

---

## Diagnosis of the current dashboard

The operator's complaint is "ugly and too much text". Reading `src/dashboard/index.html`, `src/dashboard/styles.css`, and all of `src/dashboard/app.js` confirms both, and exposes four honesty defects that a restyle would otherwise carry forward.

- **Generic palette.** `styles.css` is Tailwind's slate and cyan scale (`#f8fafc`, `#0f172a`, `#0e7490`, `#67e8f9`) in Inter: the stock look the operator rejects.
- **Prose as chrome.** Method is explained in prose throughout:
  - the header carries a sentence ("Local loopback projection — read-only…");
  - the filter bar carries a sentence about metrics scope;
  - the footer restates it a third time;
  - nearly every panel opens with a `source-note` paragraph explaining method. The Runs view alone renders eleven such paragraphs before the first run row.
- **Developer identifiers as labels.** Overview, Governance, Models, and Audit scope headers print the base64url SHA-256 repository ID (`Inspecting: EjGv-o4zKl4h… / Run #1`) instead of the recorded project identity that `repositoryIdentity` already derives.
- **Defect A — fabricated audit claim.** `governanceHealthSummary` returns `auditIntegrity: "verified"` unconditionally, and `renderGovernanceHealth` prints "Verified Hash Chain". Nothing in `RunSnapshot` verifies the audit chain; only `verify-audit` does. The test at `test/dashboard-ui.test.ts` (command-center projections) pins the fabricated value.
- **Defect B — "open" findings are all findings.** `commandCenterKpis` labels `portfolio.findings.value` "Open findings", with the formula "recorded without an addressed or approved waiver decision". The value is actually the total canonical count. For the completed `web-calculator` run it reads 10 open, while the recorded dispositions are 8 `addressed` and 2 with no decision.
- **Defect C — the attention queue ignores dispositions.** `needsAttentionQueue` lists every critical or high finding as "Open … has no approved resolution", including findings whose recorded disposition is `addressed`.
- **Defect D — the pipeline misorders the run.** `deliveryPipelineStages` maps recorded stages onto eight invented steps. It places Approval seventh although `awaiting_approval` is recorded third, and it synthesizes a Governance step with `stageId: null`. The stage vocabulary is not enumerated in `src/` (see the `doc-check` skill's pinned-sequence note), so a dashboard-side sequence is duplicated policy.
- **Shortcut drift.** The shortcuts dialog advertises `g o`, which `shortcutDestination` does not handle. `g r`, `g f`, and `g a` focus an element ID that exists only when the matching view is already rendered.
- **Unreported, but recorded.** The Models view says per-agent model and average execution time are unavailable. `agent_run` records `role`, `requested_model`, `effective_model`, and a non-null `duration_ms` for every row, and the recorded runs report an effective model on all 42 rows. The projection simply never carried these fields.

## Design system

The console's character comes from one idea: **the run is a ledger of governed stages, and gold marks only what needs the operator.** Everything else is quiet.

### Tokens (Snitch values mapped into the existing contract)

| Token | Dark (`[data-theme="dark"]` and system-dark) | Light (`:root`) | Role |
| --- | --- | --- | --- |
| `--background` | `#0B0B0E` | `#F5F4F0` | page |
| `--panel` | `#121316` | `#FFFFFF` | regions, cards, table body |
| `--surface-raised` | `#1B1D21` | `#F0EFEB` | table headers, pills, drawer header |
| `--surface-sunken` | `#0F1013` | `#FAFAF8` | inputs, code, command text, group heads |
| `--border` / `--border-strong` | `#292B30` / `#6A6C74` | `#DEDCD5` / `#8E8C84` | hairlines / control edges and the tab-band rule (3:1 on `--panel`) |
| `--text` / `--muted` | `#ECEDEE` / `#A4A6AD` | `#252622` / `#62625C` | text |
| `--primary`, `--accent`, `--focus` | `#D4AF37` | `#7A5D08` | gold: focus, selection, pressed filter, primary action |
| `--accent-wash` | `#262216` | `#F6EFD9` | gold background for selected and pressed states |
| `--success` | `#82B99B` | `#33704F` | passed, completed, reporting complete |
| `--error` | `#F08888` | `#A8313C` | blocked, high |
| `--critical` | `#FF9AA5` on `--critical-wash` `#3A1A20` | `#8A1A2A` on `#FBEBED` | critical; filled blocked and blocking states |
| `--warning` | `#E0A36A` | `#8F4A12` | open, stale, partial coverage (clay, deliberately not gold) |
| `--active` | `#8BA6BD` | `#43657E` | in progress, live, loading |
| `--neutral` | `#A4A6AD` | `#62625C` | not reached, not evaluated, not collected |
| `--hatch` | `#6A6C74` | `#8E8C84` | the stopped-run cell (3:1 on `--panel`) |

Task 1 computed every text and surface pair with the contrast function copied from `test/dashboard-ui.test.ts`:
- every foreground token is at or above 5.1:1 on every surface in both themes;
- every series colour is at or above 5.6:1 on `--panel`;
- control edges and the hatch reach 3.37:1 (light) and 3.55:1 (dark).

The values above are the adjusted results; the Snitch `--border-strong` (about 1.9:1) was too faint for a control boundary. The Snitch light `--text-dim` `#72726B` on `#F0EFEB` is about 4.2:1 and is replaced. The dashboard uses `--muted` for secondary text and has no third text tier. A filled state badge tints its own tone at 10% over `--panel` (`color-mix`), which keeps its text above 5.7:1 in both themes.

Eight series colours serve charts (stages and agents, not state). In dark they are gold, steel `#8BA6BD`, lilac `#B19DC4`, sage `#82B99B`, clay `#E0A36A`, rose `#EEA0A7`, sand `#BAB3A1`, and teal `#7FB8B5`, with darker light-theme counterparts proven at 3:1 on `--panel`. Cost bars do not use them: relative cost is drawn in muted `--border-strong`, because the size is the message.

### Type, spacing, shape

- **Faces.** The UI face is `"Segoe UI", system-ui, sans-serif`. The data face is `"Cascadia Code", Consolas, monospace` for every identifier, hash, path, command, count, and currency, with `font-variant-numeric: tabular-nums`.
- **Scale.**
  - 10–11px: column labels and meta.
  - 12px: table cells and controls.
  - 13px: body.
  - 16px: view title.
  - 22px: status-card values only.

  Column and section labels are 10–11px uppercase with 0.08em tracking (the Snitch `.eyebrow`). A label replaces a sentence wherever a sentence was naming a thing.
- **Spacing.** A 4px grid (`--space-1` 4px … `--space-6` 32px). Rows are 40px in tables and 52px in attention items. Region padding is 12px/16px. No region exists to create empty space.
- **Radius scale.**
  - `--radius-xs` 4px: badges, tags, key caps.
  - `--radius-sm` 6px: buttons, inputs, selects, chips, tabs.
  - `--radius-md` 8px: popovers, search results, menus.
  - `--radius-lg` 12px: cards, regions, table wrappers, sections.
  - `--radius-xl` 16px: drawer (leading corners) and dialog.
  - `--radius-pill` 9999px: status pill, dots, count pills.
- **Shadows.** Floating layers only (drawer, popover, search results); regions and cards use a hairline border, never a shadow.

### Two badge shapes

Severity is an **outline** badge (`HIGH`). Workflow state is a **filled tint** badge (`BLOCKING`, `OPEN`, `BLOCKED`, `PASSED`, `NOT EVALUATED`). They never share a shape, so a reader cannot take severity for state.

### The stage ledger (signature element)

Each run is drawn as a horizontal ledger of its **recorded** stages in recorded order:
- one 10×6px segment per stage: passed = `--success`, gate-blocked = `--error` (taller), open = `--active`, other = `--neutral` outline;
- when the run is not completed, a terminal cell follows: hatched for "stopped here", or an outline for "in progress".

Segment width is fixed, so across runs the ledger length itself shows how far each run got: 5 segments for the `plan_review` block, 8 for the `code_review` block, and 9 for the completed run. No unrecorded future stage is drawn, so no sequence is duplicated from policy. The ledger appears at micro size in every run row. At full size, atop the run view and on the Audit view, it adds stage names, gate results, and stage durations.

### Run progression (stage map)

The Overview's posture visualization is titled **Run progression**. It answers "how far has each loaded run got?" without a trend. That columns follow recorded stage order is stated in its information control, not in the title:
- **Columns** are the stage kinds the loaded runs recorded, ordered by their minimum recorded ordinal. This is derived from records, not a policy sequence.
- **Cells.** Each loaded run owns one cell per column: passed, blocked, open, or empty when the run has not reached that stage.
- **Counts and markers.** Under each column are "N/M reached" and a static marker where runs stopped ("1 blocked here") or completed.

Only an open stage whose run passes the liveness rule may pulse.

### Motion convention (telemetry-backed)

Repeating motion means exactly one of two things:
- work that fresh telemetry says is executing (`.is-live`);
- a data request in flight (`.is-refreshing` on the Refresh glyph, `.skeleton` for one pending snapshot).

A one-time highlight (`.just-updated`, 1.6s) marks a run row or value that changed since the previous observation. Local feedback to an operator action is short and non-repeating: the drawer's 16px/160ms slide and the disclosure chevron's 120ms turn. Nothing animates on first paint; revision 1's ledger fill was removed. Settled, blocked, waiting, stale, and disconnected states are static, and a recorded "in progress" status alone never animates. `prefers-reduced-motion: reduce` removes all motion.

### Liveness

A run shows **LIVE** ("Writer live in this repository", slow 2s opacity pulse on its open stage cell and dot) only when all four hold:
1. `run.status` is in progress;
2. the snapshot has an open stage;
3. `writer.status === "live"`;
4. that snapshot's `observedAt` is within two refresh intervals of now.

If the run is in progress but the writer is `dead` or `absent`, it shows the static "No live writer" with the last activity time. If the lock is `unreadable`, it shows the static "Writer lock unreadable". The tooltip states that the lock names a process in this repository, not a run or agent. No elapsed-silence timer declares a run "possibly stalled": nothing records an expected event cadence to measure silence against, and "No live writer" is the recorded fact that stands in its place.

### Frame

- **Product header (52px).**
  - The mark plus "BuildWorks" over "Governed Delivery".
  - The repository `select`, with no "Scope" label: the value labels itself. Selecting a repository scopes every view, through the existing `repositoryViews(application)`, which keeps only the selected repository:
    - **Overview:** cards, run progression, attention, recent runs, and coverage count only that repository, and the view's scope label names it (path tail, full path on hover).
    - **Runs and Findings:** cards, tables, and chip counts cover only that repository.
    - **Governance, Models & agents, and Audit:** the run picker lists only its runs.
    - **Search** matches only that repository's runs, findings, and agents.
    - **Tab counts** follow the selection.
    - **Opening a run from another repository** returns the scope to All repositories.
    - **Unchanged:** the data status pill and auto-refresh still cover every configured repository, because scoping is presentation only.
    - **Zero counts** take no alarm tone: "0 Blocked" and a "0" tab count are neutral.
  - A wide search combobox whose placeholder teaches its reach: "Search runs, findings, agents…". It searches loaded runs (slug, project, feature, path, state), findings (title, location, intent key, severity, status), and agents (name, role). Results are grouped with arrow-key navigation, and Enter opens the run, the finding drawer, or the agent's Models scope.
  - One **data status pill**: "Data current", "N snapshots stale", "Auto-refresh paused", or "Session expired". It answers "is what I'm reading current?"
  - "Last updated" with the observation time (the exact time on hover).
  - A labelled **Refresh** button joined to an auto-refresh toggle (`aria-pressed`).
  - The theme toggle, and a labelled **Help** button that opens the shortcuts dialog (`?` also opens it).
- **Page tabs (40px band)** under a stronger rule: the six views, with count pills (runs loaded, findings requiring attention). Below 720px they become a 56px bottom tab bar, the standalone-app pattern. Below 720px, button labels become visually hidden, never removed, so every control keeps its accessible name.
- **Status line (28px):** the read-only statement ("Read-only projection · loopback only · governed actions run as terminal commands") and the auto-refresh cadence. It no longer carries coverage tokens; those moved to the Overview's coverage layer.
- **Run-list limit** moves out of the header into the Runs table toolbar ("Per repository").

### Views

- **Overview**, as four labelled layers.
  1. **Operational status.** Four clickable status cards with one anatomy (label, primary value with status, breakdown, optional visualization, a named click-through). Each card is one stretched button with its information control above it:
     - **Run health**: blocked count; completed, in progress, and total; a proportion bar with a text legend. Clicks through to Runs filtered to blocked.
     - **Active findings**: "require attention" = blocking + open; each defined state by name (addressed, non-blocking, earlier round, rejected) and the total; a proportion bar. Clicks through to Findings filtered to "Require attention".
     - **Tokens and Known cost, as one usage pair.** The two cards share one frame with a hairline divider, tokens first because tokens consumed produce the cost:
       - **Tokens**: the abbreviated total, the exact total secondary, and the four token classes in two columns.
       - **Known cost**: the total and "Cost reported for N of M tracked rows", with a "Reporting complete" badge only when every row reported. The information control distinguishes complete reporting from a complete bill.

       The same pair appears on the Runs page cards and the Models & agents hero cards. In the selected-run KPI strip, Tokens and Known cost sit side by side on a shared sunken background.

     The card grids are explicit: four columns on the Overview and Models, six on Runs, where the pair spans two. They step down to two or three columns at 1100px and one at 600px; below 420px the pair stacks. A spanning card can therefore never create an implicit overflow column.

     Run progression follows the cards.
  2. **Needs attention.** "N items require attention", with the subtitle "Blocked runs are prioritized, followed by blocking and open findings". The order is explained in an information control. Filter chips cover All, Blocked runs, Blocking findings, and Open findings. There are two labelled groups:
     - *Blocked runs*: a state badge; the run and "stopped at <stage>" as the primary target; project, path tail, and stage number; blocking or open count and known cost; relative age (exact time on hover); "View findings".
     - *Findings*: a filled state badge and an outline severity badge; the title as the primary target; run, stage, round, and location; "Final panel, round R of M" or "No recorded decision"; "Copy location".

     Findings carry no age, because a finding row records no time. "View all" appears only when the queue is truncated (more than eight items).
  3. **Recent runs.** Newest activity first, with state chips (All, Blocked, In progress, Completed), sortable headers, "View all runs", and full-row selection. Columns:
     - run with path tail (full path on hover);
     - project;
     - state badge beside the stage name (`BLOCKED  Code review`);
     - micro ledger;
     - right-aligned findings with a blocking or open flag;
     - known cost;
     - relative last activity with the exact time and zone on hover.

     The footer names the per-repository limit.
  4. **Can I trust this data?** A telemetry coverage strip:
     - snapshots current;
     - cost reported N of M rows;
     - tokens reported N of M;
     - model attribution (effective model on N of M rows);
     - duration recorded N of M;
     - history "Not collected" (neutral, because the product does not collect it);
     - audit chain "Not verified here".

     Missing expected telemetry shows as the warning tone "Partial".
- **Runs.** Page summary cards scoped to the repository selection: Runs, Blocked, Findings requiring attention, the Tokens and Known cost pair, and Audit status "Not verified in this view". The run table has quick filters (All, Blocked, Completed, Has blocking findings), sortable headers, a sticky header, the per-repository limit, and full-row selection shown by a gold leading rule. The selected run then shows:
  - its header (slug, state, full path, project, feature, change kind, relative last activity);
  - a **selected-run KPI strip** (State "Blocked at <stage>", Findings, Tokens total with output, Known cost "for these tokens", Telemetry "N of M agent rows reported"), kept visually and verbally separate from the page cards;
  - the full ledger;
  - the **outcome statement**:
    - its headline: "Run blocked at code review", "Run blocked at <stage>", or "Run completed";
    - one derived sentence. For a code-review block: "The final review panel (round R of M) reported N <severity>-severity findings at or above the <threshold> blocking threshold." Here R is the highest recorded `code_review` finding round and M is the frozen `maxRounds`; neither is parsed from event prose. For another block: "The <stage> gate recorded a block", plus the count of findings there with no recorded decision. For a completion: "Delivery check passed; N declared artifacts delivered";
    - "No governed action is eligible for this run" from `nextAction.eligible`;
    - "View blocking findings" and "Copy status command";
    - a "Technical details" disclosure with the verbatim last event, refusal code, threshold, final reviewed commit, and writer-lock status;
  - the **findings table** (Severity, Finding, Location, Stage, Status) listing active findings (blocking, open, non-blocking), with a "Blocking only" toggle and a collapsed **History** disclosure for addressed, earlier-round, and rejected findings;
  - **Available commands**: each command's name and description first ("Run status — Inspect one run without changing state"; "Readiness check — Inspect local readiness without spending"; "Verify audit chain — Recompute the whole audit chain for this repository"). Each has an eligibility badge, "Copy command" with a "Copied" confirmation, and the command text in a "View command" disclosure, under "Copy-only PowerShell. Run a command outside this read-only dashboard.";
  - the remaining sections, collapsed with counts and renamed: "Configuration and approvals" carries a "Frozen at run start" badge, and "Evidence" reads "31 evidence references".
- **Findings.** A status chip group (All, Require attention, Blocking, Open, Non-blocking, Earlier round, Addressed, Rejected) combines with a severity chip group filtered by `cardSeverity`. One table (Severity, Finding, Location, Run, Stage, Status) has settled rows muted and a "Showing N of M" footer; a row opens the drawer.
- **Governance** (scope picker naming run and path tail). A **governance status** is categorical, never a score: "Blocked at a governed gate" or "All recorded gates passed", with "N of M recorded stage gates passed". A **policy check list** follows, with a filled result badge and one evidence line each:
  - Specification review and Plan review: gate result, findings, how many addressed.
  - Human approval: granted time; window closed.
  - Verification: passed commands, "Version checks only; they do not test the product."
  - Code review: final panel round, blocking and below-threshold counts, threshold.
  - Delivery check: delivered artifacts, or "Not reached".
  - Required specialists: "Not evaluated", naming the configured specialties.
  - Audit chain: "Not verified in this view".

  An **auditability timeline** lists stage, result, start (stage-creation audit time when `startedAt` is null), duration, agent runs, and the *configured* model per stage from the frozen model map. "Configuration and approvals" follows, and one line points to cost under Models & agents.
- **Models & agents** (scope picker). Hero cards each carry the scope in their label: Agents (authors and reviewers), Executions, and the Tokens and Known cost pair with its reporting badge. A telemetry coverage strip for the scope follows. **Where cost, tokens, and time went** should answer, at a glance, where the money went, where the tokens went, and which stage ran longest:
  - **Three ranked facts:** Highest cost (stage, amount, share of known cost), Most tokens (stage, total, share of tokens), and Longest running (stage, duration from stage creation to end). They are plain maxima of recorded values; the information control says they are rankings, not judgements that a stage is abnormal.
  - **A cost-sorted breakdown** of stages that ran agents: a muted bar (the top stage's slightly stronger), known cost, share of known cost (`<1%` below one percent), and total tokens with the exact count on hover.
  - **One "No agent runs" line** replaces the dash rows, naming each such stage with its recorded reason: "approval granted" from the approval record, and "N frozen commands passed" from `delivery.verification` for that stage.
  - **The run's token composition:** one stacked bar in categorical series colours, with a legend giving each class's total and share.
  - **The raw table in recorded order,** behind a "Token classes and agent runs by stage" disclosure: known cost, the four token classes, agent runs, and duration.

  No separate "total run cost" figure is repeated here, because the paired Known cost card sits directly above. The **Agents** table is sortable and sorted by known cost. Its columns are Agent, Role, a share-of-known-cost bar, Known cost, Share, Executions, Tokens, and Total time. Cost per execution is in the Known cost tooltip, and average time per execution is in the Total time tooltip.

  **The model rule.** When every agent row reported the same effective model, and it equals the single requested model, a Model column would repeat one value. It becomes one statement instead: "Every agent row reported model `claude-sonnet-5` (16 of 16 rows, as requested)." The Model column (effective model, requested model on hover, `Unavailable` for an unreported row) returns whenever:
  - agents report different effective models;
  - a requested model differs from the effective one;
  - or any row reported none.

  This keeps hazard 10's verbatim-identifier rule without printing the same identifier seven times.
- **Audit** (scope picker). Audit status "Not verified in this view" with "Copy verify-audit command", the full ledger, recorded limitations, and evidence references.
- **Text rule.** A qualifier that changes how a visible value must be read (stale, unavailable, partial, unreported, not reached, not evaluated) stays inline as a short token. A paragraph explaining method moves into the heading's information control (the existing `metricInfoButton` pattern), so it remains one activation away and in the accessibility tree.

The mockup's "Component states" page (reachable from the status line, mockup only) shows specimens for states the recorded runs cannot show: the pill states, the refreshing glyph, LIVE, No live writer, Writer lock unreadable, the skeleton, the change highlight, and the copied confirmation. It is labelled "specimens, not recorded data".

### Accessibility commitments

- **Colour never carries meaning alone.** Every state has a text label, and ledger segments and stage-map cells carry text alternatives.
- **Focus** is a 3px `--focus` outline, never suppressed.
- **Touch targets** are at least 44px under the bottom tab bar.
- **Forced colours.** Forced-colours mode maps every state to system colours and keeps segment outlines.
- **Narrow widths.** 320 CSS pixels produce no document-level horizontal scroll; tables and the stage map scroll inside their region. `main` is the containing block for visually hidden text, so hidden labels cannot extend the document.
- **Search** follows the combobox pattern (`aria-expanded`, `aria-controls`, `aria-activedescendant`).
- **Keyboard contracts.** The page tabs are a horizontal `tablist` with arrow, Home, and End keys. The tab, drawer, and dialog keyboard contracts are otherwise unchanged.

## Observation boundary

- **Decision.** `ARCHITECTURE.md` section 23 gains **"Dashboard live observation — 2026-09-24"**. It allows the browser to re-read the same GET routes on a bounded timer: a `setTimeout` chain of 15 seconds, only while the page is visible, the operator's toggle is on, and no request is outstanding. It adds no push channel, WebSocket, server timer, new route, or persisted state, and the lock-based liveness wording is the only liveness claim.
- **Scheduler.** `scheduleAutoRefresh` is the single timer in `app.js`. It is armed after a refresh settles, cleared on `visibilitychange` to hidden, on toggle off, and on session expiry, and re-armed on visible and toggle on. The toggle lives in memory for the tab (the dashboard persists no state).
- **What each tick re-reads.**
  - Every configured repository's run list.
  - A held snapshot only when:
    - its run-list summary's `status`, `phase`, or `lastRecordedAt` differs from the held snapshot;
    - its run is in progress;
    - or the held envelope is stale or absent.
  - An explicit Refresh still reloads everything.
- **Pure functions.** `autoRefreshPlan(held, summaries)` returns which snapshots to re-fetch, and `liveness(snapshot, observedAt, now, intervalMs)` returns `live`, `no_live_writer`, `lock_unreadable`, or `not_in_progress`. `changedRuns(previous, next)` names the rows that earn the one-time highlight.
- **Copy confirmation** uses no timer: "Copied" reverts on the button's `blur`.

## Progressive Web App boundary

- `src/dashboard/manifest.webmanifest`:
  - `id` and `start_url` `/`, `scope` `/`, `display` `standalone`;
  - `name` "BuildWorks Governed Delivery", `short_name` "BuildWorks";
  - `background_color` and `theme_color` `#0B0B0E`;
  - icons `icon.svg` (`any`), `icon-192.png`, `icon-512.png`, and `icon-maskable-512.png` (`maskable`).
- `src/dashboard/sw.js`:
  - a `SHELL` list equal to the server's static routes;
  - `install` caches `SHELL` into the single cache named `buildworks-dashboard-shell` (no version in the name, per hard rule 3) and calls `skipWaiting`;
  - `activate` deletes any other cache name and claims clients;
  - `fetch` returns without calling `respondWith` unless the request is a same-origin `GET` whose path is in `SHELL`, so `/api/` requests are never intercepted, cached, or replayed. Shell requests are network-first with the cached copy as the offline fallback.
- `src/dashboard-server.ts`: serve the new assets with correct content types and add `manifest-src 'self'; worker-src 'self'` to `SECURITY_HEADERS`. Nothing else in the server changes. `Cache-Control: no-store` stays, because the Cache Storage API is not the HTTP cache.
- `src/dashboard/app.js`: register `/sw.js` after the shell boots, and report a registration failure in the live region. When the inventory request fails at the transport level, the terminal screen names the likely cause: the dashboard host is not running; relaunch `bw dashboard` and open the URL it prints.
- `ARCHITECTURE.md` section 23 gains one sentence: the browser shell may be installable and may register a service worker that caches only the static shell and never intercepts, caches, or replays an `/api/` response. This records the operator's 2026-09-24 decision and adds no authority.

## Tasks

- **Task 1: Design-system stylesheet and static mockup from recorded runs (review gate).**
  - Depends on: None.
  - Files:
    - create `docs/features/dashboard-pwa-redesign/mockup/index.html`, `docs/features/dashboard-pwa-redesign/mockup/mockup.css`, and `docs/features/dashboard-pwa-redesign/mockup/mockup.js`;
    - scratch generators in the session scratchpad (not committed): `project-mockup.mjs`, `agent-rows.mjs`, and `gen-mockup.mjs`.
  - Step 1: Write `mockup.css`:
    - the token table above in three theme blocks: `:root` light, `:root[data-theme="dark"]`, and `@media (prefers-color-scheme: dark)` for `data-theme="system"`;
    - the type, spacing, and radius scales;
    - every component named in the design system, with the reduced-motion and forced-colours blocks.
    - Verify: a scratch script whose luminance, `contrast`, and `declaredTokens` logic is copied verbatim from `test/dashboard-ui.test.ts` checks every foreground token on every background token in both themes, and every series colour on `--panel`.
    - Expected: every text pair at or above 4.5:1 and every series colour at or above 3:1.
  - Step 2: `project-mockup.mjs` passes the three recorded snapshot envelopes through the real exports of `src/dashboard/dashboard-model.js` (`portfolioProjection`, `snapshotProjection`, `runExecutiveSummary`, `findingCard`, `orderFindings`, `cardSeverity`, `repositoryIdentity`). `agent-rows.mjs` reads each store's `agent_run` rows read-only (`node:sqlite` `DatabaseSync` with `readOnly: true`) for role, models, and duration.
    - Verify: `node <scratchpad>/project-mockup.mjs` and `node <scratchpad>/agent-rows.mjs`.
    - Expected:
      - three runs (two blocked, one completed);
      - 29 findings = 19 addressed, 0 rejected, 2 open, 2 blocking, 2 non-blocking, 4 earlier round;
      - severity high 6, medium 16, low 7;
      - known cost $7.20 (exact $7.2015296);
      - 3,260,482 tokens = 246 input, 385,153 output, 2,227,348 cache read, 647,735 cache write;
      - 42 agent rows, each with an effective model;
      - every number in the mockup is copied from this output.
  - Step 3: `gen-mockup.mjs` writes `mockup/index.html` with all six views, every run's run view, and the per-run Governance, Models, and Audit scopes. A provenance comment names the stores, the observation time, and which values anticipate Task 2. `mockup.js` implements the mockup's interactions and accepts review links such as `#view=runs&run=run-1&theme=light&finding=run-0:11`.
    - Verify:
      - headless Chrome screenshots of each view at 1440px in both themes and at 1024px;
      - an exact-width iframe probe at 320px and 390px comparing `scrollWidth` with `clientWidth` for the document and for `main`. Chrome's new headless mode enforces a minimum window width of about 500px, so a `--window-size` of 390 or 320 silently renders wider and crops.
    - Expected: equal widths for every view at both widths; focus always visible.
    - Result (revision 1, 2026-09-24): two fixes (the status line lacked `min-width: 0`; the severity control and a `max-content` definitions list overflowed `main`) before every view reported equal widths.
    - Result (revision 2, 2026-09-24): the probe found visually hidden labels escaping `main` (`position: absolute` with no positioned ancestor made the document 2,229px tall at 320px) and a scope picker wider than the viewport. After `main { position: relative }` and a shrinkable picker, all seven pages (six views plus Component states) report equal widths at 320px and 390px. Contrast: all pass. Forced colours, reduced motion, and screen-reader passes need a real browser and remain for the operator (Task 11).
    - Result (revision 2 follow-up, 2026-09-24): the operator found that the repository select did nothing; it had been inert in the mockup and was not listed as inert. The generator now renders Overview, Runs, and Findings once per repository scope. The projection script runs `portfolioProjection` once for all repositories and once per repository, and the generator refuses to write if a scope's run or finding count disagrees with it. The scoped figures are:
      - `target-tap-live-2\target`: 1 run, 3 attention items, 13 findings, $3.59, 1,407,508 tokens.
      - `target-tap-live\target`: 1 run, 3 attention items, 6 findings, $1.55, 653,533 tokens.
      - `target`: 1 run, nothing requiring attention, 10 findings, $2.06, 1,199,441 tokens.

      The same pass renamed the stage map to Run progression, paired Tokens with Known cost, and removed alarm tones from zero counts. The iframe probe is clean at 320, 390, and 700px for every scope checked (Overview in all three scopes, Runs, Findings, Models, and Governance).
  - Step 4: Present the mockup to the operator for approval. **Stop.** Record the approval or the requested changes in this plan's Status line before Task 2. Revision 1's review is `mockup-feedback.md`.
  - Task completion evidence: operator approval of revision 2 in both themes.

- **Task 2: Extend `RunSnapshot.cost.byAgent` with recorded role, model, and duration, test-first.**
  - Depends on: Task 1 approval.
  - Files: modify `src/operator-state.ts` (the `cost.byAgent` type at the `cost:` member of `RunSnapshot` and its construction beside `byStage`); modify `test/operator-state.test.ts`.
  - Step 1: Each `byAgent` entry gains five fields, computed over that agent's `agent_run` rows only (`agents.filter((a) => a.agent === agent)`):
    - `roles: string[]`: distinct `role` values, sorted.
    - `requestedModels: string[]`: distinct `requested_model` values, sorted.
    - `effectiveModels: string[]`: distinct non-null `effective_model` values, sorted.
    - `effectiveModelUnreportedRows: number`: rows whose `effective_model` is null.
    - `durationMs: number | null`: the sum of `duration_ms`, or null when the agent has no `agent_run` rows. An actor that appears only in `agent.dispatch.failed` audit events gets `roles: []` and `durationMs: null`.
  - Step 2: A test seeds a real `Store` run with two `agent_run` rows for one agent: roles `author`, one with `effective_model` recorded and one with it null, and known `duration_ms` values. It also seeds one row for a second agent, and one failed dispatch audit event for a third actor. It asserts the five fields for all three from those inserted values.
    - Verify: `node --test --test-name-pattern "byAgent" test/operator-state.test.ts`.
    - Expected: pass. Break-tests:
      - count null `effective_model` rows as reported: the test fails; restore;
      - drop the no-rows `null` for `durationMs`: the test fails; restore.
  - Step 3: Confirm that the existing readers still pass (`test/cli-operator.test.ts`, `test/operator-state.test.ts`), because the fields are additive.
    - Verify: `node --test test/operator-state.test.ts test/cli-operator.test.ts`.
    - Expected: pass, with the documented `:1394` environment exception when run from the tool shell.
  - Task completion evidence: the new test passes and failed under both break mutations; `npm run typecheck` is clean.

- **Task 3: Correct the model's honesty defects and add the new pure projections, test-first.**
  - Depends on: Task 2.
  - Files: modify `src/dashboard/dashboard-model.js`; modify `test/dashboard-ui.test.ts`; modify `src/dashboard/app.js` at the interim call sites only (the `needsAttentionQueue` consumer in `renderOverviewTab` and `renderNeedsAttention`, the two retired constants, the average-execution card, the data-quality duration rows, and the agent table's "binds no model" sentence). Task 5 replaces those renderers; until then `app.js` must still type-check and render.
  - Step 1 (Defect D): add `stageLedger(snapshot)`. It returns `{ segments: { stageId, kind, label, result: "passed" | "blocked" | "open" | "other", gateResult, status, durationMs }[], terminal: "completed" | "stopped" | "in_progress" }`:
    - segments come from `snapshot.stages` in recorded order, with labels via `stagePresentation`;
    - `durationMs` is `endedAt − (startedAt ?? startEvidence.at)`, or null when either is missing;
    - the terminal comes from `snapshot.run.status`.

    Add `stageMap(snapshots)`. It returns columns ordered by each kind's minimum recorded ordinal, with each run's cell result and the stopped and completed markers.
    - Test: a real `Store` run seeded with the existing `seedPartialRun` helper, plus a blocked variant built by the existing test's pattern.
    - Verify: `node --test --test-name-pattern "stage ledger|stage map" test/dashboard-ui.test.ts`.
    - Expected: segments equal the recorded stage kinds in recorded order. Terminal is `stopped` for blocked, `in_progress` for in progress, and `completed` for completed. The map places each run's marker on its last recorded stage. Break-test: reverse the order inside `stageLedger`; the test fails; restore.
  - Step 2 (Defect B): add `findingStatus(card, stageKind)` and `findingStatusCounts(snapshots)`. The status is derived only from recorded fields, and the recorded runs show why "no decision" cannot mean "open" on its own: document-review findings carry dispositions, while code-review findings never do. The remediation loop consumes non-final rounds, and the final panel records `finalPanelBlocking`. The classes are:
    - `addressed` and `rejected`: recorded `decision.disposition` `addressed` or `rejected_with_rationale`;
    - the other recorded dispositions follow the document gate's own rule (`src/plan-gate.ts` `BLOCKING_DISPOSITIONS`): `cannot_determine` and `upstream_blocking` are `blocking`, and `upstream_follow_up`, which routes to a proposal without blocking, is `non_blocking`. The dashboard cannot import `src/`, so it copies that list, and a test pins the copy to `BLOCKING_DISPOSITIONS`;
    - `open`: a finding whose stage kind is not `code_review` and which has no decision;
    - `blocking` and `non_blocking`: a `code_review` finding with `finalPanelBlocking` `true` or `false`;
    - `earlier_round`: a `code_review` finding with `finalPanelBlocking` `null`, which is remediation input rather than a final result.

    The stage kind is looked up from `snapshot.stages` by the finding's `stageId`. `findingStatusCounts` also returns `requireAttention` = blocking + open. Recorded check (Task 1 Step 2 output): 29 findings = 19 addressed, 2 open (`target-tap-live` plan-review findings 5 and 6), 2 blocking, 2 non-blocking, and 4 earlier round.

    Test with real store rows. `seedPartialRun` already records one high document finding with disposition `addressed`. Add:
    - a `rejected_with_rationale` decision through `store.insertFindingDecision`, which requires grounding for that disposition;
    - a document finding with no decision;
    - code-review findings with each `finalPanelBlocking` value.
    - Verify: `node --test --test-name-pattern "finding status" test/dashboard-ui.test.ts`.
    - Expected: each seeded finding lands in its class, and the counts sum to the total. Break-tests:
      - treat a `code_review` finding with no decision as `open`: the test fails; restore;
      - count every finding as `open`: the test fails; restore.
  - Step 3 (Defect C): `needsAttentionQueue` returns two groups, `runs` and `findings`:
    - blocked runs, by `lastRecordedAt` descending;
    - then findings whose `findingStatus` is `blocking` or `open` (any severity, because an open document finding is what stopped the stage), blocking before open, then by recorded severity and identifier.

    Each item carries its kind, so the view's filter chips need no re-derivation. Drop "has no approved resolution". The existing command-center test asserts that `seedPartialRun`'s *addressed* high finding appears in the queue, so it pins Defect C (hazard 4). Change that assertion to require its absence. Add an open document finding and a final-panel blocking finding that must appear, and an earlier-round and a non-blocking code-review finding that must not.
    - Verify: `node --test --test-name-pattern "attention" test/dashboard-ui.test.ts`.
    - Expected: only the open and blocking findings join the blocked-run items, in that order. Break-test: remove the status condition; the test fails; restore.
  - Step 4: add the remaining view projections, each tested from real `Store` rows:
    - `runOutcome(snapshot, findingStatuses)`: the headline and sentence defined under Views, where the code-review round R is the maximum recorded `code_review` finding round and M is `configuration.codeReview.maxRounds`.
    - `governanceChecks(snapshot, findingStatuses)`: one entry per check under Views, with results `passed`, `granted`, `blocked`, `not_reached`, `not_evaluated`, and `not_verified`. Required specialists are always `not_evaluated`, and the audit chain is always `not_verified`.
    - `telemetryCoverage(views)`: snapshot, cost, token, model-attribution (`effectiveModelUnreportedRows`), and duration (`durationMs !== null`) coverage, plus history `not_collected`. It replaces `dataQualitySummary`.
    - `agentRows(snapshot)`: each `byAgent` entry with its share of known cost, cost per execution, and average duration (`durationMs / agentRows`, or null). It also returns `uniformModel`: the single effective model when every entry has exactly one effective model, equal to its only requested model, with `effectiveModelUnreportedRows === 0`; otherwise null, which tells the renderer to show the Model column.
    - `stageUsage(snapshot)`: stages with agent rows sorted by known cost, each with its share of `cost.knownUsd` and its total tokens (the sum of the four known classes). It also returns:
      - the three maxima (cost, tokens, and duration from `stageLedger`);
      - the no-agent stages, each with its recorded reason, taken from `approval.state` for the approval stage and `delivery.verification` matched by `stageId` otherwise, or "no agent rows recorded" when neither exists;
      - the run-level token composition.

      Recorded check (Task 1 output for `target-tap-live-2` run 1): code review $1.3644 (38% of $3.5893264), 766,888 tokens (54%), and 14m 05s. Awaiting approval (approval granted) and verification (2 frozen commands passed) are the no-agent stages.
    - `relativeTimePresentation(iso, observedAt)`: "N days ago"-style text plus the exact local time with its zone.
    - `searchIndex(views)` and `searchMatches(index, query)`: grouped Runs, Findings, and Agents.
    - Verify: `node --test --test-name-pattern "run outcome|governance checks|telemetry coverage|agent rows|stage usage|relative time|search" test/dashboard-ui.test.ts`.
    - Expected:
      - `runOutcome` gives "round 2 of 2" for a seeded two-round code-review block and names the threshold from the frozen profile;
      - `governanceChecks` gives `not_reached` for an absent delivery stage;
      - `telemetryCoverage` counts a null-effective-model row as unreported;
      - `stageUsage` ranks a seeded two-stage run by cost, reports shares that sum to the known total, and gives a seeded verification stage its command count;
      - `agentRows(...).uniformModel` is the model for seeded rows that all report it, and null once one seeded row has a null `effective_model` or a different requested model;
      - `searchMatches` finds a finding by location.

      Break-tests:
      - make `runOutcome` read the round from event text: a seeded event whose summary disagrees makes the test fail; restore;
      - make `governanceChecks` return `passed` for the audit chain: the test fails; restore;
      - drop the unreported-row condition from `uniformModel`: the null-model case fails; restore.
  - Step 5: retire the statements the Task 2 extension made false:
    - `agentAnalytics`'s `model`/`modelLabel` read `effectiveModels`, and fall back to `Unavailable` only when every row is unreported;
    - `averageExecution` reads `durationMs`;
    - `AGENT_MODEL_UNAVAILABLE` and `AVERAGE_EXECUTION_UNAVAILABLE_REASON` are removed with their assertions at `test/dashboard-ui.test.ts:294,490,823`.

    Then grep for the block's own wording, so no stale site survives.
    - Verify: `grep -rn "Not reported at agent level\|AVERAGE_EXECUTION_UNAVAILABLE\|missingExecutionDuration" src test README.md`.
    - Expected: no match outside the historical `docs/features/dashboard-redesign-3/plan.md`.
  - Removals of the old overview functions happen in Task 5, not here. `test/dashboard-ui.test.ts` imports `src/dashboard/app.js`, which imports those functions, so deleting them before the renderer is replaced would break every test in the file.
  - Task completion evidence: every new or changed test passes and failed under its break mutation.
  - Result (2026-09-24):
    - Seven new tests pass. They failed first on the missing exports. Ten break mutations each failed their named test and were reversed byte-for-byte:
      - the eight named above;
      - the blocking-list copy drifting from `BLOCKING_DISPOSITIONS`;
      - `averageExecution` dividing by snapshots instead of rows (the new non-null assertion).

      The agent-model mutation made the updated `agentAnalytics` assertion fail.
    - The four affected test files pass 234 of 234. Typecheck and `check:docs` are clean.
    - The model's read-only boundary test caught a local variable named `window` and a comment ending in "window."; both were renamed.

    Deviations, each grounded in the code:
    - The ledger's `open` means store status `in_progress`. `src/store.ts` has no `open` stage status, so `stagePresentation`'s `open` branch can never match. That branch is a pre-existing defect, left unchanged as a follow-up.
    - `governanceChecks` adds an `in_progress` result for a recorded stage with no gate result.
    - The Verification evidence names each frozen command's argv and "Passed commands do not prove product correctness". It does not assert "version checks only", which is true of the recorded profiles but not of every profile (hazard 18).
    - Token coverage is the least-reported token class, so "complete" means every row reported every class.
    - The queue no longer lists unavailable repositories or stale snapshots; the data status pill carries both.
    - Step 5's grep also matches two other historical plans, `docs/features/dashboard-density-triage/plan.md` and `docs/features/dashboard-enterprise-redesign/plan.md`. They are dated records and are not edited.
    - `.claude/sessions/project-learnings.md` said the projection carried no model or duration. That is corrected.

- **Task 4: Record the observation decision and add the bounded auto-refresh.**
  - Depends on: Task 3.
  - Files: modify `ARCHITECTURE.md` section 23; modify `src/dashboard/app.js`; modify `src/dashboard/dashboard-model.js`; modify `test/dashboard-ui.test.ts`.
  - Step 1: Add **"Dashboard live observation — 2026-09-24"** under the dashboard authorization, with the content of the Observation boundary section. Verify with `npm run check:docs` (expected: exit 0).
  - Step 2: Add the pure `autoRefreshPlan`, `liveness`, and `changedRuns` to `dashboard-model.js`, tested from real `Store` rows and lock observations produced by `src/lock.ts`:
    - an in-progress run with a `live` writer, observed inside the window: `live`;
    - the same outside two intervals: `no_live_writer`;
    - `absent`, `dead`, `unreadable`: `no_live_writer`, `no_live_writer`, `lock_unreadable`;
    - a completed or blocked run: `not_in_progress`.

    `autoRefreshPlan` re-fetches exactly the snapshots whose summary changed, whose run is in progress, or whose envelope is stale or absent.
    - Verify: `node --test --test-name-pattern "liveness|auto-refresh plan|changed runs" test/dashboard-ui.test.ts`.
    - Expected: pass. Break-tests:
      - drop the freshness condition from `liveness`: the outside-window case fails; restore;
      - make `autoRefreshPlan` re-fetch every snapshot: the unchanged-summary case fails; restore.
  - Step 3: In `app.js`, add `scheduleAutoRefresh` as the only `setTimeout` use. It is armed after `refreshAll` settles, and it is cleared and re-armed on `visibilitychange`, on the toggle, and on session expiry. It never arms while a request is outstanding. The toggle is `#auto-refresh` (`aria-pressed`). The header pill renders from the coverage state and the scheduler state. `changedRuns` rows get `.just-updated` once.
    - Verify: a boundary test asserting that `app.js` still contains no `setInterval`, exactly one `setTimeout(` inside the body of `function scheduleAutoRefresh`, and a `visibilitychange` listener.
    - Expected: pass. Break-test: add a second `setTimeout` elsewhere; the test fails; restore.
  - Task completion evidence: `check:docs` clean; the new tests pass and failed under their break mutations.
  - Result (2026-09-24):
    - The ARCHITECTURE decision is recorded, and `check:docs` is clean.
    - The model functions `liveness`, `autoRefreshPlan`, `changedRuns`, and `AUTO_REFRESH_INTERVAL_MS` have two tests built on real `Store` rows and real lock states:
      - live: `acquireLock`;
      - dead: the PID of an exited process;
      - absent;
      - unreadable: no `pid=` line.
    - In `app.js`:
      - `scheduleAutoRefresh` holds the file's only `setTimeout`;
      - `trackedRefresh` disarms the timer during every refresh and re-arms it once the refresh settles;
      - `refreshChanged` re-reads the run lists plus only the planned snapshots;
      - a `visibilitychange` listener pauses and resumes the timer;
      - `.just-updated` applies to the changed rows in the one render that follows a tick.
    - The `#auto-refresh` toggle (`aria-pressed`, default on) was added to the current `index.html` now rather than in Task 5, because the decision requires an operator toggle wherever polling runs.
    - The false "no polling" statements in `README.md`, the `refreshAll` docstring, and a test comment were corrected now. Task 12 still rewrites the README subsection.
    - Break mutations, each failing its named test and each restored:
      - freshness dropped;
      - open-stage check dropped;
      - re-fetch everything;
      - highlight on first observation;
      - a second `setTimeout`;
      - arming while hidden;
      - the visibility listener removed.

      The last one exposed a defect in the break driver: an empty replacement could not be found again, so the mutation stayed applied until I restored it by hand. The driver now refuses such a case, and the rerun failed its test and restored cleanly.
    - The four affected suites pass 237 of 237, and typecheck is clean.
    - Operator decision (2026-09-24): keep the four liveness states. A stale live-lock observation reads `no_live_writer`, and the data status pill marks such snapshots stale.

- **Task 5: Replace the shell, stylesheet, and renderer against the approved mockup.**
  - Depends on: Task 4.
  - Files: modify `src/dashboard/index.html`, `src/dashboard/styles.css` (replaced by the approved `mockup.css` content, minus the specimens rules), and `src/dashboard/app.js`.
  - Step 1: `index.html` contains:
    - the product header;
    - the page-tab band: a horizontal `tablist` keeping `<button role="tab" id="tab-<view>" aria-controls="dashboard" data-tab="<view>">` for every `ALLOWED_TABS` entry;
    - `<main id="dashboard" tabindex="-1" aria-busy="true">`;
    - the status-line `<footer>` retaining the words "read-only";
    - the existing `#drawer` and `#shortcuts-dialog` contracts;
    - `#live-status`;
    - the manifest link, static `theme-color` metas for both schemes, and the apple-touch icon.

    No inline script or style.
  - Step 2: `app.js`.
    - **Kept unchanged:** every exported pure function, and the refresh, generation, slot, and routing machinery (`bootstrapToken` through `repositoryViews`, `fetchEnvelope`, `applyRefresh`, `refreshRuns`, `refreshSlot`, `refreshSelected`, `refreshAll`, `selectRun`, `switchTab`, and `updateTabUI`).
    - **Replaced:** the overview renderers `renderPortfolioBanner`, `renderCommandCenterKpis`, `renderNeedsAttention`, `renderDeliveryPipeline`, `renderGovernanceHealth`, `renderModelAssignments`, `renderLowerAnalytics`, `renderGovernedDeliveriesTable`, `renderKpiBar`, `kpiCard`, `buildPipelineStageDrawer`, `buildModelAssignmentsDrawer`, and `buildDataQualityDrawer`. The new renderers are `renderStatusCards`, `renderStageMap`, `renderAttentionQueue`, `renderRunTable`, `renderCoverage`, `stageLedgerNode`, `renderRunOutcome`, `renderGovernanceChecks`, `renderAgentTable`, and `renderSearch`.
    - **Run-view renderers:** restyled by class and structure only. Each method `source-note` paragraph moves into its section's information control, and inline qualifiers stay.
    - **Scope headers** use `repositoryIdentity(...).display` plus the path tail, never a repository ID.
    - **`renderFindingsTab`** filters by `findingStatus` and `cardSeverity`.
    - **`shortcutDestination`** returns `run-search` for `/`, `shortcuts` for `?` (which `README.md` already documents but no code handles), and a view name for `g o`, `g r`, `g f`, and `g a`. The keydown handler opens the dialog for `shortcuts`, focuses `#run-search` for search, and otherwise calls `switchTab` and focuses `#dashboard`.
    - **Theme changes** update the `theme-color` meta through `setAttribute("content", …)`.
    - **Copy controls** show "Copied" until `blur`.
  - Step 3: Remove the model functions the new renderer no longer calls, together with their imports and assertions in `test/dashboard-ui.test.ts`:
    - `governanceHealthSummary`, with its fabricated `auditIntegrity`;
    - `deliveryPipelineStages`, with `STANDARD_STAGES`;
    - `portfolioStatusBanner`, `commandCenterKpis`, `modelAssignmentsSummary`, and `dataQualitySummary`.

    The command-center test's banner assertion ("1 open finding requires review") pins Defect B and is removed with its function. The replacements are `stageLedger`, `stageMap`, `findingStatusCounts`, `telemetryCoverage`, `governanceChecks`, and the model-map table `renderConfiguration` already renders.
    - Verify: `npm run typecheck` and `grep -rn "auditIntegrity\|deliveryPipelineStages\|commandCenterKpis\|portfolioStatusBanner\|governanceHealthSummary\|modelAssignmentsSummary\|dataQualitySummary" src test`.
    - Expected: both programs type-check; the grep returns nothing.
  - Step 4: Launch `node src/cli.ts dashboard --repositories-file C:\Users\tamezs\buildWorks_test_repos\dashboard-repositories.json` (free, read-only), open the printed URL, and compare each view with the approved mockup in both themes and at the four widths.
    - Expected: the live views match the mockup's structure and values for the same three runs.
  - Task completion evidence: typecheck clean; side-by-side match with the approved mockup.
  - Result (2026-09-24):
    - `styles.css` is `mockup.css` minus the specimens rules, with the selected-tab rule on `--accent` and a run-detail block for the sections the mockup did not reproduce. `index.html` is the mockup shell. Both are CRLF.
    - `app.js` was spliced from checked line ranges. It carries the ten named renderers, uses every import, and leaves no function unreferenced. It keeps exactly one `setTimeout(` (in `scheduleAutoRefresh`), one `.open =` (the focus handler), and no `setInterval`, `innerHTML`, `JSON.stringify`, `.style.`, or mutating `fetch`.
    - Step 3: the six functions, `STANDARD_STAGES`, and their typedefs are removed, with their test imports and assertions. The test's portfolio and attention-queue assertions still exercise live projections, so they stay under a new title. Typecheck is clean and the Step 3 grep returns nothing.
    - Step 4: I launched the free read-only dashboard at 17:53 local time and took headless-Chrome screenshots of all six views at 1440px, Runs in dark, and Overview at 700px; the process was then stopped. Every figure matches the mockup for the same three runs:
      - 29 findings, split 19 addressed / 2 blocking / 2 open / 2 non-blocking / 4 earlier round;
      - $7.20 and 3.26M tokens, reported on 42 of 42 rows;
      - the code-review outcome sentence;
      - $1.36 (38%) and 766.9K tokens (54%) for the costliest stage;
      - the uniform-model statement.

      Clicks, search, keyboard, and drawer behaviour were not exercised; that is Task 11.
    - Tests: `dashboard-ui` passes 37 of 42. The 5 failures are the structure-pinning tests Task 6 rewrites (the static-assets literals and the three overview and tab-assembly tests, plus the repository-selection regexes). `operator-state`, `cli-operator`, and `dashboard-server` pass 195 of 195.

    Deviations, each grounded in the Frame rule or the code:
    - **Scope.** Views scope through `repositoryViews({ repositories, repositoryFilter })`, not `repositoryViews(application)`. The latter also narrows by `selectedRepositoryId`, which contradicts "opening a run from another repository returns the scope to All repositories". Task 6's scoping guard pins the wrapper `scopeViews`.
    - **`selectRun`, `switchTab`, and `updateTabUI`** changed, although the plan kept them unchanged:
      - `selectRun` resets the scope only when the run lies outside it;
      - a route with a run means scope All; a route without one carries the scope;
      - `updateTabUI` targets `.tabs-nav` with roving `tabindex`, because `.primary-nav` no longer exists.
    - **`governedDeliveriesRows`** is removed as well. It lost its only caller and depended on the removed `ToneClass` typedef.
    - **Kept evidence.** The run view keeps the existing "Run detail" and "Recorded limitations" disclosures, plus the next-step command in the outcome's technical details. The run view has seven collapsed sections: "Governed actions" became the always-visible "Available commands".
    - **Governance status** adds "In progress" for a run neither blocked nor completed; "All recorded gates passed" would be premature there.
    - **The attention queue's "View all"** navigates to Runs filtered to blocked, or to Findings filtered to "Require attention", instead of expanding in place.
    - **Findings tab count.** `index.html` gives it a visually hidden "require attention", as in the mockup.

    Follow-ups, not changed:
    - The Human approval check prints the raw recorded UTC time, because that text comes from `governanceChecks`.
    - The "Run detail" and "Recorded limitations" disclosures sit without body padding.
    - `collapsedColumnStatement`, `constantColumn`, `fullCoverageStatement`, and `coverageQualifier` remain exported but unused by `app.js`.

- **Task 6: Rewrite the structure-pinning tests to pin the new invariants.**
  - Depends on: Task 5.
  - Files: modify `test/dashboard-ui.test.ts`.
  - Step 1: Keep these assertions unchanged:
    - contrast and series contrast;
    - the read-only boundary: no `WebSocket`, `EventSource`, `setInterval`, `innerHTML`, mutating `fetch`, `JSON.stringify`, or `.style.` (the single `setTimeout` is pinned by Task 4);
    - aria-busy, disclosure, helper, finding-renderer region, zero-run branch, next-action command-kind, and routing.

    Update only literals the redesign deliberately changed: the `#repository-filter` width rule becomes `min(20rem, 100%)`, and any class renamed in the auto-fit or focus rules. The run view's findings table replaces the `finding-card tone-${tone}` list items, so that assertion changes to pin the table's status column.
  - Step 2: Replace the three overview and tab-assembly tests (grid-12, col-7, banner, KPI strip, pipeline stepper, health rows) with assertions that:
    - `renderOverviewTab` composes `renderStatusCards`, `renderStageMap`, `renderAttentionQueue`, `renderRunTable`, and `renderCoverage`, in that order;
    - every rendered ledger comes from `stageLedger`;
    - no scope header interpolates `repositoryId`;
    - `app.js` contains no "Verified" audit claim;
    - the tab list has no `aria-orientation="vertical"`;
    - `shortcutDestination("g", "o")` returns `overview` and `shortcutDestination("?", null)` returns `shortcuts`;
    - the Findings filter calls `cardSeverity` and `findingStatus`;
    - every Overview, Runs, and Findings renderer takes its data from `repositoryViews(application)`, never from `application.repositories` directly. A behavioural test drives `repositoryViews` from real `Store` snapshots of two repositories. With one selected, `findingStatusCounts`, `stageMap`, and `needsAttentionQueue` over its result count only that repository;
    - the Findings tab count carries `tone-danger` only when the attention count is above zero.
    - Verify: `node --test test/dashboard-ui.test.ts`.
    - Expected: pass. Break-tests:
      - reintroduce `Inspecting: ${targetRepoId}` in one scope header: the named test fails; restore;
      - restore the first-report severity filter: the named test fails; restore;
      - make `renderOverviewTab` read `application.repositories` directly: the scoping test fails; restore.
  - Task completion evidence: the file passes; each new structural guard failed under its break mutation.

- **Task 7: Icons and manifest.**
  - Depends on: Task 1 approval.
  - Files: create `src/dashboard/icon.svg`, `src/dashboard/manifest.webmanifest`, `scripts/dashboard-icons.mjs`, and its outputs `src/dashboard/icon-192.png`, `src/dashboard/icon-512.png`, and `src/dashboard/icon-maskable-512.png`.
  - Step 1: The icon is the stage ledger reduced to a mark: three ascending gold segments and one hatched terminal cell on `#0B0B0E`. `scripts/dashboard-icons.mjs` rasterizes that same geometry with `node:zlib` (no dependency) into the three PNGs; the maskable variant keeps the mark inside the 80% safe zone.
    - Verify: `node scripts/dashboard-icons.mjs`, then open each PNG.
    - Expected: three valid PNGs at the named sizes, visually matching `icon.svg`.
  - Task completion evidence: the generator reproduces byte-identical PNGs on a second run.

- **Task 8: Static-only service worker and server routes.**
  - Depends on: Tasks 5 and 7.
  - Files:
    - create `src/dashboard/sw.js`;
    - modify `src/dashboard-server.ts` (`SECURITY_HEADERS`, `assets`);
    - modify `src/dashboard/app.js` (registration and the host-unreachable message in `startBrowserApplication`);
    - modify `test/dashboard-server.test.ts` and `test/dashboard-ui.test.ts`.
  - Step 1: write `sw.js` per the PWA boundary section.
  - Step 2: add the seven new routes and the two CSP directives. The routes are `/manifest.webmanifest` as `application/manifest+json`, `/sw.js` as `text/javascript; charset=utf-8`, `/icon.svg` as `image/svg+xml`, and the three PNGs as `image/png`.
    - Verify: extend the server transport test to fetch each new route and check a 200, the exact content type, and a CSP containing `manifest-src 'self'` and `worker-src 'self'`. It also keeps `/dashboard/sw.js` and `/sw.js.map` at 404.
    - Expected: pass. Break-test: drop `worker-src 'self'`; the test fails; restore.
  - Step 3: a `node:vm` test loads `sw.js` with a stub `self` (capturing the `install`, `activate`, and `fetch` listeners), a stub `caches`, and a stub `fetch`. It dispatches fetch events for `/api/repositories`, `/api/repositories/x/runs/1`, a cross-origin URL, a non-GET, and `/app.js`.
    - Expected:
      - `respondWith` is never called for the first four and is called for `/app.js`;
      - the cached name is exactly `buildworks-dashboard-shell`;
      - `SHELL` equals the server's static route list, read from `src/dashboard-server.ts` source.

      Break-test: remove the `SHELL` membership check; the `/api/` cases fail; restore.
  - Step 4: `app.js` registers the worker after inventory succeeds and states a registration failure in `#live-status`. A transport failure on the inventory request shows the host-unreachable screen through `showSessionExpired`, and stops the auto-refresh scheduler.
    - Verify: `npm run typecheck && npm test`.
    - Expected: pass, except the documented `test/cli-operator.test.ts:1394` environment case when run from the tool shell.
  - Task completion evidence: server and worker tests pass and failed under their break mutations.

- **Task 9: Service-worker architecture sentence.**
  - Depends on: Task 8.
  - Files: modify `ARCHITECTURE.md` section 23.
  - Change: add the PWA boundary sentence under the dashboard authorization, after the Task 4 observation decision.
  - Verify: `npm run check:docs`.
  - Expected: exit 0.

- **Task 10: Type-check the worker as its own program.**
  - Depends on: Task 8.
  - Files:
    - modify `tsconfig.dashboard.json`: add `"exclude": ["src/dashboard/sw.js"]`, replacing its empty `exclude`;
    - create `tsconfig.worker.json`;
    - modify `package.json`: `typecheck` chains `typecheck:worker`.
  - Change: the DOM and `webworker` libs declare conflicting globals, so one program cannot hold both. `tsconfig.worker.json` extends `./tsconfig.json` with `allowJs`, `checkJs`, `lib: ["esnext", "webworker"]`, `types: []`, `include: ["src/dashboard/sw.js"]`, and `exclude: []`; a child inherits the base `include` and `exclude` otherwise (see project-learnings). The root program never sees `sw.js`, because it does not set `allowJs`.
  - Verify: `npm run typecheck`, then confirm that the worker program lists only `sw.js` with `npx tsc -p tsconfig.worker.json --listFilesOnly`.
  - Expected: three programs type-check; the worker program's source list is `src/dashboard/sw.js` plus library files.

- **Task 11: Browser evaluation, installability, and observation.**
  - Depends on: Tasks 5–10.
  - Step 1: Launch the free, read-only dashboard against the retained targets. Inspect all six views at 1440, 1024, 390, and 320 CSS pixels, in light and dark themes, under forced colours, and with keyboard only. Confirm that nothing animates on first paint and that reduced motion removes the refresh glyph's turn and the change highlight.
  - Step 2: In the browser's Application panel, confirm that:
    - the manifest parses with no errors;
    - the service worker is activated at scope `/`;
    - the page is installable, and the installed window opens standalone;
    - `/api/` requests show as network, not service worker, in the Network panel.

    Stop the dashboard process and reload the installed window: the cached shell shows the host-unreachable screen.
  - Step 3: With the Network panel open, confirm the observation boundary:
    - one run-list request per repository roughly every 15 seconds while the tab is visible;
    - none while it is hidden or the toggle is off;
    - no snapshot request for an unchanged completed run;
    - no overlapping requests.

    The recorded runs are all terminal with absent writer locks, so LIVE cannot be observed against them. Reaching it needs a run in progress, which requires separately authorized provider spend. Unless that is authorized, LIVE is proved by the Task 4 pure-function tests only, and this step says so.
  - Expected: all checks hold; any failure is reported with its evidence before any fix.
  - Task completion evidence: a dated record of each check in this plan's Status line.

- **Task 12: Documentation.**
  - Depends on: Task 11.
  - Files: modify `README.md` ("What the dashboard presents", the line 399 polling sentence, and the persistence sentence), and this plan's Status line.
  - Step 1: Rewrite the README dashboard presentation subsection to cover:
    - the new views, stage ledger, run progression, repository scoping, and status line;
    - auto-refresh (15 seconds, visible only, toggle, what it re-reads);
    - the lock-based liveness wording;
    - installation: per launch, and reopen the newly printed URL after a restart;
    - the service-worker boundary.

    Replace "Refresh is explicit: there is no polling, push, or WebSocket connection" with the bounded-refresh statement. Amend "persists dashboard state" to state that the browser caches only the static shell.
    - Verify: `npm run check:docs` and `grep -n "no polling" README.md`.
    - Expected: clean; no match.
  - Task completion evidence: `check:docs` exit 0.

## Rollback

Every change is on branch `dashboard-ux-redesign`. The HTTP API and CLI commands are untouched, and `RunSnapshot` changes only by the five additive `byAgent` fields, so reverting the branch's commits restores the previous dashboard and snapshot exactly. Removing only the projection extension means deleting those fields and their rendering. The dashboard then shows `Unavailable` for model attribution and duration, as it does today. A browser that installed the per-launch app keeps an orphaned, origin-scoped cache for a dead port. It holds only static files and is removed with the installed app.
