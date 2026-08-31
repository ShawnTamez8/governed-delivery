# Contain verification commands

## The gap

The `verification` stage runs commands the implementer's own changes can
influence — the repository's test suite, its typecheck, its documentation
checker. Step 7 gave those commands a named environment passthrough
(`VERIFY_ENV_PASSTHROUGH`, frozen per run), which is what keeps
`BW_APPROVAL_PUBLIC_KEY` out of their reach. Nothing else contains them.

Concretely, today a verification command:

- runs with the run's worktree as its working directory, but can read and
  write anywhere the operator's own account can — including `.governance/`,
  which holds the run store, the frozen profiles, and the audit chain, all
  reachable by relative path from the worktree;
- reaches the network, because there is no network policy to apply
  (`sandbox.network` is `"inherit"` for the executor too);
- runs for up to the frozen per-command ceiling with no CPU or memory bound.

`ARCHITECTURE.md` section 17 states this as a limitation rather than claiming
isolation the code does not provide. This proposal is the record that it is
work rather than an accepted end state.

## Why it was not built in step 7

The repository has no sandboxing mechanism to reuse. Inventing one is a larger
piece of work than the verification stage itself, and every option below
changes what "the run's environment" means for the executor as well — so
building one under step 7 would have committed the design to a mechanism
chosen for one caller.

## Options, roughly in increasing order of cost

- **Deny by path.** Refuse to start a command whose working directory is not
  the worktree, and make `.governance/` unreadable to it. On Windows this is
  an ACL change on a directory the system owns; on POSIX it is a mode change.
  Cheap, and it closes the one reachable path that matters most (the run
  store). It does nothing about the network or the rest of the filesystem.
- **Run commands as a separate low-privilege account.** Real containment for
  the filesystem, and the first option that makes "the command cannot reach
  the audit chain" a property of the OS rather than of a check. Costs an
  account-provisioning step in the repository contract, which today needs only
  git and a shell.
- **Run commands in a container.** Filesystem, network, CPU, and memory bounds
  in one mechanism, and a per-run image is a natural place to freeze the
  toolchain as well. Adds a hard dependency the system does not currently
  have, and makes the repository contract much heavier.

## What would settle it

The choice depends on a fact not yet established: whether the intended
deployment runs verification on the operator's own machine or on a dedicated
one. The first two options are adequate for a dedicated machine; only the
third is adequate for a shared developer workstation running untrusted
changes.

Related: `ARCHITECTURE.md` sections 6 (trust boundaries), 11 (the executor
definition's `sandbox` block, which already carries `allowedPaths`,
`deniedPaths`, and `network` fields that nothing enforces), and 17.
