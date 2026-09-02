import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  freezeProfile,
  invalidProfileReason,
  loadVerifiedProfile,
  loadProfile,
  requireFrozenBinding,
  requiredCapability,
  resolveStageModel,
  resolveStartingCommit,
} from "../src/profile.ts";
import { AGENTS } from "../src/agents.ts";
import { CLAUDE_CODE } from "../src/executor.ts";
import { PANEL_SIZE_MAX, REQUIRED_SPECIALTIES, buildPolicy, policyHash } from "../src/policy.ts";
import type { VerificationConfig } from "../src/governed-config.ts";
import { canonicalJson, sha256Hex } from "../src/canonical.ts";

const COMMIT = "b".repeat(40);
const MODEL = "test-model";
/** One minimal frozen configuration, shared by every call site in this file. */
const VERIFICATION: VerificationConfig = { commands: [{ name: "unit", command: ["node", "--version"] }] };

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "bw-profile-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("freezeProfile then loadProfile round-trips with an identical hash", () => {
  withRoot((root) => {
    const frozen = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    const loaded = loadProfile(root, 1);
    assert.equal(loaded.hash, frozen.hash);
    assert.deepEqual(loaded.profile, frozen.profile);
  });
});

test("freezeProfile refuses a model name the spawn cannot carry", () => {
  // The model name is operator input that reaches a spawn, and on Windows a
  // space in the name corrupts the child's argv — the audit would record one
  // invocation and the shell would run another.
  withRoot((root) => {
    assert.throws(
      () => freezeProfile(root, 1, COMMIT, "gpt-4 mini", VERIFICATION),
      /invalid model name "gpt-4 mini": must be 1-64 characters of letters, digits, dot, underscore, or hyphen, starting with a letter or digit/
    );
    assert.throws(() => freezeProfile(root, 1, COMMIT, " ", VERIFICATION), /invalid model name/);
  });
});

test("altering the profile file changes its hash", () => {
  withRoot((root) => {
    const frozen = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    appendFileSync(frozen.path, " ");
    assert.notEqual(loadProfile(root, 1).hash, frozen.hash);
  });
});

test("the profile records every seeded agent and the executor", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    assert.deepEqual(
      profile.agents.map((a) => a.id).sort(),
      [...AGENTS].map((a) => a.id).sort()
    );
    assert.equal(profile.executor.id, CLAUDE_CODE.id);
    assert.equal(profile.startingCommit, COMMIT);
    assert.equal(profile.runId, 1);
  });
});

test("the profile's policy hash is the live policy's hash", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    assert.equal(profile.policyHash, policyHash(buildPolicy()));
    assert.equal(profile.policyHash, policyHash(profile.policy));
  });
});

test("two freezes differ by their timestamp but agree on policy", () => {
  withRoot((root) => {
    const a = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    const b = freezeProfile(root, 2, COMMIT, MODEL, VERIFICATION);
    assert.notEqual(a.hash, b.hash);
    assert.equal(a.profile.policyHash, b.profile.policyHash);
  });
});

test("a missing profile is refused naming the run and the path", () => {
  withRoot((root) => {
    assert.throws(() => loadProfile(root, 7), /no frozen profile for run 7 at .+profile\.json/);
  });
});

test("resolveStartingCommit returns null outside a git repository", () => {
  withRoot((root) => {
    assert.equal(resolveStartingCommit(root), null);
  });
});

test("resolveStartingCommit reads HEAD inside this repository", () => {
  const commit = resolveStartingCommit(process.cwd());
  assert.match(commit ?? "", /^[0-9a-f]{40}$/);
});

test("resolveStartingCommit reads HEAD in a sha256 object-format repository", () => {
  withRoot((root) => {
    // Asserted, not skipped: git 2.29 and newer support this, and a git too
    // old to run it should fail the test rather than pass it vacuously.
    const init = spawnSync("git", ["init", "-q", "--object-format=sha256", root], { encoding: "utf8" });
    assert.equal(init.status, 0, `git init --object-format=sha256 failed: ${init.stderr}`);
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    };
    const commit = spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "base"], { cwd: root, env, encoding: "utf8" });
    assert.equal(commit.status, 0, commit.stderr);
    // A sha256 repository's OIDs are 64 hex characters. Rejecting them makes
    // the run freeze `startingCommit: null`, and the approval gate then
    // refuses with "not created in a git repository" — a wrong reason for a
    // real repository.
    assert.match(resolveStartingCommit(root) ?? "", /^[0-9a-f]{64}$/);
  });
});

