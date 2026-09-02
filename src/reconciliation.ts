import { normalizeLocation, SEVERITIES } from "./finding.ts";
import { normalizeText } from "./canonical.ts";
import type { SpecDoc } from "./spec-doc.ts";
import type { PlanDoc } from "./plan-doc.ts";

/**
 * The reconciliation contract (sections 12 and 13): the reviewer-report shape
 * that feeds reconciliation and the decision shape the reconciler returns.
 * One schema for both reviewed artifacts (hard rule 3) — which document
 * schema the revised artifact must satisfy is the calling stage's question,
 * exactly as in `src/self-critique.ts`.
 *
 * Two kinds of refusal, and they are deliberately different:
 *
 * - **Structure** — a missing or misplaced field, an unknown vocabulary
 *   value, a decision for a finding that does not exist, a decision missing
 *   for one that does. The envelope is wrong, so the stage aborts with a
 *   named error. The model failed to follow the contract.
 *
 * - **Content** — a grounding whose excerpt does not occur in the governing
 *   input, a normative claim that does not match the derived delta. The
 *   envelope is right and the claim is wrong, so the decision is rewritten to
 *   `cannot_determine`, the author's rationale is retained with a bracketed
 *   note naming the deterministic failure, and the conditional fields that no
 *   longer apply are dropped. The run then blocks on the converted decision
 *   (the gate is Task 9's), which is what "missing or unmatched grounding
 *   becomes `cannot_determine`" means. The author's original disposition and
 *   payload stay inspectable in the retained raw output.
 *
 * The names are chosen to say exactly what the checks prove. The grounding
 * check proves **textual occurrence**: the excerpt's words occur, in that
 * order, in the governing input after whitespace is collapsed. It does not
 * prove the excerpt logically supports the rejection or the addition, and no
 * name or comment here claims otherwise (section 12: "What these checks do
 * not establish").
 */

export const CLASSIFICATIONS: readonly string[] = ["current_artifact", "upstream"];

export const DISPOSITIONS: readonly string[] = [
  "addressed",
  "rejected_with_rationale",
  "upstream_follow_up",
  "upstream_blocking",
  "cannot_determine",
];

export type Disposition = (typeof DISPOSITIONS)[number];

/**
 * The accepted grounding source, per artifact. Always the governing input —
 * the design for specification reconciliation, the approved specification for
 * plan reconciliation. The artifact under review can never ground its own
 * change or rejection.
 */
export type UpstreamSource = "design" | "specification";

/** The exact upstream location token prefix an artifact's review may cite. */
export function upstreamPrefixFor(source: UpstreamSource): string {
  return source === "design" ? "upstream:design:" : "upstream:specification:";
}

// The kebab-case body, held separately from the anchored form so the
// upstream-token check can embed it after its prefix — `KEBAB.source` carries
// the `^…$` anchors, and embedding those mid-pattern asserts the string start
// where the token's prefix already is.
const KEBAB_BODY = "[a-z0-9]+(-[a-z0-9]+)*";

/**
 * The first member of `obj` that is not in `allowed`, or null. The plan's
 * step 7 says "refuse extras" — a field the contract does not name is a
 * second shape for the same thing (hard rule 3), and silently dropping it
 * conceals producer/schema drift while the validator's own comments claim
 * strictness it does not have. `impact` is handled by name at every level it
 * can appear, so callers pass it through this check untouched and refuse it
 * with the derived-from-disposition message.
 */
function unknownMember(obj: { [key: string]: unknown }, allowed: readonly string[]): string | null {
  return Object.keys(obj).find((key) => !allowed.includes(key)) ?? null;
}
const KEBAB = new RegExp(`^${KEBAB_BODY}$`);

/**
 * Strip a BOM, normalize CRLF, then collapse every run of whitespace to a
 * single space and trim. This is the comparison tolerance for textual
 * grounding, and it exists because a literal match was measured to fail on a
 * correct citation: the Task 1 prototype's author quoted a design sentence
 * that is hard-wrapped, the excerpt spanned the line break, and a sound
 * rejection became `cannot_determine` under `normalizeText` alone. Collapsing
 * whitespace drops only typography — the guarantee stays exactly what it was:
 * these words occur, in this order, in the governing input.
 */
