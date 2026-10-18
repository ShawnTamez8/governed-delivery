# Whole-run replay

**Date:** 2026-10-18

**Status:** Proposal — the design change 9 of `docs/proposals/sandboxed-delivery-rework.md`
needs before a decision. Non-binding. Nothing here is authorized.

**Hazards considered:**
- 2: replay depends entirely on retained output. Its corpus is extracted into the
  repository with provenance, because `.governance/raw/` is machine-local and
  deleted by `driver.mjs clean`.
- 4: a corpus is recorded model output, never hand-written, so it satisfies hard
  rule 5. The design's own fidelity labels say when a replayed response was
  produced for a different prompt, so a replay cannot pass itself off as a
  measurement.
- 7: replay serves each recorded response once, at its recorded position. It never
  re-asks or varies anything, and it makes no provider call.
- 12: replay runs the current code with the current frozen configuration. The
  report names every input that differs from the recording, so a configuration
  difference is not misread as a behaviour change.
- 14 and 15: replay changes no trust boundary. It runs only against a scratch
  copy, under the same profile-rewrite mechanism the test suite already uses.
- 18: replay does not judge correctness; it only re-runs the deterministic code
  around recorded answers.
- Every other entry: none. Replay is test infrastructure; it changes no stage,
  gate, prompt, parser or limit.

## What this is

Change 9 promised that a change to BuildWorks' deterministic code (a validator,
gate, policy, rendering or stage sequence) could be run against past runs at no
provider cost. The first draft keyed each recorded response on `agent_run.input_hash`.
That does not work past a run's first commit
(`docs/features/derived-artifacts-and-dependency-policy/plan.md`, "Change 9 is not
in this plan"):
- `input_hash` is `sha256(prompt)`, and the prompt itself is not retained.
- System commit SHAs differ in every run, and later prompts embed them. A recorded
  patch's `baseCommit` must also equal the live branch head.
- Finding IDs are store-wide, and later prompts embed them.
- Any change that edits a prompt changes every later hash.

This document designs replay that works despite all four. It answers the
operator's request of 2026-10-18 to write the replay design.

## What a run retains today

Facts from the source, which the design builds on:

- **Each dispatch:**
  - an `agent_run` row (stage, agent, role, setting, requested model and effort,
    cost, `input_hash`, `output_hash`, `raw_output_ref`);
  - the full stdout stream under `.governance/raw/<run>/`, with a timestamped random
    name, capped at 64 MiB;
  - stderr in a sibling file when it is non-empty.
- **A failed dispatch** writes no `agent_run` row, only an `agent.dispatch.failed`
  audit event and an unlinked raw file.
- **A Decision-1 request:** an `agent_run` row with executor `systemone`, plus a raw
  file holding both the request and the response body (`src/narration-check.ts`).
- **The run's records:** the audit chain, findings and their reports and decisions,
  decision questions and answers, the approval, and the frozen profile under
  `.governance/profiles/<run>/`.
- **The run branch** `gov/<slug>/<run>`, with every system commit, retained in its
  worktree (`ARCHITECTURE.md` section 7).
- **Not retained:** the prompt text, and a failed dispatch's exit code.

On this machine, crew-chatter runs 1–4 are retained in full
(`C:\Repositories\testing-repos\crew-chatter`, raw output of 1.6–5.9 MB per run).
Run 3 is the only one that reaches implementation, verification and code review.

## Design

### 1. Replay runs the real CLI; only the provider is recorded

A replay creates a scratch copy of the recorded target at its starting commit and
runs the current BuildWorks CLI against it from `migrate` onward. Each model
dispatch and each Decision-1 request is answered from the recording, and
everything else runs for real. That covers every stage, gate, validator, patch
application, commit, verification command, approval check and audit event.

There is no seam in `src/`. `src/cli.ts` states that there is no executor injection
seam (hard rule 4), and the test suite already substitutes the provider by
rewriting the frozen profile's `executor` to run a Node script and re-hashing the
profile (`test/cli-operator.test.ts`, `test/spec-stage.test.ts`). Replay does the
same with a replay executor script. Decision-1 requests go to a loopback stand-in,
as `test/systemone-stand-in.ts` already serves recorded bodies.

### 2. The corpus

A new extraction script under `scripts/` builds one corpus per recorded run, read
only from the target's store, raw directory and git objects:

- **Dispatches**, in `agent_run.id` order, plus failed dispatches from their audit
  events. Each keeps its stage kind, agent, role, setting, model, effort,
  `input_hash`, and the stream reduced to its `result` line, or `structured_output`
  where the dispatch sent a schema. Partial-message chunks are dropped and the
  provenance says so. That reduces megabytes per run to the answers themselves.
- **Decision-1 requests:** criterion text and response body.
- **Operator inputs:** each decision answer, keyed by its finding's identity (section 4),
  and the approval's expiry window.
- **The frozen profile's settings**, so the replay run can be created with the same
  per-agent model and effort (`--model`, `--model-for`, `--effort-for`).
- **A git bundle** of the target at the starting commit and of the recorded run
  branch.
- **Recorded outcomes:** stage kinds and gate results in order, the run's terminal
  status, and every gate and refusal audit action with its summary.
- **Provenance:** run, target, capture date, the BuildWorks commit that produced the
  run, and what was dropped.

A corpus that a test or document depends on is committed under
`test/fixtures/recorded/`, as `CLAUDE.md` requires for load-bearing evidence. Others
stay local.

### 3. Matching a dispatch to its recorded response

The replay executor sees only the prompt (on stdin) and the argv. It computes a key
from the prompt itself:

- **Route:** the prompt's leading prefix (`SPEC_AUTHOR_PROMPT_PREFIX` and the others
  in `src/prompts.ts`), as `selectPromptRoute` in `test/fixtures/harness/emit-cli-run.mjs`
  already does.
