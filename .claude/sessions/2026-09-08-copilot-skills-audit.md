# Copilot skill portability audit

**Status:** completed

## Requested outcome and boundary

Audit global Copilot skill metadata, structure, discovery, and workflow routing,
especially review-code, context-compaction, write-plan, implement-plan,
reconcile-findings, and review-design. Preserve this repository's canonical
Claude-directory learning record, doc-check, and run-buildworks. No application
runtime changes, paid runs, approvals, commits, or retained-target cleanup.

## Baseline and evidence

- The repository worktree was clean before this audit.
- Both global personal roots contain copied definitions. This session initially
  advertised several shared `.agents` definitions; a fresh CLI discovery used
  personal `.copilot` definitions. Do not rely on duplicate precedence.
- Project doc-check definitions in `.claude` and `.agents` were byte-identical,
  as were run-buildworks instructions, drivers, and design resources. No project
  `.Codex` skill directory exists. Fresh discovery chose `.agents`.
- The shared context-compaction skill prescribed a competing Codex learning file
  and invented memory layout; both compaction copies permitted moving durable
  facts out of the committed record. The user's explicit choice is to retain
  `.claude/sessions/project-learnings.md`.
- Planning defaults contradicted this repository's task-artifact prohibition.
  Code-review instructions prescribed index mutation, whole-file rollback, and
  non-Copilot commands. Review/reconciliation paths and handoffs also diverged.

## Approach and success criteria

Use one canonical global implementation for duplicate priority skills with
reversible local links, and explicit project skill forwarding to `.claude`.
Correct only evidenced portability and contract defects. Verify actual Copilot
discovery, metadata, referenced resources, and the existing documentation gate.
Invocation is contextual, not a hook: global workflows call doc-check; neither
doc-check nor the learning Markdown executes skills automatically.

## Priority changes

- All six priority skills now have canonical implementations under
  `C:\Users\tamezs\.copilot\skills`. Their corresponding shared
  `C:\Users\tamezs\.agents\skills` directories are Windows junctions to those
  implementations. They are not independent copies; edit the canonical file.
- Planning preserves full/fast-path behavior but no longer emits forbidden task
  artifacts or bypasses project checks. Implementation uses the real
  `review-code` skill and does not infer fast-path status from a missing task file.
- Review-code no longer stages the user's tree, uses whole-file git restoration,
  invents native review commands, or mistakes a mutation-induced failure for a
  defect in unchanged code.
- Review-design allows the tools needed to ground its findings, preserves prior
  review records, and resolves its real local resources. Reconciliation handles
  document findings only and never downgrades an Implemented plan.
- Context-compaction preserves the repository-selected learning record and keeps
  durable knowledge in the committed tier. Machine-local memory is optional.
- Project `.agents` skill entries now contain forwarding instructions instead of
  competing bodies. Run-buildworks' existing drivers and design files are
  unchanged; the `.claude` versions remain the execution/editing source.

## Auxiliary audit

The read-only auxiliary audit covered 13 definitions in full and parsed each
frontmatter with the already installed PyYAML. Two directory names disagreed
with their advertised skill names. Three entry files exceeded the recommended
500-line limit. Other findings concerned stale Codex output paths, unavailable
Superpowers and file-delivery tools, image CLI provider confusion, broken
resource references, and MVP templates conflicting with local task rules.
Those auxiliary corrections are applied without executing bundled generation or
cleanup scripts. Image assets, logs, and credential files are retained rather
than overwritten during deduplication.

- Renamed the personal Copilot requirement-checker directory to
  requirement-clarifier, and the shared requirement-generator directory to
  requirements-generator, preserving the existing advertised invocation names.
- Moved extensive guidance into `references\clarification-guide.md`,
  `references\debugging-workflow.md`, and `references\documentation-guide.md`
  in their respective skills. Their entry files now have 46, 62, and 60 lines;
  detailed guidance remains available on demand.
- Updated debugger, document-creator, requirements-generator, and
  evaluate-agent-platform to prefer repository-selected output conventions.
  MVP planning now respects feature-folder, status, hazard, task-state, and
  documentation-gate requirements.
- Executing-plans is an explicit legacy alias to implement-plan. Shared
  context-handoff forwards to the fuller Copilot definition.
- Corrected both imagegen definitions, CLI/prompt references, prompt templates,
  and maintainer READMEs. Resource resolution uses the loaded skill directory;
  image viewing/delivery uses available capabilities; Entra and standard OpenAI
  authentication and command syntax are distinguished. Kept the two asset stores
  separate because they contain different accumulated data.
- Corrected bundled-script paths for pipeline-waypoints, evaluator, and
  kill-jobs. Kill-jobs is explicitly Codex-only; it does not manage Copilot jobs.

## Correction to prior evidence

The previous learning record said doc-check never scans AGENTS or `.agents`.
Reading `checkPaths()` and its `markdownFiles()` caller showed that file discovery
is recursive; explicit lists classify document tiers rather than filter discovery.
The rooted-path regex is narrower than the file scan. The current learning
quick-reference and canonical skill now distinguish those mechanisms. No checker
behavior changed.

## Recovery

Both global roots were copied before edits to the current Copilot session's
`files\skills-backup` directory, under `personal-copilot` and `personal-agents`.
Absolute recovery root:
`C:\Users\tamezs\.copilot\session-state\34ed61a4-310e-49b3-870a-3d6d586aed0f\files\skills-backup`.
The original six shared priority directories also remain under
`replaced-priority-agents` there. To undo a junction, remove only the junction
entry, never its target, then move its original directory back. Restore other
global files selectively from their corresponding backup, accounting for the
two renamed requirement directories. No rollback has been needed.
Repository changes remain available as an uncommitted git diff.

## Validation and result

Both installed CLI versions 1.0.82 and 1.0.83 discover the six canonical personal
skills and two project forwarding entries. The six junctions resolve to identical
canonical bytes. The current session also loaded the corrected compaction body
through its shared junction. All 29 entry files across the two personal and two
project roots parse with PyYAML, have valid matching names and bounded nonempty
descriptions, and stay below 500 lines. Actual CLI discovery lists 17 personal
skills plus two project skills. Required referenced resources and corrected
reference fragments resolve.

Repository doc-check and typecheck pass; historical path warnings remain
non-blocking. BuildWorks source, tests, drivers, and design resources are unchanged.
No paid run, live image-provider call, cleanup, or workflow execution was performed.
This establishes format, discovery, local resource resolution, and instruction
consistency, not a guarantee of future model adherence or live-provider behavior.

## Operator continuation

Run `/skills reload` in existing Copilot sessions to refresh cached descriptions
and renamed locations. `/skills info doc-check` may still show the `.agents`
registration; its short body explicitly forwards to the authoritative `.claude`
skill. Windows junctions are local user setup, not repository-portable symlinks.
No commit, push, merge, or retained-target cleanup was requested.

## Authoritative references

- https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills
- https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
- https://agentskills.io/specification

Copilot documents project discovery under `.github`, `.claude`, and `.agents`,
and personal discovery under `.copilot` and `.agents`. Required frontmatter is
`name` plus `description`; a Markdown body contains the workflow. Agent Skills
specification requires directory/name agreement, names up to 64 characters and
descriptions up to 1024, and recommends bodies under 500 lines. Optional
`agents/openai.yaml` files are not Copilot registration and need not be deleted.
