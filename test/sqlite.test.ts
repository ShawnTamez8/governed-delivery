import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const STORE = new URL("../src/store.ts", import.meta.url).href;
const SQLITE = new URL("../src/sqlite.ts", import.meta.url).href;

function runModule(script: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
}

test("importing the store loads no SQLite, so a command that opens no state prints nothing", () => {
  const result = runModule(`await import(${JSON.stringify(STORE)});`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("opening a database hides Node's experimental notice and leaves every other warning alone", () => {
  // The wrapped loader emits a second, unrelated warning inside the window where
  // the filter is installed, as a future Node release might.
  const result = runModule(`
    const { openDatabase } = await import(${JSON.stringify(SQLITE)});
    const real = process.getBuiltinModule;
    process.getBuiltinModule = (id) => {
      process.emitWarning("during the load", "CustomWarning");
      return real.call(process, id);
    };
    const before = process.emitWarning;
    openDatabase(":memory:").close();
    openDatabase(":memory:", { readOnly: false }).close();
    console.log(process.emitWarning === before);
    process.emitWarning("after the load", "CustomWarning");
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "true", "the filter must be removed once the module has loaded");
  assert.match(result.stderr, /CustomWarning: during the load/);
  assert.match(result.stderr, /CustomWarning: after the load/);
  assert.doesNotMatch(result.stderr, /SQLite/);
});
