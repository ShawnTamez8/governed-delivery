# UI Design Mockup Feedback

The opening section covers shared visual design suggestions. The remaining feedback is organized by the pages reviewed.

The examples illustrate presentation and hierarchy. Counts, costs, statuses, model names, and timestamps should reflect the actual data and scope of the view rather than being hard-coded from this feedback.

## Shared Design Recommendations

### Border Radius System

A consistent radius system would help the interface feel more cohesive.

```css
:root {
  --radius-none: 0px;
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
}
```

Suggested application:

| Category | Components | Radius |
| --- | --- | --- |
| Data-dense controls | Checkboxes, badges, tags | 4px |
| Common controls | Buttons, inputs, selects, date pickers, search fields | 6px |
| Navigation | Tabs | 6px |
| Navigation | Dropdowns, menus, tooltips | 8px |
| Content containers | Cards, panels, sidebars, table wrappers | 12px |
| Overlays | Modals, drawers, command palette | 16px |
| Special cases | Avatars, status dots | 9999px |

### Motion and Feedback

I do want animation, but I would like it to function as a trust signal backed by actual telemetry rather than as decoration.

The convention I would aim for is:

- Ongoing execution animation means relevant run or stage activity is still being observed through fresh telemetry.
- A brief, one-time update highlight can acknowledge newly received data without implying that execution is continuing.
- Settled, blocked, waiting, stale, and disconnected execution states remain static. A recorded "Running" label alone is not enough to imply live activity.

A general connection heartbeat can indicate connection health, but it should not be treated as proof that a particular run or stage is making progress.

Short hover and expansion transitions could remain as local feedback to a user action. I would keep them visually distinct from repeating activity indicators: opening a panel or hovering over a button is not evidence that a run is executing. The telemetry-backed convention applies to motion that communicates operational activity.

Skeleton placeholders could help during a real refresh. Any loading animation would represent that specific data request, not the execution state of a run, and would stop when the request completes, fails, or times out.

Brief update feedback could be tied to confirmed changes in telemetry rather than animated number counting. Attention items and blocked or completed run states would remain free of ongoing activity animation.

This convention would make motion purposeful and consistent across the Overview, Runs, and Audit views, as well as any other page that shows live activity.

# Header and Navigation Feedback

## Search Feels Hidden

Remove the text "Scope" because the selected value itself acts as the label.

The search box almost disappears among the controls.

For observability-style products, search is a primary navigation mechanism. I'd make it wider and use the placeholder to teach users what is searchable.

For example:

```text
Search runs, agents, findings...
```

Instead of:

```text
Search runs
```

---

## Observed Time Is Confusing

My first reaction to:

```text
Observed 03:15:57
```

Was:

> Is that uptime? Run duration? Snapshot age? Last refresh?

The meaning isn't obvious. I'd use a label that describes what the timestamp actually represents.

Possible alternatives:

```text
Last Updated
03:15:57
```

```text
Snapshot Time
03:15:57
```

```text
Data Timestamp
03:15:57
```

---

## Refresh and Help Controls Feel Unfinished

Seeing:

```text
Refresh   ?
```

Feels more like a developer tool than a polished production interface.

I'd consider clearly labeled controls:

```text
↻ Refresh   ⓘ Help
```

Or an intentional icon-only treatment.

The solitary `?` feels like placeholder UI rather than a deliberate action.

---

## Add More Separation Between Global and Page Navigation

Right now, the global controls and page navigation visually blend together:

```text
Global Controls
Overview Runs Findings Governance...
```

I'd strengthen the separation between the product header, page navigation, and page content.

For example:

```text
--------------------------------------------------
BuildWorks Header / Search / Scope
--------------------------------------------------
Overview | Runs | Findings | Governance ...
--------------------------------------------------
Page Content
```

GitHub, Azure DevOps, and Datadog are useful references for this kind of hierarchy.

---

## Give the Header One Primary Status Element

Right now, the header is mostly controls. I don't immediately know whether the system is healthy, has detected problems, has an active run, or is idle.

A small status pill could help. Depending on the actual state, it might display:

```text
● Monitoring
```

```text
● 2 Findings
```

