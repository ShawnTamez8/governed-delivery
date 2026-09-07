# GitHub Project projection and upstream spikes

**Hazards considered:** 2 (publication must not replace retained evidence), 3
(every value accepted from a model needs its shape stated, so the projection is
derived from already-validated documents), 4 (a real GitHub response must define
the API contract tests), 7 (an ambiguous external write must not be retried
unchanged), 11 and 12 (an unconfigured integration must not stop a default run,
and its effective target must be visible), 13 (GitHub must not invent
obligations absent from the approved specification), and 16 (an upstream
omission needs a human destination rather than another revision of the wrong
artifact).

## Decision sought

Authorize planning for an outbound-only GitHub Issues and Projects integration
as a new post-milestone behaviour, subject to the target, credentials, project
field mapping, and publication policy decisions below.

The recommended first release adds two explicit operator actions to the existing
BuildWorks CLI:

1. Publish a run whose `plan_review` stage passed as one GitHub Feature issue,
   with one child Story per approved `AC-*` criterion.
2. Publish a stored `blocking_dependency` proposal as a GitHub Spike issue after
   the run has already blocked.

GitHub is a projection for people. The approved specification, reconciled plan,
run status, findings, and proposals remain authoritative in the repository and
SQLite store. No GitHub edit, issue closure, Project field, or webhook advances,
approves, unblocks, or completes a run.

This proposal does not adopt OpenSpec. It adopts only the source-of-truth
boundary and human-decision pattern demonstrated by the comparison repository.

## What the comparison repository proves

The user-directed comparison was
`C:\Repositories\agent-cortex-axel`. Its committed rules and artifacts show a
working separation:

- OpenSpec 1.12.0 owns product requirements under `openspec/`; GitHub Issues and
  the Spike ProjectV2 board, organization project 4, are the human work view.
- One OpenSpec change maps to one Feature issue. Each ADDED or MODIFIED
  requirement maps to a child Story. A question that needs a person maps to a
  concise Spike issue whose evidence and eventual decision remain in a
  repository spike document.
- The GitHub projection stops at Feature, Story, and Spike. Agent execution
  detail is not published as work items.
- Publication requires a presented plan and human confirmation because the
  issues are organization-visible.
- A visible sync marker in each issue body and a committed
  `github-issues.md` ledger provide repeat-run identity.

This is not only aspirational documentation. Two committed ledgers record a
2026-09-04 `propose` sync:

- `domain-landing-pages`: Feature 82, Stories 83 through 93, and Spikes 94
  through 96 — fifteen issues.
- `powerbi-parity`: Feature 66, Stories 67 through 77, and Spikes 78 through 80
  — fifteen issues.

The earlier OpenSpec migration ledger also records that its first publication
attempt could not run because the required skill was not installed. That
sequence is useful evidence: the artifact mapping works, but an instruction- and
tool-installation-dependent sync is not a deterministic product boundary.

### What transfers to BuildWorks

- Repository state remains canonical; GitHub is an outbound human view.
- A feature-level parent, requirement-level children, and decision-level spikes
  are understandable without exposing agent execution detail.
- Stable markers and a local remote-ID ledger are necessary for repeatable
  publication.
- The external mutation is previewed and explicitly confirmed.
- A missing human decision blocks the dependent work; the agent does not fill
  the gap with a guess.

### What does not transfer

- OpenSpec's filesystem artifact lifecycle conflicts with `ARCHITECTURE.md`
  sections 4 and 14. BuildWorks stages are database state, not document status.
- The comparison skill uses a logged-in `gh` process plus prompt instructions.
  BuildWorks needs deterministic eligibility checks, typed API failures, stored
  remote identifiers, and audit events in the core behind its one CLI surface.
- A search marker plus a ledger written after all remote calls does not close
  the ambiguous-create window. If GitHub creates an issue and the process loses
  the response before recording it, an immediate retry can duplicate the issue
  while GitHub search indexing lags.
