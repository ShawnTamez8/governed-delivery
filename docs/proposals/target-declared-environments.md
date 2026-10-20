# Target-declared run environments

**Date:** 2026-10-19

**Status:** Proposal — non-binding. Nothing here is authorized or built. The
operator chose on 2026-10-19 to build change 1 of
`docs/proposals/sandboxed-delivery-rework.md` for Node/npm targets only, as
`docs/features/sandboxed-implementer/plan.md` states, while keeping it open to
the model below: "dont build the riskier option now. Continue with node-only
... but kept open to other stacks."

**Hazards considered:** 15 (each environment the target declares must be
contained and proven by breaking it, as the change 1 spike did), 21 (the
target's own verification needs become declared facts instead of surprises
after spend), 24 (derived files stay harness-owned in every ecosystem), and 13
(a declared dependency feed is no excuse for an undeclared dependency). The
others were weighed and not engaged.

## Why

The operator builds apps routinely across stacks: C#/.NET, Azure services,
Azure SQL, SQL Server, SQLite, React, Rust. Before change 1, verification ran on
the operator's machine and could use any tool installed there and reach anything
the machine could reach. Change 1 contains verification in one Node/npm image
with network access only to the npm registry. That is correct for every target
run so far: the spike ran crew-chatter's `npm ci`, typecheck, lint and build in
the container (`docs/features/sandboxed-implementer-spike/plan.md`). But it
narrows what BuildWorks can build. A .NET target has no SDK. An npm package that
compiles native code has no compiler. A test that needs a database has nothing to
connect to. Crew-chatter's run 6 on another machine stored data in Postgres
(hazard 23, finding #209).

## The model

1. **The repository declares its needs:** a build image, preparation commands,
   package feeds, supporting services, and verification commands.
2. **BuildWorks validates and freezes that environment.** It resolves image
   digests, checks prerequisites, and refuses unsupported requirements before
   paid work starts.
3. **BuildWorks creates the isolated environment.** It mounts the run's
   workspace, starts the run's disposable services, and grants only the approved
   network access and credentials.
4. **Implementation and independent verification use the same definition.**
   Verification starts fresh and reconstructs everything it needs.
5. **BuildWorks removes the temporary environment.** It keeps source changes and
   evidence, and removes processes, networks and disposable service data.

## Rules any build of this must keep

1. **The declaration is protected and frozen.** The environment file is a
   protected path, like `governed.yaml`, read at the run's starting commit and
   frozen with digests (hard rule 6). An agent cannot change the environment
   that judges it.
2. **The agent never controls Docker.** BuildWorks creates and removes services.
   No container is given the Docker socket. The change 1 spike proved the socket
   is not reachable from the work container.
3. **Each feed comes with its dependency approval.** Opening a package feed for
   an ecosystem also extends dependency approval to that ecosystem's manifests,
   in the same change. Today `src/dependency-policy.ts` reads only
   `package.json` and `src/spec-doc.ts` accepts only that manifest under
   `## Dependencies added`. A NuGet or crates.io feed opened without that would
   let an agent add a package nobody approved.
4. **Credentials are the exception, not the default.** A private-feed token
   inside the container sits where install scripts run. Each credential needs its
   own decision, scoped to one feed, and never a provider or cloud credential.
5. **BuildWorks gains no per-language code** beyond the dependency approval each
   ecosystem needs (hard rule 4). The target declares and BuildWorks enforces.
   That is the stance of `docs/proposals/toolchain-probe-and-stack-intent.md`.

## Risks, by step

| Step | Risk | Severity |
|---|---|---|
| Declared image | Target-supplied code builds the toolchain; mitigated by rule 1 | Low |
| Preparation commands | Run with network access before the agent; the same exposure `npm ci` has today | Low |
| Package feeds | Approval code per ecosystem (rule 3), about a week each; private-feed credentials (rule 4) | Medium |
| Supporting services (SQL Server, Postgres, the Azurite storage emulator) | Readiness checks, connection settings, test data and cleanup, all in BuildWorks; about one to two weeks | Low to medium |
| Real Azure services and Azure SQL | Not containers, so BuildWorks cannot dispose of them; they need cloud credentials and network routes into the sandbox, which change 1 exists to avoid | High |
| Fresh verification | Slower runs: services and images are rebuilt every time | Low |

The real-cloud row is the one that does not fit. The default should be to verify
against emulators or containers (SQL Server for Azure SQL, Azurite for Azure
Storage) and to leave real-cloud testing outside a run. That needs its own
decision when an Azure app arrives.

## What change 1 keeps open

`docs/features/sandboxed-implementer/plan.md` ("Scope: Node-only, kept open to
other stacks") makes four extension points requirements, each held by a test:

- the image is a frozen reference, not a BuildWorks assumption;
- network access is a frozen list of allowed hosts;
- the run's private network can take more members;
- the sandbox, tool server and boundary code hold no package-manager logic.

It also refuses an unsupported target at `new-run`, before any spend, by checking
that each verification command's program exists in the image. Adding a stack
then means building the parts of this model that stack needs, not rewriting
change 1.

## When to build it

When the first app whose stack the Node image cannot serve is ready to run. Size
the work to that app: image and feeds (about a week or more), dependency approval
for its ecosystem (about a week), services if it needs them (one to two weeks).
Each estimate is an inference, not a measurement. Designing every row before
there is an app to test against would be guesswork, and hard rule 4 forbids an
abstraction with one implementation.

Related: `docs/proposals/verification-containment.md`, `ARCHITECTURE.md`
sections 7, 17 and 24.
