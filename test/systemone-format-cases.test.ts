import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPLAY, TEST5, replayLabels } from "../scripts/systemone-d6-evaluation.ts";
import { ACCEPTANCE_SECTION_RULE } from "../src/narration-check.ts";
import {
  GROUNDING_LABELS,
  NARRATION_LABELS,
  loadGroundingCases,
  loadNarrationCases,
} from "../scripts/systemone-format-cases.ts";

/**
 * The format-check case sets (`docs/features/decision-1-format-checks/plan.md`).
 * Each expected value below comes from a fixture's own provenance, a hazard
 * entry or the prompt source, never from the module under test.
 */
const RECORDED = join(process.cwd(), "test", "fixtures", "recorded");
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

const GROUNDING = loadGroundingCases();
const NARRATION = loadNarrationCases();

test("every case id is unique, and every label names its source", () => {
  for (const cases of [GROUNDING, NARRATION]) {
    const ids = cases.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of cases) {
      assert.match(c.labelSource, /^(recorded: |proposed 2026-10-17 by the assistant; awaits the operator)/, c.id);
      assert.ok(existsSync(join(RECORDED, c.fixture)), `${c.id} names a missing fixture`);
    }
  }
  for (const id of Object.keys(GROUNDING_LABELS)) assert.ok(GROUNDING.some((c) => c.id === id), id);
  for (const id of Object.keys(NARRATION_LABELS)) assert.ok(NARRATION.some((c) => c.id === id), id);
});

test("the PRD plan reconciliation yields its recorded three additions, not its one removal", () => {
  // Provenance: "The delta is three added nodes and one removed node".
  const provenance = JSON.parse(readFileSync(join(RECORDED, "plan-reconciliation-web-calculator-prd.json"), "utf8")).provenance.what as string;
  assert.match(provenance, /three added nodes and one removed node/);
  const additions = GROUNDING.filter((c) => c.fixture === "plan-reconciliation-web-calculator-prd.json");
  assert.equal(additions.length, 3);
  const replacement = additions.filter((c) => c.state.includes("\nReplacing: "));
  assert.equal(replacement.length, 1, "the one removal is shown as the replaced text of its own decision");
});

test("every rejection case cites an excerpt of the approved specification, and the uncited 214 rejection is left out", () => {
  const spec = collapse(JSON.parse(readFileSync(join(RECORDED, "crew-chatter-run-6-approved-spec-plan.json"), "utf8")).spec);
  const rejections = GROUNDING.filter((c) => c.kind === "rejection");
  for (const c of rejections) {
    const excerpt = /\nCited excerpt \(approved specification\): (.*)$/.exec(c.state)?.[1];
    assert.ok(excerpt && spec.includes(collapse(excerpt)), c.id);
  }
  // Test 5's result: "one 214 rejection whose quote was not in the spec (the check caught it)".
  assert.match(TEST5.provenance.result!, /one 214 rejection whose quote was not in the spec/);
  assert.ok(!rejections.some((c) => c.id.startsWith("R-214-")));
});

test("every rejection label agrees with its finding's label fixed before the recorded calls", () => {
  const replay = replayLabels(REPLAY.reconcilerSource);
  const sets = [replay, TEST5.sets["5a"].labels, TEST5.sets["5b"].labels];
  const labelOf = (id: number) => {
    const found = sets.flatMap((s) => (["keep", "reject", "either"] as const).filter((l) => s[l].includes(id)));
    assert.equal(found.length, 1, `finding ${id}`);
    return found[0]!;
  };
  for (const c of GROUNDING.filter((g) => g.kind === "rejection")) {
    const finding = labelOf(Number(c.id.split("-")[1]));
    if (finding === "reject") assert.equal(c.label, "supports", c.id);
    if (finding === "keep") assert.equal(c.label, "does-not-support", c.id);
    if (finding === "either") {
      // An either finding is judged only where a recorded result says the quote does not support it.
      if (c.label !== "either") {
        assert.equal(c.label, "does-not-support", c.id);
        assert.match(c.labelSource, /provenance\.result/, c.id);
      }
    }
  }
});

test("the section rule is the spec author prompt's own wording", () => {
  const source = collapse(readFileSync(join(process.cwd(), "src", "prompts.ts"), "utf8"));
  assert.ok(source.includes(ACCEPTANCE_SECTION_RULE));
});

test("the narration set holds every criterion line of its four documents, and the recorded note as one entry", () => {
  const numbering = NARRATION.filter((c) => c.fixture === "spec-reconciliation-web-calculator-numbering-note.json");
  // Provenance: the author "wrote a prose 'Note:' line as the first item under '## Acceptance criteria'".
  const note = numbering[0]!;
  assert.match(note.entry, /^Note: /);
  assert.equal(note.id, "N-wc-numbering-L025");
  assert.equal(note.label, "contains-remark");
  for (const fixture of new Set(NARRATION.map((c) => c.fixture))) {
    const entries = NARRATION.filter((c) => c.fixture === fixture);
    const criteria = entries.filter((c) => /^- AC-\d{3}: /.test(c.entry));
    assert.equal(entries.length - criteria.length, fixture === note.fixture ? 1 : 0, fixture);
  }
  // Each document's criterion lines, counted by a pattern over its text rather than by the parser.
  const counted = (spec: string) => (/## Acceptance criteria\n([\s\S]*?)\n## /.exec(spec.replace(/\r\n/g, "\n"))?.[1] ?? "").match(/^- AC-\d{3}: /gm)?.length;
  const listMarker = JSON.parse(readFileSync(join(RECORDED, "spec-reconciliation-web-calculator-list-marker.json"), "utf8")).afterSpec;
  const run6 = JSON.parse(readFileSync(join(RECORDED, "crew-chatter-run-6-approved-spec-plan.json"), "utf8")).spec;
  assert.equal(NARRATION.filter((c) => c.fixture === "spec-reconciliation-web-calculator-list-marker.json").length, counted(listMarker));
  assert.equal(NARRATION.filter((c) => c.fixture === "crew-chatter-run-6-approved-spec-plan.json").length, counted(run6));
});

test("the case sets have the recorded and proposed shape reported to the operator", () => {
  const tally = (cases: Array<{ label: string }>) => cases.reduce<Record<string, number>>((t, c) => ({ ...t, [c.label]: (t[c.label] ?? 0) + 1 }), {});
  assert.deepEqual(tally(GROUNDING.filter((c) => c.kind === "rejection")), { supports: 3, either: 3, "does-not-support": 2 });
  assert.deepEqual(tally(GROUNDING.filter((c) => c.kind === "addition")), { supports: 12, "does-not-support": 1, either: 2 });
  assert.deepEqual(tally(NARRATION), { criterion: 128, "contains-remark": 3 });
});
