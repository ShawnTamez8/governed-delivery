import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, sha256Hex } from "./canonical.ts";
import { proposalEvidenceDir, proposalEvidenceRef } from "./paths.ts";
import { collapseWhitespace } from "./reconciliation.ts";
import type { Disposition, ProposalCandidate } from "./reconciliation.ts";

/**
 * An upstream concern's destination (architecture sections 13 and 14): a
 * validated reconciliation decision's proposal candidate becomes a stored,
 * non-binding proposal. Nothing here writes into `docs/proposals/` — that
 * remains a human `git mv`, per section 14 and this plan's known blockers.
 */

export const PROPOSAL_ROUTES: readonly string[] = ["follow_up", "blocking_dependency"];
export type ProposalRoute = (typeof PROPOSAL_ROUTES)[number];

/**
 * Impact is derived from the disposition, never a second model-returned
 * field (section 13: "no second model-returned impact field can disagree
 * with the disposition"). Only the two upstream dispositions carry a
 * proposal candidate at all — `validateReconciliation` refuses one on every
 * other disposition — so a caller reaching this with anything else is a
 * defect in the caller, not a case this function silently tolerates.
 */
export function deriveRoute(disposition: Disposition): ProposalRoute {
  if (disposition === "upstream_blocking") return "blocking_dependency";
  if (disposition === "upstream_follow_up") return "follow_up";
  throw new Error(`disposition ${disposition} carries no proposal candidate to derive a route from`);
}

/**
 * The deterministic dedup key (Task 8: "deduplicate the candidate without
 * fusing impact, route, or rationale across reports"). Stage-scoped, and
 * built with `collapseWhitespace` — the same tolerance the grounding match
 * already applies to model-restated prose — so a title or problem differing
 * only in spacing, line breaks, or CRLF is one identity. `normalizeText`
 * alone was not enough: it folds CRLF and edge whitespace but leaves a
 * double space or a re-wrapped line as a different hash, which duplicated
 * the row this key exists to deduplicate. Route is part of the key: a
 * concern that escalates from follow_up to blocking (or the reverse, across
 * configured rounds) must never be silently folded into the earlier route's
 * row.
 */
export function proposalIdentity(stageId: number, title: string, problem: string, route: ProposalRoute): string {
  return sha256Hex(
    canonicalJson({
      stageId,
      title: collapseWhitespace(title),
      problem: collapseWhitespace(problem),
      route,
    })
  );
}

export interface ProposalEvidence {
  findingId: number;
  candidate: ProposalCandidate;
  route: ProposalRoute;
  rationale: string;
  artifactHashBefore: string;
  artifactHashAfter: string;
}

/**
 * Retain the full candidate and its context before the row is written,
 * mirroring `writeRawOutput`'s hazard-2 ordering. The stored `proposal` row
 * keeps only title, problem, and whyUpstream; this file is the record of
 * which decision produced them, the reconciler's rationale, and the artifact
 * hashes in force — evidence a stored row alone does not carry.
 */
export function writeProposalEvidence(rootDir: string, runId: number, evidence: ProposalEvidence): string {
  const dir = proposalEvidenceDir(rootDir, runId);
  mkdirSync(dir, { recursive: true });
  const name = `finding-${evidence.findingId}.json`;
  writeFileSync(join(dir, name), JSON.stringify(evidence, null, 2));
  return proposalEvidenceRef(runId, name);
}
