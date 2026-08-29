# Governed Delivery — Architecture — review

**Reviewed document:** `C:\Users\Shawn-work\repositories\governed-delivery\ARCHITECTURE.md`
**Document type:** Design. Primarily a design; the build order (section 23) reads as a plan outline and receives review for sequencing only.
**Review date:** 2026-08-28

---

## Summary

The document is a deliberate, subtraction-first design with unusually clear reasoning about its own past failures. The gaps are concentrated, not diffuse: the two mechanisms the whole system depends on — the patch write path and the human approval gate — each contain an unresolved specification problem, and several secondary terms the implementer must invent.

## Verdict

**Ready for planning after required changes.** The critical issues concern the design's own central guarantees, so they must be resolved before implementation planning. The secondary gaps are resolvable without redesign.

## Critical issues — must fix before implementation

**Issue:** The patch-validation anchor has three incompatible readings, and the commit model is undefined

- **Why it matters:** Section 7 states "the base commit is recorded at run start and every proposed patch is validated against it." Section 8 states a patch is "bound to a base commit" and "approval re-validates the diff against the current head, so a patch proposed against a stale tree is refused." The document never states who commits the projections it requires to be "committed" (section 7), or when. If the system commits `spec.md` and `plan.md` during the run, head moves by the system's own hand, and a literal "refuse if the tree has moved" re-validation refuses every source patch proposed before the latest projection commit. If validation instead uses the run-start base commit, any patch proposed after plan-stage commits is stale by construction.
- **Where:** Sections 4, 7, and 8; the evidence model in section 15.
- **Production impact:** The refusal guarantee either refuses valid work and stalls runs, or an implementer redefines it silently and the guarantee drifts. Commit authorship and identity are also unspecified, so "the feature branch and worktree" (section 7) has no defined producer.
- **Recommended fix:** State the commit model: the system commits projections and applied patches to the run branch under a defined author identity. State the validation rule as: a patch binds to the head in effect when proposed, and re-validation at apply time refuses only if head has moved in a path the patch touches since proposal.

**Issue:** The approval authorization has no representation in the evidence model and no defined signature mechanism

- **Why it matters:** Section 12 makes `awaiting_approval` the only human gate and lists exactly what the authorization binds: feature ID, spec version and content hash, starting commit, profile hash, risk, expiry, and scope. Section 15 claims the SQLite store holds "everything the system needs to resume, gate, or report" — but the schema omits any approval table. Section 17 says signing material lives outside the repository and workers never receive it, but never states the signature scheme, where the trusted verification key lives, or which component verifies the signature at gate time. Every post-approval stage gates on this record.
- **Where:** Sections 12, 15, and 17.
- **Production impact:** The security anchor of the pipeline is invented during implementation, or the schema is churned later — which hard rule 3 makes expensive by design.
- **Recommended fix:** Add the authorization to the schema with its bound fields, signature, signer identity, and creation time. Name the signature scheme (for example, Ed25519) and the configured location of the trusted verification key. State that the deterministic gate verifies the signature before honoring the authorization.

## High-risk areas

**Risk:** Materiality is agent-assigned and drives gate behavior

- **Why:** A closure pass triggers on "a material finding" (section 12), and remediation budgets key off material findings, but severity arrives in the finding row from the reviewing agent. An agent that assigns severity decides in practice whether a closure pass runs — the same class of self-approval the design forbids everywhere else.
- **Impact if ignored:** A reviewer that soft-pedals severity ends review rounds without a closure pass, and the deterministic gate completes on self-assigned low severity.
- **Mitigation:** Define materiality deterministically, as a severity threshold from configuration. Have the gate treat severity as an input it checks against the finding's stated rationale, never as a self-certifying fact.

**Risk:** Verification commands are required, but their location, authorship, and protection are unspecified

- **Why:** Section 7 requires them configured and actually running, with the verification stage failing closed, but never says where the commands live (committed in the target repository, or machine-local), who authors them for a first run, or that they sit outside the run's signed scope.
- **Impact if ignored:** A run that can patch the verification configuration can define its own check, and a default install cannot complete a run — the exact hazard the document lists in section 22.
- **Mitigation:** Name the committed config file that holds verification commands, add it to the protected paths, exclude it from every run's scope, and state the setup-time check that it exists and runs.

**Risk:** The lock model and the multi-project database scope conflict

- **Why:** Section 19 grants one writer per repository via a lock file. Section 15 lets one database serve several repositories. Two invocations in different repositories hold different locks and write the same SQLite file; "audit appends serialized under the same lock" names a lock that does not exist at that scope.
- **Impact if ignored:** Concurrent cross-repository writes hit `SQLITE_BUSY` with no defined retry or timeout behavior, or the design's serialization claim breaks silently.
- **Mitigation:** Scope the database per repository, or state the database-level serialization the per-repository lock does not provide — a separate database lock, or an explicit busy-timeout and retry policy.

## Medium and low concerns

