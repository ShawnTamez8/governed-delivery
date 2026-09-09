# Paid PowerShell chain

**Status:** completed

## Requested outcome and authorization

The operator authorized one fresh live paid chain from PowerShell before any
further doc-check or run-buildworks changes. Success means reaching and passing
code_review; the existing driver continues through delivery and audit validation
to establish the full outcome. No automatic paid retry, runtime correction,
skill update, or retained-target cleanup is authorized by this experiment.

## Baseline and approach

- Repository HEAD: `55b12b8`; the preceding skill-audit documentation changes
  remain uncommitted. No driver, design, or harness changes are part of this run.
- Outer shell: PowerShell 7.6.5. Node: v26.4.0. Native Claude Code:
  `C:\Users\tamezs\.local\bin\claude.exe`, version 2.1.263.
- The canonical driver uses `shell: false` for native commands. The harness
  likewise spawns Claude directly and sends the prompt on stdin. PowerShell is
  the launch shell, not an additional wrapper around each model invocation.
  The separate frozen npm verification command may still require a Windows shim.
- Use the unchanged web-calculator design and default claude-sonnet-5 model.
  Frozen code-review defaults: two specialists, at most two panels, high blocking
  severity. The driver has no dispatch-cap flag; no new numerical cap is claimed.
- Documented expected spend is roughly $1.25-$2.50, potentially more if the
  bounded remediation path executes. Raw provider envelopes and usage/cost are
  retained by BuildWorks; capture both driver output streams and process ancestry.
- The dispatch-free PowerShell smoke passed 13/13 on this host before spending.

## Paths

- Paid run root:
  `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\20260909-powershell-000531`
- Paid target: the `target` subdirectory of that root.
- Free smoke root:
  `C:\Users\tamezs\AppData\Local\Temp\1\bw-run-skill\20260909-powershell-000531-smoke`
- Driver transcript:
  `C:\Users\tamezs\.copilot\session-state\34ed61a4-310e-49b3-870a-3d6d586aed0f\files\paid-powershell-20260909.log`

## Source identity

SHA-256 before launch:

| File | SHA-256 |
|---|---|
| `.claude/skills/run-buildworks/driver.mjs` | FD393A46D5BA833B323747BC760616DC47BF40B79F0EAEB13D4C2E1CB2098C29 |
| `src/harness.ts` | 7DF2F3EE5E527ACC999D76379BD53A54D93795FD0235E726EC54A3F718224EF7 |
| `.claude/skills/run-buildworks/web-calculator-design.md` | 13B7742C3B6BB82153EBDBC429217436247593459316108A53734DF74B8CA3AA |

## Interpretation limits

One successful PowerShell-started run demonstrates that path works here; it
does not establish that cmd caused earlier failures. The retained September 7
diagnosis identified invalid provider JSON independently of the old shell wrapper.
No cmd-versus-PowerShell comparison or new wrapper is part of this experiment.
The frozen verification commands check only Node/npm versions, not calculator
behavior; reaching code review or delivery does not establish UI correctness.

## Result and running state

Launched exactly once through the PowerShell tool as detached shell
`paid-powershell-20260909`. Run 1 was created at `2026-09-09T05:08:01.322Z`.
An initial process snapshot confirmed the actual ancestry:

```text
pwsh.exe 30124
  node.exe 12364  (driver)
    node.exe 5988 (BuildWorks CLI)
      claude.exe 17916 (native model harness)
```

No cmd.exe or second PowerShell process sat between the CLI and Claude in that
snapshot. These PIDs are a captured observation, not permanent IDs. The driver
has now exited 0 and the observed processes no longer exist.

Run 1 completed at `2026-09-09T05:28:41.759Z`, about 20 minutes 40 seconds after
creation. It used 16 dispatches and cost **$2.4017376 ($2.40174 rounded)**.
All nine stages passed, delivery completed the run, audit verification returned
`chain valid`, and the driver reported `15/15 steps as expected`.

The code-review stage exercised the previously unobserved live remediation path:

1. The first full panel reported two actionable findings from the correctness
   specialist: stale calculator state after equals (high) and unrounded decimal
   results (medium). The security specialist returned no finding.
2. The frozen implementer patched both together in `src/calculator.js`.
   Its guarded commit was
   `d6fc36517779a3bf9eb714dd990b2990ea9cd49b`, replacing the initially verified
   `ac62d130935534db19d3e6101b202e4b1fe98b5f`.
3. Both frozen version commands passed against the patched commit.
4. The entire two-specialist panel reviewed that commit again and returned
   no findings. The final code-review gate passed.
5. Delivery confirmed all four signed artifacts were delivered:
   `index.html`, `src/calculator.js`, `src/styles.css`, and `src/theme.js`.

All three source hashes listed above remained identical after completion.
No additional skill, driver, harness, or application-source change was made
to obtain this outcome. No second chain was launched.

## Durable evidence

The committed-tier capture is
`test/fixtures/recorded/code-review-web-calculator-powershell-remediation-chain.json`.
It contains the run/stage rows, complete audit rows, review and delivery records,
all five code-review-stage provider results (including the remediation author),
and the two post-patch verification logs. Each provider capture identifies its
agent, dispatch timestamp, capture date, source raw hash, input hash, cost,
duration, and exactly which harness-envelope metadata fields were dropped.
Every result string is unchanged from the retained envelope; raw-file hashes
match the store's `agent_run.output_hash`.

The initial capture's post-write assertion compared SQLite's null-prototype
rows with ordinary objects parsed from JSON and rejected the prototype difference.
The saved data was already intact. A focused probe proved equal serialized values;
the capture check now compares the persistence representation, and it verified the
existing file against the same run without rewriting it or dispatching anything.
This was an evidence-tool assertion issue, not a paid-run failure.

## Remaining limits and disposition

This supplies live evidence for both specialized reviewers, an intermediate
high and medium finding, one remediation, post-patch frozen verification,
a clean second panel, and final delivery. It does not prove browser behavior:
the verification commands remain version probes and no manual UI check was made.
It also does not establish that cmd caused the older failures.

Retain the completed target, the free-smoke target, and all previously retained
targets. No paid-run process remains. Further skill changes, another paid run,
commit/push/merge, and cleanup require their own requested scope.
