import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTS, type AgentDefinition } from "./agents.ts";
import { loadPublicKey } from "./approval.ts";
import { canonicalJson, sha256Hex } from "./canonical.ts";
import { CLAUDE_CODE, type ExecutorDefinition } from "./executor.ts";
import { SYSTEM_NAME, buildPolicy, policyHash, type Policy } from "./policy.ts";
import type { VerificationConfig } from "./governed-config.ts";

/**
 * The frozen record of everything the run resolved at start (architecture
 * section 12), stored under `.governance/profiles/<run>/` with its hash on
 * the run row.
 *
 * The model map and the verification configuration are both frozen per run.
 * The verification commands are read from `governed.yaml` **as committed at
 * the starting commit** and validated by the caller before they reach here,
 * so the profile records what the run will actually verify against rather
 * than what the working copy happened to say.
 *
 * `startingCommit` lives here rather than in a `run` column because section
 * 15's `run` table has none, and a base commit is exactly "what the run
 * resolved at start".
 */
export interface Profile {
  runId: number;
  systemName: string;
  startingCommit: string | null;
  /**
   * The model each stage kind resolves to, frozen at run start (section 10).
   *
   * A map because section 10 requires a stage to name what it needs and
   * configuration to resolve it — not because the values differ today. There
   * is one model to configure, so every entry currently holds it; the shape is
   * what lets that stop being true without a schema change.
   */
  modelMap: Record<string, string>;
  /**
   * The fingerprint of the approval public key configured at run start, or
   * null when no usable key was configured then.
   *
   * `null` means "no key was configured at intake" — it does **not** mean
   * "any key is acceptable by policy". The gate treats a null as today's
   * unbound behaviour and records on the granted approval that the signer was
   * never bound, so a partial guarantee is never mistaken for a whole one
   * (section 6: record when a guarantee is asserted rather than proven).
   */
  approvalSigner: string | null;
  /**
   * The verification commands frozen at run start (section 12 names the
   * verification config among what the profile freezes).
   *
   * Not nullable: `new-run` refuses a repository with no committed,
   * parseable `governed.yaml` before the run row exists. The public-key
   * precedent above does not transfer — a null `approvalSigner` still lets a
   * run complete, recorded as unbound, whereas a run frozen without
   * verification commands could only ever block after every expensive stage
   * had spent.
   *
   * `freezeProfile` does not read `governed.yaml` itself. The caller has
   * already validated it against the starting commit, and re-reading here
   * would open a window between validation and freeze in which the file
   * could change.
   */
  verification: VerificationConfig;
  frozenAt: string;
  agents: AgentDefinition[];
  executor: ExecutorDefinition;
  policy: Policy;
  policyHash: string;
}

function profilePath(rootDir: string, runId: number): string {
  return join(rootDir, ".governance", "profiles", String(runId), "profile.json");
}

/**
 * `HEAD` at run start, or null when there is no git repository to read it
 * from. Never throws: a run created outside a repository is still a run, it
 * simply can never be approved, and the gate says so by name.
 *
 * Both object formats are accepted: 40 hex characters for a sha1 repository,
 * 64 for a sha256 one. Matching only sha1 made a real sha256 repository
 * freeze `startingCommit: null`, and the gate then refused the run for not
 * being in a git repository at all — the wrong reason.
 */
export function resolveStartingCommit(rootDir: string): string | null {
  let result;
  try {
    result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" });
  } catch {
    return null;
  }
  if (result.status !== 0 || typeof result.stdout !== "string") return null;
  const commit = result.stdout.trim();
  return /^([0-9a-f]{40}|[0-9a-f]{64})$/.test(commit) ? commit : null;
}

/**
 * The model name is operator input that reaches a spawn, and on Windows the
 * spawn builds its command line through a shell. A name containing a space or
 * other shell metacharacter freezes fine and then corrupts the child's argv —
 * the invocation runs a different command line than the audit records. The
 * pattern mirrors the `feature_id` rule.
 */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Return a named refusal for a model name that cannot be frozen, or null when
 * the name is valid. Shared by `freezeProfile` and the CLI's `new-run` case so
 * the rule is one string in one place.
 */
export function validateModelName(model: string): string | null {
  return MODEL_NAME.test(model)
    ? null
    : `invalid model name ${JSON.stringify(model)}: must be 1-64 characters of letters, digits, dot, underscore, or hyphen, starting with a letter or digit`;
}

/**
 * Freeze the profile and return its hash. The file written is the canonical
 * serialization, so re-reading the bytes and hashing them reproduces this
 * hash exactly — which is what makes tampering detectable at the gate.
 */