test("the profile freezes the approval key fingerprint, or null when none is configured", () => {
  const before = process.env.BW_APPROVAL_PUBLIC_KEY;
  const keyDir = mkdtempSync(join(tmpdir(), "bw-profile-key-"));
  try {
    withRoot((root) => {
      // Pointed at a path that cannot exist, not deleted: the deleted fallback
      // is the default ~/.buildworks/approval.pub, which the operator's real
      // machine may well have — then the freeze would bind that key and this
      // null assertion would fail for an environment reason.
      process.env.BW_APPROVAL_PUBLIC_KEY = join(keyDir, "no-such-key.pub");
      // No key at intake is the normal case on a fresh machine and must not
      // fail run creation — it records null and the gate says so in the audit.
      assert.equal(freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION).profile.approvalSigner, null);

      const { publicKey } = generateKeyPairSync("ed25519");
      const der = publicKey.export({ format: "der", type: "spki" });
      const pubPath = join(keyDir, "approval.pub");
      writeFileSync(pubPath, publicKey.export({ format: "pem", type: "spki" }) as string);
      process.env.BW_APPROVAL_PUBLIC_KEY = pubPath;
      // The expected value comes from the key's own DER encoding, not from
      // anything this test invented: it is the same identifier the gate
      // recomputes at approve time.
      assert.equal(freezeProfile(root, 2, COMMIT, MODEL, VERIFICATION).profile.approvalSigner, sha256Hex(der));
    });
  } finally {
    if (before === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = before;
    rmSync(keyDir, { recursive: true, force: true });
  }
});

test("the profile freezes one model entry per stage kind", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, "chosen-model", VERIFICATION);
    assert.deepEqual(profile.modelMap, {
      spec: "chosen-model",
      spec_review: "chosen-model",
      plan: "chosen-model",
      plan_review: "chosen-model",
      implementation: "chosen-model",
    });
    assert.deepEqual(resolveStageModel(profile, "plan"), { ok: true, model: "chosen-model" });
  });
});

test("resolveStageModel refuses an unmapped stage kind naming the mapped ones", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    const result = resolveStageModel(profile, "verification");
    assert.equal(result.ok, false);
    if (result.ok) return;
    // Section 10: the failure is at configuration time and must name what the
    // frozen profile does map, so the operator can see what is missing.
    assert.match(result.reason, /no model configured for stage verification/);
    assert.match(result.reason, /spec, spec_review, plan, plan_review, implementation/);
  });
});

test("requiredCapability maps the five dispatchable stage kinds", () => {
  assert.equal(requiredCapability("spec"), "spec");
  assert.equal(requiredCapability("spec_review"), "review");
  assert.equal(requiredCapability("plan"), "plan");
  assert.equal(requiredCapability("plan_review"), "review");
  assert.equal(requiredCapability("implementation"), "implementation");
  assert.equal(requiredCapability("verification"), null);
});

test("requireFrozenBinding accepts the frozen executor with the required capability", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    assert.deepEqual(requireFrozenBinding(profile, CLAUDE_CODE, "implementation"), { ok: true });
    assert.deepEqual(requireFrozenBinding(profile, CLAUDE_CODE, "spec_review"), { ok: true });
  });
});

test("requireFrozenBinding refuses an executor that differs from the frozen one, even with the same id", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    const different = {
      ...CLAUDE_CODE,
      sandbox: { ...CLAUDE_CODE.sandbox, idleTimeoutSeconds: 999 },
    };
    const verdict = requireFrozenBinding(profile, different, "implementation");
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.match(verdict.reason, /does not match the executor frozen at run start/);
  });
});

test("requireFrozenBinding refuses a missing capability naming capability and kind", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    const without = {
      ...profile,
      executor: {
        ...CLAUDE_CODE,
        capabilities: CLAUDE_CODE.capabilities.filter((c) => c !== "implementation"),
      },
    };
    const verdict = requireFrozenBinding(without, without.executor, "implementation");
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.match(verdict.reason, /lacks the required capability "implementation" for stage kind implementation/);
  });
});

test("requireFrozenBinding refuses an unknown stage kind by name", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    const verdict = requireFrozenBinding(profile, CLAUDE_CODE, "delivery_check");
    assert.equal(verdict.ok, false);
    if (verdict.ok) return;
    assert.match(verdict.reason, /no executor capability defined for stage kind delivery_check/);
  });
});


