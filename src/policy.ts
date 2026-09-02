import { canonicalJson, sha256Hex } from "./canonical.ts";
import { SEVERITIES } from "./finding.ts";
import { PROMPT_MAX_BYTES, RESULT_MAX_BYTES } from "./harness.ts";
import { PROTECTED_PATH_PREFIXES } from "./scope.ts";

/**
 * The system name is configuration, resolved at run start and frozen in the
 * profile (architecture section 12). Nothing functional depends on it.
 */
export const SYSTEM_NAME = "BuildWorks";

/**
 * Review rounds per artifact. One configured round is one complete
 * panel -> reconcile cycle (architecture section 12, as amended 2026-09-01).
 * Self-critique happens once per artifact regardless of this count, before
 * the first panel, and never occupies a panel seat.
 *
 * One, not the three this replaces. Those three counted closure passes, and a
 * closure pass redispatches a panel that varies nothing that matters —
 * hazard 7 exactly. Frozen per run through the profile and read by both
 * stages (step 5b Task 9), which run exactly this many complete
 * `panel -> reconcile` cycles before the decision gate.
 */
export const SPEC_REVIEW_ROUNDS = 1;
export const PLAN_REVIEW_ROUNDS = 1;

/**
 * The panel size bounds, replacing the per-risk map the author-proposed panel
 * supersedes. Risk itself survives — the approval payload binds it — it just
 * no longer sizes the panel.
 *
 * The floor is also the default. Two is what makes an independence claim mean
 * anything, and the default installation only needs to staff two distinct
 * specialties. The author proposes the size within these bounds (step 5b
 * Task 5) and the stages staff exactly what it asked for, so the maximum is a
 * ceiling on that request rather than the size a run seats by default.
 *
 * Configuring more required specialties than the floor is legal — the check
 * below only requires that they fit the maximum — and it raises the smallest
 * request that can succeed to `requiredSpecialties.length`, because required
 * lenses consume seats inside whatever size the author asks for. The
 * self-critique prompt states that effective floor rather than this constant;
 * an operator raising one should expect the other to move.
 *
 * `PANEL_SIZE_MAX` must lie within [`PANEL_SIZE_FLOOR`, `PANEL_SIZE_CEILING`].
 * Raising it is an operator action that requires registering more specialists,
 * and `assertStaffable` refuses at configuration time when they are absent —
 * before a run row exists and before anything has been spent.
 */
export const PANEL_SIZE_FLOOR = 2;
export const PANEL_SIZE_CEILING = 5;
export const PANEL_SIZE_MAX = 2;

export const REQUIRED_SPECIALTIES = ["requirements-traceability"];

/**
 * The ceiling on how far ahead an authorization may expire. Without it an
 * operator can sign a decade-long approval, which is a human gate in name
 * only.
 */
export const APPROVAL_MAX_LIFETIME_SECONDS = 86400;

/**
 * The authorization window `bw approval-request` uses when the operator does
 * not supply `--expires`.
 *
 * This is a *human* window: it spans printing the payload, the operator
 * reading and signing it, and `bw approve` verifying the signature. Eight
 * hours because a human gate that expires while the human is still reading
 * is a gate that trains people to rubber-stamp — an approval that takes
 * thirteen hours is a slow approval, not an invalid one, and the operator
 * covers that case with `--expires` up to the ceiling above.
 */
export const APPROVAL_DEFAULT_LIFETIME_SECONDS = 28800;

/**
 * The ceiling on how long a run may exist before the implementation stage
 * refuses to start it. Section 20's rule that every limit defines its
 * behaviour on breach is satisfied by the refusal, which names this limit.
 * Seven days because the ceiling exists to stop an unattended run, and the
 * human approval window (default eight hours) plus the remediating stages
 * must fit comfortably.
 *
 * This is configuration, so its value is stated here and frozen per run
 * through the profile — the stage reads `profile.policy.runDurationLimitSeconds`
 * rather than this constant, which is how section 20's "record which values
 * were in force" is satisfied.
 */
export const RUN_DURATION_LIMIT_SECONDS = 7 * 86400;