```text
● Snapshot Loaded
```

Nothing flashy—just a clear status signal that gives the header a purpose beyond navigation.

---

## BuildWorks Is a Missed Branding Opportunity

The rest of the mockup is operational and enterprise-focused. The top-left area could establish more product identity.

For example, show the product name with its capability beneath it:

```text
BuildWorks
Governed Delivery
```

Or:

```text
BuildWorks
AI Delivery Observability
```

That would immediately help a first-time user understand what the product does.

## Overview Page / Tab

### Give the Page a Command-Center Hierarchy

The current structure places metrics, attention items, run rows, coverage indicators, and system notes into a relatively flat sequence.

Consider four clearly separated layers:

1. Operational status.
2. Attention required.
3. Recent activity.
4. Coverage and telemetry health.

This creates a natural reading sequence:

What is happening? -> What requires action? -> What changed recently? -> Can I trust the data?

### Replace KPI Text Blocks with Interactive Status Cards

The current cards mix totals, percentages, explanatory text, and coverage information. For example, Findings presents "29," "2 blocking," "2 open," and "19 addressed," while Known Cost includes "42/42 rows reported."

A consistent card anatomy could include a small category label, primary value, status indicator, secondary breakdown, optional compact visualization, and clear click-through affordance.

#### Run Health

```text
2 Blocked
1 completed / 3 total
```

A small segmented bar could show blocked runs in red, completed runs in green, running runs in blue, and pending runs in gray. Labels would keep the meaning clear without relying on color alone.

Clicking this blocked-focused card could open the Runs tab filtered to blocked runs.

#### Active Findings

```text
4 Require attention
2 blocking / 2 open

19 addressed / 6 in other lifecycle states
29 total findings
```

The actionable count feels more useful as the primary value than the lifetime total. Where the remaining six findings have defined states, I would use those actual labels rather than "other."

#### Known Cost

```text
$7.20
Cost reported for 42 of 42 tracked rows
[Reporting complete]
```

A subtle coverage badge would keep the metric readable without losing transparency. I would distinguish complete reporting for the tracked rows from a claim that every possible cost is known.

#### Tokens

```text
3.26M
3,260,482 exact
```

The exact value is useful provenance, but it could be secondary text, a badge, or a tooltip rather than competing with the primary total.

#### Visual Treatment

I would favor white or subtly tinted cards on a neutral canvas, thin borders rather than heavy shadows, and small status-colored accents, icons, or badges rather than fully saturated cards.

Consistent numeric alignment and a restrained hover treatment would help readability and clickability. Tooltips could explain terms such as "terminal," "known cost," and "exact."

### Strengthen the Needs Attention Section

This is the most important section on the page. It currently combines two blocked runs, two blocking findings, and two open findings, each with an "Open run" or "Inspect" action.

The content is useful, but stronger grouping and richer decision support would help.

Example blocked-run row:

```text
[BLOCKED RUN] [Code review]                         14m ago

target-tap #1
Stopped at code review

target-tap-live-2\target / Stage 8
2 blocking findings / $3.59 known cost

[Open run] [View findings]
```

Example finding row:

```text
[BLOCKING] [HIGH]
Finding #11

Missing component test suite
target-tap #1 / Code review, round 2
package.json:10

[Inspect finding] [Open file]
```

Suggested improvements:

- Separate blocked runs and findings into labeled groups, with clear type badges.
- Keep severity and workflow state visually distinct: for example, HIGH is severity, while BLOCKING or OPEN is state.
- Promote the title and reduce the visual weight of repository paths.
- Make the row's primary area clickable while keeping secondary actions distinct.
- Add "View all 6" in the section header and filter chips for All, Blocked runs, Blocking findings, and Open findings.
- Show age or last-update time so older blockers are distinguishable from new ones.
- Offer secondary actions where supported, such as "Open file," "View findings," or "View stage."

The priority order could be explained in a tooltip:

"Ordered by operational impact, severity, and recency."

For the section summary, I would replace:

"6 blocked runs, then blocking and open findings"

with:

"6 items require attention"

A subdued subtitle could add:

"Blocked runs are prioritized, followed by blocking and open findings."

