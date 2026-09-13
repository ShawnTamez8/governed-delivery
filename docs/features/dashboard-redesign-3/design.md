# BuildWorks Governed Delivery Dashboard

## Enterprise Dashboard Redesign Specification

**Document purpose:** Define the information architecture, layout, content hierarchy, interaction patterns, and visual direction for the next version of the BuildWorks Governed Delivery Dashboard.

**Primary objective:** Transform the current long-form operational report into an enterprise-grade governed delivery command center that makes delivery health, governance risk, blocked work, and required actions immediately visible.

**Hazards considered:** 2 (evidence and telemetry availability must be explicit rather than hiding gaps or reconstructing raw output); 4 (UI expectations derive from authoritative `RunSnapshot` and `Store` contracts rather than hand-written fixtures); 10 (recorded model identifiers remain verbatim without alias normalization; agent-level model and execution duration remain explicitly unavailable); 12 (repository identity and configuration remain isolated and labeled per repository); 14 (recorded reviewer identity is presented as recorded evidence, not an independence claim); and 18 (completed stages and passed checks remain evidence records, never claims of semantic product correctness).

---

## 1. Product Direction

The dashboard should not behave like a rendered system report. It should operate as a **Governed Delivery Command Center**.

A user should be able to answer the following questions within five seconds:

1. Is the delivery portfolio healthy?
2. What is blocked or at risk?
3. What requires action now?
4. Which repository or run is affected?
5. Is the delivery ready to release?
6. Is the underlying data complete and current?

The experience should be:

- Exception-first
- Governance-centered
- Action-oriented
- Scannable
- Audit-friendly
- Progressively disclosed
- Accessible in light and dark themes
- Suitable for engineering leaders, release managers, auditors, governance teams, and delivery teams

---

## 2. Current Experience Problems

### 2.1 Report-like structure

The current experience is a long vertical sequence of metrics, explanatory paragraphs, repository information, calculation notes, and projection metadata. Users must read the page to discover what matters.

### 2.2 Weak signal-to-noise ratio

Critical information is available but buried:

- A blocked run
- Open findings
- A zero-percent success rate
- Missing execution-duration telemetry
- Snapshot and reporting-state information

These signals should be visually prioritized rather than presented alongside implementation detail.

### 2.3 Flat metric hierarchy

Delivery outcomes, governance failures, tokens, cost, run counts, snapshot counts, and telemetry notes receive similar visual weight. Governance and delivery risk should outrank AI utilization and diagnostic data.

### 2.4 Excessive explanatory content

Metric definitions, formulas, caveats, and provenance are useful for auditability, but they should not dominate the overview. Put them in tooltips, popovers, drawers, or a diagnostics view.

### 2.5 Developer-centric repository presentation

Canonical local paths, projection terminology, hashes, and exact timestamps make the product feel like an internal engineering utility. The main view should show friendly repository names, delivery status, phase, findings, and recent activity.

### 2.6 No clear action center

The page reports conditions but does not establish a prioritized queue of issues requiring user action.

### 2.7 Missing delivery-flow visibility

A governed SDLC platform should make the current stage and failed gate immediately clear. Users should not need to infer pipeline state from run metadata.

---

## 3. Information Architecture

### 3.1 Primary navigation

Use a compact, persistent application navigation structure:

- Overview
- Runs
- Findings
- Repositories
- Governance
- Models & Agents
- Audit
- Settings

The redesigned dashboard becomes the **Overview** page. Detailed run records, findings, model telemetry, audit events, and diagnostics belong in their respective destinations.

### 3.2 Overview page order

Use this exact priority:

1. Application header and scope controls
2. Portfolio status banner
3. Four primary KPI cards
4. Needs Attention queue
5. Recent delivery activity
6. Delivery pipeline status
7. Repository portfolio
8. AI governance and utilization
9. Data quality
10. Technical provenance and diagnostics through progressive disclosure

---

## 4. Desktop Wireframe