// --- the frozen-profile validity rule (step 5b Task 3) ----------------------

/**
 * The exact policy shape this repository froze before step 5b Task 3, read off
 * `src/policy.ts` at commit cd11071: a per-risk panel map and a remediation
 * round count, with none of the four fields the review stages read today.
 *
 * Built by transforming the current policy rather than typed out in full, so
 * the fields that did *not* change cannot drift into being this file's opinion
 * of them. Only the difference the change actually made is stated here.
 */
function preTask3Policy(): Record<string, unknown> {
  const { specReviewRounds, planReviewRounds, panelSizeMin, panelSizeMax, ...carried } = buildPolicy();
  return { ...carried, panelSizes: { low: 1, standard: 2, high: 3 }, remediationRounds: 3 };
}

/**
 * Write a profile whose bytes are internally correct in every way the previous
 * code cared about — its `policyHash` describes its own policy and the run row
 * records the file's hash — but whose policy is the superseded shape.
 *
 * This is the case the decision is about. A corrupted or tampered profile is
 * already refused by the hash comparison; this one passes that comparison and
 * still cannot be executed.
 */
function writePreTask3Profile(root: string, runId: number): { hash: string } {
  const { profile } = freezeProfile(root, runId, COMMIT, MODEL, VERIFICATION);
  const policy = preTask3Policy();
  const stale = { ...profile, policy, policyHash: sha256Hex(canonicalJson(policy)) };
  const serialized = canonicalJson(stale);
  writeFileSync(join(root, ".governance", "profiles", String(runId), "profile.json"), serialized);
  return { hash: sha256Hex(serialized) };
}

test("the profile this code freezes is one it accepts", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    assert.equal(invalidProfileReason(profile), null);
  });
});

test("a current profile loads and verifies", () => {
  withRoot((root) => {
    const frozen = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    const verified = loadVerifiedProfile(root, { id: 1, profile_ref: frozen.hash });
    assert.equal(verified.ok, true, (verified as { reason?: string }).reason);
  });
});

test("a correctly hashed pre-Task-3 profile is refused by name, not migrated", () => {
  withRoot((root) => {
    const { hash } = writePreTask3Profile(root, 1);
    const verified = loadVerifiedProfile(root, { id: 1, profile_ref: hash });
    assert.equal(verified.ok, false, "a superseded policy shape must not execute");
    if (verified.ok) return;
    // Named, so an operator can tell this from a tampered profile.
    assert.match(verified.reason, /run 1 cannot be executed/);
    assert.match(verified.reason, /missing panelSizeMax, panelSizeMin, planReviewRounds, specReviewRounds/);
    assert.match(verified.reason, /carrying obsolete panelSizes, remediationRounds/);
    // And it says what the operator can still do, because the run's evidence
    // is not what became invalid.
    assert.match(verified.reason, /records and evidence remain readable/);
  });
});

test("the pre-Task-3 profile is refused for its shape, not for its hash", () => {
  // Otherwise this proves nothing: a profile that also failed the tamper check
  // would be refused whether or not the validity rule existed.
  withRoot((root) => {
    const { hash } = writePreTask3Profile(root, 1);
    const verified = loadVerifiedProfile(root, { id: 1, profile_ref: hash });
    assert.equal(verified.ok, false);
    if (verified.ok) return;
    assert.ok(
      !verified.reason.includes("has been modified since intake"),
      `the tamper check fired instead of the validity check: ${verified.reason}`
    );
  });
});

test("a profile predating approvalSigner is refused, while a frozen null is honoured", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    // Null is a live, supported state: no key was configured at intake.
    assert.equal(invalidProfileReason({ ...profile, approvalSigner: null }), null);
    // Absent is an obsolete shape.
    const { approvalSigner, ...without } = profile;
    assert.match(String(invalidProfileReason(without)), /carries no approvalSigner/);
  });
});

test("a profile whose policyHash does not describe its own policy is refused", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    const lying = { ...profile, policyHash: "f".repeat(64) };
    assert.match(String(invalidProfileReason(lying)), /does not describe its own policy/);
  });
});

test("a profile with a policy value outside its bounds is refused", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    for (const patch of [
      { panelSizeMax: 6 },
      { panelSizeMin: 1 },
      { specReviewRounds: 0 },
      { planReviewRounds: 1.5 },
    ]) {
      const policy = { ...profile.policy, ...patch };
      // Hashed consistently, so the bounds check is what refuses it rather
      // than the self-consistency check above.
      const candidate = { ...profile, policy, policyHash: policyHash(policy as never) };
      assert.notEqual(
        invalidProfileReason(candidate),
        null,
        `${JSON.stringify(patch)} must be refused`
      );
    }
  });
});