export function collapseWhitespace(text: string): string {
  return normalizeText(text).replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ *
 * Reviewer report
 * ------------------------------------------------------------------ */

export interface ReviewerReport {
  severity: string;
  classification: "current_artifact" | "upstream";
  /** Normalized for identity: `current_artifact` locations via
   * `normalizeLocation`; upstream tokens kept verbatim — they are already the
   * canonical form. */
  location: string;
  intentKey: string;
  subject: string;
}

/**
 * One reviewer's report set, checked at the dispatch boundary. Each entry
 * carries the canonical identity (`location`, `intentKey`) plus that
 * reviewer's own severity, classification, and subject. A duplicate canonical
 * identity inside one reviewer's result is refused; nothing is merged here —
 * the reports travel on to reconciliation exactly as returned.
 *
 * The upstream location syntax is enforced here, not only stated in the
 * prompt: an upstream classification must carry the exact
 * `upstream:<source>:<decision-key>` token for the artifact under review, and
 * a `current_artifact` classification must never use one. The reviewer
 * prompt's stated syntax is the primary control; this is the deterministic
 * backstop.
 */
export function validateReviewerReports(
  raw: unknown,
  opts: { agentId: string; upstreamPrefix: string }
): { ok: true; value: ReviewerReport[] } | { ok: false; reason: string } {
  const refuse = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
  if (!Array.isArray(raw)) {
    return refuse(`reviewer ${opts.agentId} result is missing proposedContentChanges.findings`);
  }
  const reports: ReviewerReport[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return refuse(`reviewer ${opts.agentId} finding entry is not an object`);
    }
    const f = entry as { [key: string]: unknown };
    const unknown = unknownMember(f, ["severity", "classification", "location", "intentKey", "subject"]);
    if (unknown !== null) {
      return refuse(
        `reviewer ${opts.agentId} finding carries an unknown field ${unknown}: allowed fields are severity, classification, location, intentKey, subject`
      );
    }
    if (typeof f.severity !== "string" || !SEVERITIES.includes(f.severity)) {
      return refuse(
        `reviewer ${opts.agentId} finding severity ${JSON.stringify(f.severity)} is not one of ${SEVERITIES.join(", ")}`
      );
    }
    if (typeof f.classification !== "string" || !CLASSIFICATIONS.includes(f.classification)) {
      return refuse(
        `reviewer ${opts.agentId} finding classification ${JSON.stringify(f.classification)} is not one of ${CLASSIFICATIONS.join(", ")}`
      );
    }
    if (typeof f.location !== "string" || f.location === "") {
      return refuse(`reviewer ${opts.agentId} finding is missing a non-empty location`);
    }
    if (typeof f.intentKey !== "string" || !KEBAB.test(f.intentKey) || f.intentKey.length > 64) {
      return refuse(
        `reviewer ${opts.agentId} finding intentKey ${JSON.stringify(f.intentKey)} is not lowercase kebab-case within 64 characters`
      );
    }
    if (typeof f.subject !== "string" || f.subject === "") {
      return refuse(`reviewer ${opts.agentId} finding is missing a non-empty subject`);
    }
    if (f.classification === "upstream") {
      const escaped = opts.upstreamPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const expected = new RegExp(`^${escaped}${KEBAB_BODY}$`);
      if (!expected.test(f.location)) {
        return refuse(
          `reviewer ${opts.agentId} upstream finding location ${JSON.stringify(f.location)} is not ${opts.upstreamPrefix}<decision-key>`
        );
      }
      if (f.location.slice(opts.upstreamPrefix.length).length > 64) {
        return refuse(`reviewer ${opts.agentId} upstream decision key exceeds 64 characters: ${f.location}`);
      }
    } else if (f.location.startsWith("upstream:")) {
      return refuse(`reviewer ${opts.agentId} current_artifact finding uses an upstream location: ${f.location}`);
    }
    const location = f.classification === "upstream" ? f.location : normalizeLocation(f.location);
    const identity = `${f.intentKey}::${location}`;
    if (seen.has(identity)) {
      return refuse(`reviewer ${opts.agentId} reported the same canonical identity twice: ${identity}`);
    }
    seen.add(identity);
    reports.push({
      severity: f.severity,
      classification: f.classification as "current_artifact" | "upstream",
      location,
      intentKey: f.intentKey,
      subject: f.subject,
    });
  }
  return { ok: true, value: reports };
}

