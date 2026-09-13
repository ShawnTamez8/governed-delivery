# Requirements Clarification

## Status

- Ready for planning: Yes
- Risk tier: Low

The redesign shipped in `docs/features/dashboard-enterprise-redesign/plan.md`
removed raw JSON and added structured sections, but it presents those sections
as an always-expanded, uniformly weighted report. This follow-on is presentation
density and label precision only. It changes no route, no schema, no read model,
no authorization, and no security boundary, which is why the tier is Low despite
touching governance-evidence display: every rule below narrows or repositions
recorded evidence and none removes or reinterprets it.

## My Understanding

Rework the dashboard's information hierarchy so an operator sees the decision —
what happened, why it is blocked, what it cost, what to do next — without
scrolling, and reaches supporting audit evidence by deliberately expanding it.
The current run view stacks fourteen equally weighted panels that render every
recorded field inline, so the page reads as a governance database dump rather
than a control plane.

A second, independent problem runs through the same screens: repeated
unavailability labels, full floating-point money, full-length hashes and paths,
and per-section explanatory prose inflate the page without adding information.
Several of those labels are also imprecise — they report a field the recorded
disposition structurally forbids as though the data were merely missing.

## Business Objective

Let an operator triage a governed run at a glance and reach its audit evidence
on demand, so the dashboard functions as an operational control plane while
remaining a complete and honest projection of recorded state.

## Primary Actor

A local engineering leader or delivery operator inspecting explicitly configured
BuildWorks repositories and their governed runs through the loopback, read-only
dashboard.

## Current Behavior

Evidence is three operator screen captures from the retained paid run
(`smoke` / `web-calculator`, run 1, blocked at `code_review` round 2 of 2)
recorded on 2026-09-12 against the current implementation.

- The run view renders fourteen sections stacked full width, all expanded.
- The run summary is a flat definition list of every field: submitted path,
  run, project, feature, slug, change kind, persisted status, derived phase,
  three near-identical ISO-8601 UTC timestamps, workflow eligibility, and a
  four-row writer-lock block.
- `usd()` interpolates the stored float directly, producing `$0.5452318` and
  `$0.26745660000000004`.
- The agent analytics table carries a `Model` column repeating
  "Not reported at agent level" on all seven rows and a `Trend` column
  repeating "Trend unavailable" on all seven rows.
- Every agent token cell appends a coverage parenthetical
  (`24 (2 reported, 0 unreported)`) even when no row has an unreported value.
- The agent table shows input and output tokens only; cache read and cache
  write are omitted without saying so, which makes an input total of 24 beside
  an output total of 26,698 look like a defect rather than a cache effect.
- Finding cards render every recorded field inline, including two 64-character
  artifact hashes, full normative-change before/after artifact text, and full
  grounding excerpts. Finding 1 alone occupies roughly forty lines.
- Finding 1 (`addressed`) renders "Grounding source / location / excerpt:
  Not recorded" three times. Finding 2 (`rejected_with_rationale`) renders
  "No recorded normative change."
- "Final-panel blocking: Not projected" appears on three of four findings.
- Each of the three command tiles repeats the full repository path twice, plus
  "Shell: PowerShell" and "Reason: No recorded reason".
- Frozen configuration displays four 64-character hashes and a 40-character
  commit at full length; profile hash and starting commit each appear twice on
  the page.
- The model map lists six rows whose value is `claude-sonnet-5` in all six.
- "Proposals (0)" renders as a full section heading with no content.
- A `.source-note` explanatory sentence sits under most sections.

## Known Pain Points

- The operator must scroll past a timeline, an activity feed, cost charts, and
  an agent table before reaching the blocking finding that explains the state.
- The single most decision-relevant string on the page —
  `policy_block run 1 is blocked; last recorded event code_review.gate.block:
  round=2/2; commit=270dc90...; findings=1; blocking=1; threshold=high` — is
  rendered as one unbroken line inside a definition list.
- Raw float money reads as a defect and defeats comparison between agents.
- Constant-valued columns and repeated unavailability labels consume the
  vertical space that the blocking finding needs.
- "Not recorded" applied to a structurally forbidden field tells the operator
  that evidence is missing when the recorded disposition guarantees its absence.
- The light theme's monochrome slate palette reinforces the report reading.

## Desired Behavior

The selected run opens on a compact executive summary that answers what
happened, why the run is in its current state, the highest-severity blocking
finding, what the run cost, and the authoritative next action. Every other
section remains present, in a deliberate order, collapsed by default, and
expands without a network read. Text volume falls through collapsing constants,
aggregating unavailability, shortening identity strings behind a copy
affordance, and moving per-section explanation into the disclosure it explains —
never by dropping a recorded value.

