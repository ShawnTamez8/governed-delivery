# Review of CC Switch

**Review date:** 2026-09-11

**Reviewed:** `https://github.com/farion1231/cc-switch` (README and user manual
at documentation version v3.16.0, release notes through v3.17.0), against the
question actually asked: can one tool remove the need to write per-harness
adapter code for Claude Code, Codex, and others?

**Hazards considered:** 10 (a relayed provider remaps aliases after the probe
and before the spend), 11 (a default installation that cannot complete a run —
ambient config is precisely how one machine's install stops matching another's),
12 (configuration divergence between targets, and its disposition "make the
effective configuration visible in status output", which candidate B implements
directly), and 15 (a declared sandbox is not an enforced one — cc-switch's MCP
and skills sync writes into the surfaces the executor command exists to
exclude). Hazard 2 does not bear: nothing here changes evidence retention.

## Conclusion

No. cc-switch's unit of abstraction is **the provider a tool talks to**, not
**the contract by which a tool is invoked**. Adopting it would leave every line
of per-harness adapter code identified in
`docs/proposals/2026-09-03-multi-harness-adapter-blast-radius-review.md` still
unwritten, and would add an unrecorded input to every governed dispatch.

Two ideas are worth carrying forward, both small, both independent of any
second harness, and both partial discharges of that review's MHA-07. They are
candidates A and B below. Everything else is rejected.

## What it is

A Tauri desktop application — React frontend, Rust backend, GUI and system
tray — that manages provider credentials and endpoints for eight CLI and
desktop tools (Claude Code, Claude Desktop, Codex, Gemini CLI, Grok Build,
OpenCode, OpenClaw, Hermes). Its store of record is SQLite at
`~/.cc-switch/cc-switch.db`; switching a provider writes that record into each
tool's own live configuration file — `~/.claude/settings.json` and
`~/.claude.json`, `~/.codex/config.toml`, `~/.gemini/settings.json` — with
atomic temp-file-and-rename writes, rotated backups, and backfill from the live
file when the active provider is edited.

Around that core it adds 50+ provider presets, unified MCP server management
with bidirectional per-app sync, prompt presets synced into `CLAUDE.md` and
`AGENTS.md`, one-click skill installation from GitHub repositories, a session
browser, a `ccswitch://` deep-link import protocol, cloud sync via
Dropbox/OneDrive/iCloud/WebDAV, and an optional local HTTP proxy performing
format conversion, failover, circuit breaking, and its own usage and cost
accounting against a configurable per-model pricing table.

It is a capable tool and none of this is criticism of it. It answers a
different question.

## What this repository already does

`src/harness.ts` holds the parts that are genuinely shared across any CLI
harness: a filtered child environment, the prompt written to stdin and closed,
an idle timer that resets on output, a separate absolute ceiling, a Windows
process-tree kill by full `taskkill` path, bounded stdout capture, and a
promise that resolves on every failure path so an attempt can be audited rather
than lost. `src/executor.ts` holds the one concrete definition.

The per-harness work is the two things cc-switch does not touch:

- **argv.** `CLAUDE_CODE.command` is fourteen argv tokens, most of them
  Claude-specific containment — `--restricted`, `--safe-mode`,
  `--tools Read,Glob,Grep`, `--disallowedTools`, `--permission-mode dontAsk`,
  `--strict-mcp-config`, `--no-session-persistence` — and `invokeHarness`
  appends `--model` to the end of that static array.
- **the envelope.** `parseEnvelope` runs `JSON.parse` once and reads `result`,
  `total_cost_usd`, `usage.input_tokens`, `usage.cache_read_input_tokens`, and
  `modelUsage`, deriving the effective model as the unique `modelUsage` entry
  whose input tokens match the top-level usage. Codex `--json` emits a JSONL
  event stream; that parser fails on every Codex dispatch regardless of how
  good the returned body is.

MHA-03 already names this as the real adapter seam. A provider switcher
reduces neither half by one line.

## Disposition of every candidate idea

