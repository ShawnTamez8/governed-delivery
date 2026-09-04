# Stable criterion IDs implementation plan — plan review

**Reviewed plan:** `docs/features/stable-criterion-ids/plan.md`
**Governing sources:** `docs/features/stable-criterion-ids/design.md`, `docs/features/stable-criterion-ids/2026-09-03-design-review.md`, `.claude/sessions/2026-09-03-debug-plan-coverage-gate-paraphrase-mismatch.md`, `ARCHITECTURE.md`, and `docs/hazards.md`
**Repository evidence:** `src/spec-doc.ts`, `src/plan-doc.ts`, `src/plan-gate.ts`, `src/plan-stage.ts`, `src/approval-stage.ts`, `src/reconciliation.ts`, `src/prompts.ts`, the two stage-emitter fixtures, focused tests, and `.claude/skills/run-buildworks/SKILL.md`
**Review date:** 2026-09-03
**Status:** reconciled
**Hazards considered:** 1-4 (model shape, retained evidence, prompts, and fixtures), 6-7 (scope fitness and no unchanged retry), 13-14 (obligation authority and review independence), and 16-17 (upstream routing and unchanged deletion gap)

---

## Summary

The plan covers the new document shapes, both coverage directions, every
existing plan checkpoint, the no-compatibility decision, realistic fixtures,
binding documentation, and real-harness evidence. Two bounded handoff gaps
still force an implementer to choose an unplanned contract or test seam.

## Verdict

**Ready for implementation after required revisions.** The implementation
direction is stable; the plan needs one explicit parse-failure discriminator and
one fixed recorded-envelope test target.

## Readiness assessment

- **Requirements coverage:** Material gaps — 10 of 11 acceptance criteria have
  concrete work and validation; the old-run repair lacks a buildable failure
  classification.
- **Executor handoff:** Revisions required — two `or` choices leave observable
  behavior and test ownership to the implementer.
- **Repository grounding:** Verified — the plan maps the direct consumers and
  distinguishes parsed boundaries from `src/implementation-stage.ts`'s opaque,
  hash-bound reads.
- **Validation:** Sufficient — focused baseline is 182 passing tests, and the
  plan includes red/green mutations, isolated full gates, free smoke, and a
  paid scratch run.
- **Security and operations:** Clear — the plan keeps paid execution in a
  scratch target, inspects retained output before tracking it, refuses to label
  sanitized bytes as raw, and requires separate review authorization.
- **Specialist rubrics:** Security — untrusted model documents cross deterministic
  gates into authoritative content writes; the plan preserves validation,
  scope, raw-output, and approval boundaries without a material security gap.

## Coverage exceptions

| Requirement(s) | Status | Material gap | Plan location | Required correction |
| --- | --- | --- | --- | --- |
| Compatibility and failure behavior; acceptance criterion 9 | Partial | The plan requires read boundaries to detect an obsolete prose shape but does not define a typed discriminator. | Task 2, step 4 | Add one explicit validation-failure code or structured flag and name the exact consumers that append the fresh-run repair. |

## Security and bad-practice assessment

- No material security or bad-practice findings. The plan rejects fallback
  parsing, unvaried paid retries, unsafe raw-output promotion, and direct runs
  against this repository.

## Material findings

### Medium — Obsolete-shape detection has no defined contract

- **Where:** Task 1's validation return changes and Task 2, step 4
- **Affected requirements:** Compatibility and failure behavior; acceptance
  criterion 9
- **Evidence:** `validateSpecDoc` currently returns only `{ ok: false, reason }`.
  Task 2 says `buildBinding` and `runPlanStage` append a repair “when criterion
  parsing reports the obsolete prose-only shape” without adding a stable code
  or flag. Matching error prose creates a second, brittle parser over the first
  parser's diagnostic.
- **Impact:** Two implementers can produce incompatible behavior: every invalid
  model document receives a misleading fresh-run message, or old-shape
  detection depends on an error string that later wording changes silently
  break.
- **Required plan change:** Define a structured validation-failure discriminator
  for the obsolete criterion shape, preserve the human-readable reason, and
  require only `buildBinding` and the initial `runPlanStage` spec read to append
  the fresh-run repair when that discriminator is present.
- **Disposition:** Accepted. Task 1 now defines
  `obsoleteCriterionShape?: true` only for retired prose-only criterion lines,
  and Task 2 names the two consumers and forbids reason-string matching.

### Medium — Recorded-envelope replay leaves test ownership unresolved

- **Where:** Task 5 Files and step 6
- **Affected requirements:** Real-output validation and hazard 4
- **Evidence:** The plan names `test/harness.test.ts` or
  `test/plan-doc.test.ts`. The existing recorded real-envelope seam is
  `parseEnvelope` in `test/harness.test.ts`; `test/plan-doc.test.ts` tests
  Markdown parsing and does not own harness envelopes.
- **Impact:** The executor must choose between manually decoding the envelope in
  the document test or adding a cross-contract replay in the established
  harness seam, which changes test coverage and ownership.
- **Required plan change:** Select `test/harness.test.ts`, parse the retained
  envelope through `parseEnvelope`, validate the returned `AgentResult`, then
  pass its plan content through `validatePlanDoc` and assert the criterion IDs.
- **Disposition:** Accepted. Task 5 now fixes ownership in
  `test/harness.test.ts` and names the complete `parseEnvelope` to
  `extractJsonBody` to `validateAgentResult` to `validatePlanDoc` chain.

## Material evidence limits

- The paid post-change envelope and independent review do not exist yet. The
  plan treats both as completion evidence rather than present facts, so this
  does not weaken the pre-execution verdict.