## Decisions Already Taken

These were settled by the operator on 2026-09-12 and are constraints, not
open questions.

- The `RunSnapshot` extension that would project the agent fields already
  stored in `agent_runs` (`executor`, `requested_model`, `effective_model`,
  `fallback`, `duration_ms`, `role`, `independence`) is **deferred**. Agent-level
  model, harness identity, and execution duration stay unavailable in this work.
- The structural fix is an **executive hero plus aggressive collapse**. Tabs and
  a sticky anchored section navigation were both considered and not selected.

## In Scope

- A run executive summary region rendered above every other run section.
- A deliberate section order placing outcome and blocking evidence before
  historical and audit material.
- Default-collapsed disclosure for supporting and audit sections, with counts
  in every summary line.
- Finding cards restructured for triage, with full audit evidence behind a
  per-finding disclosure.
- Monetary formatting, identity-string shortening, and timestamp presentation.
- Collapsing constant-valued table columns into a single statement.
- Aggregating repeated unavailability into one statement per section.
- Distinguishing disposition-forbidden fields from missing data.
- Repository presentation leading with project identity over filesystem path.
- A persistent governed-actions affordance that remains copy-only.
- Severity and state colour consistency across badges, charts, and cards.
- A light-theme accent pass that keeps every ratio at or above 4.5:1.
- Empty and absent states reduced to a single line.

## Out of Scope

- Any change to `RunSnapshot`, `src/operator-state.ts`, or
  `src/operator-read.ts`.
- Any change to routes, authentication, the loopback binding, the
  Content-Security-Policy, or the GET-only method restriction.
- Agent-level model, harness identity, effort level, and execution duration.
- Historical trend series and cross-run comparison.
- Any executable action, consent collection, writer open, or signature display.
- Tabs, sticky section navigation, and client-side routing beyond the existing
  hash deep link.
- New runtime dependencies, a build step, a charting library, or web fonts.
- Any paid provider invocation.

## Business and Data Rules

### Presentation may narrow, never alter

- R1. No recorded value may be removed from the page. A value moved behind a
  disclosure, shortened, or aggregated must remain reachable without a further
  read, and its exact form must remain available to assistive technology.
- R2. The dashboard renders recorded identifiers verbatim. A human-readable
  display label may accompany an identifier but never replaces it, and the
  exact string must stay copyable. This applies to agent IDs, model
  identifiers, stage kinds, statuses, dispositions, and repository paths.

### Constants and unavailability

- R3. When every row of a table column holds one identical value, the column is
  removed and the value is stated once in that section, naming the column it
  replaces and the row count it covers. If any row differs, the column stays.
- R4. Repeated unavailability within one section is stated once for that
  section rather than per cell. The statement names what is unavailable and
  why, in the terms the existing projection already uses.
- R5. A coverage qualifier (`n reported, m unreported`) is shown only where
  `m > 0`, or where a section-level statement records that every row is fully
  reported.
- R6. An empty collection renders as one line naming the collection and its
  zero count, not as a section with a heading and a body.

### Precision and identity strings

- R7. Monetary values display rounded to two decimal places with a currency
  marker. The exact stored value remains available to assistive technology and
  through the existing disclosure pattern. The stored value is never rounded,
  re-derived, or summed from rounded components.
- R8. Hash and commit identifiers display a leading fragment of fixed length
  with the full value available to assistive technology and through a copy
  affordance. Truncation never applies to a value the operator must compare by
  eye within a single view; where two hashes are compared, the comparison
  result is stated in words alongside them.
- R9. When two compared artifact hashes are equal, the card states that the
  artifact is unchanged rather than requiring the operator to compare two
  64-character strings.
- R10. Timestamps display in the viewer's local zone with the exact recorded
  UTC value available to assistive technology. A run's created, updated, and
  last-activity timestamps collapse to the most recent, with the others behind
  the run's detail disclosure.

### Governance-evidence precision

- R11. A decision field that the recorded disposition structurally forbids must
  not render as "Not recorded". `src/store.ts` `insertFindingDecision` requires
  a grounding object exactly when the disposition is `rejected_with_rationale`
  and forbids it otherwise, and requires normative changes exactly when the
  disposition is `addressed`. The card states that the field does not apply
  under the recorded disposition, or omits it.
- R12. `finalPanelBlocking` of `null` means the projection did not report a
  final-panel result for that finding. It is shown only on findings where it is
  non-null, with the null case covered by one section-level statement.
