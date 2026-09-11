import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { appendAudit } from "../src/audit.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { freezeProfile } from "../src/profile.ts";
import { openStore } from "../src/store.ts";
import { validateSpecDoc } from "../src/spec-doc.ts";
import { validatePlanDoc } from "../src/plan-doc.ts";

const CLI = resolve("src", "cli.ts");

test("low-level consumers resolve stored evidence against the selected repository", async (t) => {
  for (const command of ["plan", "implement", "verify", "review", "deliver"]) {
    for (const absolute of [false, true]) {
      await t.test(`${command}: ${absolute ? "absolute" : "relative"} evidence from another cwd`, () => {
        const root = mkdtempSync(join(tmpdir(), "bw-relative-evidence-"));
        const git = spawnSync("git", ["init", "-q", root], { encoding: "utf8" });
        assert.equal(git.status, 0, git.stderr);
        const store = openStore(root);
        try {
          const run = store.insertRun("project", "f-1", "demo", "feature");
          const start = "a".repeat(40);
          const frozen = freezeProfile(root, run.id, start, "fixture-model", {
            commands: [{ name: "node", command: ["node", "--version"] }],
          });
          store.setProfileRef(run.id, frozen.hash);
          const ref = (path: string) => absolute ? path : relative(root, path);
          const specPath = join(root, "docs", "features", "demo", "spec.md");
          const spec = "feature: demo\nchange_kind: feature\n\n## Declared artifacts\n\n- src/a.ts\n\n## Acceptance criteria\n\n- AC-001: the artifact is delivered\n";
          assert.equal(validateSpecDoc(spec).ok, true);
          const specHash = sha256Hex(normalizeText(spec));
          mkdirSync(dirname(specPath), { recursive: true });
          writeFileSync(specPath, spec);
          let previous: number | null = null;
          const stage = (kind: string, output: string) => {
            const row = store.insertStage(run.id, kind, previous);
            store.completeStage(row.id, output, "pass");
            previous = row.id;
            return row;
          };
          const audit = (stageId: number, action: string, summary: string) => appendAudit(store, {
            runId: run.id, stageId, actor: "system", actorType: "cli", action, summary,
          });
          stage("spec", ref(specPath));
          const specReview = stage("spec_review", ref(specPath));
          audit(specReview.id, "spec.gate.pass", `specHash=${specHash}; risk=low`);
          stage("awaiting_approval", ref(specPath));
          store.insertApproval({
            runId: run.id, featureId: run.feature_id, specHash, startingCommit: start,
            profileHash: frozen.hash, risk: "low", scope: canonicalJson(["src/a.ts"]),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(), signature: "sig", signer: "signer",
          });
          let expected: RegExp = /the spec has changed since review/;
          if (command === "plan") {
            writeFileSync(specPath, `${spec}\nchanged\n`);
          } else {
            const planPath = join(dirname(specPath), "plan.md");
            const plan = `feature: demo\nplan_for: ${specHash}\n\n## Tasks\n\n- Deliver the artifact\n\n## Coverage\n\n- AC-001 -> src/a.ts\n`;
            assert.equal(validatePlanDoc(plan).ok, true);
            writeFileSync(planPath, plan);
            stage("plan", ref(planPath));
            const planReview = stage("plan_review", ref(planPath));
            audit(planReview.id, "plan.gate.pass", `planHash=${sha256Hex(normalizeText(plan))}; planFor=${specHash}`);
            expected = /the spec has changed since approval/;
            if (command === "implement") {
              writeFileSync(specPath, `${spec}\nchanged\n`);
            } else {
              const tree = join(root, ".governance", "worktrees", String(run.id));
              mkdirSync(tree, { recursive: true });
              stage("implementation", ref(tree));
              expected = /has no implementation.gate.pass audit event/;
              if (command !== "verify") {
                const recordPath = join(root, ".governance", "verification", String(run.id), "result.json");
                const verification = stage("verification", ref(recordPath));
                mkdirSync(dirname(recordPath), { recursive: true });
                writeFileSync(recordPath, JSON.stringify({
                  runId: run.id, stageId: verification.id, worktreePath: tree,
                  verifiedCommit: "c".repeat(40), patchBase: "b".repeat(40), outcome: "pass",
                }));
                audit(verification.id, "verification.gate.pass", `verified ${"c".repeat(40)} in ${tree} with 0 command(s)`);
                expected = /the spec has changed since approval/;
                if (command === "review") {
                  writeFileSync(specPath, `${spec}\nchanged\n`);
                } else {
                  const reviewPath = join(root, ".governance", "code-review", String(run.id), "result.json");
                  stage("code_review", ref(reviewPath));
                  mkdirSync(dirname(reviewPath), { recursive: true });
                  // The parser must reach the selected file and name its content,
                  // never a wrong-cwd missing-file error or a paid stage call.
                  writeFileSync(reviewPath, "{}");
                  expected = /code-review record .* is invalid: the record does not describe this run's passed code review/;
                }
              }
            }
          }
          const before = store.query("SELECT * FROM agent_run");
          const child = spawnSync(process.execPath, [CLI, command, "--repo", root, "--run", String(run.id)], {
            cwd: process.cwd(), encoding: "utf8",
          });
          assert.equal(child.status, 1, child.stderr);
          assert.match(child.stderr, expected);
          assert.deepEqual(store.query("SELECT * FROM agent_run"), before, "all cases stop before provider dispatch");
        } finally {
          store.close();
          rmSync(root, { recursive: true, force: true });
        }
      });
    }
  }
});