/**
 * The ceiling on a single verification command. Fifteen minutes because a
 * typecheck plus a test suite fits comfortably inside it: the ceiling exists
 * to stop a hung command, not to pace a fast one.
 *
 * On breach (section 20's rule that every limit defines its behaviour): the
 * process tree is killed and the run blocks, naming the command and this
 * limit. Frozen per run through the profile, so the stage reads
 * `profile.policy.verifyCommandTimeoutSeconds` rather than this constant.
 */
export const VERIFY_COMMAND_TIMEOUT_SECONDS = 900;

/**
 * The ceiling on what one verification command may write to its retained
 * evidence file. Sixty-four times the one-megabyte result budget, because
 * retention exists to make a refusal diagnosable and nobody diagnoses a
 * gigabyte — while a suite that legitimately logs a few megabytes must not be
 * truncated.
 *
 * The in-memory budget alone is not enough. Retention is deliberately
 * independent of it (hazard 2: bytes discarded above a cap are bytes no
 * diagnosis can recover), so without a second ceiling the only bound on disk
 * is the command's time ceiling — and a command writing to stdout at pipe
 * speed reaches gigabytes in seconds. Measured at roughly 1 GB/s on this
 * machine, which is 900 GB inside `VERIFY_COMMAND_TIMEOUT_SECONDS`.
 *
 * On breach (section 20's rule that every limit defines its behaviour): the
 * process tree is killed and the outcome already carries `outputOverflow`,
 * which blocks the run. The command had exhausted its output budget long
 * before this point, so its result was decided either way; killing it only
 * stops the disk filling while the answer is already known.
 */
export const VERIFY_RETENTION_MAX_BYTES = 64 * 1024 * 1024;

/**
 * The environment a verification command receives. Section 17 forbids
 * inheriting the whole environment, and this stage runs code the implementer
 * wrote — full inheritance would put `BW_APPROVAL_PUBLIC_KEY`, the key that
 * binds the approval signer, inside that code's reach.
 *
 * The list is stated here rather than imported from
 * `CLAUDE_CODE.sandbox.envPassthrough`. The two coincide today because both
 * need the same OS minimum to resolve `node` and `npm` on Windows, but they
 * are answers to different questions — what an agent session may read, and
 * what a verification command may read — and coupling them would make a
 * change to one silently move the other.
 */
export const VERIFY_ENV_PASSTHROUGH = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "SystemRoot",
];

export interface Policy {
  specReviewRounds: number;
  planReviewRounds: number;
  panelSizeMin: number;
  panelSizeMax: number;
  severities: string[];
  requiredSpecialties: string[];
  protectedPathPrefixes: string[];
  promptMaxBytes: number;
  resultMaxBytes: number;
  approvalMaxLifetimeSeconds: number;
  approvalDefaultLifetimeSeconds: number;
  runDurationLimitSeconds: number;
  verifyCommandTimeoutSeconds: number;
  verifyRetentionMaxBytes: number;
  verifyEnvPassthrough: string[];
}

/**
 * Policy is the subset of the profile that gates consult (section 12). Every
 * value is read from the module that actually enforces it, so a constant
 * changed in one place cannot leave the frozen policy describing something
 * the code no longer does.
 */
export function buildPolicy(): Policy {
  return {
    specReviewRounds: SPEC_REVIEW_ROUNDS,
    planReviewRounds: PLAN_REVIEW_ROUNDS,
    panelSizeMin: PANEL_SIZE_FLOOR,
    panelSizeMax: PANEL_SIZE_MAX,
    severities: [...SEVERITIES],
    requiredSpecialties: [...REQUIRED_SPECIALTIES],
    protectedPathPrefixes: [...PROTECTED_PATH_PREFIXES],
    promptMaxBytes: PROMPT_MAX_BYTES,
    resultMaxBytes: RESULT_MAX_BYTES,
    approvalMaxLifetimeSeconds: APPROVAL_MAX_LIFETIME_SECONDS,
    approvalDefaultLifetimeSeconds: APPROVAL_DEFAULT_LIFETIME_SECONDS,
    runDurationLimitSeconds: RUN_DURATION_LIMIT_SECONDS,
    verifyCommandTimeoutSeconds: VERIFY_COMMAND_TIMEOUT_SECONDS,
    verifyRetentionMaxBytes: VERIFY_RETENTION_MAX_BYTES,
    verifyEnvPassthrough: [...VERIFY_ENV_PASSTHROUGH],
  };
}

