# GitHub Project projection and upstream spikes - CLI impact review

**Reviewed document:** `github-project-projection-and-upstream-spikes.md`
**Related analysis:** `.claude\sessions\2026-09-09-docs-cli-operator-analysis.md`
**Document type:** Design proposal
**Review date:** 2026-09-09
**Status:** reconciled
**Hazards considered:** 2 (retained evidence stays local), 4 (real API evidence),
7 (ambiguous remote writes), 11 and 12 (optional integration and visible
configuration), 13 and 16 (source authority and upstream decisions).

## Summary

The proposal materially affects the CLI's operator-action, identity, readiness,
and outcome contracts. It supports the local-first CLI increment, but it does
not specify the operator's broader GitHub-to-BuildWorks intake and two-way flow.
This review assesses that impact; it does not authorize integration, reconcile
either input document, or independently audit the comparison repository.

## Verdict

**Ready for planning after required changes.** Amend the CLI analysis's scope
and the contracts below before planning its bounded local increment. The
outbound integration still requires the proposal's target, App, mapping,
publication-policy, visibility decisions, and live discovery; inbound flow
requires a separate requirements/design decision.

## Critical issues

No critical issues found in the bounded CLI approach.

## High-risk areas

**GCLI-H1: The eventual intake goal exceeds the proposal's outbound contract**

- **Why:** The proposal's "Decision sought" and "Project status is one-way"
  explicitly exclude inbound changes. Its effort table separates two-way
  synchronization. Feature/Story publication follows passed `plan_review`;
  it does not import or author PRDs/specs in GitHub. Stories represent approved
  criteria, not executable tasks.
- **Impact if ignored:** Planning treats an outbound projection as the intake
  system, or interprets edited issues, closed tasks, and Spike answers as
  changes to an approved run.
- **Mitigation:** Record three distinct horizons: local operator CLI, explicit
  outbound publication, and separately designed GitHub intake/two-way flow.
  Keep the current snapshot/approval boundary explicit. Do not implement an
  importer, synchronization service, or generic tracker adapter in the CLI slice.

GitHub-authored repository Markdown is a narrower case: a PRD committed at the
expected design-document path and checked out locally can already supply the
existing design input. Issue-body/Project intake is different. An externally
authored spec is not automatically the system's reviewed/approved spec.
`src\spec-stage.ts:142-148,199-214` reads local design content and sends it to
the spec author; `ARCHITECTURE.md` sections 5 and 14 defer executable task
decomposition and keep run state in SQLite.

## Medium and low concerns

- **GCLI-M1: Execution eligibility is not operator-action eligibility.**
  "Publish an upstream block as a Spike" explicitly acts after a terminal
  block; reviewed-run publication need not restart delivery either. Preserve
  CLI-AC-08 as a refusal of stage execution, not of every command for a
  terminal run. Status needs a workflow next step plus optional eligible
  operator actions, including proposal IDs/routes and missing Spike metadata.
  `src\cli.ts` already permits explicit `proposal-export` without requiring
  the run to be `in_progress`.
- **GCLI-M2: Local and remote identities have different meanings.**
  The proposal permits either a target repository or a dedicated intake
  repository and rejects a universal Project default. Amend CLI-AC-02 and
  status requirements to distinguish local checkout, BuildWorks project/run,
  GitHub owner/repository, and Project. Keep `--repo` unambiguously local;
  do not silently derive publication authority from Git remotes. A run number
  and an `AC-*` identifier are not global work-item identities. Remote IDs,
  markers, hashes, and URLs belong to the future concrete publication mappings,
  not placeholder columns in the current CLI increment.
- **GCLI-M3: Readiness and outcomes need separate delivery/publication views.**
  The proposal's optional integration and failure rules require a completed
  delivery to remain completed when publication fails or remains ambiguous.
  Amend CLI-AC-03, CLI-AC-13, and CLI-AC-14: default status reads stored facts;
  optional live GitHub diagnostics are explicit; disabled GitHub is not a
  delivery failure. Later views distinguish unpublished, partially published,
  ambiguous, and published state without adding those values to `run.status`.
  A retained `.governance` reference is local evidence, not a GitHub-accessible
  document URL.
- **GCLI-M4: Consent and recovery differ by operation.**
  The proposal's preview/confirmation, App-token, and ambiguous-create rules
  are not the guided command's paid-execution consent or signed scope
  approval. Amend CLI-AC-09: permission to execute a run does not publish
  organization-visible content. Later publication previews name the target
  and content; its credential never enters the model/verification environment.
  Remote-create reconciliation does not reopen a blocked run or retry a paid
  stage. Preserve these boundaries without building publication recovery now.

## Missing and underspecified areas

For the eventual inbound horizon, resolve these contracts before claiming it
is planning-ready:

- Identify the intake object: Git-tracked PRD/design, issue body, issue form,
  discussion, or another explicit object. Define how it selects a target
  checkout and creates a local run.
- Define the authoritative revision and retained provenance: source identity,
  content hash, selected attachments/comments, local materialization, and
  operator acceptance. Later remote edits must not silently change frozen work.
- Separate authoring a source requirement from granting spec approval. An
  issue state or comment does not replace the Ed25519 authorization.
