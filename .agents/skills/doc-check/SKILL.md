---
name: doc-check
description: Check this repository's documentation against the source. Use before claiming a documentation change is consistent, after changing the schema, migrations, or stage sequence, when adding a document under docs/features/, or when ARCHITECTURE.md and the code appear to disagree. This is the project documentation skill that write-plan, implement-plan, and review-design defer to.
---

# doc-check

`CLAUDE.md` declares that `ARCHITECTURE.md` is the design. That rule was prose,
so documents could drift from the source anyway. `scripts/doc-check.mjs` is the
executable form of it.

```bash
npm run check:docs                       # the normal invocation
node scripts/doc-check.mjs --json        # machine-readable
node scripts/doc-check.mjs --only=paths  # one check; an unknown name lists them all
node scripts/doc-check.mjs --only=taskArtifacts # task-document policy only
```

Exit `0` clean, `1` a document is wrong, `2` the checker can no longer read the
source. If `node` does not resolve, report a PATH problem, not a checker failure.

The error messages name the file, line, and what to change. Read them directly —
the notes below cover only what they cannot tell you.

## Document tiers

The same sentence is correct in a plan written three steps ago and wrong in
`ARCHITECTURE.md`. Tier decides how hard the checker presses:

| Tier | Where | Treatment |
|---|---|---|
| `current` | `ARCHITECTURE.md`, `CLAUDE.md`, `README.md`, `docs/hazards.md` | every check; broken paths are errors |
| `reference` | `docs/proposals/**`, `.claude/skills/**` | paths must resolve; claims not treated as current-state |
| `historical` | `docs/features/**`, `.claude/sessions/**` | path findings are warnings only |

Historical documents are evidence of what was believed when written. **Never
edit one to make it true** — the reconciliation depends on the record.

The `taskArtifacts` policy applies across all tiers. The exact three historical
task documents and eleven bootstrap checklist plans named in the checker are
grandfathered evidence, not templates. A new `tasks.md` file or a new plan with
Markdown task checkboxes is always an error: task execution and completion
status belong in run-state database rows.

Adding a current-state document means adding it to `CURRENT_DOCS` in the script,
or it is silently held to the weaker reference standard.

## Derived facts and pins

- **Derived** — read from source at run time: the migrations, and everything
  parsed out of `ARCHITECTURE.md`. Source outranks the document, so when a
  migration and the document disagree, edit the document.
- **Pinned** — literal lists in the script (`PINNED_SEQUENCE`, `PINNED_DEFERRED`,
  `PINNED_TABLES`, `PINNED_CONSTRAINTS`). Nothing in `src/` enumerates the stage
  vocabulary — `stage.kind` carries no `CHECK` constraint — so these cannot be
  derived. They are tripwires: a deliberate change edits the document and the pin
  together.

**A pin is not evidence.** Do not describe one as verified against the source. If
a stage-kind enum ever lands in `src/`, derive from it and delete the pin.

A failing `constraints` check is usually a real regression in the migration, not
a documentation defect.

## Never satisfy the hazards check with filler

A document under `docs/features/` needs a `**Hazards considered:**` line naming
the entries weighed and how each bore on the work — or `none` with a reason.
Silence is the failure mode: an entry nobody consulted and an entry considered
and dismissed look identical afterwards.

## Exit 2 means fix the checker, not the docs

`derive()` parses `ARCHITECTURE.md` by heading and fence shape, and throws a
named error when a shape is gone. The message names both possibilities — renamed
heading or removed section — because the checker cannot tell them apart.

**Do not loosen a getter into something that can return a wrong-but-plausible
value.** Before this guard existed, renaming section 7 made the checker report a
documentation defect that did not exist, against a document that was correct.

## Adding a check

1. Derive the fact in `derive()`, throwing a named error if parsing fails. Add a
   pin only when nothing in the source enumerates it, and say so in a comment.
2. Add a function to `CHECKS`; it becomes `--only=`-selectable automatically.
3. Report against the file carrying the claim, with a line number.
4. **Confirm it fails before you fix the document.** A rule that never fires is
   not protecting anything.

Break-test against a scratchpad mirror, not the working tree. The checker anchors
to its own location, so a copy holding `ARCHITECTURE.md`, `src/migrations/`, and
the script runs identically and nothing needs restoring.

## Gotchas

- **Only root-anchored paths are checked.** A `./scope.ts` in prose is an import
  specifier relative to a source file, not a repository path. The plans are full
  of them.
- **`.governance/` is exempt** — gitignored run state, correctly absent.
- **Path warnings from historical documents are expected.** They are placeholder
  filenames used to illustrate a point, or real paths in another repository or a
  past state. Do not chase warnings to zero — that would mean editing history.
- **This file is reference tier.** A placeholder path written in backticks here
  is an error. Name such a path in prose instead — the check caught exactly that
  in this document's first draft.
- **The working tree is checked, not `HEAD`.** Correct: this repository routinely
  carries a large uncommitted tree.
- **Task artifacts are exact-allowlisted history.** Do not widen the allowlist
  by directory or glob. A deliberate migration of a historical file removes
  its exact entry; it does not create a broader exception.

Verify a documentation-only change with `npm run check:docs` and
`npm run typecheck`. The checker itself has no test suite; its verification is
the break-test above.
