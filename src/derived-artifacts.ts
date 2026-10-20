import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { removeIgnoredOutput } from "./commit-verification.ts";
import {
  ContainerError,
  execTarget,
  runInSandbox,
  unquiescedReason,
  withSandbox,
  type FrozenSandbox,
  type Sandbox,
} from "./container.ts";
import type { DerivedArtifact } from "./governed-config.ts";
import { checkWorktreeClean, NO_HOOKS } from "./workspace-commit.ts";
import { SYSTEM_NAME } from "./policy.ts";
import { normalizePath } from "./scope.ts";

export interface RegenerationInput {
  rootDir: string;
  worktreePath: string;
  runId: number;
  derived: DerivedArtifact[];
  /** The commit the caller just made; the worktree must be exactly there. */
  expectedHead: string;
  /** Where in the run this regeneration happens: `phase-1`, `self-review`, `remediation-1`. */
  label: string;
  evidenceDir: string;
  /** The run's frozen sandbox; the declared commands run in one container of it. */
  sandbox: FrozenSandbox;
  policy: {
    timeoutSeconds: number;
    maxBytes: number;
    retentionMaxBytes: number;
  };
  audit: (
    action:
      | "derived.commit"
      | "derived.unchanged"
      | "derived.fail"
      | "derived.refused"
      | "sandbox.failed"
      | "sandbox.quiescence.failed"
      | "sandbox.teardown.failed",
    summary: string
  ) => void;
}

export type RegenerationResult =
  | { ok: true; head: string; regenerated: string[] }
  | { ok: false; reason: string };

function runGit(
  args: string[],
  cwd: string
): { ok: true; stdout: string } | { ok: false; detail: string } {
  let result;
  try {
    // Hooks off: the regeneration commit runs after an agent's change is in HEAD.
    result = spawnSync("git", [...NO_HOOKS, ...args], { cwd, encoding: "utf8" });
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
  if (result.status !== 0) {
    const detail = (result.stderr ?? "").trim();
    return { ok: false, detail: detail || `git ${args[0]} exited with code ${result.status}` };
  }
  return { ok: true, stdout: result.stdout ?? "" };
}

/**
 * The tracked and untracked paths `git status --porcelain -z` reports, ignored
 * ones excluded. A rename or copy entry carries its original path as the next
 * field, and both count as changed.
 */
function changedPaths(porcelain: string): string[] {
  const fields = porcelain.split("\0").filter((f) => f !== "");
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]!;
    paths.push(normalizePath(entry.slice(3)));
    if (entry[0] === "R" || entry[0] === "C") {
      i++;
      if (i < fields.length) paths.push(normalizePath(fields[i]!));
    }
  }
  return paths;
}

/**
 * The `git diff` pathspec that leaves every derived path out, or nothing when
 * there are none. The self-review and code review describe the change with
 * it, so a regenerated lockfile of thousands of lines never reaches a review
 * prompt (hazard 18). It also narrows the changed paths a reviewer may place
 * a finding on: a reviewer that still cites a derived path fails
 * `validateCodeReviewReports`, the panel fails, and the stage blocks without a
 * review record. Before the exclusion that finding reached remediation, whose
 * patch to the derived path was refused as outside the signed scope, so the
 * run blocked either way.
 */
export function derivedPathExclusion(derived: readonly DerivedArtifact[]): string[] {
  if (derived.length === 0) return [];
  return ["--", ".", ...derived.map((d) => `:(exclude,literal)${normalizePath(d.path)}`)];
}

/**
 * Run each declared command in the sandbox, stopping at the first that fails.
 * Returns why regeneration failed, or null when every command passed. An exec
 * whose exit status cannot be read is a sandbox failure, never the command's.
 */
async function runDerivedCommands(input: RegenerationInput, sandbox: Sandbox): Promise<string | null> {
  for (const artifact of input.derived) {
    const evidencePath = join(input.evidenceDir, `${artifact.name}.log`);
    let outcome;
    try {
      outcome = await runInSandbox(
        execTarget(sandbox),
        sandbox.frozen.imageId,
        { name: artifact.name, command: artifact.command },
        {
          cwd: input.worktreePath,
          timeoutSeconds: input.policy.timeoutSeconds,
          maxBytes: input.policy.maxBytes,
          retentionMaxBytes: input.policy.retentionMaxBytes,
          evidencePath,
        }
      );
    } catch (err) {
      if (!(err instanceof ContainerError)) throw err;
      const reason = `derived artifact ${artifact.name} could not be run in sandbox ${sandbox.name}: ${err.message}`;
      input.audit("sandbox.failed", `label=${input.label}; ${reason}`);
      return reason;
    }
    let because: string | null = null;
    if (outcome.timedOut) {
      because = `the command exceeded the ${input.policy.timeoutSeconds}-second ceiling and its process tree was killed${outcome.killError !== null ? ` (the kill failed: ${outcome.killError})` : ""}`;
    } else if (outcome.outputOverflow) {
      because = `the command produced more than the ${input.policy.maxBytes}-byte output budget`;
    } else if (outcome.exitCode !== 0) {
      because = `the command exited with code ${outcome.exitCode}`;
    }
    if (because !== null) {
      const reason = `derived artifact ${artifact.name} could not be regenerated: ${because}`;
      input.audit(
        "derived.fail",
        `label=${input.label}; ${artifact.name}: ${artifact.command.join(" ")}; evidence=${relative(input.rootDir, evidencePath)}; ${reason}`
      );
      return reason;
    }
  }
  return null;
}

