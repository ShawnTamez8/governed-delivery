---
name: doc-check
description: Check this repository's documentation against source and enforce document layout, hazards, and task-artifact rules. Use when writing or reviewing project documents, reconciling findings, updating project learnings, or changing schema or stage sequence. Delegates to the canonical .claude skill.
---

# doc-check forwarding entry

Read `.claude/skills/doc-check/SKILL.md` from the repository root in full and
follow it. That file owns this workflow; this entry exists only for hosts that
discover `.agents/skills/` before `.claude/skills/`.

Do not invoke `doc-check` recursively or maintain a second workflow here.
The checker remains `scripts/doc-check.mjs`, invoked with `npm run check:docs`.
Keep session continuity in `.claude/sessions/project-learnings.md`.
