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
  };
}

export function policyHash(policy: Policy): string {
  return sha256Hex(canonicalJson(policy));
}