Target viewport: 1440 pixels and wider.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUILDWORKS                                         Governed Delivery         │
│                                                                              │
│ Overview | Runs | Findings | Governance | Models & Agents | Audit | Settings│
├──────────────────────────────────────────────────────────────────────────────┤
│ Repository: All ▼   Environment: All ▼   Time range ▼   Search   Refresh    │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ PORTFOLIO STATUS                                                 AT RISK ●   │
│                                                                              │
│ 1 blocked delivery requires attention. 4 open findings require review.      │
│                                                                              │
│ [View blocked run] [Review findings]               Updated moments ago      │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┬──────────────────┬──────────────────┬─────────────────────┐
│ RELEASE          │ GOVERNANCE       │ OPEN FINDINGS    │ DELIVERY SUCCESS    │
│ READINESS        │ STATUS           │                  │                     │
│                  │                  │                  │                     │
│ Blocked          │ At Risk          │ 4                │ 0%                  │
│ 1 blocked run    │ 1 failed control │ Across 1 run     │ 0 complete          │
│                  │                  │                  │ 1 blocked           │
└──────────────────┴──────────────────┴──────────────────┴─────────────────────┘

┌────────────────────────────────────────┬─────────────────────────────────────┐
│ NEEDS ATTENTION                        │ RECENT DELIVERY ACTIVITY            │
│                                        │                                     │
│ 🔴 BLOCKED DELIVERY                    │ ● Planning completed                │
│ web-calculator                         │ ● Review started                    │
│ 4 findings require review              │ ● Governance failed                 │
│ Last activity Sep 12, 1:47 PM          │                                     │
│ [Open run] [Review findings]            │ Sep 12, 1:47 PM                    │
│                                        │ [View run details]                  │
├────────────────────────────────────────┤                                     │
│ 🟡 DATA QUALITY                        │                                     │
│ Execution duration was not reported    │                                     │
│ [View telemetry details]               │                                     │
└────────────────────────────────────────┴─────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ DELIVERY PIPELINE                                                           │
├──────────────────────────────────────────────────────────────────────────────┤
│ Specification  ● Complete    Planning     ● Complete                         │
│ Implementation ● Complete    Testing      ● Complete                         │
│ Review         ● Failed      Governance   ● Failed                           │
│ Approval       ○ Waiting     Release      ○ Blocked                          │
│                                                                              │
│ [Open failed stage] [View governance decision]                               │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ REPOSITORY PORTFOLIO                                      View: Table ▼      │
├──────────────────────┬──────────┬──────────┬──────────┬──────────┬────────────┤
│ Repository           │ Health   │ Phase    │ Blocked  │ Findings │ Activity   │
├──────────────────────┼──────────┼──────────┼──────────┼──────────┼────────────┤
│ smoke                │ At Risk  │ Review   │ 1        │ 4        │ Sep 12     │
│ web-calculator       │          │          │          │          │ [Open]     │
└──────────────────────┴──────────┴──────────┴──────────┴──────────┴────────────┘

