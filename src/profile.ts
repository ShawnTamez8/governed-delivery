import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTS, type AgentDefinition } from "./agents.ts";
import { loadPublicKey } from "./approval.ts";
import { canonicalJson, sha256Hex } from "./canonical.ts";
import { CLAUDE_CODE, type ExecutorDefinition } from "./executor.ts";
import { SYSTEM_NAME, buildPolicy, policyHash, type Policy } from "./policy.ts";

/**
 * The frozen record of everything the run resolved at start (architecture
 * section 12), stored under `.governance/profiles/<run>/` with its hash on
 * the run row.
 *
 * The model map and the verification config are absent because neither
 * exists yet as configuration: the model is still a per-invocation flag and
 * `governed.yaml` is step 7's input. The profile records what was actually
 * resolved rather than pretending to a completeness it does not have.
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
 * Freeze the profile and return its hash. The file written is the canonical
 * serialization, so re-reading the bytes and hashing them reproduces this
 * hash exactly — which is what makes tampering detectable at the gate.
 */
export function freezeProfile(
  rootDir: string,
  runId: number,
  startingCommit: string | null
): { path: string; hash: string; profile: Profile } {
  const policy = buildPolicy();
  // A missing or unreadable key at run start is normal — most machines have
  // none — so this records null rather than failing run creation.
  const key = loadPublicKey(rootDir);
  const profile: Profile = {
    runId,
    systemName: SYSTEM_NAME,
    startingCommit,
    approvalSigner: key.ok ? key.signer : null,
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