- R13. The executive summary derives the blocking finding from the projected
  finding records — `finalPanelBlocking === true` and the recorded report
  severities — and never by parsing the workflow-eligibility reason string. The
  reason string is displayed verbatim in a disclosure.
- R14. The executive summary's next action comes from `workflowAction` and its
  recorded `reasons`. The dashboard proposes no remediation, recommends no
  command not already projected, and infers no cause.
- R15. Where the recorded approval `expiresAt` precedes the envelope
  `observedAt`, the approval region states that the recorded approval window has
  closed, labelled as derived from those two recorded timestamps. The recorded
  `state` continues to display verbatim and is not contradicted.
- R16. The agent analytics table presents all four token classes, or names
  which classes it omits and where the omitted values are available. An input
  total shown without its cache-read counterpart is misleading and not
  acceptable.

## UI Requirements

### Executive summary

- U1. The run executive summary is the first content in the run view, is
  reachable by the existing skip link, and fits within a 1440 × 900 CSS-pixel
  viewport together with the run's section list.
- U2. It presents: run identity and project; a state badge using the
  authoritative status vocabulary; the highest-severity blocking finding with
  its severity, recorded location, and stage; total known cost; total known
  tokens; the repository's display identity; and the projected next action with
  its eligibility.
- U3. Where any of those is unavailable, the summary says so in place rather
  than omitting the row, and one statement covers a group that is unavailable
  for one shared reason.

### Section order and disclosure

- U4. Run sections appear in this order: executive summary, blocking and open
  findings, governed actions, cost and tokens, workflow timeline, activity,
  agent analytics, frozen configuration and approval, delivery, evidence.
- U5. Every section below the executive summary and the findings section is a
  native disclosure, collapsed by default, whose summary line carries the
  section name and a count where the section has a countable body.
- U6. Expanding a disclosure performs no network read and requires no refresh.
- U7. Collapse state is presentation only. It is not encoded in the deep link,
  not persisted, and never required for any value to be considered presented.

### Finding cards

- U8. A collapsed finding card presents severity, a readable title derived from
  the recorded intent key, the recorded location, the stage and round, the
  recorded disposition or an open indicator, and whether the finding is
  final-panel blocking where that is non-null.
- U9. Report subject text is presented at card level, verbatim and untruncated.
- U10. Artifact hashes, normative changes, grounding, rationale, changed
  locations, and agent-run identifiers sit behind the card's disclosure.
- U11. Findings order blocking first, then by severity, then by recorded
  identifier ascending. The ordering rule is stated in the section.

### Density and identity

- U12. The governed-actions region presents each command's name, eligibility,
  and copy control without repeating the repository path per tile; the
  repository is stated once for the region. The full command text stays
  available and remains copy-only.
- U13. A repository presents its project identity first, with the canonical
  path available through a copy affordance and to assistive technology. The
  canonical path remains the repository's identity throughout.
- U14. A section's explanatory note moves inside the disclosure it explains, or
  is stated once for the run view. The same explanation does not repeat per
  section.
- U15. An absent writer lock renders as one line. The lock's fields render only
  when the lock is present.

### Visual system

- U16. Severity and state use one colour mapping across badges, charts,
  timeline markers, and cards. Colour never carries meaning alone: every state
  pairs colour with text, and with a shape or icon where a badge is the only
  carrier.
- U17. The light theme introduces accent and surface variation sufficient to
  distinguish state at a glance, with every text pairing at or above 4.5:1 and
  every non-text state indicator at or above 3:1.
- U18. All existing accessibility behaviour is retained: visible focus,
  `prefers-reduced-motion`, `forced-colors`, 200% zoom, and containment at
  320 CSS pixels with no document-level horizontal scrolling.

## Permissions and Security

- P1. The dashboard remains loopback-bound, bearer-protected, GET-only, and
  read-only. No requirement here adds a route, a method, a transport, or a
  mutation.
- P2. Copy affordances place text on the clipboard and nothing else. No command
  executes, no writer opens, and no consent is collected.
- P3. Signatures are never displayed or served. Shortening the signer hash does
  not change what is served.
- P4. The Content-Security-Policy is unchanged, so no inline style, no injected
  markup, and no third-party asset may be introduced. Presentation continues to
  use classes and SVG presentation attributes.

## Error Handling

- E1. A stale, failed, or unavailable read continues to present its prior
  successful value with its original `observedAt`, plus the new code and
  reason. Collapsing a section never suppresses that indicator: a section whose
  resource is stale or unavailable shows that state on its collapsed summary
  line.
- E2. One repository's or one run's failure does not suppress another's result
  or alter another's collapse state.