test("a profile frozen under a different but legal configuration still executes", () => {
  // Hard rule 6: a run is governed by what it froze, not by what is configured
  // now. Only a value the code could not honour is refused.
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION);
    const policy = {
      ...profile.policy,
      panelSizeMax: 5,
      specReviewRounds: 3,
      materialityThreshold: "critical",
      requiredSpecialties: ["security"],
    };
    const candidate = { ...profile, policy, policyHash: policyHash(policy as never) };
    assert.equal(invalidProfileReason(candidate), null);
  });
});

test("the default installation staffs the configured panel", () => {
  // Hazard 11: a default installation must be able to create a run. Asserted
  // rather than assumed — if it stopped being true, nothing could start.
  withRoot((root) => {
    assert.doesNotThrow(() => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION));
  });
  assert.ok(PANEL_SIZE_MAX >= REQUIRED_SPECIALTIES.length);
});

test("a registry that cannot staff the configured panel refuses at freeze time", () => {
  // Section 11's rule applied to the panel: fail at configuration time, not at
  // the dispatch that would have spent money finding out. The refusal must
  // happen before the profile file exists — a run whose profile was written
  // and then rejected is a half-created run.
  withRoot((root) => {
    const depleted = AGENTS.filter((a) => a.role !== "reviewer");
    assert.throws(
      () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, { agents: depleted }),
      /cannot freeze a profile for run 1: the agent registry has no reviewer for required specialty requirements-traceability/
    );
    assert.equal(
      existsSync(join(root, ".governance", "profiles", "1", "profile.json")),
      false,
      "nothing may be written when the configuration is refused"
    );
  });
});

test("a registry with reviewers but too few distinct lenses is refused, naming the shortfall", () => {
  withRoot((root) => {
    const oneLens = AGENTS.map((a) =>
      a.role === "reviewer" ? { ...a, specialty: "requirements-traceability" } : a
    );
    assert.throws(
      () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, { agents: oneLens }),
      /seats 1 distinct reviewer specialty .* which cannot fill a panel of 2/
    );
  });
});

test("a required reviewer bound to another executor is refused before the profile is written", () => {
  withRoot((root) => {
    const wrongExecutor = AGENTS.map((agent) =>
      agent.specialty === "requirements-traceability"
        ? { ...agent, executor: "another-executor" }
        : agent
    );
    assert.throws(
      () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, { agents: wrongExecutor }),
      /no reviewer for required specialty requirements-traceability/
    );
    assert.equal(existsSync(join(root, ".governance", "profiles", "1", "profile.json")), false);
  });
});

test("duplicate eligible reviewer ids are refused before the profile is written", () => {
  withRoot((root) => {
    const reviewer = AGENTS.find((agent) => agent.role === "reviewer")!;
    const duplicateId = [...AGENTS, { ...reviewer, specialty: "database" }];
    assert.throws(
      () => freezeProfile(root, 1, COMMIT, MODEL, VERIFICATION, { agents: duplicateId }),
      /duplicate agent ids/
    );
    assert.equal(existsSync(join(root, ".governance", "profiles", "1", "profile.json")), false);
  });
});


/**
 * Route A rests entirely on this: the validity refusal lives in
 * `loadVerifiedProfile`, so it can only cover every execution path if every
 * execution path goes through it. A stage that called `loadProfile` directly
 * would skip both the tamper check and the validity check, and nothing else
 * would notice.
 */
test("every stage reaches the frozen profile through loadVerifiedProfile, never loadProfile", () => {
  const src = join(fileURLToPath(new URL("..", import.meta.url)), "src");
  const offenders: string[] = [];
  for (const file of [
    "spec-stage.ts",
    "plan-stage.ts",
    "implementation-stage.ts",
    "verification-stage.ts",
    "approval-stage.ts",
    "cli.ts",
  ]) {
    const source = readFileSync(join(src, file), "utf8");
    if (!source.includes("loadVerifiedProfile")) {
      offenders.push(`${file} never calls loadVerifiedProfile`);
    }
    if (/\bloadProfile\s*\(/.test(source)) {
      offenders.push(`${file} calls loadProfile directly, bypassing the verified door`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});