This makes it clear that the six items include both runs and findings, rather than implying there are six blocked runs.

### Make Recent Runs More Operational

The Runs section is labeled "newest activity first" and includes three rows. It would benefit from the same interaction language as the full Runs tab while remaining lighter and easier to scan.

Suggested changes:

- Rename the section "Recent runs" and add a clear "View all runs" action.
- Make the row's primary area clickable and use a strong state badge, such as BLOCKED, COMPLETED, or RUNNING.
- Show pipeline stage separately from state: for example, [BLOCKED] alongside "Code review."
- Right-align numeric fields such as finding counts and cost.
- Add compact filters for All, Blocked, Active, and Completed, plus sorting by Last activity, Findings, or Cost.
- Allow lightweight repository and project filtering without leaving the page.
- Show relative time first, with the exact timestamp and timezone available on hover.
- Distinguish project name from recorded scope so repeated labels such as "target-tap #1" are easier to interpret.

For example, the time could read "8 days ago," with an exact-time tooltip such as "Sep 16, 19:00" and the applicable timezone.

An inline disclosure could expose stage progression, blocking reason, finding breakdown, token usage, and cost coverage. A short expansion transition could provide interaction feedback; ongoing activity animation inside the row would follow the telemetry-backed convention.

The Overview version is for rapid scanning and direct navigation, not complete run analysis.

### Enterprise Polish and Possible Later Enhancements

The first areas I would prioritize are a simpler header, a less prominent placement for "Limit 20," compact filters, full-row primary interaction, clear separation of state/severity/stage, and readable timestamps.

Possible later enhancements include inline run expansion, saved filters or views, repository comparison, keyboard navigation, command palette support, and configurable card visibility for different operational roles.

### Use Telemetry-Backed Activity Signals

Good candidates for subtle motion include:

- The active stage of a run, when fresh stage-level telemetry supports it.
- An indeterminate progress indicator for work that is actively observed but has no reliable completion percentage.
- The Refresh control while a real data request is in progress.
- A small live-status indicator beside "Observed," when relevant telemetry is fresh.
- Activity indicators inside expanded rows for work that is actually executing.

I would keep the attention section and blocked-run cards free of ongoing activity animation. A blocked run retaining a moving progress bar would incorrectly suggest continued execution.

#### Heartbeat and Freshness

An activity indicator would be more trustworthy when paired with a last event and timestamp.

Example with fresh execution telemetry:

```text
[LIVE] Code review in progress
Last event: Reviewer started analyzing src/view.js
Updated 8 seconds ago
```

Example when relevant activity is no longer arriving as expected:

```text
[POSSIBLY STALLED]
No activity received recently
Last activity: 10:42:16 AM
```

The second treatment would be static. "Possibly stalled" communicates uncertainty rather than declaring failure from silence alone.

The freshness threshold would ideally reflect the expected event behavior for that activity, not an arbitrary UI timer. A general backend heartbeat would not, by itself, justify animating a specific stage.

#### Motion Style

I would keep supported activity animation subtle and mechanical: small linear movement or a slow pulse rather than bouncing or flashing.

Glowing neon effects, large rotating loaders, animated gradients across entire cards, and ongoing activity animation on completed or blocked content would work against the trust-signal convention. Status updates could preserve the existing layout rather than moving content around.

### Add a Compact Operational Posture Visualization

The page explicitly says there is no historical trend, so a current-state visualization would be more appropriate than a trend chart without supporting history.

A compact pipeline stage map could show where current runs are active or stopped. It could include stages such as Plan, Build, Test, Plan review, Code review, and Complete, using the product's actual stage names and recorded order rather than treating this list as the definitive pipeline sequence.

Static markers could show where blocked runs have accumulated. Only a genuinely active stage with fresh supporting telemetry would have an animated activity marker.

This would expose workflow friction without pretending that a time series exists.

## Runs Page / Tab

### Separate Page-Level Summary Cards from Selected-Run KPIs

The page exposes useful metrics, but some are embedded in text rather than presented as decision-oriented indicators.

At the page level, summary cards could show aggregate values for the current filter scope:

```text
3 Runs
2 Blocked
4 Findings requiring attention
$7.20 Known cost
Audit: Not verified in this view
```