┌─────────────────────────────────────────────┬────────────────────────────────┐
│ AI GOVERNANCE & UTILIZATION                 │ DATA QUALITY                   │
│                                             │                                │
│ Total tokens                    1.21M        │ Snapshot coverage       100%   │
│ Known cost                      $1.81        │ Current snapshots       1      │
│ Reporting coverage              16 of 16     │ Stale snapshots         0      │
│                                             │ Missing duration        1 run  │
│ [View models and agents]                     │ [View telemetry details]        │
└─────────────────────────────────────────────┴────────────────────────────────┘
```

Wireframe values are examples based on the currently loaded dashboard state. The implementation must bind to authoritative runtime data and must not hard-code these values.

---

## 5. Responsive Grid

Use a responsive 12-column layout with a constrained maximum content width of approximately 1440 to 1600 pixels.

### Desktop

- Header and filters: 12 columns
- Portfolio status banner: 12 columns
- Primary KPI cards: 3 columns each
- Needs Attention: 7 columns
- Recent Activity: 5 columns
- Delivery Pipeline: 12 columns
- Repository Portfolio: 12 columns
- AI Governance and Utilization: 7 columns
- Data Quality: 5 columns

### Tablet

- Primary KPI cards: two-by-two
- Needs Attention: full width
- Recent Activity: full width below Needs Attention
- Repository table: horizontally scrollable with secondary fields in row expansion
- AI Governance and Data Quality: stacked

### Mobile

- Keep portfolio status and first critical action above the fold
- Stack KPI cards vertically or in a compact two-column grid
- Convert the pipeline into a vertical stepper
- Show only essential repository columns
- Move secondary metadata into expandable rows
- Use a navigation drawer rather than a persistent sidebar

---

## 6. Header and Scope Controls

### Header content

- Product name: BuildWorks
- Page name: Governed Delivery
- Primary navigation
- Theme control
- User or tenant menu where applicable

### Scope controls

- Repository
- Environment
- Time range or loaded-window scope
- Persisted status
- Derived phase
- Search
- Refresh

Filters must clearly state whether they affect:

- The entire portfolio summary
- Only the repository or run list
- The currently selected time window

Do not bury filter-scope behavior in a paragraph. Use concise helper text or an information tooltip.

---

## 7. Portfolio Status Banner

The banner is the first meaningful content on the page. It must answer:

- What is the overall state?
- Why is the portfolio in that state?
- What should the user do next?

### Example

```text
Portfolio at risk

1 blocked delivery requires attention. 4 open findings require review.

[View blocked run] [Review findings]
```

### Status taxonomy

- Healthy
- At Risk
- Blocked
- Unknown

Use color, icon, label, and explanatory text together. Never communicate status through color alone.

### Banner rules

- Keep the summary to one sentence
- Provide no more than two primary actions
- Include freshness information in a quiet, secondary position
- Do not place token or cost data in this banner

---

## 8. Primary KPIs

Limit the first KPI row to four cards.

### 8.1 Release readiness

Show whether the current scope can proceed toward release.

```text
Release readiness
Blocked
1 blocked run
```

### 8.2 Governance status

Show the highest-severity governance state.

```text
Governance status
At Risk
1 failed control
```

### 8.3 Open findings

Show findings requiring review or resolution.

```text
Open findings
4
Across 1 run
```

### 8.4 Delivery success

Show the terminal outcome rate with underlying counts.

```text
Delivery success
0%
0 complete · 1 blocked
```

### KPI interaction

- Selecting a KPI filters or opens the associated detailed view
- Definitions appear in a tooltip or popover
- Calculations and exact source fields appear in a details drawer
- Unknown and unavailable data must be explicit and visually distinct from zero

### Metrics moved out of the primary row

- Total runs
- Active runs
- Token categories
- Known cost
- Reporting coverage
- Snapshot counts
- Detailed timing telemetry

---

## 9. Needs Attention

This is the primary operational component.

### Required fields per item

- Severity
- Issue type
- Concise title
- Repository or run
- Explanation
- Last relevant activity
- Primary action
- Optional secondary action

### Example: blocked delivery

```text
BLOCKED DELIVERY

web-calculator is blocked
4 findings require review
Last activity Sep 12, 1:47 PM

[Open run] [Review findings]
```

### Example: missing telemetry

```text
DATA QUALITY

Execution duration was not reported
Timing cannot be calculated from the available run snapshot

