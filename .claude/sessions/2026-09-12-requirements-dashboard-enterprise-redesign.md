# Requirements Clarification

## Status

- Ready for planning: Yes
- Risk tier: High

## My Understanding

Redesign the existing BuildWorks dashboard from a diagnostic projection into an
executive-friendly enterprise delivery control plane. The redesign must replace
every visible raw JSON block with structured, accessible components while
preserving the dashboard's current loopback-only, bearer-protected, read-only
boundary and the exact distinctions in the authoritative run projection.

The new visual direction supersedes the dashboard design's earlier aesthetic
restrictions where they conflict with this request. The result should feel
authoritative, operational, trustworthy, engineering-focused, and
governance-driven rather than futuristic, playful, AI-centric, or startup-themed.

## Business Objective

Enable engineering leaders and operators to understand delivery health,
governance state, workflow progress, cost, token usage, findings, and required
next actions without reading serialized implementation data.

## Primary Actor

A local engineering leader or delivery operator inspecting explicitly configured
BuildWorks repositories and their governed runs.

## Current Behavior

- The portfolio renders run summaries in a structured table.
- Selecting a run reveals its complete authoritative snapshot.
- Most selected-run sections render that snapshot as formatted JSON.
- Themes, keyboard navigation, filtering, explicit refresh, stale-state
  preservation, and copy-only command handoffs already exist.
- The current `RunSnapshot` includes run and stage state, cost and token coverage,
  findings, approval, configuration, delivery, evidence, and only the latest
  audit event.
- The current `RunSnapshot` does not expose agent execution duration or a
  historical metric series.

## Known Pain Points

- Raw JSON makes important run outcomes difficult to scan.
- Governance, cost, findings, evidence, and delivery details lack visual
  hierarchy.
- Portfolio health and selected-run analytics are not summarized as decision
  signals.
- Existing presentation resembles a developer diagnostic page rather than an
  enterprise delivery control plane.

## Desired Behavior

- Present portfolio KPIs before run-level detail.
- Present the selected run through a summary card, authoritative status badge,
  workflow timeline, cost visualizations, agent analytics, finding cards,
  governance command tiles, activity feed, delivery summary, and evidence list.
- Keep every value traceable to the loaded run list or an exact-current
  `RunSnapshot`.
- Keep unavailable or partially reported telemetry explicit.
- Retain existing routing, refresh, stale-state, filtering, keyboard, theme,
  authentication, and read-only behavior.

## In Scope

- A complete visual redesign of `src/dashboard/index.html`,
  `src/dashboard/styles.css`, and the checked browser source.
- Structured replacements for every raw JSON section.
- Portfolio KPIs calculated over the currently loaded run window across all
  configured repositories.
- Selected-run workflow, cost, token, agent, findings, governance, activity,
  delivery, and evidence views.
- Responsive light and dark themes.
- Accessible CSS and native SVG visualizations with equivalent text or table
  representations.
- Focused UI tests and updates to directly affected dashboard documentation.

## Out of Scope

- Interactive lifecycle mutation or command execution.
- Remote or multi-user access.
- New database tables, migrations, telemetry persistence, or dashboard-owned
  state.
- WebSockets, notifications, forecasts, alerts, export, or a second harness.
- Reading core tables directly from the browser or dashboard server.
- Fabricated trends, durations, model assignments, findings dispositions, or
  completion states.
- Tailwind, UI frameworks, chart libraries, CSS-in-JS, or runtime CSS generators.
- A second paid run or any provider spend.

## Inputs

- Configured repository inventory from the existing dashboard bootstrap route.
- Loaded run summaries from each configured repository's existing runs route.
- Exact-current selected and portfolio run snapshots from the existing status
  route.
- Existing local UI preferences and route state.

## Outputs

- A structured portfolio and selected-run dashboard.
- Copy-only read command text for Status, Doctor, and Verify Audit.
- Explicit coverage and unavailable-state labels wherever source data is
  incomplete.
- No serialized JSON object or array exposed as user-facing content.

## Business and Data Rules

### Aggregation scope

- The KPI scope is the currently loaded run window across all configured
  repositories.
- "Runs" is the number of loaded run summaries.
- "Blocked Runs" is the number whose persisted status is `blocked`.
- "Active Runs" is the number whose persisted status is `in_progress`; this
  does not assert that an agent is actively executing.
- "Success Rate" is completed terminal runs divided by completed plus blocked
  terminal runs. It is unavailable when no terminal runs are loaded.
