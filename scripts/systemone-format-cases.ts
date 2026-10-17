import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractJsonBody } from "../src/parse-output.ts";
import type { ChoiceQuestion } from "../src/systemone.ts";
import { acceptanceEntries, narrationState, type NarrationAnswer } from "../src/narration-check.ts";

/**
 * The labelled cases for two Decision-1 checks
 * (`docs/features/decision-1-format-checks/plan.md`). Both sets are derived from
 * committed fixtures; no case text is written here. Only the labels are, each
 * with the source it came from. This module builds cases and sends nothing.
 *
 * - Grounding: does the excerpt an author cited support what the author used it
 *   for? Hazard 16 states the gap: the excerpt check "proves textual occurrence
 *   ... never that they logically support what was added or rejected".
 * - Narration: does an Acceptance criteria entry carry the author's remark about
 *   the document or the work, which the section's stated rule forbids?
 */

const RECORDED = join(import.meta.dirname, "..", "test", "fixtures", "recorded");

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(RECORDED, name), "utf8")) as T;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A document line or claimed node without its list marker. */
function bare(text: string): string {
  return collapse(text.replace(/^\s*(?:- |\d+\.\s+)/, ""));
}

/** The specification an envelope's spec-author response returned. */
function returnedSpec(fixture: string): { spec: string; decisions: RecordedDecision[] } {
  const envelope = readFixture<{ envelope: { result: string } }>(fixture).envelope;
  const extracted = extractJsonBody(envelope.result);
  if (extracted.kind !== "ok") throw new Error(`${fixture}: ${extracted.reason}`);
  const changes = (extracted.value as { proposedContentChanges?: { spec?: unknown; decisions?: unknown } }).proposedContentChanges;
  if (typeof changes?.spec !== "string" || !Array.isArray(changes.decisions)) throw new Error(`${fixture} returned no spec and decisions`);
  return { spec: changes.spec, decisions: changes.decisions as RecordedDecision[] };
}

export type Label<T extends string> = T | "either";

export interface LabelEntry<T extends string> {
  label: Label<T>;
  /** "recorded: ..." names the fixture field or hazard that fixed it; "proposed: ..." awaits the operator. */
  source: string;
}

// ---- grounding ------------------------------------------------------------------

export type GroundingAnswer = "supports" | "does-not-support";

export const GROUNDING_OPTIONS: Readonly<Record<GroundingAnswer, string>> = {
  supports: "The excerpt states what the author relied on it for.",
  "does-not-support": "The excerpt does not state what the author relied on it for.",
};

export const ADDITION_QUESTION_TEXT =
  "The state holds a text an author added to a document, the text it replaced when there was one, the author's reason, and the excerpt of the governing document the author cited for it. " +
  "Does the excerpt state the obligation the added text imposes? When a replaced text is shown, judge only what the added text requires beyond it. " +
  "Choose does-not-support when the added text requires something the excerpt does not state, such as a further condition, limit, check or behaviour. " +
  "Wording and illustrative examples do not count as a further requirement.";

export const REJECTION_QUESTION_TEXT =
  "The state holds a finding a code reviewer reported, a reason given for withholding it as asking for more than the approved specification requires, and the excerpt of the specification cited for that reason. " +
  "Does the excerpt state the specification's requirement for the very behaviour the finding is about, so that the finding asks for more than it? " +
  "Choose does-not-support when the excerpt is about some other behaviour, or when the finding reports code that fails what the excerpt states.";

export interface GroundingCase {
  id: string;
  kind: "addition" | "rejection";
  fixture: string;
  /** Where in the fixture the claim was found. */
  pointer: string;
  state: string;
  label: Label<GroundingAnswer>;
  labelSource: string;
}

interface RecordedDecision {
  findingId: number;
  disposition: string;
  rationale?: string;
  excerpt?: string;
  normativeChanges?: Array<{ artifactLocation: string; artifactText: string; grounding: { source: string; location: string; excerpt: string } }>;
}

