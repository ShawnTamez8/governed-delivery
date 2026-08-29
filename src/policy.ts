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
  };
}

export function policyHash(policy: Policy): string {
  return sha256Hex(canonicalJson(policy));
}
