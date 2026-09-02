/**
 * The self-critique result: one shape for both reviewed artifacts.
 *
 * The author's own pass over the artifact it just wrote, before any
 * independent reviewer sees it. One dispatch carries three things because a
 * second dispatch would spend money to move three fields: what the author
 * found wrong, the artifact it wrote instead, and the panel it proposes.
 *
 * One schema, not one per stage (hard rule 3). `artifact` is the revised
 * document as text; which document schema it must satisfy is the calling
 * stage's question, and the stage answers it by rerunning that document's
 * own gates on the value.
 */
export interface PanelRequest {
  size: number;
  specialties: string[];
}

export interface SelfCritique {
  critique: string[];
  artifact: string;
  panelRequest: PanelRequest;
}

/**
 * Section 8's contract applied to the self-critique payload, enforced at the
 * boundary. Every refusal names its cause (hazard 1), and there is no
 * tolerant path: a caller that cannot get a valid self-critique blocks its
 * stage rather than falling back to the draft, because falling back would
 * make the phase optional in exactly the runs where it went wrong.
 *
 * Structure only. Whether the requested size lies within the frozen policy's
 * `[panelSizeMin, panelSizeMax]`, whether the union with the configured
 * required specialties fits, and whether the frozen registry can seat the
 * result are questions about a run's frozen configuration, not about the
 * shape of a model's answer — step 5b Task 5 asks them where selection
 * happens. What is checked here is what can be checked without a profile:
 * the fields are present, typed, non-empty, unique, and internally
 * consistent.
 *
 * `specialties` may be empty. An author that wants no lens beyond the
 * configured required ones has proposed a panel, and refusing that would be
 * an obligation the design does not state.
 */
export function validateSelfCritique(
  raw: unknown
): { ok: true; value: SelfCritique } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "self-critique must be an object" };
  }
  const r = raw as { [key: string]: unknown };

  if (!Array.isArray(r.critique) || r.critique.length === 0) {
    return { ok: false, reason: "self-critique critique must be a non-empty array" };
  }
  for (const entry of r.critique) {
    if (typeof entry !== "string" || entry.trim() === "") {
      return { ok: false, reason: "every self-critique critique entry must be a non-empty string" };
    }
  }

  if (typeof r.artifact !== "string" || r.artifact.trim() === "") {
    return { ok: false, reason: "self-critique artifact must be the full revised document as a non-empty string" };
  }

  if (typeof r.panelRequest !== "object" || r.panelRequest === null || Array.isArray(r.panelRequest)) {
    return { ok: false, reason: "self-critique panelRequest must be an object" };
  }
  const request = r.panelRequest as { [key: string]: unknown };
  if (typeof request.size !== "number" || !Number.isInteger(request.size) || request.size < 1) {
    return {
      ok: false,
      reason: `self-critique panelRequest size ${JSON.stringify(request.size)} is not a positive integer`,
    };
  }
  if (!Array.isArray(request.specialties)) {
    return { ok: false, reason: "self-critique panelRequest specialties must be an array" };
  }
  for (const entry of request.specialties) {
    if (typeof entry !== "string" || entry.trim() === "") {
      return {
        ok: false,
        reason: "every self-critique panelRequest specialty must be a non-empty string",
      };
    }
  }
  const specialties = request.specialties as string[];
  // Compared as returned. Normalizing here would let the author's casing
  // decide which lens got staffed, and the plan says to normalize no model
  // value: two spellings of one specialty are two requests, and the second
  // one is the duplicate this refuses.
  const duplicates = specialties.filter((s, i) => specialties.indexOf(s) !== i);
  if (duplicates.length > 0) {
    return {
      ok: false,
      reason: `self-critique panelRequest specialties contain duplicates: ${[...new Set(duplicates)]
        .sort()
        .join(", ")}`,
    };
  }
  // Over-capacity against the author's own request. A panel seats one lens
  // per seat, so more distinct lenses than seats is a request no selection
  // could honour, whatever the configured bounds turn out to be.
  if (specialties.length > request.size) {
    return {
      ok: false,
      reason: `self-critique panelRequest asks for ${specialties.length} specialties in a panel of ${request.size}`,
    };
  }

  return {
    ok: true,
    value: {
      critique: r.critique as string[],
      artifact: r.artifact,
      panelRequest: { size: request.size, specialties },
    },
  };
}
