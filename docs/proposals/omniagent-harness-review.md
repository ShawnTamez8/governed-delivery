# Review of the OmniAgent harness

## What this is

A record of a review of `https://github.com/YeQing17-2026/OmniAgent` (source
as of 2026-08-31), carried out alongside the
`docs/proposals/sssf-harness-review.md` entry. Notes only, no implementation,
nothing adopted. The record exists so the considered-and-rejected list is on
file when step-8/9 planning happens, and so the gap between the project's
security claims and its code is recorded once rather than rediscovered.

## What it is

A general-purpose chat agent: CLI, Web UI, and Feishu/Discord/Telegram
channels; memory, skills, and personalization that "self-evolve" during
interaction; an optional online-RL model-training pipeline; and a security
harness (`omniagent/security/`) around a single agent loop
(`omniagent/agents/reflexion.py`). Different domain from this repository: it
is a personal assistant, not a governed delivery pipeline. It is a young
project — 6 test files for 67 Python modules, and "More Tests" on its
roadmap.

## Does it solve this repository's issues? No

Its headline is a "four-layer dynamic security scanning" (LLM review →
policy engine → interactive approval → execution sandbox), described as
"unbypassable (industry-first)". What the code actually contains:

- `omniagent/security/` has exactly three modules — `policy.py`,
  `approval.py`, `audit.py`. **No sandbox exists anywhere in the tree.** The
  claimed fourth layer is unimplemented. This is the `docs/hazards.md`
  entry 15 class of claim — a declared containment with nothing behind it —
  from the very repository whose own README sells it.
- The policy engine is a tool-name allowlist with profiles
  (MINIMAL/CODING/FULL) and a per-tool `require_approval` list. That is the
  same surface the executor's `--tools`/`--disallowedTools` flags already
  provide at the invocation boundary, plus a per-call human approval prompt.
  Per-call approval cannot serve unattended governed stages; the run-level
  signature over a declared scope is the design that lets stages run, and
  this repository already has it.
- The Guardian agent (an LLM reviewing high-impact tool calls before
  execution) is LLM-judges-LLM pre-execution — the opposite of the
  deterministic-first stance every gate in this repository takes.
- `omniagent/security/audit.py` is a JSON event log: no hash chain, no
  recomputation, nothing that makes tampering detectable. This repository's
  audit chain and `verify-audit` are strictly stronger.
- Its own system prompt carries the trust boundary as prose: "Prioritize
  safety and human oversight over completion." This repository's correction
  exists because a prompt is not enforcement.

## Candidates worth carrying forward

One mechanism, ranked below the sssf entry's three but genuinely useful:

1. **Loop detection with corrective injection.** In `reflexion.py` every tool
   call is SHA-256-hashed; when the identical call repeats N times
   consecutively, the harness skips it and injects "[LOOP DETECTED] … This
   approach is not working. Try a different tool or different parameters."
   A sibling check does the same for an identical error string. The
   deterministic distinction it draws — "the model is still trying" versus
   "the model is looping" — maps onto the failure observed in the step-7
   smoke, where the plan gate blocked because the plan restated criteria
   without their `(traces to: …)` suffixes, and a repeat would have
   re-spent the round budget on the same failure. The transferable version
   is gate-level: when the same gate rejects the same artifact hash twice,
   audit it as a loop rather than as a second honest attempt. One
   comparison, no model involved. This repository's remediation rounds are
   already bounded (3, then a terminal block), so the value is not cost
   containment — it is naming the loop in the audit.

## Considered and rejected

- **Sentinel decomposition on repeated failures.** A planner agent rewrites
  a task into milestones when the agent fails repeatedly. Conflicts with the
  governed-delivery thesis: the operator authors the request, and the system
  does not rewrite it.
- **Per-call interactive approval.** Rejected by design — the run-level
  signature is the authorization unit; stages are unattended by definition.
- **Guardian LLM review before execution.** An LLM gate on an LLM's tool
  calls is a weaker control than the deterministic gates this repository
  builds, and costs tokens to run. Rejected.
- **Progressive context loading (L0/L1/L2).** Graduated loading of
  documents saves tokens but means the model binds to a partial view. The
  plan and spec must reach the implementer verbatim and complete — the
  prompt is the single source of truth for what the model binds to.
  Rejected for the document stages.
- **Skill self-evolution, proactive memory, personalization, online-RL
  brain-model evolution.** The agent rewrites its own skills and memory
  during interaction. Domain-foreign, and each one violates hard rule 6
  (config is frozen at run start) in a different way. Rejected.
- **The audit log as a model.** A JSON event list with no chain is a step
  backward from what this repository has. Rejected.
- **GPL-3.0 licensing.** Any code copied from this repository would impose
  GPL on the project; combined with the rule against importing patterns
  from other codebases, nothing is copied, only reviewed.

## What would settle it

Nothing is adopted before the step-9 stop. One fact, when the step-8/9
planning happens: whether any gate in the remediation path has ever rejected
the same artifact hash twice — if yes, the gate-level loop detector is a
small, deterministic addition to the audit; if no, the recorded rejection of
the mechanism stands, because it would be building for a failure that has
not occurred.

Related: `docs/proposals/sssf-harness-review.md` (the companion review,
whose same-session correction and mid-flight tracing candidates are the
stronger answers to the same problems), `docs/hazards.md` entry 15,
`ARCHITECTURE.md` section 12.