/**
 * Regenerate the files `governed.yaml` declares under `derived:` and commit
 * them. This is a system write under architecture section 7, not an agent
 * patch: the commands are the operator's, frozen at run start, and the scope
 * gate does not apply because no agent proposed the change. What the gate
 * would have protected is checked here instead: the commands may change only
 * the derived paths, and the tree must be clean before and after. The
 * commands run in one sandbox of the run's frozen image, and the tree is read
 * only after its work container is proven gone.
 *
 * Runs after every patch commit. An empty list runs nothing.
 */
export async function regenerateDerivedArtifacts(input: RegenerationInput): Promise<RegenerationResult> {
  const { worktreePath, derived, expectedHead, label, evidenceDir } = input;
  if (derived.length === 0) {
    return { ok: true, head: expectedHead, regenerated: [] };
  }
  const evidenceRef = relative(input.rootDir, evidenceDir);

  const head = runGit(["rev-parse", "HEAD"], worktreePath);
  if (!head.ok) {
    return { ok: false, reason: `cannot read the worktree head before regeneration: ${head.detail}` };
  }
  if (head.stdout.trim() !== expectedHead) {
    return {
      ok: false,
      reason: `the worktree head moved before regeneration: expected ${expectedHead}, found ${head.stdout.trim()}`,
    };
  }
  const before = checkWorktreeClean(worktreePath);
  if (!before.ok) {
    return {
      ok: false,
      reason: `the worktree is not clean before regeneration: ${before.detail ?? before.entries.slice(0, 3).join(", ")}`,
    };
  }

  mkdirSync(evidenceDir, { recursive: true });
  const run = await withSandbox(
    { frozen: input.sandbox, rootDir: input.rootDir, runId: input.runId, label: `derived-${label}`, worktreePath },
    (sandbox) => runDerivedCommands(input, sandbox)
  );
  if (!run.started) {
    const reason = `cannot start the derived-artifact sandbox: ${run.error.message}`;
    input.audit("sandbox.failed", `label=${label}; ${reason}`);
    return { ok: false, reason };
  }
  if (!run.teardown.workContainerGone) {
    const reason = unquiescedReason(run.sandbox, run.teardown, run.value);
    input.audit("sandbox.quiescence.failed", `label=${label}; ${reason}`);
    return { ok: false, reason };
  }
  if (run.teardown.failures.length > 0) {
    input.audit(
      "sandbox.teardown.failed",
      `label=${label}; sandbox ${run.sandbox.name} left objects behind: ${run.teardown.failures.join("; ")}`
    );
  }
  if (run.value !== null) return { ok: false, reason: run.value };

  const status = runGit(["status", "--porcelain", "-z", "--untracked-files=all"], worktreePath);
  if (!status.ok) {
    return { ok: false, reason: `cannot read the worktree state after regeneration: ${status.detail}` };
  }
  const derivedPaths = derived.map((d) => normalizePath(d.path));
  const changed = [...new Set(changedPaths(status.stdout))];
  const stray = changed.filter((path) => !derivedPaths.includes(path));
  if (stray.length > 0) {
    const reason = `the derived command(s) changed files that are not derived artifacts: ${stray.join(", ")}`;
    input.audit("derived.refused", `label=${label}; ${reason}; evidence=${evidenceRef}`);
    return { ok: false, reason };
  }

  let resultHead = expectedHead;
  if (changed.length > 0) {
    const add = runGit(["--literal-pathspecs", "add", "--", ...changed], worktreePath);
    if (!add.ok) {
      return { ok: false, reason: `cannot stage the regenerated files: ${add.detail}` };
    }
    const commit = runGit(
      [
        "-c",
        `user.name=${SYSTEM_NAME}`,
        "-c",
        "user.email=buildworks@buildworks.invalid",
        "commit",
        "-q",
        "-m",
        `bw run ${input.runId}: regenerate derived artifacts (${label}, base ${expectedHead.slice(0, 8)})`,
      ],
      worktreePath
    );
    if (!commit.ok) {
      return { ok: false, reason: `cannot commit the regenerated files: ${commit.detail}` };
    }
    const after = runGit(["rev-parse", "HEAD"], worktreePath);
    if (!after.ok) {
      return { ok: false, reason: `cannot read the worktree head after regeneration: ${after.detail}` };
    }
    resultHead = after.stdout.trim();
    const committed = runGit(["diff", "--name-only", "-z", expectedHead, resultHead], worktreePath);
    if (!committed.ok) {
      return { ok: false, reason: `cannot read the regeneration commit: ${committed.detail}` };
    }
    const committedPaths = committed.stdout.split("\0").filter((p) => p !== "").map(normalizePath);
    if (
      committedPaths.length !== changed.length ||
      !committedPaths.every((path) => changed.includes(path))
    ) {
      return {
        ok: false,
        reason: `the regeneration commit holds ${committedPaths.join(", ")}, not the regenerated ${changed.join(", ")}`,
      };
    }
  }

  // After the commit, not before: the cleanup refuses any entry that is not
  // ignored, so it can run only once the tree holds nothing else.
  const cleanup = removeIgnoredOutput(input.sandbox, worktreePath, evidenceDir);
  if (!cleanup.ok) {
    return {
      ok: false,
      reason: `the derived files were regenerated, but the ignored output the commands left could not be removed: ${cleanup.detail}`,
    };
  }
  const after = checkWorktreeClean(worktreePath);
  if (!after.ok) {
    return {
      ok: false,
      reason: `the worktree is not clean after regeneration: ${after.detail ?? after.entries.slice(0, 3).join(", ")}`,
    };
  }

  if (changed.length === 0) {
    input.audit("derived.unchanged", `label=${label}; head=${expectedHead}; evidence=${evidenceRef}`);
  } else {
    input.audit(
      "derived.commit",
      `label=${label}; base=${expectedHead}; head=${resultHead}; paths=${changed.join(",")}; evidence=${evidenceRef}`
    );
  }
  return { ok: true, head: resultHead, regenerated: changed };
}