[View telemetry details]
```

### Issue classification

Keep these states visually distinct:

- Governance issue: a control, review, or approval failed
- Delivery issue: a run or release is blocked
- Data-quality issue: required telemetry is missing or stale
- System issue: a repository or snapshot could not be loaded

Do not present missing telemetry as if it were a governance failure.

---

## 10. Recent Delivery Activity

Provide a concise event stream showing the latest meaningful delivery transitions.

### Event content

- Event name
- Stage
- Outcome
- Repository or run
- Actor type where available: model, agent, harness, or human
- Timestamp
- Link to supporting evidence or run detail

### Event examples

- Specification approved
- Plan completed
- Tests executed
- Review completed
- Governance gate failed
- Human approval requested
- Delivery blocked
- Release readiness verified

Avoid displaying low-value technical polling, refresh, or projection events in the primary activity stream.

---

## 11. Delivery Pipeline

The pipeline is a high-priority enterprise component because it communicates where delivery stopped.

### Recommended stages

1. Specification
2. Planning
3. Implementation
4. Testing
5. Review
6. Governance
7. Approval
8. Release

### Stage states

- Not started
- In progress
- Complete
- At risk
- Failed
- Waiting
- Blocked
- Skipped, only when governance policy permits it
- Unknown

### Stage content

Each stage should support drill-down to:

- Start and completion time
- Assigned model
- Assigned agent
- Harness or executor
- Effort level
- Review type
- Test-case count
- Findings count
- Approval status
- Evidence and artifacts

### Pipeline interaction

- Selecting a failed stage opens a side drawer
- The drawer explains why it failed
- Show the controlling policy or gate
- Show associated findings and evidence
- Show required next action
- Preserve a link to the full audit record

---

## 12. Repository Portfolio

Use a compact enterprise table rather than a long repository description.

### Default columns

- Repository
- Health
- Current phase
- Runs
- Blocked
- Findings
- Last activity
- Action

### Optional columns or row expansion

- Environment
- Branch
- Release readiness
- Governance compliance
- Test status
- Approval state
- Snapshot freshness

### Details drawer only

Keep these values out of the default overview:

- Canonical filesystem path
- Repository hash
- Snapshot identifier
- Projection source
- Exact machine timestamp
- Raw status values
- Command-line or loopback implementation detail

### Table behavior

- Sticky header
- Right-aligned numerical values
- Explicit status badges
- Sort and filter support
- Row expansion for secondary metadata
- A final action column
- Clear empty, loading, stale, and unavailable states

---

## 13. AI Governance and Utilization

AI metrics are important but secondary to delivery and governance outcomes.

### Summary content

- Models used
- Agents used
- Harnesses or executors used
- Assignment by review type
- Effort level
- Total tokens
- Known cost
- Reporting coverage

### Governance questions this area must answer

- Which model planned the work?
- Which model implemented it?
- Which model generated and executed tests?
- Which model performed each review type?
- Which harness executed the work?
- What effort level was assigned?
- Were model assignments consistent with policy?
- Did a human approve the required gates?

### Token presentation

Use a summary first:

```text
Total tokens     1.21M
Known cost       $1.81
Coverage         16 of 16 agent rows
```

Place the following in a drill-down:

- Input tokens
- Output tokens
- Cache-read tokens
- Cache-write tokens
- Cost by model
- Tokens by model
- Tokens by agent
- Tokens by stage
- Tokens by review type

Do not make cache telemetry compete visually with blockers or governance failures.

---

## 14. Data Quality

Convert snapshot and reporting details into a compact data-quality component.

### Summary content

- Snapshot coverage
- Current snapshots
- Stale snapshots
- Loading snapshots
- Unavailable snapshots
- Missing execution duration
- Cost-reporting coverage
- Historical trend availability

### Example

```text
Data quality

