# Stable criterion IDs — review

**Reviewed document:** `docs/features/stable-criterion-ids/design.md`
**Document type:** Feature and design
**Review date:** 2026-09-03
**Status:** reconciled
**Hazards considered:** 3 (prompted ID grammar), 4 (schema-derived evidence), 13 (spec-only obligation authority), 16 (no plan-minted upstream obligation), and 17 (deletion authorization remains out of scope)

---

## Summary

The design selects the correct boundary for the plan-coverage failure: the
approved specification owns criterion identity, and the plan gate compares IDs
in both directions. Two promises exceed the enforcement surfaces the document
keeps in scope, so the design needs a narrower and more explicit contract before
planning.

## Verdict

**Ready for planning after required changes.** The core document and gate
contract is sound, but criterion lifecycle enforcement and criterion-specific
review lineage require decisions that the current text contradicts or leaves
unbuildable.

## Critical issues — must fix before planning

No critical issues found.

## High-risk areas

**Risk:** Pre-approval ID stability has no authoritative history or permitted-removal rule

- **Why:** The Specification contract says deterministic validation enforces
  preservation, monotonic minting, retirement, and non-reuse across every
  specification revision. The same design excludes hazard 17's removal
  authorization and any persisted schema change. `writeSpecDoc` overwrites the
  projection, while `spec-stage.ts` holds only the current accepted content as
  structured state. The system can compare adjacent revisions, but it cannot
  decide whether a removed ID represents a valid deletion, an illicit
  renumbering, or a wording replacement without the removal contract this
  feature excludes.
- **Impact if ignored:** An implementer either invents a stage-local history
  mechanism and removal policy, weakens the promised deterministic guarantee to
  prompt compliance, or expands the feature into hazard 17. Each choice changes
  observable acceptance behavior.
- **Mitigation:** Define stability at the approved spec-to-plan boundary, where
  code enforces it exactly. Treat ID preservation during pre-approval model
  revisions as a stated prompt obligation and retained diagnostic, not a
  deterministic guarantee. Defer deterministic deletion, retirement, and
  cross-revision reuse enforcement with hazard 17.
- **Disposition:** Accepted. The reconciled design limits the hard guarantee to
  approved IDs consumed by planning and labels pre-approval continuity as an
  unenforced semantic boundary.

**Risk:** Existing location strings cannot enforce criterion-level lineage

- **Why:** The Review and reconciliation behavior section requires a finding's
  `location` and a decision's `changedLocations` to name `AC-###`. Current
  validation accepts any non-empty current-artifact location and any non-empty
  changed-location string. Code cannot determine whether a finding targets one
  criterion, and the design excludes a typed field or database contract that
  expresses that fact.
- **Impact if ignored:** Reviewers continue to emit section headings while the
  feature claims stable criterion lineage, or implementation adds an unplanned
  result and storage contract.
- **Mitigation:** Remove criterion-level review lineage from this feature's
  acceptance criteria and scope. Keep a prompt recommendation to cite an ID
  when useful, label it unenforced, and retain typed finding lineage as a
  separate design candidate.
- **Disposition:** Accepted. The reconciled design keeps ID citation as prompt
  guidance and excludes typed or mechanically enforced finding lineage.

## Medium and low concerns

- The ID grammar accepts `AC-000` and multiple encodings of the same numeric
  value, such as `AC-001` and `AC-0001`, while the design orders IDs
  numerically. Define one canonical positive-integer encoding: zero-pad values
  below 1000 to three digits and forbid extra leading zeroes.
  - **Disposition:** Accepted. The reconciled grammar permits one canonical
    positive-integer encoding.
- The compatibility section says old in-progress runs must start fresh but does
  not require the refusal to name the stale document shape and repair. Add an
  operator-visible diagnostic at each old-spec or old-plan read boundary so the
  no-compatibility decision produces an actionable failure instead of a generic
  parse error.
  - **Disposition:** Accepted. The reconciled failure contract names both the
    obsolete shape and the fresh-run repair only where code parses the
    document; already-gated opaque consumers continue without a compatibility
    parser.

## Missing and underspecified areas

No additional underspecified areas found.

## Suggested improvements

- State that focused parser and prompt tests enforce the document syntax.
  `scripts/doc-check.mjs` checks architecture, schema, hazards, task artifacts,
  and paths; a clean documentation check does not prove that model-output
  examples satisfy the parser.
  - **Disposition:** Accepted. The reconciled acceptance criteria distinguish
    parser and prompt tests from the documentation check.