/** The reconciliation fixtures with grounded normative changes, and the document each returned. */
const ADDITION_SOURCES: ReadonlyArray<{ short: string; fixture: string; load: () => { returned: string; decisions: RecordedDecision[] } }> = [
  {
    short: "wc-plan",
    fixture: "plan-reconciliation-web-calculator.json",
    load: () => {
      const j = readFixture<{ afterPlan: string; decisions: RecordedDecision[] }>("plan-reconciliation-web-calculator.json");
      return { returned: j.afterPlan, decisions: j.decisions };
    },
  },
  {
    short: "wc-prd-plan",
    fixture: "plan-reconciliation-web-calculator-prd.json",
    load: () => {
      const j = readFixture<{ afterPlan: string; decisions: RecordedDecision[] }>("plan-reconciliation-web-calculator-prd.json");
      return { returned: j.afterPlan, decisions: j.decisions };
    },
  },
  {
    short: "wc-spec",
    fixture: "spec-reconciliation-web-calculator-list-marker.json",
    load: () => {
      const j = readFixture<{ afterSpec: string; decisions: RecordedDecision[] }>("spec-reconciliation-web-calculator-list-marker.json");
      return { returned: j.afterSpec, decisions: j.decisions };
    },
  },
  {
    short: "nk-spec-a",
    fixture: "spec-reconciliation-note-keeper-missing-proposal.json",
    load: () => {
      const r = returnedSpec("spec-reconciliation-note-keeper-missing-proposal.json");
      return { returned: r.spec, decisions: r.decisions };
    },
  },
  {
    short: "nk-spec-b",
    fixture: "spec-reconciliation-note-keeper-missing-changed-locations.json",
    load: () => {
      const r = returnedSpec("spec-reconciliation-note-keeper-missing-changed-locations.json");
      return { returned: r.spec, decisions: r.decisions };
    },
  },
];

/**
 * Every claimed node a reconciliation added: one whose text, without its list
 * marker, is a line of the document the author returned. A claimed node that is
 * not there is the removed half of a replacement: it is not a case, and its
 * text is shown as the replaced text in the same decision's addition.
 */
function additionCases(labels: Readonly<Record<string, LabelEntry<GroundingAnswer>>>): GroundingCase[] {
  const cases: GroundingCase[] = [];
  for (const source of ADDITION_SOURCES) {
    const { returned, decisions } = source.load();
    const lines = new Set(returned.split(/\r?\n/).map(bare));
    for (const decision of decisions) {
      const changes = decision.normativeChanges ?? [];
      const removed = changes.filter((change) => !lines.has(bare(change.artifactText)));
      if (removed.length > 1) throw new Error(`${source.fixture} finding ${decision.findingId} removes ${removed.length} nodes`);
      changes.forEach((change, index) => {
        if (!lines.has(bare(change.artifactText))) return;
        const id = `A-${source.short}-${decision.findingId}-${index + 1}`;
        const state = [
          `Added to ${change.artifactLocation}: ${bare(change.artifactText)}`,
          ...removed.map((r) => `Replacing: ${bare(r.artifactText)}`),
          `Author's reason: ${decision.rationale ?? ""}`,
          `Cited excerpt (${change.grounding.source}, ${change.grounding.location}): ${change.grounding.excerpt}`,
        ].join("\n");
        cases.push(withLabel({ id, kind: "addition", fixture: source.fixture, pointer: `finding ${decision.findingId}, normativeChanges[${index}]`, state }, labels));
      });
    }
  }
  return cases;
}

interface StoredFinding {
  findingId: number;
  round?: number;
  location: string;
  reports: Array<{ subject: string }>;
}

interface ReconcilerCall {
  label: string;
  decisions: RecordedDecision[];
}

/**
 * Each distinct (finding, excerpt) rejection the recorded Haiku reconciler calls
 * made, taken from the first call in fixture order that made it. A rejection
 * whose excerpt is not in the approved specification is left out: the shipped
 * excerpt check already refuses it.
 */
function rejectionCases(labels: Readonly<Record<string, LabelEntry<GroundingAnswer>>>): GroundingCase[] {
  const spec = collapse(readFixture<{ spec: string }>("crew-chatter-run-6-approved-spec-plan.json").spec);
  const run6 = readFixture<{ codeReviewFindings: StoredFinding[] }>("code-review-crew-chatter-run-6.json");
  const test5 = readFixture<{ sets: Record<string, { findings: StoredFinding[] }>; calls: ReconcilerCall[] }>(
    "code-review-reconciler-test-5-crew-chatter-run-6.json"
  );
  const replay = readFixture<{ calls: ReconcilerCall[] }>("code-review-reconciler-replay-crew-chatter-run-6.json");
  const findings = new Map(
    [...run6.codeReviewFindings, ...test5.sets["5a"]!.findings, ...test5.sets["5b"]!.findings].map((f) => [f.findingId, f])
  );
  const seen = new Map<number, string[]>();
  const cases: GroundingCase[] = [];
  const sources = [
    { fixture: "code-review-reconciler-replay-crew-chatter-run-6.json", calls: replay.calls },
    { fixture: "code-review-reconciler-test-5-crew-chatter-run-6.json", calls: test5.calls },
  ];
  for (const { fixture, calls } of sources) {
    for (const call of calls) {
      for (const decision of call.decisions) {
        if (decision.disposition !== "reject" || decision.excerpt === undefined) continue;
        const excerpt = collapse(decision.excerpt);
        if (!spec.includes(excerpt)) continue;
        const known = seen.get(decision.findingId) ?? [];
        if (known.includes(excerpt)) continue;
        seen.set(decision.findingId, [...known, excerpt]);
        const finding = findings.get(decision.findingId);
        if (finding === undefined) throw new Error(`no stored finding ${decision.findingId}`);
        const id = `R-${decision.findingId}-${known.length + 1}`;
        const state = [
          `Finding at ${finding.location}: ${finding.reports.map((r) => r.subject).join(" ")}`,
          `Reason for withholding it: ${decision.rationale ?? ""}`,
          `Cited excerpt (approved specification): ${decision.excerpt}`,
        ].join("\n");
        cases.push(withLabel({ id, kind: "rejection", fixture, pointer: `call ${call.label}, finding ${decision.findingId}`, state }, labels));
      }
    }
  }
  return cases;
}

