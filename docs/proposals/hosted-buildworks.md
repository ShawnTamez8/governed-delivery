# Hosted BuildWorks: Azure-hosted controller, containerized agents, Foundry models

**Date:** 2026-10-23

**Status:** Proposal. It records the rework the operator asked about on 2026-10-23,
before any of it is planned. It is non-binding, and nothing here is authorized.
The operator has concurred with building change 8 part 1 (per-phase verification,
`docs/proposals/sandboxed-delivery-rework.md`) first. This proposal does not
change that order.

**Hazards considered:**
- 1: BuildWorks reads every patch-producing dispatch and every code reviewer's
  answer through `--json-schema` structured output. A Foundry deployment must be
  proven to return the same structured output before any stage depends on it.
  tech-story-builder found the route accepts structured output but that Sonnet
  judged worse with it on its prompts. The first Foundry run therefore compares
  decisions, not only parse rates.
- 2: a hosted controller keeps `.governance/raw/` and retained prompts on a
  server disk instead of the operator's workstation. Retention, access and
  deletion become an operations question, and the rule that load-bearing
  evidence is copied into `test/fixtures/recorded/` is unchanged.
- 8: the Windows launch code in `src/harness.ts` (native `claude.exe`, `taskkill`)
  stops being the production path once the agent session runs in a Linux
  container. It stays only while workstation runs are supported.
- 10: on Foundry a model is selected by its deployment name, and
  tech-story-builder observed a model swapped behind an existing deployment name
  failing for about four minutes. Deployment names resolve at run start and are
  frozen, and the effective model each dispatch reports is recorded against that.
- 11: a hosted controller that cannot reach Foundry, GitHub or its container
  runtime must refuse at `new-run`, before spend, as `doctor` does today for
  Docker and the `claude` binary.
- 12: workstation and hosted runs would freeze different provider settings for
  the same target. The frozen profile records the provider, the deployment names
  and the credential kind (never the credential), so a difference between two
  runs is visible rather than misread as a behaviour change.
- 14 and 15: moving the agent session into a container strengthens section 17's
  stated limitation ("the agent session itself runs on the host"). It must not
  weaken the tool-server boundary: the agent container gets no Docker socket and
  no network route except to the model endpoint and the tool server.
- 19: model calls from Azure to Foundry change latency, not the inactivity
  budget's meaning. The frozen 1800-second idle budget is unchanged.
- Every other entry: none. This proposal changes where BuildWorks runs and who
  operates it, not any stage, gate, prompt, parser or limit.

## What this is

The operator asked (2026-10-23) what it would take for BuildWorks to stop running
on each developer's workstation and run in Azure instead. Claude Code would run
in containers and call Claude models deployed in Microsoft Foundry. It would no
longer depend on a developer's personal Claude Code sign-in. The shape the
operator described:

```
Browser -> Azure-hosted BuildWorks -> isolated Claude/work containers -> Foundry models
```

| Layer | Role |
|---|---|
| Host | Runs containers in Azure and provides CPU, memory, disk and networking (a resource group, a Docker host or Kubernetes) |
| BuildWorks controller | Advances stages, checks approvals, records results and manages work |
| Agent sessions | Run Claude Code, call models and use tools to perform assigned work |
| Cloud models | Generate responses through Foundry, remotely |

The operator's answers on the same day:
- Every Claude model is available in the organization's Foundry; tech-story-builder
  already uses Sonnet 5.5 there.
- Multiple users, eventually.
- Delivery goes to a GitHub repository.

## What already makes this easier