- E3. Where the executive summary cannot be built because the snapshot is
  unavailable, it states that in place of the summary and the remaining
  sections behave as they do today.

## Edge Cases

- X1. A run with no finding: findings section states zero and the executive
  summary reports no blocking finding rather than an empty slot.
- X2. A run blocked with no finding marked final-panel blocking: the summary
  names the highest-severity open finding and says no final-panel blocking
  finding is projected.
- X3. Multiple findings tie at the highest severity: the summary names the
  lowest recorded identifier among them and states that others share the
  severity.
- X4. Every token class unreported, versus every reported class equal to zero:
  the existing three-way distinction is preserved in the summary and in every
  aggregate it feeds.
- X5. Cost unavailable because no row reported: the summary says cost is
  unavailable rather than showing zero.
- X6. A column that is constant in one run and varies in another: the collapse
  rule evaluates per render, never per column definition.
- X7. A single-run repository, and a repository with no run: the repository card
  presents its identity and the zero count without an empty table.
- X8. A recorded value whose length exceeds its truncation budget by one
  character is still truncated, and a value shorter than the budget is never
  padded or altered.

## Non-Functional Requirements

- N1. No new runtime dependency, build step, bundler, charting library, web
  font, or network asset. Browser-native modules only, strictly type-checked
  through `tsconfig.dashboard.json`.
- N2. Projection and formatting logic lives in `src/dashboard/dashboard-model.js`
  and stays free of DOM, `window`, and `fetch` usage, so it remains directly
  testable.
- N3. Every new projection and formatting rule is proved against real `Store`
  rows through `readStatusResult` or `readRunsResult`. No hand-written
  `RunSnapshot` defines correctness.
- N4. Each new guard is proved by mutation: break the behaviour, confirm the
  test fails, restore byte-exactly.
- N5. Rendering the full paid-run snapshot performs no measurable additional
  read; collapsing is presentation state only.

## Acceptance Criteria

```gherkin
Scenario: The blocked run's outcome is visible without scrolling
  Given the retained paid run is selected at 1440 by 900 CSS pixels
  When the run view renders
  Then the executive summary is the first content in the run region
  And it shows the run state, the blocking finding severity and location,
      the total known cost, the total known tokens, and the projected next action
  And no scrolling is required to read it
```

```gherkin
Scenario: Supporting sections are collapsed but complete
  Given the run view has rendered
  Then every section below findings is a collapsed native disclosure
  And each collapsed summary line carries the section name and its count
  When any disclosure is expanded
  Then its content appears with no network read
  And every value the previous design displayed is present
```

```gherkin
Scenario: Money is readable and exact
  Given an agent group whose recorded cost is 0.5452318
  When the agent analytics section renders
  Then the visible text is "$0.55"
  And the exact value 0.5452318 is available to assistive technology
  And no stored cost value is modified
```

```gherkin
Scenario: A constant column collapses to one statement
  Given every agent row reports the same model unavailability
  When the agent analytics section renders
  Then no per-row model cell is rendered
  And the section states once that no model is bound at agent level
      and names the number of rows it covers
```

```gherkin
Scenario: A varying column is not collapsed
  Given one agent row differs from the others in a column
  When that section renders
  Then the column is rendered per row
```

```gherkin
Scenario: A forbidden decision field is not reported as missing
  Given a finding whose recorded disposition is "addressed"
  When its card renders
  Then no grounding field reads "Not recorded"
  And the card states that grounding does not apply under that disposition
  And its normative changes are present behind the card disclosure
```

```gherkin
Scenario: A rejected finding's normative changes are not reported as missing
  Given a finding whose recorded disposition is "rejected_with_rationale"
  When its card renders
  Then no normative-change field reads "No recorded normative change"
  And the card states that normative changes do not apply under that disposition
  And its recorded grounding is present behind the card disclosure
```

```gherkin
Scenario: The blocking finding is derived from records, not parsed from prose
  Given the run's workflow eligibility reason names a blocking count
  When the executive summary selects the blocking finding
  Then the selection uses the projected finding records only
  And the reason string is displayed verbatim inside a disclosure
```

```gherkin
Scenario: No remediation is invented
  Given a blocked run
  When the executive summary renders its next action
  Then the action text comes from the projected workflow action and its reasons
  And no recommendation absent from the projection is displayed
```

```gherkin
Scenario: Unchanged artifact hashes are stated in words
  Given a finding decision whose before and after artifact hashes are equal
  When its card disclosure renders
  Then the card states that the artifact is unchanged
  And both hashes remain available
```