/* ------------------------------------------------------------------ *
 * Grounding
 * ------------------------------------------------------------------ */

export interface Grounding {
  source: string;
  location: string;
  excerpt: string;
}

/**
 * The textual grounding check. Returns the failure as a string, or null when
 * the grounding passes. What it proves, and all it proves: the excerpt's
 * words occur, in that order, in the governing input after whitespace is
 * collapsed, and the cited source is the governing input rather than the
 * artifact under review. It deliberately does not check that the location
 * names a real heading or that the excerpt logically supports anything —
 * claims it cannot back are not made in its name.
 */
export function groundingTextuallyFails(
  grounding: Grounding,
  governingSource: UpstreamSource,
  governingText: string
): string | null {
  if (grounding.source !== governingSource) {
    return `grounding source ${JSON.stringify(grounding.source)} is not the governing ${governingSource}: the current artifact cannot ground its own change or rejection`;
  }
  if (typeof grounding.location !== "string" || grounding.location.trim() === "") {
    return "grounding location is empty";
  }
  if (typeof grounding.excerpt !== "string" || grounding.excerpt.trim() === "") {
    return "grounding excerpt is empty";
  }
  if (!collapseWhitespace(governingText).includes(collapseWhitespace(grounding.excerpt))) {
    return `grounding excerpt does not occur in the governing ${governingSource}`;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Normative nodes
 * ------------------------------------------------------------------ */

/**
 * The parsed normative nodes of a specification: the declared artifacts and
 * the acceptance criteria (section 12). The set deterministic code diff-before
 * and after reconciliation to derive what an `addressed` decision must claim.
 */
export function specNormativeNodes(doc: SpecDoc): string[] {
  return [...doc.declaredArtifacts, ...doc.acceptanceCriteria];
}

/**
 * The parsed normative nodes of a plan: the tasks and the coverage lines.
 * Coverage entries are reconstructed into their line form — `<criterion> ->
 * <artifact>` or the `not_applicable` decision — because that is the text a
 * reconciler copies out of the artifact. The comparison that consumes these
 * collapses whitespace on both sides, so a line whose spacing differs from
 * the canonical form still matches.
 */
export function planNormativeNodes(doc: PlanDoc): string[] {
  return [
    ...doc.tasks,
    ...doc.coverage.map((entry) =>
      entry.artifact !== null
        ? `${entry.criterion} -> ${entry.artifact}`
        : `${entry.criterion} -> not_applicable: ${entry.rationale} / ${entry.alternativeVerification}`
    ),
  ];
}

/**
 * The added normative nodes: a multiset difference, `after` minus `before`,
 * counted per distinct node with whitespace collapsed on both sides. Every
 * occurrence is a node that must be claimed exactly once — including the
 * added half of a replacement, which is simply the new node with the old one
 * gone from the count.
 */
export function deriveAddedNormativeNodes(before: string[], after: string[]): string[] {
  const counts = new Map<string, number>();
  for (const node of after) {
    const key = collapseWhitespace(node);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const node of before) {
    const key = collapseWhitespace(node);
    counts.set(key, (counts.get(key) ?? 0) - 1);
  }
  const added: string[] = [];
  for (const [node, count] of counts) {
    for (let i = 0; i < count; i++) added.push(node);
  }
  return added;
}

/* ------------------------------------------------------------------ *
 * Reconciliation result
 * ------------------------------------------------------------------ */

export interface ProposalCandidate {
  title: string;
  problem: string;
  whyUpstream: string;
}

export interface NormativeChange {
  artifactLocation: string;
  artifactText: string;
  grounding: Grounding;
}

export interface ReconciliationDecision {
  findingId: number;
  /** Rewritten to `cannot_determine` when a deterministic content check
   * converts the decision; the author's original disposition stays in the
   * retained raw output and in the conversion record. */
  disposition: Disposition;
  /** The author's explanation, retained as semantic evidence. A converted
   * decision appends a bracketed note naming the deterministic failure. */
  rationale: string;
  changedLocations: string[];
  grounding: Grounding | null;
  normativeChanges: NormativeChange[] | null;
  proposal: ProposalCandidate | null;
}

export interface ReconciliationValidation {
  decisions: ReconciliationDecision[];
  /** Every decision a deterministic content check converted, and why. */
  conversions: { findingId: number; from: Disposition; reason: string }[];
  /** Added normative nodes no decision claimed. The gate treats these as
   * `cannot_determine` and blocks (Task 9); there is no owning decision to
   * convert, so they are reported rather than rewritten. */
  unclaimedNodes: string[];
}

const PROPOSAL_FIELDS = ["title", "problem", "whyUpstream"] as const;

/**
 * The reconciliation decisions, checked against the round's canonical finding
 * ids, the governing input, and the derived normative delta. Structure errors
 * refuse with a named cause; content failures convert the affected decision
 * to `cannot_determine` — see the module comment for the boundary.
 *
 * Every added normative node must be claimed exactly once across the
 * `addressed` decisions' `normativeChanges`: an entry whose `artifactText` is
 * not an added node, or is one already claimed, converts its decision; an
 * added node left unclaimed is reported in `unclaimedNodes`. An `addressed`
 * decision may carry no entries — a deletion-only or prose-only change adds
 * no normative node and has nothing to claim.
 */
export function validateReconciliation(
  raw: unknown,
  ctx: {
    canonicalFindingIds: number[];
    governingSource: UpstreamSource;
    governingText: string;
    beforeNormativeNodes: string[];
    afterNormativeNodes: string[];
  }
): { ok: true; value: ReconciliationValidation } | { ok: false; reason: string } {
  const refuse = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
  if (!Array.isArray(raw)) {
    return refuse("reconciliation result is missing proposedContentChanges.decisions");
  }
  const wanted = new Set(ctx.canonicalFindingIds);
  const seen = new Set<number>();
  const decisions: ReconciliationDecision[] = [];
  const conversions: ReconciliationValidation["conversions"] = [];
  const claimable = new Map<string, number>();
  for (const node of deriveAddedNormativeNodes(ctx.beforeNormativeNodes, ctx.afterNormativeNodes)) {
    claimable.set(node, (claimable.get(node) ?? 0) + 1);
  }

  const convert = (decision: ReconciliationDecision, reason: string): void => {
    conversions.push({ findingId: decision.findingId, from: decision.disposition, reason });
    decision.disposition = "cannot_determine";
    decision.rationale = `${decision.rationale}\n[deterministic validation: ${reason}]`;
    decision.grounding = null;
    decision.normativeChanges = null;
    decision.proposal = null;
  };

  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return refuse("reconciliation decision entry is not an object");
    }
    const d = entry as { [key: string]: unknown };
    const { findingId, disposition, rationale, grounding, proposal, impact } = d;
    const unknown = unknownMember(d, [
      "findingId",
      "disposition",
      "rationale",
      "changedLocations",
      "grounding",
      "normativeChanges",
      "proposal",
    ]);
    if (unknown !== null && unknown !== "impact") {
      return refuse(
        `reconciliation decision for finding ${JSON.stringify(findingId)} carries an unknown field ${unknown}: allowed fields are findingId, disposition, rationale, changedLocations, grounding, normativeChanges, proposal`
      );
    }
    if (typeof findingId !== "number" || !Number.isInteger(findingId)) {
      return refuse(`reconciliation decision findingId ${JSON.stringify(findingId)} is not an integer`);
    }
    if (!wanted.has(findingId)) {
      return refuse(`reconciliation decision names finding ${findingId}, which is not a canonical finding of this round`);
    }
    if (seen.has(findingId)) {
      return refuse(`reconciliation returned two decisions for finding ${findingId}`);
    }
    seen.add(findingId);
    if (typeof disposition !== "string" || !DISPOSITIONS.includes(disposition)) {
      return refuse(
        `reconciliation disposition ${JSON.stringify(disposition)} for finding ${findingId} is not one of ${DISPOSITIONS.join(", ")}`
      );
    }
    if (typeof rationale !== "string" || rationale.trim() === "") {
      return refuse(`reconciliation decision for finding ${findingId} is missing a non-empty rationale`);
    }
    if (!Array.isArray(d.changedLocations)) {
      return refuse(`reconciliation decision for finding ${findingId} is missing changedLocations`);
    }
    for (const location of d.changedLocations as unknown[]) {
      if (typeof location !== "string" || location.trim() === "") {
        return refuse(
          `reconciliation decision for finding ${findingId} has a changedLocations entry that is not a non-empty string`
        );
      }
    }
    if (impact !== undefined) {
      return refuse(
        `reconciliation decision for finding ${findingId} returned an impact field: impact is derived from the disposition`
      );
    }

    const decision: ReconciliationDecision = {
      findingId,
      disposition: disposition as Disposition,
      rationale,
      changedLocations: [...(d.changedLocations as string[])],
      grounding: null,
      normativeChanges: null,
      proposal: null,
    };

    if (decision.disposition === "rejected_with_rationale") {
      if (grounding === null || typeof grounding !== "object" || Array.isArray(grounding)) {
        return refuse(`finding ${findingId} is rejected_with_rationale without a grounding object`);
      }
      const g = grounding as { [key: string]: unknown };
      const unknownGrounding = unknownMember(g, ["source", "location", "excerpt"]);
      if (unknownGrounding !== null) {
        return refuse(
          `finding ${findingId} grounding carries an unknown field ${unknownGrounding}: allowed fields are source, location, excerpt`
        );
      }
      decision.grounding = { source: g.source as string, location: g.location as string, excerpt: g.excerpt as string };
      const failure = groundingTextuallyFails(
        decision.grounding,
        ctx.governingSource,
        ctx.governingText
      );
      if (failure !== null) {
        convert(decision, failure);
      }
    } else if (grounding !== undefined) {
      return refuse(`finding ${findingId} carries grounding on disposition ${disposition}, where it is forbidden`);
    }

    if (decision.disposition === "addressed") {
      decision.normativeChanges = [];
      if (d.normativeChanges !== undefined) {
        if (!Array.isArray(d.normativeChanges)) {
          return refuse(`finding ${findingId} normativeChanges must be an array`);
        }
        for (const change of d.normativeChanges as unknown[]) {
          if (change === null || typeof change !== "object" || Array.isArray(change)) {
            return refuse(`finding ${findingId} has a normativeChange entry that is not an object`);
          }
          const c = change as { [key: string]: unknown };
          const unknownChange = unknownMember(c, ["artifactLocation", "artifactText", "grounding"]);
          if (unknownChange !== null) {
            return refuse(
              `finding ${findingId} has a normativeChange entry with an unknown field ${unknownChange}: allowed fields are artifactLocation, artifactText, grounding`
            );
          }
          if (typeof c.artifactLocation !== "string" || c.artifactLocation.trim() === "") {
            return refuse(`finding ${findingId} has a normativeChange entry missing a non-empty artifactLocation`);
          }
          if (typeof c.artifactText !== "string" || c.artifactText.trim() === "") {
            return refuse(`finding ${findingId} has a normativeChange entry missing a non-empty artifactText`);
          }
          if (c.grounding === null || typeof c.grounding !== "object" || Array.isArray(c.grounding)) {
            return refuse(`finding ${findingId} has a normativeChange entry without a grounding object`);
          }
          const g = c.grounding as { [key: string]: unknown };
          const unknownNestedGrounding = unknownMember(g, ["source", "location", "excerpt"]);
          if (unknownNestedGrounding !== null) {
            return refuse(
              `finding ${findingId} has a normativeChange grounding with an unknown field ${unknownNestedGrounding}: allowed fields are source, location, excerpt`
            );
          }
          const entry: NormativeChange = {
            artifactLocation: c.artifactLocation,
            artifactText: c.artifactText,
            grounding: { source: g.source as string, location: g.location as string, excerpt: g.excerpt as string },
          };
          const failure = groundingTextuallyFails(entry.grounding, ctx.governingSource, ctx.governingText);
          if (failure !== null) {
            convert(decision, failure);
            break;
          }
          decision.normativeChanges.push(entry);
        }
      }
    } else if (d.normativeChanges !== undefined) {
      return refuse(
        `finding ${findingId} carries normativeChanges on disposition ${disposition}, where it is forbidden`
      );
    }

    if (decision.disposition === "upstream_follow_up" || decision.disposition === "upstream_blocking") {
      if (proposal === null || typeof proposal !== "object" || Array.isArray(proposal)) {
        return refuse(`finding ${findingId} is ${decision.disposition} without a proposal candidate`);
      }
      const p = proposal as { [key: string]: unknown };
      const unknownProposal = unknownMember(p, PROPOSAL_FIELDS);
      if (unknownProposal === "impact") {
        return refuse(`finding ${findingId} proposal candidate returned an impact field: impact is derived from the disposition`);
      }
      if (unknownProposal !== null) {
        return refuse(
          `finding ${findingId} proposal candidate carries an unknown field ${unknownProposal}: allowed fields are ${PROPOSAL_FIELDS.join(", ")}`
        );
      }
      for (const field of PROPOSAL_FIELDS) {
        if (typeof p[field] !== "string" || (p[field] as string).trim() === "") {
          return refuse(`finding ${findingId} proposal candidate is missing a non-empty ${field}`);
        }
      }
      decision.proposal = {
        title: p.title as string,
        problem: p.problem as string,
        whyUpstream: p.whyUpstream as string,
      };
    } else if (proposal !== undefined) {
      return refuse(
        `finding ${findingId} carries a proposal candidate on disposition ${disposition}, where it is forbidden`
      );
    }

    decisions.push(decision);
  }

  const missing = [...wanted].filter((id) => !seen.has(id));
  if (missing.length > 0) {
    return refuse(`reconciliation is incomplete: no decision for canonical finding id(s) ${missing.join(", ")}`);
  }

  // Normative accounting. All-or-nothing per decision: a decision is checked
  // against the still-claimable nodes, and only if every one of its entries
  // claims a unique added node are they consumed. A converted decision drops
  // its entries, so its nodes surface as unclaimed rather than silently
  // claimed by an answer the gate will block anyway.
  for (const decision of decisions) {
    if (decision.normativeChanges === null || decision.normativeChanges.length === 0) continue;
    const claims = decision.normativeChanges.map((c) => collapseWhitespace(c.artifactText));
    const wouldUse = new Map<string, number>();
    let failure: string | null = null;
    for (const claim of claims) {
      const available = (claimable.get(claim) ?? 0) - (wouldUse.get(claim) ?? 0);
      if (available <= 0) {
        failure = `normative change ${JSON.stringify(claim)} is not an added node of this reconciliation claimed exactly once`;
        break;
      }
      wouldUse.set(claim, (wouldUse.get(claim) ?? 0) + 1);
    }
    if (failure !== null) {
      convert(decision, failure);
      continue;
    }
    for (const [claim, count] of wouldUse) {
      claimable.set(claim, claimable.get(claim)! - count);
    }
  }

  const unclaimedNodes: string[] = [];
  for (const [node, count] of claimable) {
    for (let i = 0; i < count; i++) unclaimedNodes.push(node);
  }

  return { ok: true, value: { decisions, conversions, unclaimedNodes } };
}
