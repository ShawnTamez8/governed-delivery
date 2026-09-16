import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";

const CHECKOUT = realpathSync(resolve("."));

function npm(cwd: string, ...args: string[]) {
  return spawnSync("npm", args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

test("checkout-linked global install exposes buildworks and bw outside the checkout", { timeout: 120_000 }, () => {
  const workspace = mkdtempSync(join(dirname(CHECKOUT), ".buildworks-entrypoint-"));
  const prefix = join(workspace, "prefix");
  const invocation = join(workspace, "outside");
  try {
    mkdirSync(invocation);
    const installed = npm(invocation, "install", "--global", CHECKOUT, "--prefix", prefix, "--ignore-scripts");
    assert.equal(installed.status, 0, installed.stderr);
    const packagePath = process.platform === "win32"
      ? join(prefix, "node_modules", "buildworks")
      : join(prefix, "lib", "node_modules", "buildworks");
    assert.ok(statSync(packagePath).isDirectory());
    assert.equal(realpathSync(packagePath), CHECKOUT, "the installed package must link to the complete checkout");
    for (const retained of [
      join(packagePath, "src", "migrations"),
      join(packagePath, "src", "dashboard", "index.html"),
      join(packagePath, "src", "cli.ts"),
    ]) {
      assert.ok(existsSync(retained), retained);
    }
    assert.ok(relative(CHECKOUT, invocation).startsWith(".."), "the command must run outside the checkout");
    for (const name of ["buildworks", "bw"]) {
      const shim = process.platform === "win32" ? join(prefix, `${name}.cmd`) : join(prefix, "bin", name);
      const called = spawnSync(shim, ["--help"], {
        cwd: invocation,
        encoding: "utf8",
        shell: process.platform === "win32",
      });
      assert.equal(called.status, 0, `${name}: ${called.stderr}`);
      assert.match(called.stdout, /^usage: buildworks /);
      assert.match(called.stdout, /Advanced commands:/);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
