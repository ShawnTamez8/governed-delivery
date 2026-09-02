# Proposals

Backlog. Features, enhancements, and defects that are not yet active work.

Markdown files, one per proposal. There is no enforced lifecycle and no status
field — nothing downstream depends on a proposal's state being accurate.

## Proposals raised by a run

An upstream concern a review stage routes past the reviewed artifact (section
13) is stored as run state, not written here directly — no run writes into
this directory. Materializing one is a separate, explicit operator action:

```
bw proposal-export --proposal <id> [--name <slug>]
```

This writes `docs/proposals/<slug>.md` (derived from the proposal's title
when `--name` is omitted) and refuses to overwrite an existing file. The
stored proposal — its title, problem statement, why it is upstream, derived
route, source finding ids, and retained evidence — is inspectable through the
run store before export; the command only decides whether it belongs in the
backlog.

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
