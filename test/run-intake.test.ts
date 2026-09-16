import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { verifyAuditChain } from "../src/audit.ts";
import { profilePath } from "../src/paths.ts";
import { createRunIntake, RunIntakeFreezeError } from "../src/run-intake.ts";
import { openStore } from "../src/store.ts";

function workspace(): string {
  return mkdtempSync(join(dirname(resolve(".")), ".buildworks-intake-"));
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function repository(root: string): void {
  git(root, "init", "-q");
  writeFileSync(join(root, ".gitignore"), ".governance/\n");
  writeFileSync(join(root, "governed.yaml"), 'verify:\n  - name: unit\n    command: ["node", "--version"]\n');
  git(root, "add", "-A");
  git(root, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "-qm", "base");
}

test("shared intake writes the existing run, audit, and frozen-profile contract", () => {
  const root = workspace();
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  process.env.BW_APPROVAL_PUBLIC_KEY = join(root, "missing-public.pem");
  try {
    repository(root);
    const store = openStore(root);
    try {
      const created = createRunIntake(store, root, {
        project: "project",
        featureId: "feature-1",
        slug: "feature-one",
        changeKind: "feature",
        model: "test-model",
      });
      assert.equal(created.run.id, 1);
      assert.equal(created.run.project, "project");
      assert.equal(created.run.feature_id, "feature-1");
      assert.equal(created.run.slug, "feature-one");
      assert.equal(created.run.change_kind, "feature");
      assert.equal(created.run.profile_ref, created.profileHash);
      const profile = JSON.parse(readFileSync(profilePath(root, created.run.id), "utf8"));
      assert.equal(profile.approvalSigner, null, "low-level intake retains its existing unbound behavior");
      assert.deepEqual(store.getAuditEvents(created.run.id).map((event) => event.action),
        ["run.create", "profile.freeze"]);
      assert.equal(verifyAuditChain(store), null);
    } finally {
      store.close();
    }
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
  }
});

test("guided intake requires a usable public key before inserting a run", () => {
  const root = workspace();
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  process.env.BW_APPROVAL_PUBLIC_KEY = `${root}-missing-public.pem`;
  try {
    repository(root);
    const store = openStore(root);
    try {
      assert.throws(() => createRunIntake(store, root, {
        project: "project",
        featureId: "feature-1",
        slug: "feature-one",
        changeKind: "feature",
        model: "test-model",
      }, { requireApprovalSigner: true }), /approval public key not found/);
      assert.deepEqual(store.query("SELECT * FROM run"), []);
      assert.deepEqual(store.query("SELECT * FROM audit"), []);
    } finally {
      store.close();
    }
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a shared profile-freeze failure blocks and audits the created run", () => {
  const root = workspace();
  const keyDirectory = `${root}-keys`;
  const beforeKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    repository(root);
    mkdirSync(keyDirectory);
    const { publicKey } = generateKeyPairSync("ed25519");
    const publicPath = join(keyDirectory, "approval.pub");
    writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }));
    process.env.BW_APPROVAL_PUBLIC_KEY = publicPath;
    const store = openStore(root);
    try {
      mkdirSync(join(root, ".governance", "profiles"), { recursive: true });
      writeFileSync(join(root, ".governance", "profiles", "1"), "collision\n");
      assert.throws(() => createRunIntake(store, root, {
        project: "project",
        featureId: "feature-1",
        slug: "feature-one",
        changeKind: "feature",
        model: "test-model",
      }), (error: unknown) => {
        assert.ok(error instanceof RunIntakeFreezeError);
        assert.equal(error.runId, 1);
        return true;
      });
      assert.equal(store.getRun(1)!.status, "blocked");
      assert.deepEqual(store.getAuditEvents(1).map((event) => event.action),
        ["run.create", "profile.freeze.failed"]);
      assert.equal(verifyAuditChain(store), null);
    } finally {
      store.close();
    }
  } finally {
    if (beforeKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = beforeKey;
    rmSync(root, { recursive: true, force: true });
    rmSync(keyDirectory, { recursive: true, force: true });
  }
});