export function freezeProfile(
  rootDir: string,
  runId: number,
  startingCommit: string | null,
  model: string,
  verification: VerificationConfig
): { path: string; hash: string; profile: Profile } {
  const modelError = validateModelName(model);
  if (modelError !== null) {
    throw new Error(modelError);
  }
  const policy = buildPolicy();
  // A missing or unreadable key at run start is normal — most machines have
  // none — so this records null rather than failing run creation.
  const key = loadPublicKey(rootDir);
  const profile: Profile = {
    runId,
    systemName: SYSTEM_NAME,
    startingCommit,
    // One entry per stage kind that exists today. `new-run --model` is the
    // only point at which this can be resolved, which is what makes hard
    // rule 6 — config is frozen at run start — enforceable rather than
    // advisory.
    modelMap: { spec: model, spec_review: model, plan: model, plan_review: model, implementation: model },
    approvalSigner: key.ok ? key.signer : null,
    verification,
    frozenAt: new Date().toISOString(),
    agents: [...AGENTS].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    executor: CLAUDE_CODE,
    policy,
    policyHash: policyHash(policy),
  };
  const serialized = canonicalJson(profile);
  const path = profilePath(rootDir, runId);
  mkdirSync(join(rootDir, ".governance", "profiles", String(runId)), { recursive: true });
  writeFileSync(path, serialized);
  return { path, hash: sha256Hex(serialized), profile };
}

/**
 * Read the frozen profile and hash the bytes as they were found. Comparing
 * that hash against `run.profile_ref` is the caller's job, so this has one
 * responsibility.
 */
export function loadProfile(rootDir: string, runId: number): { profile: Profile; hash: string } {
  const path = profilePath(rootDir, runId);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`no frozen profile for run ${runId} at ${path}`);
  }
  return { profile: JSON.parse(raw) as Profile, hash: sha256Hex(raw) };
}

/**
 * The model a stage kind resolves to, from the profile frozen at run start.
 *
 * Section 10 requires this to fail at configuration time — before any
 * invocation — rather than at dispatch, so an unmapped stage kind is a
 * refusal here and never a spawn that spends first and fails after.
 */
export function resolveStageModel(
  profile: Profile,
  stageKind: string
): { ok: true; model: string } | { ok: false; reason: string } {
  const model = profile.modelMap?.[stageKind];
  if (typeof model !== "string" || model === "") {
    return {
      ok: false,
      reason: `no model configured for stage ${stageKind}: the profile frozen at run start maps ${Object.keys(
        profile.modelMap ?? {}
      ).join(", ")}`,
    };
  }
  return { ok: true, model };
}

/**
 * Load the frozen profile and prove it is the one the run froze.
 *
 * `loadProfile` returns the hash but leaves the comparison to its caller, and
 * a caller that reads `.profile` and drops `.hash` gets a profile that is
 * enforced but not tamper-evident: editing `profile.json` on disk changes
 * which model a stage may use, or what policy a gate applies, and nothing
 * objects. Every consumer of the frozen profile goes through here so the
 * comparison cannot be forgotten at one site and remembered at another.
 */
export function loadVerifiedProfile(
  rootDir: string,
  run: { id: number; profile_ref: string | null }
): { ok: true; profile: Profile; hash: string } | { ok: false; reason: string } {
  if (run.profile_ref === null) {
    return { ok: false, reason: `run ${run.id} has no frozen profile` };
  }
  let loaded;
  try {
    loaded = loadProfile(rootDir, run.id);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  if (loaded.hash !== run.profile_ref) {
    return {
      ok: false,
      reason: `profile for run ${run.id} has been modified since intake: frozen ${run.profile_ref}, on disk ${loaded.hash}`,
    };
  }
  return { ok: true, profile: loaded.profile, hash: loaded.hash };
}

/**
 * The executor capability a stage kind requires (architecture section 11:
 * "a stage requiring a capability no configured executor declares must fail
 * at configuration time"). The five dispatchable kinds map to four capability
 * names — the review kinds share `review`, mirroring how the stages resolve
 * two model entries. Unknown kinds return null, which the binding check
 * refuses by name.
 */
export function requiredCapability(stageKind: string): string | null {
  switch (stageKind) {
    case "spec":
      return "spec";
    case "spec_review":
    case "plan_review":
      return "review";
    case "plan":
      return "plan";
    case "implementation":
      return "implementation";
    default:
      return null;
  }
}

/**
 * The frozen-executor binding check, enforced at every dispatch construction
 * site before a stage row, worktree, or paid invocation exists.
 *
 * The identity test is canonical JSON equality, not id equality: a caller
 * handing the same id with a different command, probe, or sandbox would
 * otherwise pass the check while the run executes against a definition it
 * never froze (the divergence the step-6 diagnosis's finding 4 names).
 */
export function requireFrozenBinding(
  profile: Profile,
  executor: ExecutorDefinition,
  stageKind: string
): { ok: true } | { ok: false; reason: string } {
  if (canonicalJson(executor) !== canonicalJson(profile.executor)) {
    return { ok: false, reason: `the executor handed to the stage does not match the executor frozen at run start` };
  }
  const capability = requiredCapability(stageKind);
  if (capability === null) {
    return { ok: false, reason: `no executor capability defined for stage kind ${stageKind}` };
  }
  if (!profile.executor.capabilities.includes(capability)) {
    return {
      ok: false,
      reason: `executor ${executor.id} lacks the required capability "${capability}" for stage kind ${stageKind}: capabilities are ${profile.executor.capabilities.join(", ")}`,
    };
  }
  return { ok: true };
}
