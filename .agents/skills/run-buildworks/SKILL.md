---
name: run-buildworks
description: Run or inspect the BuildWorks CLI against a throwaway target repository, including free smoke checks, governed stage execution, failures, and costs. Use for operating bw, not for ordinary code changes. Delegates to the canonical .claude skill; a paid run requires explicit authorization.
---

# run-buildworks forwarding entry

Read `.claude/skills/run-buildworks/SKILL.md` from the repository root in full
and follow it. Use the canonical `.claude/skills/run-buildworks/driver.mjs`
and its adjacent design. Do not invoke this skill recursively.

This entry exists for hosts that discover `.agents/skills/` first. The adjacent
driver and design are retained legacy copies, not the editing or execution
source for this workflow. Do not change BuildWorks' Claude harness into Copilot
merely because Copilot is operating the CLI.

Preserve `.claude/sessions/project-learnings.md`. No paid run, operator
approval, or retained-target cleanup is authorized by loading this skill.