Within Selected Run, the cards would instead show metrics for that run:

```text
Blocked at Code review
2 Blocking findings
$3.59 Known cost
1.41M Input tokens
16 of 16 agent rows reported
```

Keeping these scopes separate would prevent aggregate counts from being mistaken for selected-run metrics.

For color, I would favor neutral gray for informational metrics, blue for active or informational states, amber for warnings, red for genuinely blocking conditions, and green for verified or completed states.

Alignment, spacing, typography, and consistency would contribute more than gradients, glowing cards, oversized numbers, or decorative AI-style effects.

### Make the Blocked State Actionable

The user should be able to understand where the run stopped, why it stopped, what needs to happen next, and whether there is an available action.

Example:

```text
Run blocked at Code review
2 high-severity blocking findings need to be resolved before the run can continue.

[View blocking findings]
[Copy verification command]
[Open repository, where supported]
```

Showing the two blocking findings directly beneath this summary would connect the state to its cause. The detailed policy event, review round, commit SHA, and threshold could move into an expandable "Technical details" section.

### Simplify the Findings Presentation

The findings are grouped by status, but individual entries still resemble dense log lines. A structured table would be easier to scan.

| Severity | Finding | Location | Stage | Status |
| --- | --- | --- | --- | --- |
| High | Missing component test suite | package.json:10 | Code review | Blocking |
| High | Target hit dedup token race | src/view.js:63 | Code review | Blocking |
| Low | Path traversal prefix check bypass tests | gameplay.spec.js:22 | Code review | Open |

Useful controls could include search, severity/status/stage filters, a "Blocking only" toggle, and row expansion for evidence, remediation, and review history.

Addressed findings and earlier-round history could be collapsed by default. Findings that are still active should remain visible even if they originated in an earlier round.

### Keep the Ledger-Step Activity Treatment

The ledger-step bar appears to animate when the run is on a particular step, and that is a nice touch when it reflects real execution telemetry.

I would keep this treatment for actively observed work. When the run becomes blocked, completes, waits, or loses fresh activity telemetry, the motion would stop and the state would remain clearly labeled.

### Treat Terminal Commands as Secondary Actions

The dashboard currently displays full PowerShell commands for status, doctor, and verify-audit.

For a more polished presentation, the action name and description could come first, with the command in an expandable area and a clear "Copy command" button. An immediate "Copied" confirmation would be sufficient without additional animation.

Example:

```text
Verify audit chain
Confirms the integrity of the recorded audit evidence.

[Eligible] [Copy command] [View command]

Copy-only action. Run the command outside this read-only dashboard.
```

This would be easier to understand than leading with raw CLI text while preserving the distinction between copying a command and executing it.

### Improve Labels and Terminology

Some labels feel compressed or implementation-oriented. Possible alternatives:

| Current wording | Suggested wording |
| --- | --- |
| 3 copy-only PowerShell | 3 available commands, with "Copy-only PowerShell" as supporting text |
| 31 references only | 31 evidence references |
| 42/42 cost rows reported | Cost reporting complete: 42 of 42 tracked rows |
| Frozen configuration and approval | Configuration and approvals, with a separate frozen/read-only indicator where relevant |
| Audit chain: not verified by this view | Audit status: Not verified in this view |

I would avoid changing "not verified by this view" to "verification required" unless an actual policy establishes that requirement. Not verified, failed verification, and required verification are different states.

Raw telemetry could remain available through tooltips or expandable technical details.

### Improve the Run Table

The table already contains useful information: project, recorded stages, state, findings, known cost, and last activity.

Suggested refinements include full-row selection, a clear selected-row treatment, a sticky header, right-aligned numeric fields, sortable column headers, shortened paths with full paths available on hover or in the detail panel, and a Columns menu for less important fields.

Quick filters could include Blocked, Completed, Has blocking findings, and Audit not verified in this view. "Verification required" could be a separate filter where the underlying policy supports it.

State and stage can remain visually distinct while still reading naturally together:

```text
[BLOCKED] Code review
```

A combined text description could read "Blocked at code review." This preserves context without treating stage as part of the state taxonomy.