| Idea | Disposition | Why |
|---|---|---|
| Provider endpoint and model as explicit named data, separate from the tool | **Carry forward** (candidate A) | This is the transferable insight. The repository's version is a frozen, hashed field, not a global file. |
| Effective configuration made visible before anything is spent | **Carry forward** (candidate B) | Hazard 12's stated disposition, and MHA-07's probe/invocation gap, already have a home in `doctor`. |
| Live config-file rewriting as the switching mechanism | Reject | Hard rule 6 freezes config at run start. A user-global file mutated by a tray click is the opposite mechanism, and Claude Code hot-switches without a restart. |
| Local format-conversion proxy | Reject for governed dispatch | It is the only way one harness reaches many model families, but `total_cost_usd` and the effective model would then come from a relay's pricing table and routing decision. Section 11 requires cost and model identity from the harness; this satisfies the letter and destroys the point. Hazard 10 also worsens: the alias resolved at run start is resolved by the relay. |
| Usage dashboard and cost accounting | Reject | The run store already owns queryable cost, measured per dispatch. A second accounting of the same spend is a source of disagreement, not information. |
| MCP, prompt, and skill sync into `CLAUDE.md` / `AGENTS.md` | Reject | `--strict-mcp-config`, `--no-session-persistence`, and the fixed tool inventory exist to exclude exactly these injection surfaces (hazard 15). A tool whose feature is writing into them is aimed at the boundary. |
| Managed CLI install / update / diagnose | Note only | MHA-11 wants a *supported standalone installation contract* with recorded probe and version evidence. A GUI that updates binaries underneath a frozen run is the wrong direction, but the observation that "the binary resolved" is not "the binary is the supported one" is the same observation. |
| Session browser, workspace editor, cloud sync, deep links | Out of scope | Machine-local developer convenience; no governed-run surface. |

## The risk of installing it alongside BuildWorks

This is the finding worth recording even though nothing is adopted.

`CLAUDE_CODE.sandbox.envPassthrough` passes `USERPROFILE` and `APPDATA` to the
child. The spawned `claude` binary therefore reads `~/.claude/settings.json`
today. That is the file cc-switch rewrites on every switch, and Claude Code is
the one tool its FAQ says hot-switches without a restart. A tray click between
dispatch 4 and dispatch 5 of a paid run would change the provider mid-run, with
nothing in the frozen profile, the audit chain, or `agent_run` recording that
anything changed. `requireFrozenBinding` would still pass: it compares the
executor definition, and the definition never mentioned the file.

Notably, `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` are *not* in the
passthrough list, so the environment-variable route into the child is already
closed. The file route is open.

Checked on this workstation on 2026-09-11: `~/.cc-switch` does not exist and no
`ANTHROPIC_*` variable is set. This is prevention, not a live defect, and it is
deliberately **not** added to `docs/hazards.md` — that file records failures
that have actually occurred and cost real money, and this one has not.

## Candidate A — the executor environment becomes frozen data

**Problem.** The executor definition declares which variable *names* reach the
child but nothing about their *values*. Every value is inherited from whatever
the operator's shell and home directory happened to hold at spawn time. Config
is frozen at run start except for the part that decides which provider answers.

**Shape.** Add `env: Record<string, string>` to `ExecutorDefinition` in
`src/executor.ts`, empty for `claude-code` today. In `invokeHarness`, build the
child environment from `envPassthrough` as now, then apply the literal map over
it, so the run's own declaration beats ambient state. That ordering is the
entire behavioural change.

**Why it is cheap.** `freezeProfile` in `src/profile.ts` serializes the whole
`ExecutorDefinition` into the profile, and `requireFrozenBinding` compares
canonical JSON of the entire definition rather than its id. The field is
therefore frozen, folded into the profile hash the approval signs, and enforced
at every dispatch construction site the moment it exists on the type. No new
plumbing, no migration, no new column.