- The comparison workflow can continue unrelated work around a spike.
  BuildWorks' current upstream block is terminal and requires a fresh run. A
  GitHub Spike must not silently add an in-place resume path.
- Project 4 is the Spike product's board, not a universal BuildWorks default.
  Every governed target needs an explicit repository and project mapping.

The live Project 4 field identifiers, option identifiers, workflows, and current
permissions were not verified in this review. No authenticated browser was
available and the installed `gh` credentials were invalid. The repository's
issue forms and ledgers establish the Feature, Story, Bug, and Spike types and
the board number, but planning must begin with a read-only live discovery of the
board contract.

## Proposed behaviour

### 1. Publish a reviewed run

An operator invokes a new command after `plan_review` has passed. The command
first produces a no-write preview; an explicit confirmation flag performs the
external writes. The exact command names are a planning detail, but the surface
stays the existing CLI calling the core directly, for example:

```text
node src/cli.ts github-publish-run --run <id>
node src/cli.ts github-publish-run --run <id> --yes
```

The eligibility gate reads the store and refuses unless:

- the run, approved specification, and reconciled plan exist;
- `spec_review` and `plan_review` passed;
- the plan's `plan_for` equals the approved specification hash;
- the target GitHub repository, organization Project number, issue types, and
  field options were frozen for this run; and
- the proposed issue bodies fit configured size limits without truncation.

The output mapping is:

| BuildWorks source | GitHub projection in the first release |
| --- | --- |
| Run and feature | One Feature issue added to the configured Project |
| Approved `AC-*` criterion | One child Story, keyed by the criterion ID |
| Declared artifacts | Exact list in the Feature body |
| Spec and plan identity | Source paths plus normalized content hashes |
| Run state | Outbound Project status only: Todo, In Progress, or Done |

The Story body carries the criterion text verbatim. The Feature body carries
the exact declared artifacts and the identities of the approved specification
and reconciled plan. Agent execution steps and their progress are not copied to
GitHub. This gives people the reviewed product contract without creating a
second execution-status surface.

`plan_review`, not a separate "design reviewed" event, is the first valid
publication point in the current architecture. The design is the human input;
the derived specification is reviewed and approved, and the plan is then
reviewed. Publishing earlier would expose draft obligations that reconciliation
may still replace or remove.

### 2. Publish an upstream block as a Spike

The existing gate behaviour remains first and authoritative:

1. A reviewer classifies the concern as upstream.
2. Reconciliation returns `upstream_blocking` with a validated proposal
   candidate.
3. The deterministic gate stores a `blocking_dependency` proposal with retained
   evidence and blocks the run.
4. The operator reviews a no-write preview and may publish that proposal as a
   GitHub Spike.
5. A person decides the upstream question in the source repository. The repair
   is a fresh BuildWorks run against the changed input.

For example:

```text
node src/cli.ts github-publish-proposal --proposal <id>
node src/cli.ts github-publish-proposal --proposal <id> --yes
```

The issue contains the proposal title, problem, why it is upstream, route,
BuildWorks run and finding identifiers, and repository-relative retained
evidence reference. It does not copy raw model output. If the affected run has
already been published, the Spike is parented to the most relevant Story when
that mapping is deterministic, otherwise to the Feature.

The current proposal schema does not contain four fields a useful Spike needs:
an answerable decision question, options, a decision owner, and a needed-by
date. The system must not guess them or add another model dispatch to fill them.
The preview therefore names the missing human inputs and `--yes` refuses until
the operator supplies them from a reviewed, committed proposal. The exact
operator-input shape is a planning decision; it must be validated before the
first GitHub call and must not rewrite the stored proposal.

`cannot_determine` still publishes nothing. That disposition deliberately has
no complete proposal candidate, so turning it into an issue would require the
system to invent the missing question. The CLI instead names the block and asks
the human to author or export a proposal first. `follow_up` proposals are also
outside the first Spike publisher because they did not block a decision in the
current run.