## Governance Page / Tab

### Make Governance State Easier to Understand

The page currently presents raw data but does not offer a clear governance summary.

A top-level "Governance health" or "Governance status" card could help answer, "Is this governed?"

Possible inputs include telemetry completeness, reviewer coverage, approval coverage, required agent participation, and audit-trail completeness.

A percentage score could work if there is a transparent, evidence-backed scoring model. Without that model, a categorical summary with visible supporting checks would be more credible than an arbitrary percentage. Missing evidence could remain explicitly unknown rather than being treated as a pass.

### Add a Policy Checks Section

A compact policy checklist would be more actionable than making cost the main story.

Potential checks include required reviewers staffed, security review completed, traceability review completed, human approval received, and audit evidence preserved.

Each check could show its supported result, such as Passed, Needs attention, Not evaluated, or Not applicable, with access to the underlying evidence. These are suggested categories, not assertions that the current data already establishes each result.

### Show Staffing Coverage

A "Required specialists" section could align the page with the governed delivery workflow.

Example roles:

```text
Plan Author
Implementer
Correctness Reviewer
Security Reviewer
Traceability Reviewer

Coverage: 5 of 5 required roles, when supported by the staffing data
```

I would distinguish a staffed role from a completed review. Having a reviewer assigned is not the same presentation state as having that review finished.

### Reduce the Prominence of Cost

The current visual emphasis is on Cost by stage, Known cost, and Agent cost.

For this page, I would place governance status, policy checks, traceability, approvals, and risk ahead of cost. Cost would still be available, but lower in the hierarchy.

### Add an Auditability Timeline

A timeline could make the governance story easier to follow.

Illustrative sequence:

```text
Specification created
  -> Specification reviewed
  -> Plan authored
  -> Plan reviewed
  -> Implementation
  -> Code review
  -> Verification
  -> Approval
```

Each step could show timestamp, agent, model, user, and status where those fields are available.

The stage names and order would follow the actual workflow and remain consistent with the Overview stage map. Recorded history would be static; a current activity marker could animate only where fresh telemetry supports it.

## Models & Agents Page / Tab

### Visualize Cost Distribution

The stage table could be supported by a simple horizontal bar chart. Muted bars would make relative cost easier to compare without requiring users to read every row.

Stages such as Code review, Implementation, Specification authoring, and Plan authoring could be compared using their reported values. The chart would show current data without decorative animated entrances or unsupported trends.

### Make Model Attribution More Explicit

The Agents header currently says there are seven agents, with a note that the model per agent row was not reported.

The natural question is, "Which model did each agent use?"

A dedicated model field would make this easier to answer:

| Agent | Model |
| --- | --- |
| Implementer | Reported model, where available |
| Security Reviewer | Reported model, where available |
| Plan Author | Reported model, where available |

When attribution is unavailable, a visible treatment would be clearer than a small note:

```text
Model attribution
Unavailable
Per-agent model telemetry not supplied
```

I would avoid inferring a model-to-agent relationship from an overall model list when that mapping has not been reported.

### Add Token Data

Where token telemetry is available, it would be useful to include input tokens, output tokens, and known cost for each stage.

```text
Stage | Input tokens | Output tokens | Known cost
```

A compact alternative could show a stage name, its reported token total, and its known cost, with input/output detail available on expansion.

Token data would provide additional context when investigating prompt size, agent usage, repeated reviews, and loop behavior. Missing token values could remain "Not reported" rather than appearing as zero.

### Add Agent Usage and Efficiency Comparisons

The current table shows Agent, Executions, and Known cost. Additional context could include tokens and cost per execution.

| Agent | Executions | Known cost | Cost / execution |
| --- | --- | --- | --- |
| Implementer | 2 | $1.27 | $0.64 |
| Plan Author | 3 | $0.36 | $0.12 |

These are presentation examples, with the derived costs rounded for display. Token totals could be another column where available.

If distinct-run counts are available, Runs and Cost / run could be useful additional metrics. I would not relabel executions as runs, since the same run may contain multiple agent executions.

These comparisons could help identify areas to investigate, especially alongside workload, role, stage, and token usage. Higher cost alone would not be labeled as proof of inefficiency.

