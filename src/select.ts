import type { AgentDefinition } from "./agents.ts";
import type { PanelRequest } from "./self-critique.ts";

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
 * The unique lenses a panel must seat: the configured required specialties
 * and the ones the author asked for, as one set.
 *
 * One helper rather than the same two-line union written wherever it is
 * needed. `validatePanelRequest` asks whether the set fits the requested
 * size; `staffingShortfall` asks whether the registry can seat it. Two
 * computations of one set is one place for them to drift.
 */
function unionSpecialties(
  requiredSpecialties: readonly string[],
  requestedSpecialties: readonly string[]
): string[] {
  return [...new Set([...requiredSpecialties, ...requestedSpecialties])];
}

/**
 * The author's panel request, checked against the configuration this run
 * froze. Returns the validated request, or the reason it cannot be honoured.
 *
 * `validateSelfCritique` has already checked the shape of the model's answer;
 * this asks the question that needs a profile, which that function
 * deliberately does not have: is the size within the bounds this run froze,
 * and do the configured required specialties leave room for the lenses the
 * author asked for? The structural checks are repeated rather than assumed —
 * a tolerance applied at one boundary and not its sibling is how a malformed
 * value reaches a consumer that trusted the other end to have caught it.
 *
 * Nothing here normalizes, clamps, truncates, or defaults. A size outside the
 * frozen bounds is refused by name rather than pulled to the nearest legal
 * one, because a panel the author did not ask for is not the author's
 * proposal, and silently seating it would make the request a decoration.
 *
 * Required specialties consume seats inside the requested size (hazard 11).
 * With the default floor of two and `requirements-traceability` required,
 * that leaves room for exactly one further lens.
 */
export function validatePanelRequest(
  request: PanelRequest,
  panelSizeMin: number,
  panelSizeMax: number,
  requiredSpecialties: readonly string[]
): { ok: true; value: PanelRequest } | { ok: false; reason: string } {
  const { size, specialties } = request;
  if (typeof size !== "number" || !Number.isInteger(size)) {
    return { ok: false, reason: `panel request size ${JSON.stringify(size)} is not an integer` };
  }
  if (size < panelSizeMin || size > panelSizeMax) {
    return {
      ok: false,
      reason: `panel request size ${size} is outside the frozen bounds ${panelSizeMin}-${panelSizeMax}`,
    };
  }
  if (!Array.isArray(specialties)) {
    return { ok: false, reason: "panel request specialties must be an array" };
  }
  for (const entry of specialties) {
    if (typeof entry !== "string" || entry.trim() === "") {
      return {
        ok: false,
        reason: `panel request specialty ${JSON.stringify(entry)} is not a non-empty string`,
      };
    }
  }
  // Compared as returned, for the reason `validateSelfCritique` states: two
  // spellings of one lens are two requests, and normalizing here would let the
  // author's casing decide which one got staffed.
  const duplicates = specialties.filter((s, i) => specialties.indexOf(s) !== i);
  if (duplicates.length > 0) {
    return {
      ok: false,
      reason: `panel request specialties contain duplicates: ${[...new Set(duplicates)].sort().join(", ")}`,
    };
  }
  const union = unionSpecialties(requiredSpecialties, specialties);
  if (union.length > size) {
    return {
      ok: false,
      reason: `panel request of ${size} cannot seat the ${union.length} required and requested specialties: ${union
        .slice()
        .sort()
        .join(", ")}`,
    };
  }
  return { ok: true, value: { size, specialties: [...specialties] } };
}

/**
 * A pure, deterministic panel selection (section 9). Candidates are
 * reviewers only, so an author can never appear in its own stage's panel;
 * configured required specialties fill first, the author's requested lenses
 * next, then any remaining seats go by ranked relevance without repeating a
 * represented specialty.
 * The candidate list is passed in so the panel comes from the frozen
 * profile's agents, never the live registry (hard rule 6).
 *
 * `size` replaces the per-risk map this used to index: risk no longer sizes
 * the panel, the author proposes a size within the frozen bounds and
 * `validatePanelRequest` has already checked it. The caller reads every value
 * from the frozen profile, so this stays a pure function of its arguments.
 *
 * **The author proposes lenses and never identities.** Requested specialties
 * are seated in the ranked order the fill pass uses, not in the order the
 * author listed them, so two requests naming the same lenses in a different
 * order produce the same panel in the same order. The author's list is read
 * as a set, which is the only thing it is allowed to be.
 *
 * A requested lens the registry cannot seat is not substituted here — the
 * ranked pass would quietly fill the seat with a different specialty and the
 * panel would come out the right size with the wrong lens. `staffingShortfall`
 * is what refuses that, by name, before this runs.
 */