function withLabel<C extends { id: string }, T extends string>(
  partial: C,
  labels: Readonly<Record<string, LabelEntry<T>>>
): C & { label: Label<T>; labelSource: string } {
  const entry = labels[partial.id];
  if (entry === undefined) throw new Error(`case ${partial.id} has no label`);
  return { ...partial, label: entry.label, labelSource: entry.source };
}

const PROPOSED = "proposed 2026-10-17 by the assistant; awaits the operator";
const TEST5_RESULT ="recorded: code-review-reconciler-test-5-crew-chatter-run-6.json provenance.result";

/** Every grounding case's label. A case without one, or a label without a case, refuses to load. */
export const GROUNDING_LABELS: Readonly<Record<string, LabelEntry<GroundingAnswer>>> = {
  "R-200-1": { label: "supports", source: 'recorded: code-review-reconciler-replay-crew-chatter-run-6.json provenance.labels, "reject 200 (spec baseline lines 47 and 49)"' },
  "R-207-1": { label: "either", source: 'recorded: code-review-reconciler-replay-crew-chatter-run-6.json provenance.labels, "either answer accepted for ... 207"' },
  "R-207-2": { label: "either", source: 'recorded: code-review-reconciler-replay-crew-chatter-run-6.json provenance.labels, "either answer accepted for ... 207"' },
  "R-213-1": { label: "does-not-support", source: `${TEST5_RESULT}, "one 213 rejection quoting a spec sentence about password reset that does not support it"; docs/hazards.md entry 16` },
  "R-213-2": { label: "either", source: 'recorded: code-review-reconciler-test-5-crew-chatter-run-6.json provenance.set5a, "either 213, 214"' },
  "R-905-1": { label: "supports", source: 'recorded: code-review-reconciler-test-5-crew-chatter-run-6.json provenance.set5b, "reject 905 (no server-side revocation; baseline \\"Sign-out clears the cookie.\\")"' },
  "R-905-2": { label: "supports", source: 'recorded: code-review-reconciler-test-5-crew-chatter-run-6.json provenance.set5b; the excerpt contains the baseline "Sign-out clears the cookie."' },
  "R-906-1": { label: "does-not-support", source: `${TEST5_RESULT}, "906 wrongly rejected once, with a valid but irrelevant quote of AC-018's leave-page text"` },
  "A-wc-plan-1-1": { label: "supports", source: `${PROPOSED}: the task verifies the excerpt's own example` },
  "A-wc-plan-2-1": {
    label: "does-not-support",
    source: `${PROPOSED}: the excerpt states a light/dark toggle; the task adds localStorage persistence, validation of the stored value and a prefers-color-scheme fallback, and the author's reason argues it is "not a new obligation"`,
  },
  "A-wc-prd-plan-4-1": { label: "supports", source: `${PROPOSED}: parseFloat is given as an example of correct decimal evaluation` },
  "A-wc-prd-plan-4-2": { label: "supports", source: `${PROPOSED}: the task verifies decimal evaluation` },
  "A-wc-prd-plan-5-2": { label: "either", source: `${PROPOSED}: the script order serves restoring the theme, but "before first paint" is a condition the excerpt does not state` },
  "A-wc-spec-1-1": { label: "supports", source: `${PROPOSED}: touch on mobile widths is stated by the excerpt` },
  "A-wc-spec-2-2": { label: "supports", source: `${PROPOSED}: the added text is the excerpt verbatim, without the replaced qualifier` },
  "A-nk-spec-a-26-1": { label: "supports", source: `${PROPOSED}: the change adds "searchable", which the excerpt lists` },
  "A-nk-spec-a-27-1": { label: "supports", source: `${PROPOSED}: restates the excerpt` },
  "A-nk-spec-a-28-1": { label: "supports", source: `${PROPOSED}: restates the excerpt` },
  "A-nk-spec-a-29-1": { label: "supports", source: `${PROPOSED}: restates the excerpt's keyboard-navigation list` },
  "A-nk-spec-a-30-1": { label: "supports", source: `${PROPOSED}: restates the excerpt's accessibility list` },
  "A-nk-spec-b-16-1": { label: "either", source: `${PROPOSED}: completing a reset is what "reset a forgotten password" means, but the token-or-link mechanism is not in the three-word excerpt` },
  "A-nk-spec-b-17-2": { label: "supports", source: `${PROPOSED}: the change adds highlighting where practical, which the excerpt states` },
  "A-nk-spec-b-21-2": { label: "supports", source: `${PROPOSED}: the change adds preferences, which the excerpt lists` },
};