### 3. Project status is one-way

A later explicit sync may project these observed states:

| Authoritative BuildWorks event | GitHub Project status |
| --- | --- |
| `plan_review` passed | Todo |
| implementation stage started | In Progress |
| run completed after `delivery_check` | Done and Feature/Stories may close |
| run blocked or failed | Blocked field or label, without closing the issue |

The exact field and option identifiers come from the frozen target profile, not
from matching display text at mutation time. A missing or renamed option refuses
the projection and reports the field by name and ID. It does not change the run.

No inbound webhook or polling loop is included. GitHub issue closure is not
approval; Project Done is not delivery; a Spike answer is not a signed change to
the approved specification.

## Target configuration and authentication

The integration is disabled unless the target repository opts in. The
non-secret target contract is committed configuration and frozen at run start:

- GitHub organization and repository;
- Project number and GraphQL node ID;
- issue type identifiers for Feature, Story, and Spike;
- Project field identifiers and allowed option identifiers;
- publication size limits; and
- whether publication is manual-only. Manual-only is the first-release value.

The effective mapping appears in run status output so two target repositories
cannot silently behave as different products.

Use one concrete GitHub implementation; do not introduce a generic work-tracker
adapter without a second real tracker. The target authentication design is a
GitHub App installed only on the organization and repositories it must update,
with organization Projects read/write and repository Issues read/write. A
short-lived installation token is supplied through one named environment
variable at command time. The App private key, token, and installation secret
never enter committed configuration, a prompt, retained model output, or an
audit summary.

A user `gh` session may be used for a disposable discovery spike, but it is not
the production authentication contract. GitHub documents that a repository's
ordinary Actions token cannot update an organization Project; this proposal
also avoids making a GitHub Action a second BuildWorks control surface.

## Idempotency, failure, and evidence

GitHub issue creation has no transaction with the local SQLite write. Treat
partial success as an expected state, not an exception to retry blindly.

- Every Feature, Story, and Spike body carries a visible deterministic marker
  containing the BuildWorks project, run or proposal identity, artifact kind,
  stable criterion ID where applicable, and source content hash.
- Store remote issue node ID, issue number, URL, Project item ID, published
  content hash, and the last completed mutation step locally. Use separate
  concrete mappings for Feature, Story, and Spike publications rather than one
  discriminator-heavy union table.
- Repeat publication updates the same issue only when the marker, stored remote
  ID, and target all agree. It never creates a second issue merely because a
  display title changed.
- Adding an existing issue to a Project and updating its fields are resumable
  steps after issue creation, not one assumed transaction.
- If transport fails after an issue-create request may have reached GitHub but
  before the response is stored, mark the publication ambiguous and refuse an
  automatic recreate. Recovery lists recent repository issues and inspects
  their bodies directly for the marker; it does not depend only on the lagging
  search index. If one match cannot be proved, a human chooses the remote issue
  before publication resumes.
- A GitHub outage or permission failure fails the publication command and
  appends a typed audit event. It never changes a stage gate or run status. A
  run already blocked on an upstream dependency remains blocked for the
  original reason, not for GitHub.
- Preview and audit output contain no token, raw response body, raw model
  output, or unrestricted repository content.

Contract tests use responses recorded from one authorized sandbox repository
and Project run, with a provenance block and secrets removed. Hand-written
GraphQL responses may exercise transport mechanics but do not define the real
API contract. The external proof must cover create, repeat without duplication,
field update, ambiguous recovery, permission refusal, and no mutation in
preview mode.

## Delivery slices and provisional effort

These estimates assume one engineer familiar with this repository. They exclude
organization-admin lead time and carry roughly a fifty-percent uncertainty
until Project 4 and the intended BuildWorks target are inspected live.