export function selectReviewers(
  candidates: readonly AgentDefinition[],
  size: number,
  requiredSpecialties: string[],
  requestedSpecialties: readonly string[] = []
): AgentDefinition[] {
  const reviewers = candidates.filter((a) => a.role === "reviewer" && a.outputs.includes("findings"));
  const selected: AgentDefinition[] = [];
  const used = new Set<string>();
  const usedSpecialties = new Set<string>();
  const seat = (candidate: AgentDefinition | undefined): void => {
    if (
      candidate === undefined ||
      selected.length >= size ||
      candidate.specialty === null ||
      used.has(candidate.id) ||
      usedSpecialties.has(candidate.specialty)
    ) {
      return;
    }
    selected.push(candidate);
    used.add(candidate.id);
    usedSpecialties.add(candidate.specialty);
  };
  // Configured order: this list is frozen configuration, not model output, so
  // reading it in order is reading the operator's own priority.
  for (const specialty of requiredSpecialties) {
    if (selected.length >= size) break;
    seat(reviewers.find((c) => c.specialty === specialty && !used.has(c.id)));
  }
  const ranked = [...reviewers].sort((a, b) => {
    const aSpecial = a.specialty !== null ? 1 : 0;
    const bSpecial = b.specialty !== null ? 1 : 0;
    if (aSpecial !== bSpecial) return bSpecial - aSpecial;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const requested = new Set(requestedSpecialties);
  for (const candidate of ranked) {
    if (selected.length >= size) break;
    if (candidate.specialty !== null && requested.has(candidate.specialty)) seat(candidate);
  }
  for (const candidate of ranked) {
    if (selected.length >= size) break;
    seat(candidate);
  }
  return selected;
}

/**
 * Can this registry seat a panel of `size` on the named executor, with unique
 * agent ids and distinct specialties including every required and requested
 * one? Returns the refusal, or null when it can.
 *
 * Two callers ask this one question at two moments. At configuration time —
 * when the profile is frozen, before a run row exists and before anything has
 * been spent — no author has proposed anything yet, so `requestedSpecialties`
 * is empty and the question is whether the registry could staff the configured
 * maximum at all. At review time the author's validated request supplies the
 * rest, and the question is whether *this* panel can be staffed. Same question,
 * different mandatory set; one function, so a rule added for one caller cannot
 * go missing for the other.
 *
 * The default registry holds three reviewers with three distinct specialties,
 * so the default maximum of two is staffable; raising the maximum without
 * registering specialists is the configuration this refuses. It names what is
 * missing rather than quietly seating a smaller panel or substituting a lens
 * nobody asked for.
 *
 * Distinct specialties, not distinct agents: two reviewers sharing a lens are
 * one lens twice, which is not the independence a panel is claiming.
 */
export function staffingShortfall(
  candidates: readonly AgentDefinition[],
  size: number,
  requiredSpecialties: readonly string[],
  requestedSpecialties: readonly string[],
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
  // Checked before the union, so a configuration that cannot fit its own
  // required lenses is named as that rather than as a request it never made.
  if (requiredSpecialties.length > size) {
    return `the ${requiredSpecialties.length} required specialties cannot fit in a panel of ${size}`;
  }
  const repeatedRequested = requestedSpecialties.filter(
    (specialty, index) => requestedSpecialties.indexOf(specialty) !== index
  );
  if (repeatedRequested.length > 0) {
    return `the requested specialties contain duplicates: ${[...new Set(repeatedRequested)]
      .sort()
      .join(", ")}`;
  }
  const union = unionSpecialties(requiredSpecialties, requestedSpecialties);
  if (union.length > size) {
    return `a panel of ${size} cannot seat the ${union.length} required and requested specialties: ${union
      .slice()
      .sort()
      .join(", ")}`;
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
  const seats = `a panel of ${size} was asked to seat ${union
    .slice()
    .sort()
    .join(", ")} and the registry seats ${[...available].sort().join(", ") || "no specialty at all"}`;
  const missing = requiredSpecialties.filter((s) => !available.has(s));
  if (missing.length > 0) {
    return `the agent registry has no reviewer for required specialt${
      missing.length === 1 ? "y" : "ies"
    } ${missing.join(", ")}`;
  }
  // Named as requested, not as required. The author is told which of its own
  // lenses could not be staffed, which is the half of the refusal it can act
  // on; calling a requested lens "required" would report the configuration as
  // the defect when the request is what could not be honoured.
  const missingRequested = requestedSpecialties.filter((s) => !available.has(s));
  if (missingRequested.length > 0) {
    return `the agent registry has no reviewer for requested specialt${
      missingRequested.length === 1 ? "y" : "ies"
    } ${missingRequested.join(", ")}; ${seats}`;
  }
  if (available.size < size) {
    return `the agent registry seats ${available.size} distinct reviewer specialt${
      available.size === 1 ? "y" : "ies"
    } (${[...available].sort().join(", ")}), which cannot fill a panel of ${size}`;
  }
  return null;
}