### Give Telemetry Coverage a Dedicated Card

Notes such as "agent duration not recorded" and "no historical trend" deserve a clearer presentation.

A Telemetry Coverage card could summarize:

```text
Cost data: Reported / Partial / Not reported
Agent data: Reported / Partial / Not reported
Duration: Not recorded, where applicable
History: Not collected, where applicable
Snapshots: Available, where reported
```

Unavailable history need not look like a failure when the product does not collect it. A warning would make more sense where expected telemetry is missing.

### Consider an Anomalies Section

This page could be a useful home for observability-oriented insights, where the telemetry and detection logic support them.

Illustrative insights might include:

```text
Implementer consumed 53% of total tokens.
Code review cost exceeded implementation cost by 28%.
Security reviewer executed twice against the same artifact.
```

These patterns are not automatically problems. Context, an explicit rule, or a relevant baseline would help distinguish an expected pattern from an anomaly.

"No anomalies detected" would be appropriate only when the relevant checks have actually run, with the monitored scope and coverage clear. Otherwise, "Not evaluated" or "Detection unavailable" would be more trustworthy.

### Elevate the Hero Metrics

The top of the page could provide a clearer summary through compact KPI cards, followed by the detailed tables.

Example layout:

```text
7 Agents
16 Executions
[Known cost for the current scope]
3 Snapshots
```

The cost card would use the actual total for the selected scope, with that scope visible. A consistent scope label would make it easier to compare this value with the Overview and Selected Run cost cards.

### Enterprise UX Direction

I would favor muted cost bars, telemetry status indicators, dense but readable tables, and operational summaries.

Giant donut charts, colorful gradient cards, decorative animated counters, and busy token visualizations would work against that direction. This is not a blanket objection to animation: small, telemetry-backed activity signals would still fit.

The visual reference is closer to Datadog, Azure Monitor, and GitHub Actions than to a decorative AI analytics dashboard.

### Consider an Agent Behavior Section

An additional Agent Behavior section could provide a useful observability perspective.

Illustrative layout only:

| Signal | Example display |
| --- | --- |
| Normal behavior | 7 of 7 agents assessed as normal |
| Repeated reads | 0 |
| Correction loops | 1 |
| High token consumption | 0 |
| Suspicious activity | 0 |

The definitions and evaluation coverage would matter here. "Normal," zero counts, and reassuring status indicators would make sense only when supported by actual observations and completed checks. Otherwise, "Not evaluated" or "Telemetry unavailable" would be clearer.

Operational motion in this section would follow the same shared convention: observed ongoing activity may animate; settled results and unsupported assumptions would not.

---

## Reconciliation

**Reviewed document:** `docs/features/dashboard-pwa-redesign/plan.md`. The review covers revision 1 of the Task 1 mockup, under `docs/features/dashboard-pwa-redesign/mockup/`.
**Date:** 2026-09-24
**Disposition:** 35 accepted, 5 rejected, 4 deferred, 0 open
**Status:** reconciled

**Hazards considered:**
- **2.** Every new card, pill, and coverage cell keeps its qualifier. Missing evidence stays "Not evaluated" or "Not collected", never a pass.
- **4.** The review's example values were checked against the recorded snapshots before use. That check exposed the token-label and finding-status corrections below.
- **10.** Model attribution shows the recorded effective model verbatim, and `Unavailable` where a row reported none.
- **14.** Staffing is not inferred from agent names.
- **18.** The Verification check says the frozen commands are version checks only.
- **Weighed and not bearing: 1, 3, 5–9, 11–13, 15–17.** This review concerns presentation and one additive read projection, not provider output, prompts, stages, configuration merging, or launch.

**Inventory.** The review has 38 subsections. Five recommendations inside accepted subsections were not taken; they are recorded separately below as rejected. One deferred entry collects the enhancements the review itself marked as later.

**Operator decisions taken during reconciliation:**
- Page tabs go under the header.
- Bounded, read-only polling is authorized.
- The `byAgent` projection is extended.

### Verdicts

