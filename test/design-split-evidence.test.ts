import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeText, sha256Hex } from "../src/canonical.ts";
import { readSpecDeclaredArtifacts, validateSpecDoc } from "../src/spec-doc.ts";
import { DESIGN_SPLIT_PATH_THRESHOLD, IMPLEMENTATION_MAX_PHASES, IMPLEMENTATION_PHASE_TASKS } from "../src/policy.ts";

/**
 * The evidence the design-split threshold rests on, copied from the targets'
 * stores (`test/fixtures/recorded/`, each with provenance). Crew-chatter run 4
 * is the motivating failure: its spec passed review and its plan did not fit
 * the frozen ceiling. The ratio rows are every recorded run with both a
 * signed scope and a plan its gate passed.
 */
const RUN_4 = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "spec-crew-chatter-run-4.json"), "utf8")
) as {
  provenance: { specHash: string; declaredPaths: number; criteria: number; planItems: number };
  specMarkdown: string;
};

const RATIOS = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "declared-paths-vs-plan-items.json"), "utf8")
) as { runs: { target: string; run: number; declaredPaths: number; planItems: number; source: string }[] };

test("the recorded crew-chatter run 4 spec is the spec its decision gate passed", () => {
  const result = validateSpecDoc(RUN_4.specMarkdown);
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) return;
  assert.equal(sha256Hex(normalizeText(RUN_4.specMarkdown)), RUN_4.provenance.specHash);
  assert.equal(readSpecDeclaredArtifacts(RUN_4.specMarkdown)!.length, RUN_4.provenance.declaredPaths);
  assert.equal(result.value.acceptanceCriteria.length, RUN_4.provenance.criteria);
});

test("the highest recorded ratio of plan items to declared files is team-notes run 10's 2.6", () => {
  const recoverable = RATIOS.runs.filter((r) => r.source !== "not recoverable");
  assert.equal(recoverable.length, RATIOS.runs.length);
  const ratios = recoverable.map((r) => r.planItems / r.declaredPaths);
  const max = Math.max(...ratios);
  const top = recoverable[ratios.indexOf(max)]!;
  assert.deepEqual([top.target, top.run, top.declaredPaths, top.planItems], ["team-notes", 10, 20, 52]);
  assert.equal(max, 2.6);
});

test("the split threshold is the frozen task ceiling divided by the highest recorded ratio, rounded down", () => {
  const maxRatio = Math.max(...RATIOS.runs.map((r) => r.planItems / r.declaredPaths));
  assert.equal(DESIGN_SPLIT_PATH_THRESHOLD, Math.floor((IMPLEMENTATION_PHASE_TASKS * IMPLEMENTATION_MAX_PHASES) / maxRatio));
});

test("crew-chatter run 4, the run that motivated the split, declares more files than the threshold", () => {
  assert.ok(
    RUN_4.provenance.declaredPaths > DESIGN_SPLIT_PATH_THRESHOLD,
    `${RUN_4.provenance.declaredPaths} declared files must exceed ${DESIGN_SPLIT_PATH_THRESHOLD}`
  );
});