Snapshot coverage     100%
Current                1
Stale                  0
Unavailable            0
Execution duration     Missing
Historical trends      Unavailable
```

### Interaction

Selecting the component opens telemetry detail, including:

- Source snapshot
- Recorded timestamp
- Missing fields
- Freshness threshold
- Reporting agent rows
- Data lineage and provenance

---

## 15. Progressive Disclosure

Keep the overview focused on operational meaning.

### Level 1: Overview

- Outcome
- Risk
- Status
- Required action
- High-level freshness

### Level 2: Tooltip or popover

- Metric definition
- Calculation
- Short caveat

### Level 3: Side drawer

- Raw values
- Exact timestamps
- Source snapshot
- Model, agent, and harness assignments
- Supporting evidence

### Level 4: Diagnostics or audit view

- Canonical paths
- Identifiers and hashes
- Projection status
- Raw status values
- Command details
- Full provenance
- Immutable audit evidence

### Example transformation

Instead of displaying:

```text
Completed divided by completed plus blocked terminal runs.
0 completed and 1 blocked terminal runs.
```

Display:

```text
Delivery success
0%
0 complete · 1 blocked
ⓘ
```

The information control reveals the formula and current inputs.

---

## 16. Content and Language Guidelines

### Use operational language

Prefer:

- Portfolio at risk
- Delivery blocked
- Findings require review
- Execution duration not reported
- Approval waiting
- Release blocked by governance

Avoid as primary UI copy:

- Canonical projection
- Exact loaded summary
- Read-route observation
- Persisted status in progress
- Local loopback projection
- This does not assert that an agent is executing now

Technical language may remain in diagnostics and audit evidence.

### Content rules

- Use short labels
- Use one-line supporting descriptions
- Keep caveats out of the primary visual path
- Use human-readable dates by default
- Preserve exact timestamps in details
- Distinguish zero from unavailable
- Distinguish blocked from failed
- Distinguish stale from missing
- Avoid duplicating the same status in multiple sections without adding context

---

## 17. Visual Design Direction

### Style

The product should resemble a mature enterprise SaaS control plane rather than a generated analytics template.

Use:

- Strong, restrained visual hierarchy
- Neutral surfaces
- Subtle borders
- Compact data density
- Clear interaction states
- Consistent status semantics
- Light and dark themes

Avoid:

- Purple gradients
- Decorative glow
- Large pill-shaped containers everywhere
- Excessive card nesting
- Oversized hero sections
- Generic AI imagery
- Raw JSON on the overview
- Heavy drop shadows
- Excessive whitespace that reduces useful density

### Color

- Neutral slate or gray foundation
- Blue for navigation, links, and selected states
- Green only for verified success
- Amber for risk, waiting, and incomplete states
- Red only for blocked or failed outcomes
- Gray for unknown, unavailable, and neutral metadata

### Typography

- Page title: 24 to 28 pixels
- KPI value: 28 to 36 pixels
- Section heading: 14 to 16 pixels, semibold
- Body: 14 pixels
- Metadata: 12 to 13 pixels
- Use tabular numerals for metrics where supported

### Spacing and surfaces

- Use an 8-pixel spacing system
- Use 6 to 8 pixel corner radii
- Prefer borders to strong shadows
- Use one page background and one primary surface level
- Add another surface level only for drawers, menus, and temporary overlays

---

## 18. Accessibility Requirements

- Meet WCAG 2.2 AA contrast requirements
- Do not rely on color alone
- Pair every status color with text and an icon
- Provide visible keyboard focus indicators
- Ensure all controls are keyboard accessible
- Use semantic headings and landmarks
- Provide accessible names for icon-only controls
- Respect reduced-motion preferences
- Maintain readable table behavior at high zoom
- Make tooltips available through keyboard focus, not hover only
- Announce refreshed status and errors appropriately to assistive technology
- Preserve logical focus when opening and closing drawers

---

## 19. Interaction Requirements

### Global filters

- Persist filter state in the URL when appropriate
- Clearly identify active filters
- Provide a single clear-all action
- Never silently change portfolio scope
- Show when metrics and lists use different scope rules

### Refresh

- Show last successful refresh
- Avoid blocking the entire page when only one component refreshes
- Preserve existing data while new data loads
- Clearly mark stale data
- Surface component-level errors without suppressing the rest of the portfolio

### Drawers

Use right-side drawers for:

- Run summary
- Finding detail
- Failed pipeline stage
- KPI calculation
- Telemetry quality
- Model, agent, and harness detail

Drawers should preserve page context and include a link to the full record.

### Empty and unavailable states

Provide distinct states for:

- No matching data
- Data not reported
- Data still loading
- Data stale
- Source unavailable
- Feature not applicable

Never display `0` when the value is unknown or unavailable.

---

## 20. Recommended Component Inventory

- ApplicationShell
- PrimaryNavigation
- DashboardHeader
- ScopeFilterBar
- PortfolioStatusBanner
- KpiCard
- NeedsAttentionPanel
- AttentionItem
- RecentActivityTimeline
- DeliveryPipeline
- PipelineStage
- RepositoryPortfolioTable
- StatusBadge
- AiGovernanceSummary
- TokenUsageBreakdown
- DataQualityPanel
- DetailDrawer
- MetricDefinitionPopover
- EmptyState
- ErrorState
- StaleDataIndicator
- AuditEvidenceLink

Components should share one status vocabulary and should not implement independent color or label mappings.

---

## 21. Data and State Model Considerations

The UI should preserve a clear separation between:

- Persisted run state
- Derived lifecycle phase
- Governance decision
- Release readiness
- Agent execution activity
- Snapshot freshness
- Data availability

Do not collapse these into one generic status field.

### Suggested status fields

```text
runStatus
lifecyclePhase
governanceStatus
releaseReadiness
executionState
snapshotFreshness
dataQualityStatus
```

### AI assignment fields

```text
model
agent
harness
executor
effortLevel
reviewType
stage
assignmentPolicy
```

### Test telemetry fields

```text
testCaseCount
testCasesCreated
testCasesExecuted
testsPassed
testsFailed
testExecutionDuration
testTokenUsage
```

Field names are implementation suggestions. Align them with the authoritative BuildWorks domain model rather than introducing duplicate concepts.

---

## 22. Overview Content to Remove or Relocate

Remove these from the default overview and relocate them to details, audit, or diagnostics:

- Canonical repository path
- Local temporary filesystem path
- Repository hash
- Exact projection route
- Read-only loopback explanation
- Full metric formulas
- Raw snapshot counts in sentence form
- Exact recorded timestamps beside every human-readable date
- Repeated statements about what the page does not execute
- Full input, output, cache-read, and cache-write breakdown
- Raw status or JSON output

A concise global read-only indicator may remain in the header if it materially affects user expectations.

---

## 23. Design Acceptance Criteria

The redesigned overview is successful when:

1. A user can identify overall portfolio health without scrolling.
2. A blocked delivery is visible above the fold.
3. The primary action for a blocker is obvious.
4. Governance status has greater visual priority than token usage.
5. Users can identify the failed pipeline stage without opening run detail.
6. Repository health can be compared in a compact table.
7. Missing telemetry is clearly distinguished from a failed control.
8. Metric definitions remain available without occupying permanent page space.
9. Canonical paths and projection internals are hidden by default.
10. Every status is communicated with text and not color alone.
11. Keyboard users can reach all filters, actions, rows, tooltips, and drawers.
12. The layout works in both light and dark themes.
13. The default Overview page avoids raw JSON and implementation-centric terminology.
14. Audit evidence remains reachable from relevant governance decisions and findings.
15. The page remains useful when one repository or data source fails.

---

## 24. Implementation Priority

### Priority 1: Information architecture

- Build the application shell and navigation
- Add the portfolio status banner
- Reduce the KPI row to four primary outcomes
- Add Needs Attention
- Add the delivery pipeline

### Priority 2: Operational workflow

- Add run and finding drawers
- Add primary actions for blockers
- Add recent delivery activity
- Redesign the repository portfolio table

### Priority 3: Governance visibility

- Add model, agent, harness, executor, effort-level, and review-type assignments
- Add human approval and governance-gate visibility
- Link decisions to evidence and audit records

### Priority 4: Secondary analytics

- Add AI utilization
- Add cost and token drill-downs
- Add data-quality and snapshot detail
- Add trend visualizations only when authoritative historical data exists

### Priority 5: Enterprise polish

- Complete responsive behavior
- Validate accessibility
- Complete light and dark themes
- Add loading, empty, stale, unavailable, and partial-failure states
- Perform content and terminology review

---

## 25. Final Design Principle

The Overview page must prioritize:

```text
Status
What is blocked
What needs action
Where delivery stopped
Which repository is affected
Whether governance and release requirements are satisfied
```

Everything else should be available through drill-down.

The next version should feel like a governed enterprise delivery control plane, not a verbose projection of backend state. Auditability must remain intact, but it should support the operational experience rather than overwhelm it.

---

## 26. Compact, Single-View Dashboard Layout

The Overview page should adopt the dense, horizontally organized layout demonstrated by the approved visual reference. The reference is directional for composition and scanability only. BuildWorks must use its own governance-focused titles, metrics, terminology, and visual identity.

### 26.1 Layout objective

On a standard desktop viewport, users should see the following without extensive scrolling:

1. Product header, scope, date range, and primary controls
2. Primary navigation
3. One horizontal row of outcome-focused KPI cards
4. Two high-value panels displayed side by side
5. A second pair of governance and assignment panels where space permits
6. A compact repository or governed-deliveries table

The design should favor a dashboard canvas over a sequence of full-width report sections.

### 26.2 Revised desktop composition

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUILDWORKS        SCOPE / DATE RANGE                     Refresh  Settings   │
│ Updated recently                                                             │
│                                                                              │
│ Overview  Runs  Findings  Governance  Models & Agents  Audit                 │
└──────────────────────────────────────────────────────────────────────────────┘

┌────────────┬────────────┬────────────┬────────────┬────────────┬──────────────┐
│ PORTFOLIO  │ RELEASE    │ BLOCKED    │ OPEN       │ GOVERNANCE │ DELIVERY     │
│ HEALTH     │ READY      │ DELIVERIES │ FINDINGS   │ COVERAGE   │ SUCCESS      │
│ At Risk    │ 0          │ 1          │ 4          │ At Risk    │ 0%           │
│ Action req.│ No runs    │ Review now │ Across 1   │ 1 failure  │ 0 completed  │
└────────────┴────────────┴────────────┴────────────┴────────────┴──────────────┘

┌──────────────────────────────────────────┬───────────────────────────────────┐
│ NEEDS ATTENTION                          │ DELIVERY PIPELINE                 │
│                                          │                                   │
│ Blocked delivery                         │ Specification  Complete           │
│ web-calculator                           │ Planning       Complete           │
│ 4 findings require review                │ Implementation Complete           │
│                                          │ Testing        Complete           │
│ [Open run] [Review findings]              │ Review         Failed             │
│                                          │ Governance     Failed             │
│ Missing execution duration               │ Approval       Waiting            │
│ [View telemetry]                         │ Release        Blocked            │
└──────────────────────────────────────────┴───────────────────────────────────┘

┌──────────────────────────────────────────┬───────────────────────────────────┐
│ GOVERNANCE HEALTH                        │ MODEL & AGENT ASSIGNMENTS         │
│                                          │                                   │
│ Controls passed / failed                 │ Planning model                    │
│ Findings by severity                     │ Implementation agent              │
│ Approval coverage                        │ Review models by review type      │
│ Audit evidence coverage                  │ Test model and harness            │
│                                          │ Effort levels                     │
│ [Open governance]                        │ [View assignments]                │
└──────────────────────────────────────────┴───────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ GOVERNED DELIVERIES                                         Filter  Sort     │
├──────────────────┬──────────┬────────────┬──────────┬──────────┬──────────────┤
│ Repository / Run │ Status   │ Stage      │ Findings │ Activity │ Action       │
├──────────────────┼──────────┼────────────┼──────────┼──────────┼──────────────┤
│ web-calculator   │ Blocked  │ Governance │ 4        │ Sep 12   │ Open         │
└──────────────────┴──────────┴────────────┴──────────┴──────────┴──────────────┘
```

