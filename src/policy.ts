import { canonicalJson, sha256Hex } from "./canonical.ts";
import { DISPOSITIONS, SEVERITIES } from "./finding.ts";
import { PROMPT_MAX_BYTES, RESULT_MAX_BYTES } from "./harness.ts";
import { PROTECTED_PATH_PREFIXES } from "./scope.ts";
import { PANEL_SIZE } from "./select.ts";

/**
 * The system name is configuration, resolved at run start and frozen in the
 * profile (architecture section 12). Nothing functional depends on it.
 */
export const SYSTEM_NAME = "BuildWorks";

/** Bounded remediation rounds, counting closure passes (section 20). */
export const REMEDIATION_ROUNDS = 3;

/** Materiality is a severity threshold set in configuration (section 12). */
export const MATERIAL_THRESHOLD = "high";

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
  panelSizes: Record<string, number>;
  remediationRounds: number;
  materialityThreshold: string;
  severities: string[];
  dispositions: string[];
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
    panelSizes: { ...PANEL_SIZE },
    remediationRounds: REMEDIATION_ROUNDS,
    materialityThreshold: MATERIAL_THRESHOLD,
    severities: [...SEVERITIES],
    dispositions: [...DISPOSITIONS],
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
