# GitHub proposal impact on the CLI analysis

**Status:** Review complete; findings open and not reconciled.
**Date:** 2026-09-09
**Baseline:** `a8a71d1` on `code-review-stage`; the preceding CLI analysis is
an existing untracked file and remains unchanged.
**Hazards considered:** 2, 4, 7, 11, 12, 13, and 16, as detailed in the review.

## Requested outcome and scope

Determine whether the GitHub Project projection and upstream spikes proposal
changes the CLI operator-experience analysis, given the eventual goal of
GitHub-authored PRDs, specs, issues, and tasks flowing into and out of BuildWorks.
Success means a source-grounded impact decision, exact requirement deltas, and
a distinction between immediate CLI scope and future integration authority.

Read the whole proposal, the existing CLI analysis, applicable architecture and
hazards, and the relevant source paths. This is review only: no implementation,
automatic findings reconciliation, authenticated discovery, remote mutation,
paid run, key change, or retained-target cleanup.

## Result

The proposal affects operator-action eligibility, target identity, separate
delivery/publication status, optional readiness, consent, and recovery language.
It does not require building GitHub integration before the bounded local CLI.

The broader target is not fully covered by the proposal: its first release is
outbound only. Repository Markdown authored through GitHub can feed the existing
local design path after checkout; issue/Project intake, remotely edited approved
specifications, and executable task synchronization require separate contracts.

The dated, source-grounded review is
`docs\proposals\2026-09-09-github-project-projection-and-upstream-spikes-review.md`.
It records 0 critical issues, 1 high-risk scope gap, 4 medium concerns, and
current/future acceptance-criterion deltas. Its verdict is ready for planning
after required changes to the CLI analysis; full integration planning retains
the proposal's unresolved decisions.

## Changes, evidence, and remaining state

Only this session record and the dated proposal review are new. The source
proposal and earlier CLI analysis remain intact; nothing is marked reconciled.
Review evidence comes from the proposal's explicit outbound/authority clauses,
the CLI/store/profile behavior already traced, the local spec-input path, and
the proposal migration. No comparison-repository or live GitHub claims are
independently re-established here.

The documentation checker reports no errors and only historical path warnings.
All cited repository paths resolve, and both new files have clean whitespace.
No runtime behavior changes, so no runtime rollback is needed. Reconciliation
of the recommended analysis changes is the remaining document action; target
ownership, App permissions, field mapping, visibility, and inbound authority
remain separate operator decisions.
