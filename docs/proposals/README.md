# Proposals

Backlog. Features, enhancements, and defects that are not yet active work.

Markdown files, one per proposal. There is no enforced lifecycle and no status
field — nothing downstream depends on a proposal's state being accurate.

Promoting a proposal to active work is a move:

```
git mv docs/proposals/<name>.md docs/features/<slug>/design.md
```

Once it is active, its state is a query against the run store, not a field in a
document. See `ARCHITECTURE.md`, "Work intake and projections".

## Review records

Some entries are not buildable proposals but records of external-harness
reviews: what the reviewed system does, what this repository already does,
and the disposition of every candidate idea (carry forward, reject, defer)
against the hard rules. They are decision inputs for the step-8/9 planning,
not backlog items to promote. When a candidate inside one is chosen, write
its design as a new `docs/features/<slug>/design.md`; do not `git mv` a
review record as a whole.

- `sssf-harness-review.md` — same-session correction loops, mid-flight tracing, run-process registry
- `omniagent-harness-review.md` — gate-level loop detection
- `archon-harness-review.md` — greenfield decision, container containment pattern, read-back rule for step 8
- `spec-kit-harness-review.md` — coverage-gate reverse-direction check, stable criterion IDs with a single minting authority
