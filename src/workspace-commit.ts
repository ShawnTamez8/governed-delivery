import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { removeIgnoredOutputInContainer, type FrozenSandbox } from "./container.ts";
import { gatePatchPaths } from "./implementation-gate.ts";
import { SYSTEM_NAME } from "./policy.ts";
import { normalizePath } from "./scope.ts";

/**
 * The boundary between an agent's workspace and the run branch
 * (docs/features/sandboxed-implementer/plan.md, Task 5), as host-side Git. An
 * agent changes files in the worktree through the tool server; nothing it
 * writes reaches the branch except the diff this module computes, gates and
 * commits as the system (hazard 15's guarantee, moved to the boundary).
 *
 * The caller has already proven the work container gone (`destroySandbox`'s
 * `workContainerGone`), so no writer can change the worktree while this runs.
 *
 * In order:
 * 1. HEAD must still be `base`; the agent's `.git` is read-only, so a moved
 *    head is a boundary failure, kept as evidence rather than reset.
 * 2. Ignored output is removed from inside a container (hazard 22: the Linux
 *    symlinks a package manager leaves on the bind mount cannot be opened from
 *    Windows).
 * 3. Every frozen derived path the agent changed returns to its state at
 *    `base`, restored when `base` holds it and removed when it does not; the
 *    system regenerates it after the commit (operator, 2026-10-19).
 * 4. `git add -A`.
 * 5. The staged diff against `base`, NUL-delimited and with rename detection
 *    off, so a rename arrives as an add and a deletion. A deletion, a symlink
 *    (mode 120000), a nested repository (gitlink, mode 160000), a path under a
 *    protected directory and any path `gatePatchPaths` refuses are refused by
 *    name.
 * 6. An empty diff is "changed nothing".
 * 7. The system commits, then checks that the committed set equals the staged
 *    set.
 *
 * A refusal leaves the worktree reset to `base` and cleaned, so the branch
 * keeps only committed work; a refused diff is first kept as a commit outside
 * every branch, which the refusal names. Every Git call goes through one helper whose
 * failure names its argv, exit code and stderr tail; when the reset after a
 * refusal itself fails, both are reported, the refusal first.
 */

export interface WorkspaceCommitInput {
  worktreePath: string;
  base: string;
  scope: string[];
  slug: string;
  /** The run's frozen `verification.derived` paths. */
  derivedPaths: string[];
  /**
   * Directories (ending in `/`) no change may touch: the acceptance suite after
   * its author (docs/features/protected-acceptance-tests/plan.md, Task 7).
   */
  protectedPaths?: string[];
  sandbox: FrozenSandbox;
  message: string;
  onAudit: (action: "derived.discarded" | "workspace.refused", summary: string) => void;
}

export type WorkspaceCommitResult =
  | { ok: true; head: string; paths: string[]; ignoredRemoved: string[]; derivedDiscarded: string[] }
  | {
      ok: false;
      /** `refused`: the diff broke a rule; `empty`: it changed nothing; `failed`: Git, Docker or the head failed. */
      kind: "refused" | "empty" | "failed";
      reason: string;
      ignoredRemoved: string[];
      derivedDiscarded: string[];
    };

type GitResult = { ok: true; stdout: string } | { ok: false; detail: string };

/**
 * Turns off the target's Git hooks for one host-side call. A hook runs on the
 * host as the operator with BuildWorks' environment, and one that runs
 * repository content (a tracked `core.hooksPath`, a lint step) would run an
 * agent's change there, outside every container. A path holding no hook
 * disables them all, `post-commit` and `reference-transaction` included, which
 * `--no-verify` does not.
 */
export const NO_HOOKS = ["-c", "core.hooksPath=/dev/null"];

/**
 * Every Git call: line endings are pinned to LF for anything this module
 * writes back into the worktree (the run worktree is checked out LF), the
 * target's hooks are off (a hook runs on the host, and could run the agent's
 * just-written code there), and a failure names the argv, the exit code or
 * spawn error, and the stderr tail.
 */