| Slice | Outcome | Effort |
| --- | --- | --- |
| Live discovery and decision record | Project schema, issue types, field options, target repository, and App permissions verified read-only | 1–2 days |
| Blocking-proposal to Spike proof | Concrete GitHub client, explicit CLI preview/confirm, Spike publication mapping, stored remote identity, focused tests, one authorized real issue | 5–8 days |
| Reviewed-run projection | Feature plus `AC-*` Stories, parent links, Project fields, and size refusals | 5–8 days |
| Lifecycle and recovery | Outbound status updates, close behaviour, ambiguous-write recovery, audit and operator diagnostics | 4–7 days |
| Full first release | All above, documentation, mutation proofs, repository gates, and real-target evidence | 15–24 engineering days plus access lead time |
| Inbound/two-way synchronization | Separate trust-boundary and authorization design; not recommended here | separate 15–30+ day effort |

The smallest useful authorization is the blocking-proposal-to-Spike proof. It
tests the new service boundary with one issue before multiplying mutations
across a twenty-criterion specification.

## Acceptance criteria for the first release

- With no GitHub target configured, every existing run and smoke test behaves
  exactly as it does now.
- A reviewed-run preview is refused unless the approved specification and
  reconciled plan are present, hash-bound, and passed by their gates.
- One confirmed publication produces exactly one Feature and one Story per
  approved criterion; a repeat produces no duplicates.
- The Feature shows the exact declared artifacts and the spec and plan hashes;
  agent execution detail is absent.
- A confirmed `blocking_dependency` publication with human-supplied decision
  question, options, owner, and needed-by date produces exactly one Spike linked
  to its BuildWorks proposal and evidence; missing metadata and
  `cannot_determine` produce none.
- Closing or editing any GitHub item cannot alter approval, specification,
  plan, finding, proposal, stage, or run state.
- GitHub failure cannot convert a passed or blocked BuildWorks gate into another
  outcome, and an ambiguous create cannot automatically retry.
- The credential is received only through its named environment input and is
  absent from prompts, retained files, issues, logs, and audit summaries.
- Tests replay sanitized responses from an authorized real target, and each
  guard is proved by breaking what it protects and observing the expected
  failure before restoration.

## Decisions required before planning

1. **Target ownership.** Does each governed target publish into its own GitHub
   repository and configured organization Project, or is there a dedicated
   BuildWorks intake repository? Do not default every target to the Spike board.
2. **Application ownership.** Which organization owner registers and installs
   the GitHub App, and which repositories may it update?
3. **Project contract.** What are the live node IDs and allowed values for
   Status, Funnel Stage, and any Blocked representation in the intended board?
4. **Publication policy.** Accept the recommended explicit preview plus `--yes`
   for the first release, or separately authorize a frozen, pre-consented
   automatic mode.
5. **Visibility.** Confirm that validated proposal text, acceptance criteria,
   and declared artifact paths may be copied into the target
   repository's organization-visible issues.

Until those decisions and a live read-only Project discovery exist, this is a
backlog proposal, not an implementation-ready plan.

## Primary references

- `ARCHITECTURE.md` sections 5, 6, 13, 14, 15, and 17.
- `docs/hazards.md` entries 2, 3, 4, 7, 11, 12, 13, and 16.
- `src/proposal.ts`, `src/migrations/006_proposal.sql`, `src/spec-doc.ts`,
  `src/plan-doc.ts`, and the `proposal-export` path in `src/cli.ts`.
- The comparison checkout's root instructions, OpenSpec configuration,
  2026-09-03 OpenSpec migration ledger, issue forms, two committed GitHub issue
  ledgers, and installed `rushent-work-management` 1.1.0
  `sync-feature-issues` and `raise-spike` skills.
- [GitHub Projects documentation](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects),
  [Projects API documentation](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects),
  [GitHub App authentication for Project automation](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/automating-projects-using-actions),
  and [GitHub sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues).
- [OpenSpec](https://github.com/Fission-AI/OpenSpec), reviewed only to distinguish
  its artifact model from BuildWorks' database-owned stage state.
