export const SEVERITIES: readonly string[] = ["low", "medium", "high", "critical"];
export const DISPOSITIONS: readonly string[] = ["open", "resolved", "disputed", "accepted"];
export const SEVERITY_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * Normalize a location for identity: trim, collapse internal whitespace,
 * drop a trailing colon — `## Acceptance criteria` and `## Acceptance
 * criteria:` are the same location.
 */
export function normalizeLocation(location: string): string {
  return location.trim().replace(/\s+/g, " ").replace(/:$/, "");
}

/** Trim, lowercase, collapse runs of non-alphanumerics to a single dash. */
export function normalizeIntentKey(intentKey: string): string {
  return intentKey.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * The identity key (section 8): normalized location plus intent key. Used
 * for validation and deduplication; never used to change a stored value.
 */
export function findingIdentity(location: string, intentKey: string): string {
  return `${normalizeLocation(location)}::${intentKey}`;
}
