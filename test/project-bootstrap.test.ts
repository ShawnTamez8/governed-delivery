import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { chmodSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { Writable } from "node:stream";
import { test } from "node:test";
import { parseGovernedConfig } from "../src/governed-config.ts";
import { prepareGuidedProject } from "../src/project-bootstrap.ts";
import { checkIntakeRepository } from "../src/readiness.ts";

function workspace(): string {
  return mkdtempSync(join(dirname(resolve(".")), ".buildworks-bootstrap-"));
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function output() {
  let text = "";
  return {
    stream: new Writable({
      write(chunk, _encoding, done) {
        text += chunk.toString();
        done();
      },
    }),
    text: () => text,
  };
}

async function withTools<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const tools = join(root, "tools");
  mkdirSync(tools);
  const claude = join(tools, process.platform === "win32" ? "claude.exe" : "claude");
  copyFileSync(process.execPath, claude);
  if (process.platform !== "win32") chmodSync(claude, 0o755);
  const saved = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  };
  process.env.PATH = `${tools}${delimiter}${saved.PATH ?? ""}`;
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  process.env.GIT_CONFIG_GLOBAL = join(root, "no-global-gitconfig");
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function answers(...values: string[]) {
  const pending = [...values];
  return async () => pending.shift() ?? "";
}

test("an absent target becomes the exact committed static-web starter and waits for design", async () => {
  const root = workspace();
  const target = join(root, "My Guided App");
  try {
    await withTools(root, async () => {
      const declinedTarget = join(root, "declined");
      await assert.rejects(
        prepareGuidedProject(declinedTarget, {
          prompt: answers("static-web", "declined-feature", "Fixture User", "fixture@example.invalid", "no"),
          stdout: output().stream,
          invocationDirectory: root,
        }),
        /baseline commit declined/,
      );
      assert.notEqual(spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: declinedTarget,
        encoding: "utf8",
      }).status, 0);
      assert.equal(readFileSync(join(declinedTarget, ".gitignore"), "utf8"), ".governance/\nnode_modules/\n");

      const written = output();
      const prepared = await prepareGuidedProject(target, {
        prompt: answers("static-web", "first-feature", "Fixture User", "fixture@example.invalid", "yes"),
        stdout: written.stream,
        invocationDirectory: root,
      });
      assert.equal(prepared.waitingForDesign, true);
      assert.equal(prepared.slug, "first-feature");
      assert.deepEqual(git(target, "ls-tree", "-r", "--name-only", "HEAD").split(/\r?\n/).sort(), [
        ".gitignore",
        "README.md",
        "governed.yaml",
        "index.html",
        "package-lock.json",
        "package.json",
        "src/app.js",
        "test/starter.test.js",
      ]);
      assert.equal(git(target, "log", "-1", "--format=%s"), "Initialize BuildWorks static-web project");
      assert.equal(git(target, "status", "--porcelain"), "");
      assert.equal(git(target, "config", "--local", "user.name"), "Fixture User");
      assert.equal(git(target, "config", "--local", "user.email"), "fixture@example.invalid");
      assert.ok(existsSync(join(target, "docs", "features", "first-feature")));
      assert.ok(!existsSync(join(target, "docs", "features", "first-feature", "design.md")));
      assert.ok(!existsSync(join(root, ".buildworks")));
      const manifest = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
      assert.equal(manifest.name, "my-guided-app");
      assert.equal(manifest.private, true);
      assert.equal(manifest.scripts.test, "node --test");
      const config = parseGovernedConfig(readFileSync(join(target, "governed.yaml"), "utf8"));
      assert.ok(config.ok, config.ok ? "" : config.reason);
      assert.deepEqual(config.config.commands.map((command) => command.command), [["npm", "ci"], ["npm", "test"]]);
      const install = spawnSync("npm", ["ci"], { cwd: target, encoding: "utf8", shell: process.platform === "win32" });
      assert.equal(install.status, 0, install.stderr);
      const tested = spawnSync("npm", ["test"], { cwd: target, encoding: "utf8", shell: process.platform === "win32" });
      assert.equal(tested.status, 0, tested.stderr);
      assert.match(written.text(), /Generated static-web baseline/);
      assert.ok(written.text().includes(join(target, "docs", "features", "first-feature", "design.md")));
      assert.equal(checkIntakeRepository(target).ok, true);

      const head = git(target, "rev-parse", "HEAD");
      const repeat = output();
      const waiting = await prepareGuidedProject(target, {
        prompt: async () => { throw new Error("a design-wait rerun must not prompt"); },
        stdout: repeat.stream,
        invocationDirectory: root,
      });
      assert.equal(waiting.waitingForDesign, true);
      assert.equal(git(target, "rev-parse", "HEAD"), head);
      assert.equal(git(target, "status", "--porcelain"), "");
      assert.ok(repeat.text().includes("docs\\features\\first-feature\\design.md") ||
        repeat.text().includes("docs/features/first-feature/design.md"));
      rmSync(join(target, "docs"), { recursive: true, force: true });
      const restored = await prepareGuidedProject(target, {
        prompt: async () => { throw new Error("restoring the owned empty directory must not prompt"); },
        stdout: output().stream,
        invocationDirectory: root,
      });
      assert.equal(restored.waitingForDesign, true);
      assert.ok(existsSync(join(target, "docs", "features", "first-feature")));
      assert.equal(git(target, "rev-parse", "HEAD"), head);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rerun commits only the nonempty operator design and refuses accompanied dirt", async () => {
  const root = workspace();
  const target = join(root, "design-target");
  try {
    await withTools(root, async () => {
      await prepareGuidedProject(target, {
        prompt: answers("static-web", "guided-feature", "Fixture User", "fixture@example.invalid", "yes"),
        stdout: output().stream,
        invocationDirectory: root,
      });
      const design = join(target, "docs", "features", "guided-feature", "design.md");
      writeFileSync(design, "# Design\n\nOperator-authored obligations.\n");
      writeFileSync(join(target, "unrelated.txt"), "do not stage me\n");
      await assert.rejects(
        prepareGuidedProject(target, {
          prompt: answers("yes"),
          stdout: output().stream,
          invocationDirectory: root,
        }),
        /unrelated path.*unrelated\.txt/,
      );
      assert.equal(git(target, "log", "--format=%s").split(/\r?\n/).length, 1);
      assert.equal(readFileSync(join(target, "unrelated.txt"), "utf8"), "do not stage me\n");
      rmSync(join(target, "unrelated.txt"));
      const beforeDecline = git(target, "rev-parse", "HEAD");
      await assert.rejects(
        prepareGuidedProject(target, {
          prompt: answers("no"),
          stdout: output().stream,
          invocationDirectory: root,
        }),
        /design commit declined/,
      );
      assert.equal(git(target, "rev-parse", "HEAD"), beforeDecline);
      assert.equal(readFileSync(design, "utf8"), "# Design\n\nOperator-authored obligations.\n");
      const shown = output();
      const ready = await prepareGuidedProject(target, {
        prompt: answers("yes"),
        stdout: shown.stream,
        invocationDirectory: root,
      });
      assert.equal(ready.waitingForDesign, false);
      assert.equal(git(target, "log", "-1", "--format=%s"), "Add BuildWorks design for guided-feature");
      assert.deepEqual(git(target, "show", "--pretty=", "--name-only", "HEAD").split(/\r?\n/).filter(Boolean),
        ["docs/features/guided-feature/design.md"]);
      assert.equal(git(target, "status", "--porcelain"), "");
      assert.match(shown.text(), /Design to commit: docs\/features\/guided-feature\/design\.md/);
      writeFileSync(design, "# Design\n\nChanged after commit.\n");
      await assert.rejects(
        prepareGuidedProject(target, {
          prompt: answers(),
          stdout: output().stream,
          invocationDirectory: root,
        }),
        /design differs from its committed bytes/,
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exclusive starter creation refuses a write-time collision without replacing its bytes", async (t) => {
  const root = workspace();
  const target = join(root, "exclusive-target");
  const collision = join(target, ".gitignore");
  const originalWrite = fs.writeFileSync;
  let injected = false;
  try {
    await withTools(root, async () => {
      t.mock.method(fs, "writeFileSync", (
        path: Parameters<typeof originalWrite>[0],
        data: Parameters<typeof originalWrite>[1],
        options?: Parameters<typeof originalWrite>[2],
      ) => {
        if (!injected && resolve(String(path)) === resolve(collision) &&
            typeof options === "object" && options !== null && options.flag === "wx") {
          injected = true;
          originalWrite(path, "operator collision\n", "utf8");
        }
        return originalWrite(path, data, options);
      });
      syncBuiltinESMExports();
      await assert.rejects(
        prepareGuidedProject(target, {
          prompt: answers("static-web", "feature", "Fixture User", "fixture@example.invalid"),
          stdout: output().stream,
          invocationDirectory: root,
        }),
        /EEXIST|file already exists/,
      );
      assert.equal(injected, true);
      assert.equal(readFileSync(collision, "utf8"), "operator collision\n");
      assert.notEqual(spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: target }).status, 0);
    });
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("bootstrap refuses nonempty non-Git targets and mismatched generated bytes without overwriting", async () => {
  const root = workspace();
  try {
    await withTools(root, async () => {
      const occupied = join(root, "occupied");
      mkdirSync(occupied);
      writeFileSync(join(occupied, "keep.txt"), "owned\n");
      await assert.rejects(
        prepareGuidedProject(occupied, {
          prompt: answers("static-web", "feature"),
          stdout: output().stream,
          invocationDirectory: root,
        }),
        /refusing nonempty non-Git target/,
      );
      assert.equal(readFileSync(join(occupied, "keep.txt"), "utf8"), "owned\n");

      const target = join(root, "mismatch");
      await prepareGuidedProject(target, {
        prompt: answers("static-web", "feature", "Fixture User", "fixture@example.invalid", "yes"),
        stdout: output().stream,
        invocationDirectory: root,
      });

      writeFileSync(join(target, "README.md"), "operator bytes\n");
      await assert.rejects(
        prepareGuidedProject(target, {
          prompt: answers(),
          stdout: output().stream,
          invocationDirectory: root,
        }),
        /generated starter no longer matches/,
      );
      assert.equal(readFileSync(join(target, "README.md"), "utf8"), "operator bytes\n");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("existing repositories require committed nonempty designs and prompt among displayed slugs", async () => {
  const root = workspace();
  try {
    git(root, "init", "-q");
    writeFileSync(join(root, ".gitignore"), ".governance/\n");
    writeFileSync(join(root, "governed.yaml"), 'verify:\n  - name: unit\n    command: ["node", "--version"]\n');
    git(root, "add", "-A");
    git(root, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
      "commit", "-qm", "base");
    await assert.rejects(
      prepareGuidedProject(root, {
        prompt: answers(),
        stdout: output().stream,
      }),
      /no committed nonempty .*design\.md/,
    );
    for (const slug of ["alpha", "beta"]) {
      const path = join(root, "docs", "features", slug, "design.md");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `# ${slug}\n`);
    }
    git(root, "add", "-A");
    git(root, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid",
      "commit", "-qm", "designs");
    const selected = await prepareGuidedProject(root, {
      prompt: answers("2"),
      stdout: output().stream,
    });

    test("a clean autocrlf clone of the generated starter remains resumable", async () => {
      const root = workspace();
      const target = join(root, "source", "autocrlf-app");
      const clone = join(root, "clone", "autocrlf-app");
      try {
        await withTools(root, async () => {
          await prepareGuidedProject(target, {
            prompt: answers("static-web", "guided-feature", "Fixture User", "fixture@example.invalid", "yes"),
            stdout: output().stream,
            invocationDirectory: root,
          });
          mkdirSync(dirname(clone), { recursive: true });
          git(root, "-c", "core.autocrlf=true", "clone", "-q", target, clone);
          assert.equal(git(clone, "status", "--porcelain"), "");
          const prepared = await prepareGuidedProject(clone, {
            prompt: async () => { throw new Error("a clean generated clone waiting for design must not prompt"); },
            stdout: output().stream,
            invocationDirectory: root,
          });
          assert.equal(prepared.waitingForDesign, true);
          assert.equal(prepared.slug, "guided-feature");
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
    assert.equal(selected.slug, "beta");
    assert.equal(selected.scaffold, false);
    assert.equal(git(root, "status", "--porcelain"), "");

    const child = join(root, "empty-child");
    mkdirSync(child);
    const fromChild = await prepareGuidedProject(child, {
      prompt: answers("1"),
      stdout: output().stream,
    });
    assert.equal(fromChild.rootDir, root, "an invocation inside a project must use its existing worktree root");
    assert.equal(fromChild.slug, "alpha");
    assert.equal(existsSync(join(child, ".git")), false, "guided mode must not create a nested repository");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