- **Agent:** the `"agent": "<id>"` in the prompt's result example. Fourteen of the
  fifteen builders in `src/prompts.ts` carry one. The code-review reconciler's
  prompt does not, and its route alone identifies it, because it has one setting.
  A replay test pins which builders carry an agent ID, so a change to that list
  fails a test instead of silently mis-keying.
- **Ordinal:** the count of earlier dispatches with the same route and agent in this
  replay.

The recorded response with the same key is served. This tolerates concurrency:
code-review reviewers launch together, but each has its own agent ID. It also
tolerates the code-review reconciler's repeated identical calls, which differ only
by ordinal. A key with no recorded response is a **miss**. The executor exits non-zero
with `replay miss: <route> <agent> #<n>`, and the dispatch fails the way a real one
would. A failed recorded dispatch is replayed as its raw bytes with exit code 1; the
report labels this, because the true exit code was not retained.

### 4. Translating run-specific values

Two kinds of values differ between the recording and the replay, and each is
translated where it matters.

- **Commit SHAs in responses.** The only SHA a response must carry is `baseCommit`
  in a patch result (implementation phases, self-review, remediation), and it must
  equal the live head.
  - The executor runs with the worktree as its working directory, so it reads the
    replay's head with `git rev-parse HEAD`.
  - It first checks that the recorded `baseCommit` was the recorded proposal base at
    that point. The `base=` values of `implementation.phase.apply`,
    `implementation.selfreview.pass` and `code_review.remediation.pass` say what it
    was.
  - It then rewrites `baseCommit` to the replay head inside the parsed result. If
    the recorded value was not the recorded base, the response is served unchanged,
    and the applier's own refusal reproduces the original failure.
- **Finding IDs in responses.** Spec and plan reconciliations, the decision fold and
  the code-review reconciler return decisions keyed by `findingId`.
  - A finding's identity is its stage kind, round, intent key and location: the
    `finding` table's unique key (`stage_id, round, intent_key, location`), with the
    stage named by kind because stage IDs are store-wide too.
  - The executor reads the replay's store read-only (its path passed through a
    `REPLAY_*` variable added to the rewritten profile's `envPassthrough`, as tests
    add `EMIT_MODE`). It maps each recorded ID to the replay finding with the same
    identity and rewrites the field.
  - A recorded ID with no replay counterpart is left as it is, and the reconciler's
    own validation refuses it, as it would in a real run.

Rewriting is structural, on parsed JSON fields named by the result schemas. It never
substitutes inside text, because a model's prose can contain any number.

### 5. Fidelity labels

Every replayed dispatch is labelled, because a response served for a different
prompt is a hypothesis, not a measurement:

| Label | Meaning |
|---|---|
| `exact` | `sha256(replay prompt)` equals the recorded `input_hash` |
| `normalized` | The prompts differ only in mapped SHAs and finding IDs. Needs the recorded prompt (section 6) |
| `unverified` | Matched by key, but the recorded prompt is not retained, so equality cannot be checked |
| `drifted` | The recorded prompt is retained and differs after normalization. The report carries the diff |
| `miss` | No recorded response for the key |

Everything after the first `drifted` or `unverified` dispatch is counterfactual. The
report says so at that point, not in a footnote.

### 6. Retaining prompts from now on (the one change to `src/`)

`dispatchOnce` in `src/dispatch.ts` writes each prompt, before invocation, to a
content-addressed file named by its `input_hash` under `.governance/`. That is the
layout `ARCHITECTURE.md` section 20 already describes for oversize prompts. The
retention ceiling and the sensitivity rules for raw output (section 17) apply
unchanged. Runs recorded after this lands can reach `exact`, `normalized` and
`drifted`; earlier runs reach only `exact` and `unverified`. Normalization replaces
each SHA the two runs' branches pair by commit role (projections, phase *i*,
self-review, remediation round *r*, derived regeneration; read from the commit
messages with the run ID and base removed), and each finding ID by identity.

### 7. Operator inputs and the rest of the run

