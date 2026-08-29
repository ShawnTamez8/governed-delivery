---
name: doc-check
description: Verify ARCHITECTURE.md facts against the source (schema, stage sequence, paths). Run before claiming a documentation change is consistent.
---

# doc-check

Verify that `ARCHITECTURE.md` statements match the source.

1. Confirm the interpreter resolves in this environment: run `node --version`.
   If it does not resolve, report a PATH problem — do not report a checker
   failure.
2. Run from the repository root: `node scripts/doc-check.mjs`
3. Exit 0 means every asserted fact holds. On failure, report each failing
   line verbatim.
