# Guided Project Bootstrap Implementation Plan — plan review

**Reviewed document:** `docs/features/guided-project-bootstrap/plan.md`
**Governing sources:** `ARCHITECTURE.md`, `docs/hazards.md`, `docs/features/cli-operator/plan.md`, `docs/runbooks/cli-operator.md`, `AGENTS.md`, `CLAUDE.md`
**Repository evidence:** `package.json`, `package-lock.json`, `src/approval.ts`, `src/cli.ts`, `src/operator-state.ts`, `src/policy.ts`, `src/profile.ts`, `src/run-command.ts`, `src/store.ts`, `src/verify-command.ts`, `scripts/sign-approval.mjs`, and relevant CLI/signing tests
**Review date:** 2026-09-13
**Status:** reconciled
**Hazards considered:** 4 for source-derived packaging and guard evidence; 8 and 11 for the actual Windows npm shim and usable default installation; 12 for frozen run identity and configuration; and 15 for the boundary between operator authority and untrusted execution.

---

## Summary

The plan is not executable safely as written. Its orchestration and refusal paths are substantially grounded, but the default key design exposes approval authority to implementer-authored verification, run creation leaves signed identity choices undefined, and the packaging task cannot pass its stated gate.

## Verdict

**Not ready for implementation.** The key boundary requires an architecture decision before coding; the remaining two findings require finite plan corrections.

## Readiness assessment

- **Requirements coverage:** Material gaps — 11 of 15 feature acceptance criteria are fully covered; GBP-AC-01, GBP-AC-07, GBP-AC-08, and GBP-AC-11 have material exceptions.
- **Executor handoff:** Blocked — an implementer must invent security and run-identity behavior.
- **Repository grounding:** Material gaps — the packaging claims conflict with the current manifest and observed npm behavior.
- **Validation:** Material gaps — the package test uses a different installation form from the supported command.
- **Security and operations:** Material gaps — the private key is reachable from the existing verification boundary.
- **Specialist rubrics:** UI and Security — the plan changes the primary interactive CLI journey and moves private-key operations across a trust boundary. API was not selected because endpoints, RPC, and public network schemas remain unchanged.

## Coverage exceptions

| Requirement(s) | Status | Material gap | Plan location | Required correction |
| --- | --- | --- | --- | --- |
| GBP-AC-11 | Conflict | The predictable private-key path is reachable by verification code. | Task 3 Steps 2-3; Task 4 Step 1 | Define an enforceable isolation boundary before authorizing guided key custody. |
| GBP-AC-07, GBP-AC-08 | Partial | Project, feature ID, change kind, and ambiguous feature/run selection are undefined. | Task 5 Step 1; Task 6 Step 2 | Specify every identity source and the complete selection/refusal rules. |
| GBP-AC-01 | Partial | The manifest cannot be packed, and the tested tarball is not the documented checkout-path install. | Installation and naming; Task 2 | Choose one install contract and test that exact contract. |

## Security and bad-practice assessment

- The critical finding below defeats the human approval boundary in the default configuration. Environment-map assertions do not prove filesystem containment.

## Material findings

### Critical — Default key custody exposes approval authority to verification code

- **Where:** GBP-AC-11; Task 3 Steps 2-3; Task 4 Step 1; Task 6 Step 3.
- **Affected requirements:** GBP-AC-11 and architecture sections 12 and 17.
- **Evidence:** The plan fixes the private key at `%USERPROFILE%\.buildworks\approval.key`. `VERIFY_ENV_PASSTHROUGH` supplies `HOME` and `USERPROFILE`, while `runVerifyCommand` executes implementer-authored commands with inherited filesystem access; architecture section 17 explicitly says verification is not filesystem- or network-contained.
- **Impact:** A generated verification command can locate, read, and exfiltrate the key, then sign a future approval without the human. This is reachable for every guided project using the default key setup.
- **Required plan change:** Resolve the custody model first: keep signing in an authority verification cannot access, introduce an enforceable isolation mechanism, or narrow the feature so it does not create a predictable file-backed private key. Add a negative test that attempts an actual read from the verification process.

### High risk — Guided run identity and selection are incomplete

- **Where:** Task 5 Step 1 and Task 6 Step 2.
- **Affected requirements:** GBP-AC-07 and GBP-AC-08.
- **Evidence:** `Store.insertRun` requires `project`, `featureId`, `slug`, and `changeKind`; `featureId` enters the signed payload. The plan derives only a slug, says the intake helper receives all four values, then filters runs only by project and slug without defining the project, feature ID, or change kind.
- **Impact:** Implementers can derive incompatible identities, miss an existing run, create a duplicate, or bind approval to an invented feature ID. Existing repositories with multiple design directories or terminal matches remain ambiguous.
- **Required plan change:** Define exact prompt/derivation rules for all four fields, the persisted source of each, the full run-match key, and behavior for multiple designs plus multiple terminal/nonterminal matches; map tests to each branch.

### High risk — The package contract fails and tests a different installation

- **Where:** Installation and naming; Task 2 Steps 1-2; Task 10 Step 3.
- **Affected requirements:** GBP-AC-01.
- **Evidence:** `package.json` and `package-lock.json` have no version, so `npm pack --dry-run --json` currently exits nonzero with “Invalid package, must have name and version.” With npm 11.17.0, the documented `npm install --global <checkout>` created a junction to the complete checkout, while Tasks 2 and 10 install a packed tarball and claim no checkout path is required.
- **Impact:** Task 2 blocks immediately, and even after adding a version the test does not prove the documented installation or its packed-file boundary.
- **Required plan change:** Choose checkout-linked installation or a packed artifact, add required manifest metadata, align the user command and runtime-dependency claim, and exercise that exact form through both Windows shims outside the checkout.

## Material evidence limits

No material evidence limits found.

---

## Reconciliation

**Date:** 2026-09-13
**Disposition:** 3 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled
**Hazards considered:** 4 requires source-derived installation and process-level negative evidence; 8 and 11 require testing the actual checkout-linked npm shims and usable default installation; 12 requires a complete, frozen run identity; and 15 requires the guided path to preserve the boundary around untrusted execution.

### Verdicts

- **Accepted — Default key custody exposes approval authority to verification code:** Guided mode now creates no private key and never reads or invokes one. It exports only a canonical payload, imports a detached signature from an external authority outside the BuildWorks host and verification identity, and requires a verification-process test that actually fails to read the former default private-key path.
- **Accepted — Guided run identity and selection are incomplete:** The plan now prompts for every run identity field when no persisted tuple exists, matches project, feature ID, slug, and change kind exactly, and defines design, identity-tuple, nonterminal-run, and terminal-run ambiguity behavior.
- **Accepted — The package contract fails and tests a different installation:** The plan now retains the stated checkout-linked `npm install --global <absolute-BuildWorks-checkout>` contract, removes the packed-artifact and `files` allowlist claims, and tests both Windows shims through that exact installation form from outside the checkout.