- **Accepted — Border Radius System:** the plan's radius scale is now 4/6/8/12/16px plus a pill radius, applied according to the review's component table.
- **Accepted — Motion and Feedback:** the plan adopts the telemetry-backed convention. Revision 1's first-paint ledger fill is removed; only LIVE, an in-flight request, or a one-time change highlight may move.
- **Accepted — Search Feels Hidden:** the "Scope" label is gone. Search is a wide combobox with the placeholder "Search runs, findings, agents…" that covers loaded runs, findings, and agents.
- **Accepted — Observed Time Is Confusing:** the header reads "Last updated", with the exact time on hover.
- **Accepted — Refresh and Help Controls Feel Unfinished:** Refresh and Help are labelled buttons with icons, and the auto-refresh toggle is joined to Refresh.
- **Accepted — Add More Separation Between Global and Page Navigation:** the page tabs move from the side rail to their own band under the header (operator decision). Below 720px they become a bottom bar.
- **Accepted — Give the Header One Primary Status Element:** one data status pill states Data current, N snapshots stale, Auto-refresh paused, or Session expired. The findings count lives on the Findings tab rather than in the pill.
- **Accepted — BuildWorks Is a Missed Branding Opportunity:** the brand reads "BuildWorks" over "Governed Delivery".
- **Accepted — Give the Page a Command-Center Hierarchy:** the Overview has four labelled layers: operational status, needs attention, recent runs, and "Can I trust this data?".
- **Accepted — Replace KPI Text Blocks with Interactive Status Cards:** four cards share one anatomy and click through with their filter. The six findings that do not require attention are named by their recorded states (19 addressed, 2 non-blocking, 4 earlier round, 0 rejected) rather than "other".
- **Accepted — Strengthen the Needs Attention Section:** the section reads "6 items require attention" with the review's subtitle. It adds an order tooltip, filter chips, two labelled groups, distinct state and severity badges, a clickable primary area, and age for blocked runs. "View all" appears only when the queue is truncated.
- **Accepted — Make Recent Runs More Operational:** the section is renamed "Recent runs" and gains:
  - "View all runs", state chips, sortable headers, and full-row selection;
  - a state badge beside the stage name, and right-aligned numbers;
  - relative time, with the exact time and zone on hover.

  Repository filtering is handled by the header select and search.
- **Accepted — Enterprise Polish (first priorities):** a simpler header, the run limit moved to the Runs toolbar, compact filters, full-row interaction, separated state, severity, and stage, and readable timestamps. Keyboard navigation already exists.
- **Accepted — Use Telemetry-Backed Activity Signals:** the Refresh glyph turns only while a request is in flight. An active stage pulses only under the liveness rule. Attention items and blocked runs never animate.
- **Accepted — Heartbeat and Freshness (LIVE):** LIVE requires all four of the following:
  - an in-progress run;
  - an open stage;
  - a live writer lock;
  - an observation fresher than two refresh intervals.

  It says "Writer live in this repository", because the lock names a process, not a run or an agent.
