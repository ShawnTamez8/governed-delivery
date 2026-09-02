import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { AGENTS, type AgentDefinition } from "./agents.ts";
import { loadPublicKey } from "./approval.ts";
import { canonicalJson, sha256Hex } from "./canonical.ts";
import { CLAUDE_CODE, type ExecutorDefinition } from "./executor.ts";
import { profileDir, profilePath } from "./paths.ts";
import {
  SYSTEM_NAME,
  buildPolicy,
  invalidPolicyReason,
  policyHash,
  type Policy,
} from "./policy.ts";
import { staffingShortfall } from "./select.ts";
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
  verification: VerificationConfig,
  // A test seam, and the only one here: the seeded registry seats three
  // distinct specialties and the configured maximum is two, so the staffing
  // refusal below is unreachable with the real agents and could otherwise
  // never be proven by breaking it. Callers pass nothing. The override feeds
  // both the check and the frozen agent list, because a refusal has to be
  // about the registry the run would actually work with.
  deps: { agents?: readonly AgentDefinition[] } = {}
): { path: string; hash: string; profile: Profile } {
  const agents = deps.agents ?? AGENTS;
  const modelError = validateModelName(model);
  if (modelError !== null) {
    throw new Error(modelError);
  }
  const policy = buildPolicy();
  // Section 11's rule, applied to the panel: a configuration the registry
  // cannot satisfy fails at configuration time, not at the dispatch that
  // would have spent money discovering it. Checked against the agents this
  // profile is about to freeze, so the refusal is about what the run would
  // actually have to work with.
  const shortfall = staffingShortfall(
    agents,
    policy.panelSizeMax,
    policy.requiredSpecialties,
    CLAUDE_CODE.id
  );
  if (shortfall !== null) {
    throw new Error(`cannot freeze a profile for run ${runId}: ${shortfall}`);
  }
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
    agents: [...agents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    executor: CLAUDE_CODE,
    policy,
    policyHash: policyHash(policy),
  };
  const serialized = canonicalJson(profile);
  const path = profilePath(rootDir, runId);
  mkdirSync(profileDir(rootDir, runId), { recursive: true });
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
 * Is this frozen profile one the code can execute a run against? Returns the
 * reason it is not, or null when it is.
 *
 * The profile-level half of the same question `invalidPolicyReason` asks of
 * the policy: not "how old is this" but "does it carry what the stages read".
 * There is no migration, no defaulting, and no version discriminator here by
 * design — hard rule 3 — and a profile that fails this is refused by name
 * rather than repaired.
 *
 * `approvalSigner` must be *present*, and may be null. The two are not the
 * same claim: null means no key was configured at intake, which is a real
 * and supported state the approval gate records on the granted approval.
 * Absent means the profile predates the field, which is a shape this code no
 * longer executes.
 */
export function invalidProfileReason(profile: unknown): string | null {
  if (profile === null || typeof profile !== "object" || Array.isArray(profile)) {
    return "the frozen profile is not an object";
  }
  const p = profile as Record<string, unknown>;
  if (!isPositiveInt(p.runId)) {
    return `the frozen profile runId must be a positive integer, found ${JSON.stringify(p.runId)}`;
  }
  if (typeof p.systemName !== "string" || p.systemName === "") {
    return `the frozen profile systemName must be a non-empty string, found ${JSON.stringify(p.systemName)}`;
  }
  if (typeof p.startingCommit !== "string" && p.startingCommit !== null) {
    return `the frozen profile startingCommit must be a string or null, found ${JSON.stringify(p.startingCommit)}`;
  }
  if (!("approvalSigner" in p)) {
    return "the frozen profile carries no approvalSigner: it predates the field, and a run frozen without it cannot bind a signer";
  }
  if (typeof p.approvalSigner !== "string" && p.approvalSigner !== null) {
    return `the frozen profile approvalSigner must be a string or null, found ${JSON.stringify(p.approvalSigner)}`;
  }
  if (typeof p.frozenAt !== "string" || p.frozenAt === "") {
    return `the frozen profile frozenAt must be a non-empty string, found ${JSON.stringify(p.frozenAt)}`;
  }
  if (typeof p.policyHash !== "string" || p.policyHash === "") {
    return `the frozen profile policyHash must be a non-empty string, found ${JSON.stringify(p.policyHash)}`;
  }
  const modelMap = p.modelMap;
  if (modelMap === null || typeof modelMap !== "object" || Array.isArray(modelMap)) {
    return "the frozen profile carries no modelMap";
  }
  if (!Array.isArray(p.agents) || p.agents.length === 0) {
    return "the frozen profile carries no agents";
  }
  if (p.executor === null || typeof p.executor !== "object") {
    return "the frozen profile carries no executor";
  }
  const verification = p.verification as { commands?: unknown } | null | undefined;
  if (
    verification === null ||
    typeof verification !== "object" ||
    !Array.isArray(verification.commands)
  ) {
    return "the frozen profile carries no verification commands";
  }
  const policyReason = invalidPolicyReason(p.policy);
  if (policyReason !== null) return policyReason;
  // The recorded hash must describe the policy actually present. A profile
  // whose bytes were never edited still fails this if it was written by code
  // that hashed a different shape, which is precisely the pre-change case.
  const inProfile = policyHash(p.policy as Policy);
  if (p.policyHash !== inProfile) {
    return `the frozen profile's policyHash ${p.policyHash} does not describe its own policy (${inProfile})`;
  }
  return null;
}

function isPositiveInt(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
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
  // Shape after tamper-evidence, in that order. A profile that fails the hash
  // has a different problem, and reporting the shape of bytes that are not the
  // ones the run froze would name the wrong defect.
  //
  // This is the single door the step 5b Task 3 decision chose: every execution
  // and resume path loads the frozen profile through here, so the refusal
  // cannot be enforced at one stage and forgotten at another — the same reason
  // the hash comparison above lives here. Nothing that only reads the database,
  // the retained evidence, or the audit chain comes through this function, so
  // a refused run stays fully inspectable.
  const invalid = invalidProfileReason(loaded.profile);
  if (invalid !== null) {
    return {
      ok: false,
      reason: `run ${run.id} cannot be executed: ${invalid}. It was frozen under a configuration this code no longer honours; its records and evidence remain readable, but the run cannot continue and must be replaced by a fresh one.`,
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