**The constraint that matters.** Literals must be non-secret only — a base URL,
a region, a model alias. The profile is written to run state, hashed, and bound
into an approval a human reads; an API key must never enter it. Secrets keep
flowing by name through `envPassthrough`, and that list grows to include
`ANTHROPIC_AUTH_TOKEN` only if third-party endpoints are actually wanted.

**What it costs.** Adding a field changes the canonical JSON of every frozen
profile, so a run frozen before the change fails its binding check after it.
Hard rule 3 permits this — nothing has shipped — but it means the change lands
between runs, not during one.

**What must be edited with it.** Section 11's executor-definition YAML block
and its sandbox paragraph, because `doc-check` derives from `ARCHITECTURE.md`
and the block is the declared shape.

**Evidence required before calling it done.** Not "the code path looks right":
spawn a child that echoes the variable and confirm the literal arrives, then
change the literal against a frozen run and confirm the dispatch refuses by
name before any spend.

## Candidate B — `doctor` reports the environment the child will actually get

**Problem.** MHA-07 states that the probe and the invocation test different
environments. It is true of `doctor` too: `src/readiness.ts` calls
`probeExecutor(CLAUDE_CODE, { timeoutMs: 5000 })`, and `probeExecutor` uses
`spawnSync` with no `env` option, so it inherits the operator's full
interactive environment while `invokeHarness` constructs a filtered one.
Doctor can pass on configuration and credentials the real child never receives.
Its `current.executor` projection reports id, command, probe, and capabilities;
its `limitations` array already concedes that provider authentication,
entitlement, and quota go unchecked. That concession is the right place to
stop conceding.

**Shape.** Two changes in `src/readiness.ts`, both free — no dispatch, no
spend, and `--json` already exists:

1. Probe with the same filtered environment `invokeHarness` builds, so a pass
   means what it appears to mean.
2. Add an `ambient_provider_config` check that reports, without disclosing a
   secret: which `envPassthrough` names are present and a short hash of each
   value; whether `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, or
   `OPENAI_BASE_URL` are set; the existence and content hash of the CLI user
   configuration files reachable through the passed-through home variables; and
   the **resolved absolute path** of the probed executable, since MHA-11's
   extension-managed alpha build is exactly what a bare version string hides.

**What it is not.** Doctor reports; it never repairs, rewrites, or deletes
ambient configuration. A status surface that edits the thing it measures cannot
be trusted about it afterwards.

**Evidence required.** Set a base-URL override and modify a user config file,
and confirm doctor's output changes and names both. A check that never fires
is not protecting anything.

## Relationship to the multi-harness review

| Finding | Effect of A and B |
|---|---|
| MHA-07 (probe and invocation test different environments; probe happens at dispatch) | Partially discharged. B fixes the environment mismatch for the `doctor` path; A makes the environment a frozen declaration rather than ambient state, which is what makes a pre-run probe meaningful. Moving the probe into intake, before the run row exists, remains MHA-07's own work. |
| MHA-04 (run intake and agent binding must become executor-aware) | Shape-compatible and slightly easier. A establishes that per-run provider selection belongs in the frozen serializable definition, which is the same field MHA-04 wants a selected adapter written into. |
| MHA-08 (telemetry must be measured per adapter) | Supported. Candidate A's rejection of the relay proxy is the same argument: a declared field must come from harness-owned evidence, and an unreported field stays `null`. |
| MHA-11 (local availability is not an installation contract) | Supported. B's resolved-absolute-path and version reporting is the recording half of MHA-11's disposition. |
| MHA-01 (architecture sequencing needs a human decision) | Not affected and not bypassed. Neither candidate adds a harness, extracts an interface, changes the stage sequence, or touches the adapter seam — so neither is second-harness work arriving through the side door. Candidate A does change the frozen profile shape, which is a deliberate architecture edit and needs its own decision, just a much smaller one. |

## What is explicitly not proposed

No second harness, no adapter registry, no plugin discovery, no local proxy, no
GUI dependency, no new hazard entry, and no change to the stage sequence,
findings model, approval payload shape, verification, or delivery gate.