### 26.3 Above-the-fold requirements

At common desktop dimensions, the first viewport should contain:

- Header and primary scope controls
- Navigation
- Complete KPI strip
- Needs Attention
- Delivery Pipeline
- At least the heading or first rows of Governed Deliveries

Governance Health and Model & Agent Assignments may move below the first viewport on shorter displays, but the page must avoid overly tall cards, verbose descriptions, and large decorative whitespace.

### 26.4 Horizontal KPI strip

Use five or six compact KPI cards in one row at wide desktop sizes. The cards should communicate business and governance outcomes rather than backend telemetry.

Recommended cards:

- Portfolio Health
- Release Ready
- Blocked Deliveries
- Open Findings
- Governance Coverage or Governance Status
- Delivery Success

Card rules:

- Use a short uppercase or semibold label
- Use one dominant value
- Use one concise comparison, qualifier, or action statement
- Keep each card approximately equal in height
- Allow the full card to open the relevant filtered view
- Do not show metric formulas permanently
- Do not place token categories in the primary KPI strip
- Do not use trend arrows unless the system has authoritative historical comparison data

### 26.5 Two-column analytical rows

Use paired panels to reduce page length and support rapid comparison.

#### Primary pair

- Needs Attention
- Delivery Pipeline

This pair should receive the most vertical space because it explains what is wrong and where delivery stopped.

