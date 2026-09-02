import type { AgentDefinition } from "./agents.ts";

export type Risk = "low" | "standard" | "high";

/**
 * The risk values, owned here beside the type so the store's validation and
 * the migration CHECK cannot drift from what `computeRisk` can actually
 * return — the same single-source rule `finding.ts` follows.
 */
export const RISKS: readonly string[] = ["low", "standard", "high"];

/**
 * Deterministic risk (section 9): computed from the spec's declared
 * properties, never an agent's self-assessment. Score 0 -> low, 1-2 ->
 * standard, 3+ -> high.
 */
export function computeRisk(
  changeKind: string,
  declaredArtifactCount: number,
  touchesProtectedPaths: boolean
): Risk {
  const score =
    (changeKind === "defect_fix" ? 1 : 0) +
    (declaredArtifactCount > 10 ? 1 : 0) +
    (touchesProtectedPaths ? 2 : 0);
  if (score >= 3) return "high";
  if (score >= 1) return "standard";
  return "low";
}

/**
 * A pure, deterministic panel selection (section 9). Candidates are
 * reviewers only, so an author can never appear in its own stage's panel;
 * required specialties fill first, then remaining slots go by ranked
 * relevance without repeating a represented specialty.
 * The candidate list is passed in so the panel comes from the frozen
 * profile's agents, never the live registry (hard rule 6).
 *
 * `size` replaces the per-risk map this used to index. Risk no longer sizes
 * the panel — the author proposes a size within the frozen bounds (step 5b
 * Task 5) and until then the caller passes the frozen floor. The caller reads
 * that value from the frozen profile, so this stays a pure function of its
 * arguments.
 */
export function selectReviewers(
  candidates: readonly AgentDefinition[],
  size: number,
  requiredSpecialties: string[]
): AgentDefinition[] {
  const reviewers = candidates.filter((a) => a.role === "reviewer" && a.outputs.includes("findings"));
  const selected: AgentDefinition[] = [];
  const used = new Set<string>();
  const usedSpecialties = new Set<string>();
  for (const specialty of requiredSpecialties) {
    if (selected.length >= size) break;
    const match = reviewers.find((c) => c.specialty === specialty && !used.has(c.id));
    if (match) {
      selected.push(match);
      used.add(match.id);
      usedSpecialties.add(specialty);
    }
  }
  const ranked = [...reviewers].sort((a, b) => {
    const aSpecial = a.specialty !== null ? 1 : 0;
    const bSpecial = b.specialty !== null ? 1 : 0;
    if (aSpecial !== bSpecial) return bSpecial - aSpecial;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  for (const candidate of ranked) {
    if (selected.length >= size) break;
    if (
      candidate.specialty !== null &&
      !used.has(candidate.id) &&
      !usedSpecialties.has(candidate.specialty)
    ) {
      selected.push(candidate);
      used.add(candidate.id);
      usedSpecialties.add(candidate.specialty);
    }
  }
  return selected;
}

/**
 * Can this registry seat a panel of `size` on the named executor, with unique
 * agent ids and distinct specialties including every required one? Returns
 * the refusal, or null when it can.
 *
 * Checked at configuration time — when the profile is frozen, before a run row
 * exists and before anything has been spent. The default registry holds three
 * reviewers with three distinct specialties, so the default maximum of two is
 * staffable; raising the maximum without registering specialists is the
 * configuration this refuses, and it names what is missing rather than
 * quietly seating a smaller panel.
 *
 * Distinct specialties, not distinct agents: two reviewers sharing a lens are
 * one lens twice, which is not the independence a panel is claiming.
 */
export function staffingShortfall(
  candidates: readonly AgentDefinition[],
  size: number,
  requiredSpecialties: readonly string[],
  executorId: string
): string | null {
  const repeatedRequired = requiredSpecialties.filter(
    (specialty, index) => requiredSpecialties.indexOf(specialty) !== index
  );
  if (repeatedRequired.length > 0) {
    return `the configured required specialties contain duplicates: ${[
      ...new Set(repeatedRequired),
    ]
      .sort()
      .join(", ")}`;
  }
  if (requiredSpecialties.length > size) {
    return `the ${requiredSpecialties.length} required specialties cannot fit in a panel of ${size}`;
  }

  const reviewers = candidates.filter(
    (a) =>
      a.role === "reviewer" &&
      a.outputs.includes("findings") &&
      a.executor === executorId
  );
  const repeatedIds = reviewers
    .map((a) => a.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (repeatedIds.length > 0) {
    return `the eligible reviewer registry contains duplicate agent ids: ${[
      ...new Set(repeatedIds),
    ]
      .sort()
      .join(", ")}`;
  }
  const available = new Set(
    reviewers.map((a) => a.specialty).filter((s): s is string => s !== null)
  );
  const missing = requiredSpecialties.filter((s) => !available.has(s));
  if (missing.length > 0) {
    return `the agent registry has no reviewer for required specialt${
      missing.length === 1 ? "y" : "ies"
    } ${missing.join(", ")}`;
  }
  if (available.size < size) {
    return `the agent registry seats ${available.size} distinct reviewer specialt${
      available.size === 1 ? "y" : "ies"
    } (${[...available].sort().join(", ")}), which cannot fill a panel of ${size}`;
  }
  return null;
}