- Define whether GitHub tasks mean criterion-level Stories or real executable
  tasks. The latter expands beyond both the proposal and the authorized stages.
- Define how a human Spike decision creates changed source and a fresh run,
  and whether repeated runs update one Feature or publish separate run views.
  Do not change the proposal's run-scoped publication identity by inference.

The outbound proposal already names its unresolved production decisions.
Their absence does not block the local CLI increment, provided that increment
does not include GitHub mutation. No live App/Project/API contract is verified
by this review.

## Suggested improvements

Add the following planning criteria to the CLI analysis through a deliberate
reconciliation:

| Scope | Required criterion |
|---|---|
| Current CLI | A terminal run prevents execution but still exposes existing proposal inspection/export and clearly distinguishes optional operator actions. |
| Current CLI | Execution consent neither signs approval nor authorizes publication; all local operations work without GitHub configuration or credentials. |
| Current CLI | Target/output terminology leaves local repository identity and remote publication identity distinct without implementing future storage. |
| Future outbound | Preview changes neither local authoritative state nor remote items; publication failure/recovery never changes a stage gate. |
| Future outbound | Status exposes frozen target mapping, stored remote identity, partial/ambiguous publication state, and missing human Spike inputs without leaking credentials/raw output. |
| Future inbound | An accepted remote source becomes a retained, identified local input; later remote edits do not mutate an active approved run. |

The core CLI recommendation remains read-only visibility plus safe existing-stage
execution. Incorporate these boundaries now; add the proposal's blocking-Spike
proof after separate authorization, then reviewed-run projection and outbound
recovery. GitHub-authored intake and executable tasks remain a separately
specified horizon, not prerequisites that stall the first increment.

---

## Reconciliation

**Date:** 2026-09-09
**Reconciliation target:** `.claude\sessions\2026-09-09-docs-cli-operator-analysis.md` (repository-relative)
**Disposition:** 5 accepted, 0 rejected, 5 deferred, 0 open
**Status:** reconciled
**Hazards considered:** 2, 4, 7, 11, 12, 13, and 16; preserve evidence,
source authority, operation-specific consent/recovery, and optional integration.

The operator explicitly selects the related CLI analysis as the amendment
target. The original reviewed outbound proposal remains unchanged. Repository
evidence and the established local-first scope make the five boundary
corrections mechanical; no new authority or integration implementation is
selected. Overlapping missing-area and suggested-criterion items are grouped
with their owning finding below rather than counted twice.

### Verdicts

- **Accepted - GCLI-H1, three delivery horizons and source authority:** The analysis separates local CLI, outbound publication, and inbound flow; distinguishes repository Markdown from issue intake and criterion Stories from executable tasks; incorporates the missing authorship-versus-approval boundary and suggested future inbound snapshot invariant without selecting its import design.
- **Accepted - GCLI-M1, execution versus operator-action eligibility:** Status and the boundary map separate stage continuation from existing proposal inspection/export; `CLI-AC-08`, `CLI-AC-14`, and new `CLI-AC-17` incorporate the suggested current terminal-run criterion without adding a publisher.
- **Accepted - GCLI-M2, local versus remote identity:** `--repo`, input/output terminology, and `CLI-AC-02` remain explicitly local; run/criterion identity scope and future concrete publication mappings incorporate the suggested current identity criterion without placeholder storage.
- **Accepted - GCLI-M3, delivery versus publication readiness and outcomes:** Local status/readiness remain offline and independent of GitHub; `CLI-AC-03`, `CLI-AC-13`, `CLI-AC-14`, and new `CLI-AC-18` reflect that rule; the future-boundaries table incorporates stored remote mappings, partial/ambiguous outcomes, local evidence limitations, and missing human Spike inputs.
- **Accepted - GCLI-M4, operation-specific consent and recovery:** The journey, rules, and `CLI-AC-09` distinguish execute/sign/publish authority; the future-boundaries table incorporates no-write preview, credential exclusion, independent publication failure, and ambiguous-create recovery without adding a retry or unblocking path.
- **Deferred - GCLI-D1, inbound object and target/run selection:** The analysis records this missing-area decision for the operator's separately authorized inbound requirements; the local slice retains its design-document input.
- **Deferred - GCLI-D2, revision/provenance selection and acceptance details:** The source invariant is accepted under GCLI-H1, but revision, attachment/comment selection, materialization, and operator-acceptance mechanics remain decisions for inbound design.
- **Deferred - GCLI-D3, executable task semantics:** The analysis retains the distinction from criterion Stories and requires explicit stage-scope authorization before designing execution-task synchronization.
- **Deferred - GCLI-D4, Spike-decision ingestion and repeated-run linkage:** The analysis preserves fresh-run repair and the outbound proposal's run-scoped identity; later GitHub design determines ingestion and whether cross-run reuse exists.
- **Deferred - GCLI-D5, outbound production contract decisions:** Target ownership, App installation/permissions, live field mapping, publication policy, and content visibility remain prerequisites to separate outbound authorization/discovery, not blockers to local CLI planning.

All six suggested criteria are incorporated as either current CLI requirements
or explicitly future boundaries. The five missing-area bullets map to D1, D2,
H1/M4, D3, and D4 respectively. The proposal's existing production decisions map
to D5. No item remains open, and no deferred implementation is marked shipped.