#### Secondary pair

- Governance Health
- Model & Agent Assignments

This pair should make governance outcomes and AI responsibility visible without requiring users to open individual runs.

#### Optional lower pair

- AI Utilization
- Data Quality

This pair is secondary and may appear below the governed-deliveries table or behind a customizable Overview preference.

### 26.6 Chart usage

Do not copy charts from the visual reference unless a chart answers a BuildWorks operational question.

Appropriate visualizations include:

- Findings by severity
- Governance pass/fail coverage
- Delivery outcomes over an authoritative historical period
- Execution time by stage
- Model cost or token usage by stage, model, review type, or harness
- Test pass/fail distribution

Prefer status matrices, segmented bars, pipeline stages, and exception lists over decorative doughnut charts.

Do not render trend charts when historical series are unavailable. Show a concise unavailable state instead.

### 26.7 Table placement

Use the large lower-page table pattern from the reference, adapted as Governed Deliveries or Repository Portfolio.

The table should provide the detailed operational layer after the user sees status, exceptions, and pipeline health.

Recommended default columns:

- Repository or run
- Health or status
- Current stage
- Findings
- Governance decision
- Last activity
- Primary action

The table should use compact rows, sticky headers, sorting, filtering, row expansion, and a clear final action column.

### 26.8 Density guidelines