The rework proposal required each dependency to be confined to one module
(`docs/proposals/sandboxed-delivery-rework.md`, "Each dependency confined to one
module"). That rule is what keeps this move bounded:
- Docker is called only from `src/container.ts`.
- Claude Code's invocation, flags, stream parsing, cost telemetry and structured
  output live only in `src/harness.ts` and `src/executor.ts`.
- Provider selection and credentials reach Claude Code only through the frozen
  environment passthrough (`src/executor.ts`, `envPassthrough`). So switching
  provider is a change of environment, not of code paths.
- The tool server is plain MCP and agent-neutral (`src/tool-server.ts`).

Unchanged by a hosted deployment: every stage, gate, validator and prompt; the
store schema; the audit chain; the delivery check. Dashboard approval also fits
as it is. The operator's browser signs the canonical payload and sends only the
detached signature (section 17), so the hosted controller never holds an approval
key. That is stricter than today, where an agent session runs as the same user
that holds the key file.

The rework proposal's open question on seat use is also relevant. Claude Code's
legal page says subscription sign-in "is designed to support ordinary use of
Claude Code". It says products and services should authenticate through the
Claude Console or a supported cloud provider. A shared, hosted BuildWorks is that
case, and Foundry is a supported cloud provider.

## Facts the design rests on

These come from Claude Code's documentation, summarized on 2026-10-23 and not yet
proven by a run:
- https://code.claude.com/docs/en/microsoft-foundry.md
- https://code.claude.com/docs/en/env-vars.md
- https://code.claude.com/docs/en/headless.md
- https://code.claude.com/docs/en/model-config.md
- https://code.claude.com/docs/en/network-config.md
- https://code.claude.com/docs/en/devcontainer.md

**Provider selection.** `CLAUDE_CODE_USE_FOUNDRY=1`, plus
`ANTHROPIC_FOUNDRY_RESOURCE` (the resource name) or `ANTHROPIC_FOUNDRY_BASE_URL`.
No Claude Code account sign-in is needed.

**Authentication.**
- An API key in `ANTHROPIC_FOUNDRY_API_KEY`.
- A bearer token in `ANTHROPIC_FOUNDRY_AUTH_TOKEN`.
- Microsoft Entra ID through the Azure SDK's default credential chain, when
  neither of the above is set.

The documented inference roles are Azure AI User or Cognitive Services User. The
documentation does not list which credential sources the chain uses inside a
container.

**Models.** `--model` takes the Foundry deployment name. The variables
`ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL` and
`ANTHROPIC_DEFAULT_HAIKU_MODEL` pin the aliases.

**Cost.** `total_cost_usd` in the result line is a client-side estimate from a
bundled price table. The bill comes from Azure Cost Management.

**Flags.** `--json-schema`, `--mcp-config`, `--strict-mcp-config`,
`--max-budget-usd` and `--effort` are documented with no Foundry exclusion.
Features that need a claude.ai subscription are unavailable.

**Network.** Model and authentication traffic goes to the Foundry endpoint.
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` turns off updates, telemetry, error
reporting and feature-flag fetches. The hostname of the Entra token endpoint is
not documented.

## Evidence from the organization's own repositories

The operator named three repositories that already solve parts of this:
tech-story-builder, alm-workbench and agent-cortex-axel, under
`C:\Repositories\apllied-ai\projects\`. They were surveyed read-only on
2026-10-23, and the claims below were spot-checked against their code.
This repository's working rule against importing patterns from other codebases
still applies. They are evidence of what works in the organization's tenant, not
designs to copy.

What they show works:
- **GitHub to Azure deployment** over OIDC federated credentials on a
  user-assigned identity, with no secrets, on the organization's self-hosted ARC
  runners. All three do this. tech-story-builder's deploy-identity request
  (C:\Repositories\apllied-ai\projects\tech-story-builder\.claude\sessions\2026-10-08-deploy-identity-request.md)
  shows the organizational constraint: IT, not developers, creates managed
  identities and role assignments, and the first deploy failed until IT added the
  federated credential.
- **Keyless managed identity to Azure services.** agent-cortex-axel selects
  `ManagedIdentityCredential` with a user-assigned identity per tier, and grants
  roles out of band from its infrastructure code.
- **Multi-user Entra sign-in** with MSAL in the browser and JWT scope
  validation in the backend. tech-story-builder has the minimal form, and
  agent-cortex-axel has a closed-by-default fallback policy.
- **Restricted egress** through VNet integration, route-all and a NAT gateway
  static IP (agent-cortex-axel).
- **Postgres with managed-identity tokens** (alm-workbench).
- **Claude Sonnet 5.5 on Foundry's Anthropic route**
  (`/anthropic/v1/messages`, tech-story-builder).

What none of them shows:
- **Keyless Entra access to a Claude deployment.** tech-story-builder calls Claude
  with a shared API key held as a Key Vault reference, and its security review
  lists moving to managed identity as still to do. agent-cortex-axel's only
  Foundry role is Foundry Agent Consumer, for a `gpt-5-mini` agent; whether that
  role covers direct model inference is unchecked.
- **Containers of any kind in Azure.** All three deploy code packages to App
  Service. None has an image registry, Container Apps, AKS, Container Apps Jobs,
  or a Dockerfile for the hosted app.
- **The Claude Code CLI, the Claude Agent SDK or `CLAUDE_CODE_USE_FOUNDRY`.**
- **Any Git clone, push or pull-request creation.**

## The rework, layer by layer

Estimates are engineer-weeks and are judgments, not measurements.

### 1. Models through Foundry (about 1 week)

- Add the Foundry variables to the frozen environment passthrough in
  `src/executor.ts`, which today lists only Windows host variables.
- The seeded models in `src/policy.ts` become Foundry deployment names, resolved
  and frozen at `new-run` (hazard 10). `--model-for` already lets a run override
  them.
- `doctor`'s ambient provider check (`src/doctor-diagnostics.ts`) reports provider
  variables as observed overrides. It must report a configured Foundry provider as
  the expected configuration instead.
- Record the provider and the credential kind in the frozen profile, and keep
  `total_cost_usd` labelled as the client-side estimate it already is.

This layer works on today's workstations too: an operator can point BuildWorks at
Foundry with an API key or `az login` before anything is hosted. One paid
web-calculator run proves it, and that run should compare judgments under
structured output (hazard 1), not only parse rates.

### 2. Agent sessions in containers (about 2 to 3 weeks)

Today `claude` runs on the host, reading the worktree with its Read, Glob and Grep
tools. The tool server is a stdio child of `claude` that reaches the work
container with `docker exec`. Moving the session into a container means:
- `src/harness.ts` starts an agent container instead of a host process.
- The agent container mounts the worktree read-only for Read, Glob and Grep.
- Its only network exit is the egress proxy, whose allowlist gains the Foundry
  host and, for Entra, the token endpoint.
- The tool server moves out of the agent's process. Running it inside the agent
  container would need the Docker socket, which hands the agent the engine. It
  runs instead beside the controller and serves MCP over HTTP to that one
  container, under a credential issued per run. The rework proposal already
  states that a tool server credential is issued per run.

This closes the limitation section 17 records today. It is the "BuildWorks runs
the agent itself inside a container whose only reachable service is the tool
server" option the rework proposal names for agents that cannot confine
themselves. It can be built and tested on Docker Desktop before anything is
hosted.

### 3. A container runtime in Azure (the infrastructure decision)

`src/container.ts` drives the `docker` CLI with host bind mounts, an internal
network and a proxy container. App Service, where the organization's three apps
run, cannot start sandbox containers, and neither can Container Apps. Options:

| Option | Rework | Notes |
|---|---|---|
| Azure VM or VM scale set running Docker Engine, controller on the same host | `src/container.ts` unchanged | Least rework; one VM bounds concurrency |
| AKS | Rewrite `src/container.ts` for pods and jobs, worktree volumes, NetworkPolicy plus the proxy, Kubernetes exec (about 3 to 4 weeks) | Scales; the most new operations work |
| Container Apps Jobs or dynamic sessions | Unknown | Whether they support the mounts and network isolation the sandbox needs is unverified |

Recommended first: the Docker VM. Any option needs IT and landing-zone approval,
because the organization's existing apps use none of them.

### 4. Repositories, state and delivery (about 1 to 2 weeks)

- **Clone.** A target is a local Git worktree today. A hosted controller clones
  from GitHub, preferably through a GitHub App installed on the organization
  rather than a personal access token.
- **Store.** `.governance/` (the `node:sqlite` store, the `wx` writer lock in
  `src/lock.ts`, worktrees and raw output) stays inside each clone on a managed
  disk. SQLite is not put on an Azure Files share, whose network locking it cannot
  rely on. One controller instance keeps the store as it is. Moving the store to
  Postgres is needed only for more than one controller instance, and would rewrite
  `src/store.ts`.
- **Delivery.** The delivered branch is pushed back to GitHub, and probably opened
  as a pull request. Both are outside today's scope. Section 24 lists pull-request
  creation as a non-goal, and `CLAUDE.md` says "No packed artifact, GitHub
  integration, or remote publication is implied".

### 5. The web controller as the single authority (about 4 to 8 weeks)

Today every mutation goes through the CLI. The dashboard binds to `127.0.0.1`
(`src/dashboard-server.ts`), authenticates with a token in the URL fragment, and
writes only approval signatures and decision answers. Starting runs and
consenting to paid ranges from a browser, for several users, needs:
- **A replacement decision under hard rule 2.** The rule keeps the CLI "the only
  mutating surface until an explicit replacement decision". It also excludes "RPC
  service, remote dashboard" by name. It requires that interactive dashboard
  mutation "retires or narrows the CLI mutation path rather than allowing two
  authorities to drift". So the controller must become the one authority, not sit
  beside the CLI.
- **Entra sign-in, TLS and authorization:** who may create a run, consent to
  spend, approve, or answer a decision, per project.
- **User identity in audit records.** Today the operator is implicit.
- **Web forms for guided mode,** with separate consent for each paid range.
- **Token validation in Node.** BuildWorks has no runtime dependencies, so
  validating Entra tokens means either a first dependency or hand-written JWKS
  validation over `node:crypto`.

## Recorded decisions this reverses

- **Hard rule 2** and its 2026-09-12, 2026-09-26 and 2026-09-27 authorizations:
  the CLI is the only mutating surface; there is no RPC service or remote
  dashboard; and a loopback-only dashboard's only writes are an approval and a
  decision answer.
- **Section 24's non-goals:** multiple delivery surfaces and pull-request
  creation, and possibly cross-machine resume.
- **The 2026-10-18 operator answers in the rework proposal:**
  - BuildWorks runs on the operator's own workstation;
  - each developer holds their own Claude Code seat;
  - no credential belongs to BuildWorks.

  With Foundry, BuildWorks holds a credential: a Key Vault secret, or none at all
  under a managed identity.
- **Section 11's launch description** and the Windows harness launch. They become
  the workstation path, secondary to a Linux service.
- **The PowerShell operator guide** in `README.md` and
  `docs/runbooks/cli-operator.md`. It stays for workstation runs and gains a
  hosted counterpart.

## Sequencing

Each step is useful by itself and is authorized separately:
1. Change 8 part 1, per-phase verification. Already agreed; independent of this
   proposal.
2. Foundry on the workstation (layer 1), proven by one paid run.
3. Agent sessions in containers (layer 2), on Docker Desktop.
4. BuildWorks on an Azure Docker VM, still operated through the CLI, with the
   dashboard behind Entra sign-in (layers 3 and 4).
5. The web controller as the single authority (layer 5), after the hard rule 2
   replacement decision.
6. AKS, only if one VM is not enough.

Roughly 9 to 15 engineer-weeks to step 5, plus 3 to 4 for AKS. Lead time for IT
requests sits outside those figures, and tech-story-builder's history shows it can
take more than one round.

## IT and organization requests

- A user-assigned managed identity for the controller, with an inference role on
  the Foundry resource (Azure AI User or Cognitive Services User), and Opus 5.5,
  Sonnet 5.5 and Haiku 5.5 deployments with agreed names.
- A GitHub OIDC federated credential for BuildWorks' own deployment.
- The compute choice and its network: Docker VM or AKS, VNet, egress rules that
  admit Foundry, the Entra token endpoint, GitHub and the npm registry.
- A GitHub App on the organization for clone, push and pull request.
- An Entra app registration for user sign-in, and who maps users to projects.

## Open questions

- Which credential source Claude Code's Entra chain uses inside a container
  (managed identity or workload identity), and the token endpoint's hostname for
  the egress allowlist.
- Whether Foundry Agent Consumer covers direct inference, or a separate role is
  needed.
- Whether structured output on the Foundry deployments keeps the code reviewers'
  and implementer's judgment, measured as tech-story-builder measured it.
- Who the users are at first, and how projects map to them.
- Whether delivery ends at a pushed branch or a pull request.

## Decisions for the operator

1. Whether to plan layer 1, Foundry on the workstation, after change 8 part 1.
2. The Azure compute option for layer 3.
3. The hard rule 2 replacement decision for layer 5, and the section 24 reversals.
4. Who raises the IT requests above, and when.