- **Decisions:** the replay driver answers each `decide` pause from the recorded
  answer for the finding with the same identity. A question with no recorded answer
  stops the replay at that pause, and the report names it.
- **Approval:** the driver signs with a key it generates, as
  `.claude/skills/run-buildworks/driver.mjs` does. The report labels the approval as
  a replay signature, never the operator's.
- **Verification commands** run for real, from the frozen profile. A command that
  needs the network still needs it.
- **Counterfactual configuration:** one option, a replacement `governed.yaml`
  committed on top of the recorded starting commit before `new-run`. It exists so
  changes like derived artifacts can be replayed, and the report names it as a
  changed input.

### 8. The report

Each replay writes a report beside its scratch target, and prints a summary. The
report contains:
- each dispatch's key, fidelity label and served response;
- each stage's gate result beside the recorded one;
- the **first divergence** (the first stage, gate or refusal whose outcome or audit
  action differs from the recording);
- the terminal status beside the recorded one.

Two uses follow:
- **Faithful mode** (no code change): every stage matches. That is the regression
  test of replay itself.
- **Counterfactual mode:** the first divergence is the answer to "what would this
  change have done to that run".

## What replay proves, and what it does not

- **Proves:** how the current deterministic code handles the recorded model outputs
  and operator inputs, end to end, through the real CLI.
- **Does not prove:** how a model would answer a changed prompt. Changes 2 and 10
  change prompts, so a replay of crew-chatter run 3 under them is counterfactual
  from the first spec dispatch. It still answers useful questions. Would run 3's
  recorded specification be refused for declaring `package-lock.json` once it is a
  derived file? Would its recorded plan pass `tasksNameScope`?
- **Does not replace** a paid run as the live test of a prompt change, or the
  focused recorded-response tests already in `test/`.

## Governance

Replay creates only scratch targets and stores, never touches a real target, and
never spends. Its approval key is generated for the replay and is never the
operator's. It adds no executor interface (hard rule 4), and its corpora are
recorded output (hard rule 5). The one `src/` change retains evidence; it gates
nothing. Retained prompts are as sensitive as retained raw output, and are
machine-local and ignored for the same reasons.

## Effort and risk

The proposal estimated 1.5–2 weeks for replay. This design is about 2.5–3.5 weeks:

| Part | Effort |
|---|---|
| Extraction script and corpus format | 3–4 days |
| Replay executor, matching and translation | 3–4 days |
| Replay driver, Decision-1 stand-in and report | 2–3 days |
| Prompt retention in `dispatchOnce` | 1 day |
| Faithful replay of crew-chatter run 3 as the acceptance test, with its corpus committed | 2–3 days |

The acceptance criterion is that a faithful replay of run 3 on unchanged code
reproduces every recorded gate result and run 3's `code_review.artifact.missing`
block, at no provider cost.

Risks:
- **Corpus size in the repository.** Reduced corpora are much smaller than the raw
  directories, but bundles and answers still add up. Commit only corpora a test
  depends on.
- **Matching fragility.** A change that adds or reorders dispatches of one route and
  agent shifts ordinals. The report then shows a miss or a drift at that point,
  rather than a silent mismatch, but the replay ends early.
- **Past runs stay `unverified`** after their first commit, because their prompts
  were never retained. Their counterfactual answers are useful, but they are not
  fidelity-checked.
- **Real verification commands** make a replay as slow as the run's own
  verification and as dependent on the network.

## Decisions for the operator

**Operator decision, 2026-10-18:** replay waits, and is reassessed after changes 2,
10 and 1 of the rework are built. Prompt retention (decision 2) waits with it.

1. Whether to build replay as designed, and when relative to the
   derived-artifacts and dependency-policy plan. That plan does not depend on
   replay.
2. Whether to retain prompts in `dispatchOnce` now, even if replay waits. It is
   about a day, and every run recorded before it lands stays `unverified` forever.
3. Which runs get committed corpora. The recommendation is crew-chatter run 3 only.

## Considered and rejected

- **Pinning commit dates and run IDs so SHAs repeat.** It would need clock and ID
  seams in the core, and runs already recorded were not pinned, so they would stay
  unreplayable.
- **Rebuilding past prompts from BuildWorks' source at the recorded commit.** That
  could verify old prompts by hash, but it needs every input reconstructed exactly,
  and the recorded store's finding IDs and SHAs embedded. It could be revisited
  for one important run.
- **Recording at the network layer.** The provider is reached through the `claude`
  subprocess, so there is no request in BuildWorks to intercept.
- **Replaying stage functions directly in tests.** The test suite already does this
  piecemeal. It does not exercise the CLI chain, the pauses or the run command's
  boundaries, which is where several recorded failures were.

Related: `docs/proposals/sandboxed-delivery-rework.md` (change 9);
`docs/features/derived-artifacts-and-dependency-policy/plan.md`;
`ARCHITECTURE.md` sections 11, 15, 17, 20 and 21; `src/dispatch.ts`;
`src/raw-output.ts`; `test/systemone-stand-in.ts`.
