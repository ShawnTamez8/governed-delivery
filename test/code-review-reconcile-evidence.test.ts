import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeText, sha256Hex } from "../src/canonical.ts";
import { validateSpecDoc } from "../src/spec-doc.ts";

/**
 * The approved specification and plan the code-review reconciler replays read
 * (`docs/features/code-review-reconciler/plan.md`, Task 1), copied from
 * crew-chatter run 6's target with the hashes its store recorded. Task 3
 * checks the 30 recorded reconciler calls against these texts.
 */
const PINNED = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "crew-chatter-run-6-approved-spec-plan.json"), "utf8")
) as { provenance: { specHash: string; planHash: string }; spec: string; plan: string };

test("the pinned run 6 spec and plan hash to the values its store recorded", () => {
  assert.equal(sha256Hex(normalizeText(PINNED.spec)), PINNED.provenance.specHash, "approval.spec_hash");
  assert.equal(sha256Hex(normalizeText(PINNED.plan)), PINNED.provenance.planHash, "plan.gate.pass planHash");
});

test("the spec parser finds the same acceptance criteria the replay's regex found", () => {
  const parsed = validateSpecDoc(PINNED.spec);
  assert.equal(parsed.ok, true, (parsed as { reason?: string }).reason);
  if (!parsed.ok) return;
  const fromParser = new Set(parsed.value.acceptanceCriteria.map((criterion) => criterion.id));
  // The replay's own rule (`reconcilerSource` in the replay fixture).
  const fromReplay = new Set([...PINNED.spec.matchAll(/^- (AC-\d{3,}):/gm)].map((match) => match[1]));
  assert.ok(fromParser.size > 0);
  assert.deepEqual([...fromParser].sort(), [...fromReplay].sort());
});
