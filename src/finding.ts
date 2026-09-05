/**
 * The severity vocabulary, in ascending order: `low` is the weakest assertion
 * a reviewer can make and `critical` the strongest. `buildPolicy` copies this
 * array into the frozen `policy.severities`, and the code-review gate decides
 * by comparing indices *in that frozen copy* — so the order here is
 * load-bearing for every run frozen after a change to it, and reordering the
 * constant can never move an in-progress run's gate (hard rule 6).
 */
export const SEVERITIES: readonly string[] = ["low", "medium", "high", "critical"];

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
