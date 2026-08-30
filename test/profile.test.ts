import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freezeProfile, loadProfile, resolveStageModel, resolveStartingCommit } from "../src/profile.ts";
import { AGENTS } from "../src/agents.ts";
import { CLAUDE_CODE } from "../src/executor.ts";
import { buildPolicy, policyHash } from "../src/policy.ts";
import { sha256Hex } from "../src/canonical.ts";

const COMMIT = "b".repeat(40);
const MODEL = "test-model";

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
    const frozen = freezeProfile(root, 1, COMMIT, MODEL);
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
      () => freezeProfile(root, 1, COMMIT, "gpt-4 mini"),
      /invalid model name "gpt-4 mini": must be 1-64 characters of letters, digits, dot, underscore, or hyphen, starting with a letter or digit/
    );
    assert.throws(() => freezeProfile(root, 1, COMMIT, " "), /invalid model name/);
  });
});

test("altering the profile file changes its hash", () => {
  withRoot((root) => {
    const frozen = freezeProfile(root, 1, COMMIT, MODEL);
    appendFileSync(frozen.path, " ");
    assert.notEqual(loadProfile(root, 1).hash, frozen.hash);
  });
});

test("the profile records every seeded agent and the executor", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL);
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
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL);
    assert.equal(profile.policyHash, policyHash(buildPolicy()));
    assert.equal(profile.policyHash, policyHash(profile.policy));
  });
});

test("two freezes differ by their timestamp but agree on policy", () => {
  withRoot((root) => {
    const a = freezeProfile(root, 1, COMMIT, MODEL);
    const b = freezeProfile(root, 2, COMMIT, MODEL);
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
      assert.equal(freezeProfile(root, 1, COMMIT, MODEL).profile.approvalSigner, null);

      const { publicKey } = generateKeyPairSync("ed25519");
      const der = publicKey.export({ format: "der", type: "spki" });
      const pubPath = join(keyDir, "approval.pub");
      writeFileSync(pubPath, publicKey.export({ format: "pem", type: "spki" }) as string);
      process.env.BW_APPROVAL_PUBLIC_KEY = pubPath;
      // The expected value comes from the key's own DER encoding, not from
      // anything this test invented: it is the same identifier the gate
      // recomputes at approve time.
      assert.equal(freezeProfile(root, 2, COMMIT, MODEL).profile.approvalSigner, sha256Hex(der));
    });
  } finally {
    if (before === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = before;
    rmSync(keyDir, { recursive: true, force: true });
  }
});

test("the profile freezes one model entry per stage kind", () => {
  withRoot((root) => {
    const { profile } = freezeProfile(root, 1, COMMIT, "chosen-model");
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
    const { profile } = freezeProfile(root, 1, COMMIT, MODEL);
    const result = resolveStageModel(profile, "verification");
    assert.equal(result.ok, false);
    if (result.ok) return;
    // Section 10: the failure is at configuration time and must name what the
    // frozen profile does map, so the operator can see what is missing.
    assert.match(result.reason, /no model configured for stage verification/);
    assert.match(result.reason, /spec, spec_review, plan, plan_review, implementation/);
  });
});