- Every portfolio aggregate states how many loaded runs supplied a complete
  snapshot and how many were unavailable, refused, or not yet loaded.
- A run outside the configured run limit is not included. The UI must disclose
  this bounded scope when `hasMore` is true.

### Cost and tokens

- "Known Cost" sums `knownUsd` only from successfully loaded snapshots.
- A cost total is unavailable when no contributing agent row reports cost.
- Partial cost coverage remains visibly partial; unreported rows are never
  treated as known zero-cost executions.
- "Total Tokens" is the sum of reported input, output, cache-read, and
  cache-write token classes. The UI names those included classes.
- Missing token classes and unreported rows remain visible beside the total.
- Cost by stage and cost by agent use only the selected snapshot's existing
  `cost.byStage` and `cost.byAgent` groups.
- The token-consumption visualization orders selected-run token totals by
  recorded stage ordinal. It is stage progression, not a claim of
  wall-clock sampling.

### Findings

- Portfolio "Findings" counts canonical finding IDs in successfully loaded
  snapshots and displays snapshot coverage.
- A finding card represents one canonical finding.
- Every immutable report remains separate within its finding card.
- Severity badges belong to individual reports; the UI must not synthesize one
  severity when reports disagree.
- Description uses the recorded report subject.
- Status uses the recorded decision disposition when present and separately
  identifies final-panel blocking when projected.
- Missing decisions remain "No recorded decision," not "open," "accepted," or
  "resolved."

### Agent analytics

- One row is displayed for each selected-run `cost.byAgent` entry.
- Executions use the projected `agentRows` count.
- Input tokens, output tokens, and cost retain their reported and unreported
  coverage.
- Findings generated count immutable reports whose projected reviewer ID matches
  the agent.
- Agent-level model is "Not reported at agent level" because the current
  projection does not bind `modelMap` entries to agent rows.
- Sparklines display a neutral unavailable state because no historical
  per-agent series is projected.

### Timing and trends

- Average execution time is defined as the arithmetic mean, across contributing
  loaded runs, of each run's summed recorded agent execution duration.
- The current `RunSnapshot` does not expose those durations. The KPI therefore
  displays "Unavailable" with that reason in this redesign.
- The dashboard must not substitute run wall-clock time, stage elapsed time, or
  verification-command duration.
- KPI trend indicators are neutral and labeled "Trend unavailable" unless an
  authoritative historical series is added by a separate core decision.
- Neutral indicators must not imply improvement, decline, or no change.

### Status vocabulary

- Large badges use authoritative values rather than marketing aliases.
- Persisted `in_progress`, `blocked`, and `completed` values render as
  `IN PROGRESS`, `BLOCKED`, and `COMPLETED`.
- Derived `awaiting_approval` and `interrupted_or_inconsistent` phases render as
  `AWAITING APPROVAL` and `ATTENTION REQUIRED` where phase is the relevant
  signal.
- The dashboard must not translate `in_progress` to `RUNNING` or `completed` to
  `PASSED`.
- Color supplements visible text and iconography; it never carries status alone.

### Activity

- The activity feed may use recorded stage start evidence, stage completion
  timestamps, and the projected latest audit event.
- Each item shows timestamp, event, stage when known, and recorded result.
- The feed must not imply that it is a complete audit history.
- Missing timestamps or event details render as unavailable rather than being
  inferred from neighboring records.

## UI Requirements

### Shell and hierarchy

- Use a product header, filter bar, KPI bar, portfolio region, and selected-run
  detail regions in that order.
- Preserve direct run selection and stable repository/run route identity.
- Use concise labels and progressive disclosure instead of large text dumps.
- Use 16-pixel card radii, restrained soft shadows, subtle gradients, and
  restrained glass-style overlays in dark mode.
- Visual effects must not reduce contrast or obscure semantic borders.

### KPI bar

Display eight cards:

1. Runs
2. Blocked Runs
3. Active Runs
4. Findings
5. Known Cost
6. Total Tokens
7. Success Rate
8. Average Execution Time

Each card includes:

- A recognizable inline SVG icon with an accessible name or decorative hiding,
  as appropriate.
- Primary value or explicit unavailable state.
- Scope or coverage text.
- A neutral trend indicator under the current data contract.
- A subtle hover treatment that is also available on keyboard focus when the
  card is interactive.

### Run summary

- Display repository, project or feature, current phase, persisted status, and
  last recorded activity.
- Use a prominent authoritative status or phase badge.
- Include stale-state and refusal information without replacing the last
  successful same-run snapshot.
- Do not reuse a prior snapshot for a different run.