- `handoff` and `stage.input_stage_id` represent the same edge twice. Section 4 calls the handoff a row; storing the linkage again on the stage recreates the derived-state-stored-as-authority pattern that section 14 bans for status. Choose one representation and derive the other.
- The authorization binds "spec version" while hard rule 3 bans version discriminators. Define whether a spec version is its content hash — making "version and content hash" redundant — or something else, and remove the redundancy.
- `selectReviewers(stage, risk, spec)` consumes risk before any approval binds it. The document never states who assesses risk, when, and on what evidence. Specify provenance for both the pre-approval selection and the authorization's risk field.
- "Closure pass" appears once (section 12) with no definition: a re-dispatch of the same panel, a review round, or something else. Define it.
- The executor definition example sets `allowedPaths: [docs/features/**]`, which refuses the implementation stage's source writes. Mark the example's paths as stage-scoped rather than a global default.
- "Profile hash" and "policy" appear without a statement of whether they name one thing or two. Define what a profile snapshot contains and where snapshots are stored.

## Missing and underspecified areas

- Approval record schema, signature scheme, verification key location, and gate-time signature verification (critical issue 2).
- Commit model: who commits, when, with what identity, and how commits interact with the clean-tree precondition (critical issue 1).
- Scope derivation: what the signed scope is computed from and who computes it.
- Verification command config format and location (high-risk 2).
- Risk assessment source and timing.
- Materiality threshold for findings (high-risk 1).
- Enumerations for `run.status`, `stage.status`, and `gate_result`; the plan needs them to write the gate logic.
- Location of the content-addressed overflow store for oversized prompts; section 20 references a file without naming where it lives.
- Branch and worktree naming conventions and their location on disk.

## Suggested improvements

- Fold `handoff` into `stage` — an `output_ref` on the stage row — so the edge exists once.
- Add the approval table and profile-snapshot storage to the evidence model so section 15's claim stays true.
- Extend the documentation checker (section 21) to verify the architecture's own claims — for example, that every table the design references appears in the schema block.

---

## Reconciliation

**Date:** 2026-08-29
**Disposition:** 14 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

### Verdicts

- **Accepted — Patch-validation anchor conflict (critical):** The commit model is now stated: the system commits everything it writes to the run branch — projections and applied patches — under a configured identity, and writes run state only to ignored `.governance/`. A patch binds to the head in effect when proposed; re-validation at apply time refuses it only if head has moved in any path it touches. The run-start base commit anchors the branch. Sections 7, 8, and 12 now agree on these rules.
- **Accepted — Approval authorization missing from schema and mechanism (critical):** The schema gains an `approval` row binding spec hash, starting commit, profile hash, risk, scope, expiry, signature, and signer. The design names Ed25519, verified by the gate against a public key in machine-local configuration. The profile and its storage (`.governance/profiles/<run>/`, `run.profile_ref`) are defined.
- **Accepted — Materiality is agent-assigned (high-risk):** Materiality is a severity threshold from configuration, frozen in the profile. The reviewer assigns severity; the threshold decides materiality.
- **Accepted — Verification commands unspecified (high-risk):** Verification commands live in a committed `governed.yaml` at the repository root, authored by the operator, listed as a protected path, and never part of a run's scope.
- **Accepted — Lock model vs multi-project database (high-risk):** Audit appends serialize under the database's single-writer lock with a SQLite busy timeout and bounded retry; the repository lock covers per-repository state only. The reviewer offered per-repository databases as the alternative; section 15's multi-project feature forces the database-level option.
- **Accepted — `handoff` vs `stage.input_stage_id` (medium):** The `handoff` table is gone; `stage` carries `output_ref`, and the edge exists once. Section 4 now says the handoff is the stage row.
- **Accepted — "Spec version" vs hard rule 3 (medium):** Per the operator's version-neutral directive, the authorization binds the spec content hash only; "spec version" is removed. Hard rule 3 now bans version identifiers in component names and contracts. The optimistic-concurrency mechanism is renamed a per-row revision counter.
- **Accepted — Risk provenance (medium):** Risk is computed once, deterministically, at intake from `changeKind`, declared scope size, and protected-path touches. It sizes the panel and is what the operator signs; an agent never assesses its own risk.
- **Accepted — Closure pass undefined (medium):** A closure pass is one further review round by the same panel, charged against the remediation budget, after which the gate decides again.
- **Accepted — Sandbox `allowedPaths` example (medium):** The example marks paths stage-scoped: document stages write `docs/features/**`; the implementation stage writes only inside the signed scope.
- **Accepted — Profile vs policy (medium):** The profile is the frozen record of everything the run resolved at start; policy is its gate-consulted subset, re-hashed at approval.
- **Accepted — Suggested: fold `handoff` into `stage`:** Applied together with the `handoff` finding above.
- **Accepted — Suggested: add approval table and profile-snapshot storage to the evidence model:** Applied together with the approval finding above.
- **Accepted — Suggested: checker asserts referenced tables exist:** The checker in section 21 now verifies that every table the design prose names exists in the schema block.

The missing and underspecified areas resolve inside the entries above: status and gate-result enumerations land in section 15, the overflow store (`.governance/content/<hash>`) in sections 15 and 20, branch and worktree naming (`gov/<slug>/<run-id>`, `.governance/worktrees/<run-id>`) in section 7, and scope derivation (gate-computed from the spec's declared paths and artifacts) in section 12.