- Use more horizontal space and fewer full-width stacked sections
- Keep cards compact and aligned to a consistent grid
- Avoid paragraphs inside cards
- Limit card supporting text to one or two lines
- Avoid excessive internal padding
- Keep the most important values above the fold
- Use drawers and detail pages for evidence, calculations, paths, and raw telemetry
- Maintain sufficient whitespace for readability without creating large dead zones

### 26.9 Visual-reference elements to adopt

Adopt these layout characteristics:

- A consolidated header surface
- Scope and range controls near the page title
- A clearly selected primary navigation tab
- A single horizontal KPI strip
- Balanced two-column content rows
- Large, clearly titled analytical panels
- A detailed full-width table at the bottom
- Consistent card dimensions, borders, spacing, and alignment
- Dense but readable use of the desktop canvas

### 26.10 Visual-reference elements not to copy

Do not copy:

- Product name, labels, titles, or section names
- Token-analytics-first hierarchy
- Decorative charts without governance value
- Warm color palette as a requirement
- Monospace typography for all headings
- Usage streaks or profile activity unless BuildWorks develops a validated operational need
- Arbitrary period comparisons without authoritative historical data

### 26.11 Updated implementation principle

The Overview page should present all decision-critical information in one coherent desktop canvas. Scrolling should reveal deeper governance, utilization, and repository detail, not information that should have been visible at first glance.

The target experience is:

```text
See health
Identify exceptions
Understand the failed stage
Take action
Drill into evidence
```

This compact dashboard composition supersedes any earlier recommendation that would create a long sequence of full-width sections on the Overview page.
