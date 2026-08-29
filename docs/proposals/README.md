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