### Workflow timeline

- Render recorded stages horizontally on wide screens and vertically on narrow
  screens.
- Preserve recorded order and exact stage kind labels.
- Show passed, blocked, in-progress, and unavailable states with text, icon, and
  semantic color.
- Show recorded timestamps and gate results in accessible details.
- Do not render unrecorded stages as completed or imply parallel execution.

### Cost dashboard

- Show total known cost and the four token classes with coverage.
- Render Cost by Stage as a bar chart.
- Render Cost by Agent as the requested donut chart, with a table or list
  equivalent and non-color labels.
- Render Token Consumption as a native SVG stage-progression chart with a table
  equivalent.
- Show explicit empty, partial, and unavailable states.

### Agent analytics

- Display Agent, Model, Executions, Input Tokens, Output Tokens, Cost, Findings
  Generated, and Trend.
- Preserve the unavailable model and sparkline states defined above.
- Keep large tables usable on narrow screens without expanding the page
  viewport.

### Findings dashboard

- Render one structured card per canonical finding.
- Display location, finding identity, round, all immutable report severities and
  descriptions, recorded decision, and final-panel blocking state.
- Use dark red for critical, red for high, amber for medium, and blue for low,
  while preserving text labels and contrast.
- Preserve every finding and report; do not silently truncate arrays.

### Governance command center

- Present Status, Doctor, and Verify Audit as action tiles.
- Each tile displays the exact target repository and run identity.
- Each tile has a copy button and explanatory copy-only text.
- Copying writes command text to the clipboard and announces success or failure
  through the existing live region.
- The dashboard never executes a command, opens a writer, collects consent, or
  claims the copied command succeeded.
- Existing eligible workflow and operator handoffs remain available as
  structured copy-only tiles with refusal reasons.

### Governance, delivery, and evidence

- Render frozen configuration as labeled definition groups.
- Render approval as a status card with binding fields.
- Render proposals as structured records.
- Render verification commands and outcomes as a table or card list.
- Render delivery artifacts and missing paths as labeled lists.
- Render evidence references with kind, stage, availability, path, and reason.
- Render limitations as an explicit callout list.
- Do not expose raw prompts, raw model output, signatures, credentials, or an
  unrestricted file browser.

### Recent activity

- Render recorded activity as a timeline feed.
- Show timestamp, event, stage, and result where projected.
- Label the feed as a partial recorded view because the current snapshot exposes
  only stage timestamps and the latest audit event.

### Themes

- Dark theme tokens:
  - Background `#0f172a`
  - Surface `#1e293b`
  - Border `#334155`
  - Text `#f8fafc`
  - Accent `#0891b2`
- Light theme tokens:
  - Background `#f8fafc`
  - Surface `#ffffff`
  - Border `#e2e8f0`
  - Text `#0f172a`
  - Accent `#0891b2`
- Semantic colors:
  - Passed or completed `#22c55e`
  - Blocked or danger `#ef4444`
  - Warning `#f59e0b`
  - In progress `#3b82f6`
  - Neutral `#64748b`
- Typography uses Inter when locally available, then Segoe UI and `system-ui`.
- No external font request is required.

## Permissions and Security

- Preserve the CLI as the only mutating surface.
- Preserve loopback-only binding, process-lifetime bearer authentication,
  authenticated `/api/` routes, and the existing static allowlist.
- Preserve Host, Origin, method, and token enforcement.
- Do not place bearer tokens in rendered content, logs, links, copied commands,
  or persistent storage.
- Preserve per-repository refusal isolation and read-only store access.
- Add no third-party network-loaded scripts, fonts, icons, or analytics.

## Error Handling

- A repository refusal must remain visible without suppressing healthy
  repositories.
- A failed same-run refresh must preserve and label the last successful snapshot
  as stale.
- A failed different-run refresh must not display the prior run's snapshot.
- Portfolio aggregates must exclude unavailable snapshots and display the
  resulting coverage.
- A clipboard failure must be announced without claiming the command was copied.
- Empty findings, cost, agent, delivery, evidence, or activity collections must
  use purposeful empty states, never an empty chart or empty JSON block.

## Edge Cases

- Zero loaded runs.
- More runs exist than the configured 1–100 limit.
- Some repositories or snapshots are unavailable.
- All cost rows are unreported.
- Some token classes are partially reported.
- A finding has multiple reports with different severities.
- A run has no finding decision.
- A run is `in_progress` but no execution is active.
- Stage timestamps are incomplete.
- Long repository paths, commands, evidence references, and finding text.
- Hundreds of findings without document-level horizontal overflow.
- Theme changes, reduced motion, high contrast, zoom, and narrow viewports.