- **Accepted — Motion Style:** a slow opacity pulse only, with no movement, flashing, glow, or animated gradients.
- **Accepted — Add a Compact Operational Posture Visualization:** a stage map with columns in recorded stage order, one cell per run, and static markers for blocked and completed runs.
- **Accepted — Separate Page-Level Summary Cards from Selected-Run KPIs:** the Runs view has page cards scoped to the filter and a separate KPI strip for the selected run. The colour guidance matches the token roles.
- **Accepted — Make the Blocked State Actionable:** an outcome statement names where and why the run stopped, and states that no governed action is eligible. It derives "round 2 of 2" from the recorded rounds and the frozen profile. It offers "View blocking findings", and moves the raw event, commit, and threshold into "Technical details".
- **Accepted — Simplify the Findings Presentation:** the run view lists active findings in a table with a "Blocking only" toggle. Addressed, earlier-round, and rejected findings collapse into History, and the drawer serves as the row expansion.
- **Accepted — Keep the Ledger-Step Activity Treatment:** kept only for observed work. Revision 1's motion was a decorative first-paint fill, not telemetry, so it is removed.
- **Accepted — Treat Terminal Commands as Secondary Actions:** each command leads with its name and CLI description, followed by an eligibility badge, "Copy command" with a "Copied" confirmation, and the text behind "View command". The audit description uses the CLI's own wording, "Recompute the whole audit chain", because the dashboard cannot vouch for the result.
- **Accepted — Improve Labels and Terminology:** all five suggested wordings are adopted.
- **Accepted — Improve the Run Table:** full-row selection with a gold leading rule, a sticky header, right-aligned numbers, sortable headers, and path tails with the full path on hover. Quick filters are Blocked, Completed, and Has blocking findings.
- **Accepted — Make Governance State Easier to Understand:** a categorical governance status with "N of M recorded stage gates passed". There is no percentage, because no scoring model exists.
- **Accepted — Add a Policy Checks Section:** eight checks, each with a result badge and one evidence line. They are derived from the recorded gates, the approval window, the frozen verification commands, and the configuration.
- **Accepted — Reduce the Prominence of Cost:** Governance carries one line pointing to cost under Models & agents.
- **Accepted — Add an Auditability Timeline:** stage, result, start, duration, agent runs, and the configured model per stage. The timeline shows no user or per-stage agent, because the projection records neither per stage.
- **Accepted — Visualize Cost Distribution:** muted relative-cost bars, with no entrance animation.
- **Accepted — Make Model Attribution More Explicit:** the `byAgent` projection gains recorded roles, requested and effective models, unreported-row counts, and summed duration (operator decision). The recorded runs report an effective model on 42 of 42 rows, and `Unavailable` remains the fallback.
- **Accepted — Add Token Data:** input, output, cache read, cache write, known cost, and agent runs per stage. A stage with no agent rows shows a dash, not zero.
- **Accepted — Add Agent Usage and Efficiency Comparisons:** executions, known cost, cost per execution, tokens, total time, and average time per execution. A note states that a higher value is a place to look, not proof of inefficiency.
- **Accepted — Give Telemetry Coverage a Dedicated Card:** a coverage strip for snapshots, cost, tokens, model attribution, duration, history ("Not collected", neutral), and the audit chain.
- **Accepted — Elevate the Hero Metrics:** Agents, Executions, Known cost, and Tokens cards, each with its scope in the label. Snapshot coverage moved to the coverage strip, because a run scope has one snapshot.
- **Accepted — Enterprise UX Direction:** dense tables, muted bars, and status indicators, with no donuts, gradients, or animated counters.
- **Rejected — "Possibly stalled" state:** nothing records an expected event cadence to measure silence against, so any threshold would be the arbitrary UI timer the review itself warns against. "No live writer", which is a recorded fact, is shown instead.
- **Rejected — "Open file" and "Open repository" actions:** the dashboard never links to or serves repository files (the section 23 read boundary). "Copy location" and "Copy status command" replace them.
- **Rejected — "Need to be resolved before the run can continue" and "Copy verification command":** a blocked final panel is the run's recorded result, and no governed action is eligible. The sentence would therefore promise a continuation that does not exist. No verification command is offered, so the copy action is the status command.
- **Rejected — "Audit not verified in this view" quick filter:** it is true of every run, because this view never verifies the chain, so it would filter nothing.
- **Rejected — "1.41M Input tokens":** the recorded value is total tokens; input is 84 of the 1,407,508. The KPI reads "Tokens", showing the total and the output count.
- **Deferred — Show Staffing Coverage:** the record binds no specialty to an agent, and matching by agent name would be inference. Governance shows "Required specialists: Not evaluated", naming the configured specialties. Trigger: a recorded specialty-to-agent binding.
- **Deferred — Consider an Anomalies Section:** no detection rule or baseline exists, and a "Not evaluated" placeholder section would be decoration. Trigger: an operator-defined rule set.
- **Deferred — Consider an Agent Behavior Section:** deferred for the same reason as anomalies. Trigger: defined behaviour signals with evaluation coverage.
- **Deferred — Later enhancements:** the review marked these as later. Owner: the operator, after this plan ships.
  - inline run expansion;
  - saved filters or views;
  - repository comparison;
  - command palette;
  - configurable card visibility;
  - a columns menu;
  - a stage filter on the Findings view;
  - cross-run per-agent comparison (Runs and Cost / run).