export function loadGroundingCases(): GroundingCase[] {
  const cases = [...rejectionCases(GROUNDING_LABELS), ...additionCases(GROUNDING_LABELS)];
  const orphans = Object.keys(GROUNDING_LABELS).filter((id) => !cases.some((c) => c.id === id));
  if (orphans.length > 0) throw new Error(`labels with no case: ${orphans.join(", ")}`);
  return cases;
}

// ---- narration ------------------------------------------------------------------

// The question, its options, its state and the entry rule live in
// `src/narration-check.ts`, which the spec stage asks; this set reads them there.

export interface NarrationCase {
  id: string;
  fixture: string;
  /** The entry's first and last line in the recorded document. */
  lines: [number, number];
  entry: string;
  state: string;
  label: Label<NarrationAnswer>;
  labelSource: string;
}

/** The recorded specifications the narration set reads, each from a different run. */
const NARRATION_SOURCES: ReadonlyArray<{ short: string; fixture: string; load: () => string }> = [
  { short: "wc-numbering", fixture: "spec-reconciliation-web-calculator-numbering-note.json", load: () => returnedSpec("spec-reconciliation-web-calculator-numbering-note.json").spec },
  { short: "wc-list-marker", fixture: "spec-reconciliation-web-calculator-list-marker.json", load: () => readFixture<{ afterSpec: string }>("spec-reconciliation-web-calculator-list-marker.json").afterSpec },
  { short: "nk-changed-locations", fixture: "spec-reconciliation-note-keeper-missing-changed-locations.json", load: () => returnedSpec("spec-reconciliation-note-keeper-missing-changed-locations.json").spec },
  { short: "cc-run-6", fixture: "crew-chatter-run-6-approved-spec-plan.json", load: () => readFixture<{ spec: string }>("crew-chatter-run-6-approved-spec-plan.json").spec },
];

/**
 * The entries labelled anything but `criterion`. Every other entry is labelled
 * `criterion` under the stated rule (`NARRATION_DEFAULT`).
 */
export const NARRATION_LABELS: Readonly<Record<string, LabelEntry<NarrationAnswer>>> = {
  "N-wc-numbering-L025": {
    label: "contains-remark",
    source: "recorded: spec-reconciliation-web-calculator-numbering-note.json provenance; docs/hazards.md entry 3, measured 2026-09-05 (the note became a criterion with ID Note and blocked the run)",
  },
  "N-wc-numbering-L049": {
    label: "contains-remark",
    source: `${PROPOSED}: AC-022 ends "the PRD does not specify a numeric contrast ratio, so the exact threshold is left as an open decision"; the prompt rule says no explanation, and an undecided part belongs under ## Open decisions`,
  },
  "N-nk-changed-locations-L131": {
    label: "contains-remark",
    source: `${PROPOSED}: AC-051 ends "the specific limit is an open implementation decision not fixed by this specification"; same rule`,
  },
};

export const NARRATION_DEFAULT: LabelEntry<NarrationAnswer> = {
  label: "criterion",
  source: `${PROPOSED}: every entry not listed in NARRATION_LABELS is a criterion`,
};

export function loadNarrationCases(): NarrationCase[] {
  const cases: NarrationCase[] = [];
  for (const source of NARRATION_SOURCES) {
    for (const { lines, entry } of acceptanceEntries(source.load())) {
      const id = `N-${source.short}-L${String(lines[0]).padStart(3, "0")}`;
      const labelled = NARRATION_LABELS[id] ?? NARRATION_DEFAULT;
      cases.push({ id, fixture: source.fixture, lines, entry, state: narrationState(entry), label: labelled.label, labelSource: labelled.source });
    }
  }
  const orphans = Object.keys(NARRATION_LABELS).filter((id) => !cases.some((c) => c.id === id));
  if (orphans.length > 0) throw new Error(`labels with no case: ${orphans.join(", ")}`);
  return cases;
}

// ---- the questions --------------------------------------------------------------

export function groundingQuestion(kind: GroundingCase["kind"]): ChoiceQuestion {
  return { type: "choice", instructions: kind === "addition" ? ADDITION_QUESTION_TEXT : REJECTION_QUESTION_TEXT, criteria: { ...GROUNDING_OPTIONS } };
}
