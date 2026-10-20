import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ContainerError,
  createSandbox,
  destroySandbox,
  dockerReady,
  ensureImage,
  execTarget,
  missingImagePrograms,
  removeIgnoredOutputInContainer,
  runInSandbox,
  sandboxLeftovers,
} from "../src/container.ts";
import {
  STAND_IN,
  STAND_IN_IMAGE_ID,
  markNoExitStatus,
  markUnremovable,
  standInSandbox,
} from "./fixtures/docker/stand-in.ts";

/**
 * The Docker stand-in is held to recorded real output
 * (docs/features/sandboxed-implementer/plan.md, Task 4; hard rule 5): every
 * form `src/container.ts` parses answers with the bytes
 * `test/fixtures/recorded/docker-cli-outputs.json` recorded, and every other
 * form is refused.
 */

interface RecordedForm {
  label: string;
  argv: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}
const RECORDED = JSON.parse(readFileSync("test/fixtures/recorded/docker-cli-outputs.json", "utf8")) as {
  provenance: { image: { tag: string; imageId: string } };
  forms: RecordedForm[];
};
const form = (label: string): RecordedForm => RECORDED.forms.find((f) => f.label === label)!;

function standIn(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [STAND_IN, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Replay a recorded form's argv (after `docker`) against the stand-in and compare all three channels. */
function sameAsRecorded(label: string, argv = form(label).argv.slice(1)): void {
  const recorded = form(label);
  const answer = standIn(argv);
  assert.deepEqual(
    { exitCode: answer.status, stdout: answer.stdout, stderr: answer.stderr },
    { exitCode: recorded.exitCode, stdout: recorded.stdout, stderr: recorded.stderr },
    label
  );
}

test("the stand-in answers the parsed forms with the recorded bytes", () => {
  assert.equal(STAND_IN_IMAGE_ID, RECORDED.provenance.image.imageId);
  for (const label of [
    "version",
    "image inspect, present tag",
    "image inspect, present ID",
    "image inspect, absent",
    "program check",
    // The recorded container and network no longer exist in the stand-in either.
    "container inspect, removed",
    "exec against a removed container",
    "exit-status file read, removed container",
    "rm -f, removed",
    "network rm, removed",
  ]) {
    sameAsRecorded(label);
  }
});

test("created objects, the exit-status wrapper and its file read take the recorded shapes", () => {
  const dir = mkdtempSync(join(tmpdir(), "bw-stand-in-"));
  try {
    const network = standIn(["network", "create", "--internal", "--label", "bw.repo=standin", "n"]);
    assert.match(network.stdout, /^[0-9a-f]{64}\n$/);
    assert.match(form("network create").stdout, /^[0-9a-f]{64}\n$/);
    const run = standIn(["run", "-d", "--name", "bw-standin-test-work", "--label", "bw.repo=standin", "-v", `${dir}:/work`, "-w", "/work", STAND_IN_IMAGE_ID, "sleep", "infinity"]);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^[0-9a-f]{64}\n$/);
    assert.match(form("run -d").stdout, /^[0-9a-f]{64}\n$/);
    const id = run.stdout.trim();
    const token = "0123456789abcdef";
    const wrapper = `timeout --signal=KILL "$0" "$@"; echo $? > /tmp/bw-exit-${token}`;
    const exec = standIn(["exec", "-i", id, "sh", "-c", wrapper, "30", "node", "-e", "process.exit(3)"]);
    assert.equal(exec.status, form("exec with the exit-status wrapper, failing command").exitCode);
    const read = standIn(["exec", id, "cat", `/tmp/bw-exit-${token}`]);
    assert.deepEqual([read.status, read.stdout, read.stderr], [0, form("exit-status file read, present").stdout, ""]);
    const absentToken = form("exit-status file read, absent").argv.at(-1)!.slice("/tmp/bw-exit-".length);
    const absent = standIn(["exec", id, "cat", `/tmp/bw-exit-${absentToken}`]);
    assert.deepEqual([absent.status, absent.stdout, absent.stderr], [1, "", form("exit-status file read, absent").stderr]);
    assert.equal(standIn(["container", "inspect", "--format", "{{.Id}}", id]).stdout, `${id}\n`);
    assert.equal(standIn(["ps", "-a", "--filter", "label=bw.repo=standin", "--format", "{{.ID}} {{.Names}}"]).stdout, `${id.slice(0, 12)} bw-standin-test-work\n`);
    assert.equal(standIn(["rm", "-f", id]).stdout, `${id}\n`);
    assert.equal(standIn(["network", "rm", network.stdout.trim()]).stdout, network.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the stand-in refuses every form it does not implement", () => {
  for (const args of [["pull", "node"], ["image", "rm", "x"], ["exec", "x", "ls"], ["run", "--privileged", "x"], ["network", "create", "n"]]) {
    const answer = standIn(args);
    assert.equal(answer.status, 2, args.join(" "));
    assert.match(answer.stderr, /^docker stand-in: unimplemented form: /);
  }
});

function target(): { root: string; worktree: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "bw-stand-in-target-"));
  const worktree = join(root, "wt");
  mkdirSync(worktree);
  writeFileSync(join(worktree, ".git"), "gitdir: elsewhere\n");
  return { root, worktree, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("src/container.ts runs against the stand-in: readiness, image, sandbox, command and teardown", async () => {
  const frozen = standInSandbox();
  assert.deepEqual(dockerReady(frozen.dockerCommand), { ok: true, serverVersion: "29.8.2" });
  assert.equal(ensureImage(frozen.dockerCommand).imageId, STAND_IN_IMAGE_ID);
  assert.deepEqual(missingImagePrograms(frozen, ["npm", "dotnet", "sh"]), ["dotnet"]);
  const t = target();
  try {
    const sandbox = createSandbox({ frozen, rootDir: t.root, runId: 4, label: "verify", worktreePath: t.worktree });
    const options = { cwd: t.worktree, timeoutSeconds: 30, maxBytes: 65536, retentionMaxBytes: 65536, evidencePath: join(t.root, "e.log") };
    const outcome = await runInSandbox(execTarget(sandbox), frozen.imageId, { name: "fail", command: ["node", "-e", "process.stdout.write('hi');process.exit(3)"] }, options);
    assert.equal(outcome.exitCode, 3);
    assert.equal(outcome.stdout, "hi");
    assert.deepEqual(outcome.argv, ["node", "-e", "process.stdout.write('hi');process.exit(3)"]);
    assert.equal(sandboxLeftovers(frozen.dockerCommand, t.root).containers.length, 2);
    const teardown = destroySandbox(sandbox);
    assert.deepEqual(teardown, { removed: [sandbox.work, sandbox.proxy, sandbox.network], failures: [], workContainerGone: true });
    assert.deepEqual(sandboxLeftovers(frozen.dockerCommand, t.root), { containers: [], networks: [] });
  } finally {
    t.cleanup();
  }
});

test("a container marked unremovable is not reported gone, and an absent exit-status file is a ContainerError", async () => {
  const frozen = standInSandbox();
  const t = target();
  try {
    const sandbox = createSandbox({ frozen, rootDir: t.root, runId: 4, label: "verify", worktreePath: t.worktree });
    const unmarkNoExit = markNoExitStatus(sandbox.work);
    try {
      await assert.rejects(
        runInSandbox(execTarget(sandbox), frozen.imageId, { name: "x", command: ["node", "--version"] }, {
          cwd: t.worktree, timeoutSeconds: 30, maxBytes: 65536, retentionMaxBytes: 65536, evidencePath: join(t.root, "x.log"),
        }),
        (err: unknown) => err instanceof ContainerError && err.operation === "read exit status in" && /No such file or directory/.test(err.message)
      );
    } finally {
      unmarkNoExit();
    }
    const unmark = markUnremovable(sandbox.work);
    try {
      const teardown = destroySandbox(sandbox);
      assert.equal(teardown.workContainerGone, false);
      assert.match(teardown.failures[0]!, /^remove work container .* failed \(docker exit 1\)/);
      assert.match(teardown.failures[1]!, /still exists after removal/);
    } finally {
      unmark();
      destroySandbox(sandbox);
    }
  } finally {
    t.cleanup();
  }
});

test("ignored output is removed through the stand-in's removal container", () => {
  const frozen = standInSandbox();
  const t = target();
  try {
    mkdirSync(join(t.worktree, "dist", "deep"), { recursive: true });
    writeFileSync(join(t.worktree, "dist", "deep", "a.js"), "x");
    writeFileSync(join(t.worktree, "keep.txt"), "x");
    removeIgnoredOutputInContainer(frozen, t.worktree, ["dist"]);
    assert.equal(existsSync(join(t.worktree, "dist")), false);
    assert.equal(existsSync(join(t.worktree, "keep.txt")), true);
  } finally {
    t.cleanup();
  }
});