function runGit(cwd: string, args: string[]): GitResult {
  const argv = ["-c", "core.autocrlf=false", "-c", "core.eol=lf", ...NO_HOOKS, ...args];
  const result = spawnSync("git", argv, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) {
    return { ok: false, detail: `git ${args.join(" ")} could not run in ${cwd}: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    const tail = stderr.length > 2000 ? stderr.slice(-2000) : stderr;
    return { ok: false, detail: `git ${args.join(" ")} failed (exit ${result.status}) in ${cwd}: ${tail || "no stderr"}` };
  }
  return { ok: true, stdout: result.stdout ?? "" };
}

/** The tracked, untracked, staged and matching-ignored entries; empty is clean. */
export function checkWorktreeClean(cwd: string): { ok: true } | { ok: false; entries: string[]; detail?: string } {
  const status = runGit(cwd, ["status", "--porcelain", "-z", "--untracked-files=all", "--ignored=matching"]);
  if (!status.ok) return { ok: false, entries: [], detail: status.detail };
  const entries = status.stdout.split("\0").filter((entry) => entry !== "");
  return entries.length === 0 ? { ok: true } : { ok: false, entries };
}

/** The paths of `git status --porcelain=v1 -z` entries whose status is `prefix` (`!!`, `??`), or every path. */
function statusPaths(stdout: string, prefix?: string): string[] {
  const fields = stdout.split("\0").filter((f) => f !== "");
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]!;
    const code = entry.slice(0, 2);
    if (prefix === undefined || code === prefix) paths.push(entry.slice(3).replace(/\/$/, ""));
    // A rename or copy entry carries its source as the next field.
    if (code[0] === "R" || code[0] === "C") i++;
  }
  return paths;
}

interface RawRecord {
  srcMode: string;
  dstMode: string;
  status: string;
  path: string;
}

/** `git diff --raw -z` records: `:<src> <dst> <srcsha> <dstsha> <status>\0<path>\0`, renames off. */
function parseRaw(stdout: string): RawRecord[] | string {
  const fields = stdout.split("\0");
  const records: RawRecord[] = [];
  for (let i = 0; i < fields.length; i++) {
    const header = fields[i]!;
    if (header === "") continue;
    const match = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*$/.exec(header);
    if (!match) return `cannot read the staged diff record ${JSON.stringify(header)}`;
    const path = fields[i + 1];
    if (path === undefined || path === "") return `the staged diff record ${JSON.stringify(header)} has no path`;
    records.push({ srcMode: match[1]!, dstMode: match[2]!, status: match[3]!, path });
    i++;
  }
  return records;
}

/** Put the worktree back at `base` with nothing untracked or ignored; the reason why not, or null. */
function resetTo(worktreePath: string, base: string, sandbox: FrozenSandbox): string | null {
  const hard = runGit(worktreePath, ["reset", "-q", "--hard", base]);
  if (!hard.ok) return hard.detail;
  const leftover = runGit(worktreePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"]);
  if (!leftover.ok) return leftover.detail;
  const paths = statusPaths(leftover.stdout);
  try {
    removeIgnoredOutputInContainer(sandbox, worktreePath, paths);
  } catch (err) {
    return `cannot remove what the agent left untracked (${paths.join(", ")}): ${(err as Error).message}`;
  }
  return null;
}

/**
 * Keep the staged, refused change as a commit on `base` under
 * `refs/buildworks/refused/<sha>`, outside every branch, because the reset that
 * follows destroys the only other copy (the tool log keeps byte counts, not
 * content). Returns the sentence the refusal carries.
 */
function keepRefused(worktreePath: string, base: string, message: string): string {
  const tree = runGit(worktreePath, ["write-tree"]);
  if (!tree.ok) return `keeping the refused change also failed: ${tree.detail}`;
  const commit = runGit(worktreePath, [
    "-c", `user.name=${SYSTEM_NAME}`,
    "-c", "user.email=buildworks@buildworks.invalid",
    "commit-tree", tree.stdout.trim(), "-p", base, "-m", `refused: ${message}`,
  ]);
  if (!commit.ok) return `keeping the refused change also failed: ${commit.detail}`;
  const sha = commit.stdout.trim();
  const ref = `refs/buildworks/refused/${sha}`;
  const kept = runGit(worktreePath, ["update-ref", ref, sha]);
  if (!kept.ok) return `keeping the refused change also failed: ${kept.detail}`;
  return `the refused change is kept as commit ${sha} (${ref})`;
}

/**
 * Throw away an agent's workspace changes the system will not commit (an
 * unusable self-review reply): the worktree returns to `base` and is cleaned,
 * and the discarded paths are named. Like `commitWorkspace`, it refuses when
 * the head moved, keeping the worktree as evidence.
 */
export function discardWorkspace(input: {
  worktreePath: string;
  base: string;
  sandbox: FrozenSandbox;
}): { ok: true; discarded: string[] } | { ok: false; reason: string } {
  const { worktreePath, base } = input;
  const head = runGit(worktreePath, ["rev-parse", "HEAD"]);
  if (!head.ok) return { ok: false, reason: `cannot read the worktree head: ${head.detail}` };
  if (head.stdout.trim() !== base) {
    return { ok: false, reason: `the worktree head moved from ${base} to ${head.stdout.trim()} while the agent ran; the worktree is kept as evidence` };
  }
  const status = runGit(worktreePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"]);
  if (!status.ok) return { ok: false, reason: status.detail };
  const discarded = [...new Set(statusPaths(status.stdout).map(normalizePath))].sort();
  const failure = resetTo(worktreePath, base, input.sandbox);
  return failure === null ? { ok: true, discarded } : { ok: false, reason: `cannot discard ${discarded.join(", ")}: ${failure}` };
}

export function commitWorkspace(input: WorkspaceCommitInput): WorkspaceCommitResult {
  const { worktreePath, base } = input;
  const ignoredRemoved: string[] = [];
  const derivedDiscarded: string[] = [];
  const git = (args: string[]) => runGit(worktreePath, args);

  const stop = (kind: "refused" | "empty" | "failed", reason: string, resetFirst = true): WorkspaceCommitResult => {
    let full = reason;
    if (resetFirst) {
      const resetFailure = resetTo(worktreePath, base, input.sandbox);
      if (resetFailure !== null) full = `${reason}; resetting the worktree to ${base} also failed: ${resetFailure}`;
    }
    if (kind !== "empty") input.onAudit("workspace.refused", full);
    return { ok: false, kind, reason: full, ignoredRemoved, derivedDiscarded };
  };

  // 1. The head.
  const head = git(["rev-parse", "HEAD"]);
  if (!head.ok) return stop("failed", `compute diff: cannot read the worktree head: ${head.detail}`, false);
  if (head.stdout.trim() !== base) {
    return stop("failed", `compute diff: the worktree head moved from ${base} to ${head.stdout.trim()} while the agent ran; the worktree is kept as evidence`, false);
  }

  // 2. Ignored output.
  const ignored = git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"]);
  if (!ignored.ok) return stop("failed", `remove ignored output: ${ignored.detail}`);
  const ignoredPaths = statusPaths(ignored.stdout, "!!");
  try {
    removeIgnoredOutputInContainer(input.sandbox, worktreePath, ignoredPaths);
  } catch (err) {
    return stop("failed", `remove ignored output (${ignoredPaths.join(", ")}): ${(err as Error).message}`);
  }
  ignoredRemoved.push(...ignoredPaths);

  // 3. Derived paths return to base.
  if (input.derivedPaths.length > 0) {
    const derived = input.derivedPaths.map(normalizePath);
    const changed = git(["--literal-pathspecs", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...derived]);
    if (!changed.ok) return stop("failed", `discard derived edits: ${changed.detail}`);
    const discarded: string[] = [];
    for (const path of [...new Set(statusPaths(changed.stdout).map(normalizePath))].filter((p) => derived.includes(p))) {
      const atBase = git(["--literal-pathspecs", "ls-tree", "-z", "--name-only", base, "--", path]);
      if (!atBase.ok) return stop("failed", `discard derived edits: ${atBase.detail}`);
      if (atBase.stdout.split("\0").some((p) => p === path)) {
        const restored = git(["--literal-pathspecs", "checkout", base, "--", path]);
        if (!restored.ok) return stop("failed", `discard derived edits: ${restored.detail}`);
        discarded.push(`${path} (restored to ${base})`);
      } else {
        try {
          rmSync(join(worktreePath, path), { force: true, recursive: true });
        } catch (err) {
          return stop("failed", `discard derived edits: cannot remove ${path}, which ${base} does not hold: ${(err as Error).message}`);
        }
        discarded.push(`${path} (removed; absent at ${base})`);
      }
    }
    if (discarded.length > 0) {
      derivedDiscarded.push(...discarded);
      input.onAudit("derived.discarded", `base=${base}; discarded ${discarded.join(", ")}`);
    }
  }

  // 4 and 5. Stage everything and read the diff, renames off.
  const added = git(["add", "-A"]);
  if (!added.ok) return stop("failed", `compute diff: ${added.detail}`);
  const raw = git(["diff", "--cached", "--raw", "--no-renames", "-z", base]);
  if (!raw.ok) return stop("failed", `compute diff: ${raw.detail}`);
  const records = parseRaw(raw.stdout);
  if (typeof records === "string") return stop("failed", `compute diff: ${records}`);
  const causes: string[] = [];
  for (const record of records) {
    if ((input.protectedPaths ?? []).some((dir) => normalizePath(record.path).startsWith(dir))) {
      causes.push(`changes ${record.path} in the acceptance suite: the system refuses agent edits to it`);
      continue;
    }
    if (record.status === "D") {
      causes.push(`deletes ${record.path}: the system refuses deletions, and a rename is a deletion`);
      continue;
    }
    if (record.dstMode === "120000") {
      causes.push(`makes ${record.path} a symbolic link: the system refuses links`);
      continue;
    }
    // Committed, a gitlink makes every later host `git status` recurse into
    // the nested repository and honour its agent-written config
    // (`core.fsmonitor` is a command), outside every container.
    if (record.dstMode === "160000") {
      causes.push(`makes ${record.path} a nested Git repository (a gitlink): the system refuses them`);
      continue;
    }
  }
  const gate = gatePatchPaths(records.map((r) => r.path), input.scope, input.slug);
  if (!gate.ok) causes.push(gate.reason);
  if (causes.length > 0) {
    return stop("refused", `the agent's changes were refused: ${causes.join("; ")}; ${keepRefused(worktreePath, base, input.message)}`);
  }

  // 6. Nothing changed.
  const paths = [...new Set(records.map((r) => normalizePath(r.path)))].sort();
  if (paths.length === 0) return stop("empty", "the agent changed nothing");

  // 7. Commit as the system and check the committed set.
  const committed = git([
    "-c", `user.name=${SYSTEM_NAME}`,
    "-c", "user.email=buildworks@buildworks.invalid",
    "commit", "-q", "-m", input.message,
  ]);
  if (!committed.ok) return stop("failed", `commit: ${committed.detail}`);
  const after = git(["rev-parse", "HEAD"]);
  if (!after.ok) return stop("failed", `commit: cannot read the new head: ${after.detail}`);
  const tree = git(["diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", base, after.stdout.trim()]);
  if (!tree.ok) return stop("failed", `commit: cannot read the committed set: ${tree.detail}`);
  const committedSet = [...new Set(tree.stdout.split("\0").filter((p) => p !== "").map(normalizePath))].sort();
  if (JSON.stringify(committedSet) !== JSON.stringify(paths)) {
    return stop("failed", `commit: the committed set ${committedSet.join(", ")} differs from the staged set ${paths.join(", ")}`);
  }
  return { ok: true, head: after.stdout.trim(), paths, ignoredRemoved, derivedDiscarded };
}
