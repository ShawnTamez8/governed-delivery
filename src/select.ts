import { AGENTS, type AgentDefinition } from "./agents.ts";

export type Risk = "low" | "standard" | "high";

export const PANEL_SIZE: Record<Risk, number> = { low: 1, standard: 2, high: 3 };

/**
 * The risk values, owned here beside the type and the panel map so the store's
 * validation and the migration CHECK cannot drift from what `computeRisk`
 * can actually return — the same single-source rule `finding.ts` follows.
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
 * required specialties fill first, remaining slots go by ranked relevance.
 */
export function selectReviewers(risk: Risk, requiredSpecialties: string[]): AgentDefinition[] {
  const candidates = AGENTS.filter((a) => a.role === "reviewer" && a.outputs.includes("findings"));
  const selected: AgentDefinition[] = [];
  const used = new Set<string>();
  for (const specialty of requiredSpecialties) {
    const match = candidates.find((c) => c.specialty === specialty && !used.has(c.id));
    if (match) {
      selected.push(match);
      used.add(match.id);
    }
  }
  const ranked = [...candidates].sort((a, b) => {
    const aSpecial = a.specialty !== null ? 1 : 0;
    const bSpecial = b.specialty !== null ? 1 : 0;
    if (aSpecial !== bSpecial) return bSpecial - aSpecial;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  for (const candidate of ranked) {
    if (selected.length >= PANEL_SIZE[risk]) break;
    if (!used.has(candidate.id)) {
      selected.push(candidate);
      used.add(candidate.id);
    }
  }
  return selected;
}