```gherkin
Scenario: Agent token classes are complete or the omission is named
  Given an agent group with recorded input, output, cache-read and cache-write totals
  When the agent analytics section renders
  Then all four classes are presented
  Or the section names which classes are omitted and where they are available
```

```gherkin
Scenario: Reported zero is still distinguished from nothing reported
  Given one run whose agent rows record zero tokens
  And another run whose agent rows record no token value
  When each run's executive summary renders
  Then the first reports a token total of zero
  And the second reports token totals as unavailable
```

```gherkin
Scenario: An absent writer lock costs one line
  Given a run whose recorded writer lock state is absent
  When the run view renders
  Then the lock is presented as a single line
  And no lock path, process identifier, or reason row is rendered
```

```gherkin
Scenario: An empty collection does not occupy a section
  Given a run with zero proposals
  When the run view renders
  Then proposals are presented as one line naming the zero count
```

```gherkin
Scenario: The repository leads with project identity
  Given a repository whose canonical path is a long temporary directory
  When the repository card renders
  Then the project identity is the card's leading text
  And the canonical path is available through a copy control and to assistive technology
```

```gherkin
Scenario: Governed actions stay copy-only and stop repeating the path
  Given three projected operator actions for one repository
  When the governed actions region renders
  Then the repository is stated once for the region
  And each action presents its name, eligibility, and copy control
  And activating a copy control places text on the clipboard and executes nothing
```

```gherkin
Scenario: A closed approval window is reported without contradicting the record
  Given a recorded approval whose expiry precedes the envelope observation time
  When the approval region renders
  Then the recorded approval state is displayed verbatim
  And the region states that the recorded approval window has closed
  And that statement is labelled as derived from the recorded timestamps
```

```gherkin
Scenario: A stale section reports staleness while collapsed
  Given a section whose underlying resource is stale
  When the run view renders with that section collapsed
  Then the collapsed summary line carries the stale indicator and its reason
```

```gherkin
Scenario: Colour is never the only carrier of state
  Given the severity and state colour mapping
  When any badge, chart segment, or timeline marker renders
  Then its state is also conveyed by text
  And by a shape or icon where the badge is the only carrier
  And the view remains usable under forced colors
```

```gherkin
Scenario: The light theme stays accessible after the accent pass
  Given the declared light and dark theme tokens
  When contrast is computed for every declared text pairing
  Then every ratio is at least 4.5 to 1
  And every non-text state indicator is at least 3 to 1
```

```gherkin
Scenario: The read-only boundary is unchanged
  Given the redesigned dashboard
  When its static assets and routes are inspected
  Then no route, method, header, or policy differs from the current server
  And no asset performs a mutating request
```

## Assumptions

- A1. "Readable title derived from the recorded intent key" means presentational
  formatting of that exact string — separator and capitalisation only. The
  recorded key remains displayed or copyable. Low risk and reversible.
- A2. Hash truncation shows the leading twelve characters, matching the
  convention already used for commits in this repository's own documents. Any
  fixed length satisfies R8; twelve is the default absent a preference.
- A3. Native `<details>` and `<summary>` provide the disclosure behaviour, since
  they are already used in the current implementation and need no script.
- A4. "Project identity" for a repository means the run's recorded `project`
  value where the loaded window has one, and the canonical path's final segment
  otherwise. Both are recorded or derived from recorded values.
- A5. The executive summary's "total known tokens" sums the four recorded token
  classes, matching the existing `tokenTotal` behaviour, and reports
  unavailable where no class reported.

## Open Questions

All four are closed by the operator on 2026-09-12. They are constraints now,
not questions.

1. **Findings default state — expanded.** The findings section remains expanded
   by default alongside the executive summary, as U4 and U5 already assume.
   Only sections below findings are collapsed disclosures.
2. **Hash fragment length — twelve characters.** A2 stands as written: the
   leading twelve characters display, with the full value copyable and exposed
   to assistive technology.
3. **Governed actions — document flow.** The region is not sticky. A sticky
   region costs vertical space on short viewports and works against U1.
4. **Portfolio view — in scope.** The portfolio view receives the same density
   and label-precision treatment as the run view in this work. Every rule in
   *Business and Data Rules* and *Density and identity* applies to it where the
   rule has a portfolio analogue; the run executive summary (U1–U3) and the run
   section order (U4) remain run-view requirements. This closes Open Question 4
   and widens the *In Scope* list accordingly; nothing in *Out of Scope*
   changes, so `RunSnapshot`, `src/operator-state.ts`, `src/operator-read.ts`,
   the routes and the boundary remain untouched.