## Non-Functional Requirements

- Use HTML5, modern CSS, inline SVG, and the current vanilla browser source.
- Retain strict TypeScript `checkJs`; do not introduce a browser compilation or
  bundling step for this redesign.
- Add no runtime dependency.
- Meet WCAG 2.1 AA contrast and interaction requirements.
- Support full keyboard navigation and visible focus.
- Preserve screen-reader landmarks, headings, table semantics, live regions,
  and descriptive chart alternatives.
- Respect `prefers-reduced-motion` and forced-colors or high-contrast modes.
- Never rely on color, hover, or pointer interaction alone.
- Keep the page within the viewport at 320 CSS pixels; data regions may use
  contained local scrolling where necessary.
- Avoid unnecessary animation and decorative visual noise.

## Acceptance Criteria

```gherkin
Given the dashboard has loaded run summaries from one or more configured repositories
When the portfolio is rendered
Then the eight KPI cards use the loaded portfolio scope, disclose coverage, and never infer unavailable telemetry
```

```gherkin
Given no terminal run is loaded
When Success Rate is rendered
Then it displays an unavailable state rather than zero percent
```

```gherkin
Given the current snapshot contract has no agent-duration aggregate
When Average Execution Time is rendered
Then it displays "Unavailable" with the missing-projection reason and does not substitute wall-clock or verification time
```

```gherkin
Given a selected run has a complete authoritative snapshot
When its detail view is rendered
Then repository, feature, phase, status, last activity, ordered stages, cost, tokens, agents, findings, governance, delivery, evidence, limitations, and recorded activity appear as structured components
```

```gherkin
Given any dashboard view
When a user inspects its visible content
Then no snapshot object or array is displayed as serialized JSON
```

```gherkin
Given a run has persisted status or a derived exceptional phase
When its large badge is rendered
Then the badge uses the authoritative vocabulary and does not translate in-progress to running or completed to passed
```

```gherkin
Given a selected run has stage records
When the workflow timeline is rendered
Then stages appear in recorded order with textual, iconic, and semantic-color state indicators
```

```gherkin
Given selected-run cost groups contain reported values
When cost visualizations are rendered
Then bar, donut, and stage-progression charts match the projected values and expose equivalent text or tabular data
```

```gherkin
Given cost or token rows are unreported
When totals or charts are rendered
Then the dashboard displays partial or unavailable coverage and does not treat missing values as known zero
```

```gherkin
Given a canonical finding contains multiple immutable reports
When its finding card is rendered
Then every report retains its own reviewer, severity, classification, and subject without a synthesized finding severity
```

```gherkin
Given the selected run has agent cost groups
When Agent Analytics is rendered
Then executions, reported tokens, cost, and attributed report counts are shown while model and sparkline cells explicitly state their unavailable status
```

```gherkin
Given the current snapshot exposes stage timestamps and one latest audit event
When Recent Activity is rendered
Then only those recorded observations appear and the feed is labeled as partial
```

```gherkin
Given a user selects a governance command tile
When the copy action succeeds
Then the exact command is placed on the clipboard, success is announced, and no command or state mutation is executed
```

```gherkin
Given a same-run refresh fails after a successful snapshot
When the dashboard rerenders
Then the structured view preserves that snapshot as stale and shows the new refusal
```

```gherkin
Given a different run is selected and its refresh fails
When the dashboard rerenders
Then no content from the previously selected run appears under the new route
```

```gherkin
Given light theme, dark theme, forced colors, reduced motion, keyboard-only navigation, or a 320-pixel viewport
When the dashboard is used
Then content remains perceivable, operable, labeled, and contained without document-level horizontal overflow
```

```gherkin
Given the redesigned frontend
When the repository's dashboard and primary TypeScript programs run
Then the browser source remains in the DOM-enabled checkJs program and DOM globals remain excluded from the primary Node program
```

## Assumptions

- The user's new visual request supersedes conflicting aesthetic restrictions in
  the earlier dashboard design, while its governance and source-of-truth rules
  remain binding.
- Restrained gradients, a cost-by-agent donut, and dark-mode glass overlays are
  permitted only where they preserve the authoritative enterprise-control-plane
  personality specified in the latest direction.
- Existing browser compatibility remains the target; no new browser support
  matrix or performance SLA is introduced.
- The existing repository/run limit control remains the definition of the
  loaded portfolio window.

## Open Questions

1. None.