export function policyHash(policy: Policy): string {
  return sha256Hex(canonicalJson(policy));
}

function isPositiveInt(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isStringArray(v: unknown): boolean {
  return Array.isArray(v) && v.every((e) => typeof e === "string");
}

/** Every policy field that must be a positive integer, with no further bound. */
const POSITIVE_INT_FIELDS = [
  "specReviewRounds",
  "planReviewRounds",
  "promptMaxBytes",
  "resultMaxBytes",
  "approvalMaxLifetimeSeconds",
  "approvalDefaultLifetimeSeconds",
  "runDurationLimitSeconds",
  "verifyCommandTimeoutSeconds",
  "verifyRetentionMaxBytes",
];

/** Every policy field that must be an array of strings. */
const STRING_ARRAY_FIELDS = [
  "severities",
  "requiredSpecialties",
  "protectedPathPrefixes",
  "verifyEnvPassthrough",
];

/**
 * Is this frozen policy one this code enforces? Returns the reason it is not,
 * or null when it is.
 *
 * Not a version check, and deliberately not compatibility handling — hard rule
 * 3 forbids both, and this is that rule said out loud rather than an exception
 * to it. The question has no notion of "old": does the policy this run froze
 * carry the values the stages read, within the bounds they assume?
 *
 * The reason it has to exist. A profile frozen before a field existed parses
 * with `undefined` in its place, and in JavaScript every comparison against
 * `undefined` is false: `panel.length < undefined` is false, so a staffing
 * refusal would never fire, and a loop bounded by `undefined` would run zero
 * times. The central refusal keeps that malformed value from reaching any
 * consumer.
 * Filling a default would be worse — it would govern a run by a value it never
 * froze — so the only honest answer is to refuse and name what is wrong.
 *
 * The expected field set is read from `buildPolicy()` rather than listed here,
 * so adding a policy field cannot leave this check silently behind. An
 * obsolete field is reported too: a policy still carrying `panelSizes` is as
 * clear a signal of a superseded shape as one missing `panelSizeMax`.
 */
export function invalidPolicyReason(policy: unknown): string | null {
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) {
    return "the frozen profile carries no policy object";
  }
  const p = policy as Record<string, unknown>;
  const expected = Object.keys(buildPolicy());
  const missing = expected.filter((k) => !(k in p));
  const obsolete = Object.keys(p).filter((k) => !expected.includes(k));
  if (missing.length > 0 || obsolete.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing ${missing.sort().join(", ")}`);
    if (obsolete.length > 0) parts.push(`carrying obsolete ${obsolete.sort().join(", ")}`);
    return `the frozen policy is not the shape this code enforces: ${parts.join("; ")}`;
  }
  for (const field of POSITIVE_INT_FIELDS) {
    if (!isPositiveInt(p[field])) {
      return `the frozen policy field ${field} must be a positive integer, found ${JSON.stringify(p[field])}`;
    }
  }
  for (const field of STRING_ARRAY_FIELDS) {
    if (!isStringArray(p[field])) {
      return `the frozen policy field ${field} must be an array of strings, found ${JSON.stringify(p[field])}`;
    }
  }
  if (!isPositiveInt(p.panelSizeMin) || !isPositiveInt(p.panelSizeMax)) {
    return `the frozen policy panel sizes must be positive integers, found min ${JSON.stringify(
      p.panelSizeMin
    )} and max ${JSON.stringify(p.panelSizeMax)}`;
  }
  const min = p.panelSizeMin as number;
  const max = p.panelSizeMax as number;
  // The bound is the absolute one, not today's configured value: a run frozen
  // under a different but legal maximum is still governed by what it froze
  // (hard rule 6). Only a size the selector could not honour is refused.
  if (min < PANEL_SIZE_FLOOR || max > PANEL_SIZE_CEILING || min > max) {
    return `the frozen policy panel sizes ${min}-${max} are outside the permitted ${PANEL_SIZE_FLOOR}-${PANEL_SIZE_CEILING}`;
  }
  const required = p.requiredSpecialties as string[];
  if (new Set(required).size !== required.length) {
    return "the frozen policy requiredSpecialties must not contain duplicates";
  }
  if (required.length > max) {
    return `the frozen policy has ${required.length} required specialties, which cannot fit in its maximum panel of ${max}`;
  }
  return null;
}
