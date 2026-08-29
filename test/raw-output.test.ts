import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRawOutput } from "../src/raw-output.ts";

test("writeRawOutput round-trips the exact bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-raw-"));
  try {
    const ref = writeRawOutput(root, 3, "{\"raw\":\"bytes\"}");
    const readBack = readFileSync(join(root, ref), "utf8");
    assert.equal(readBack, "{\"raw\":\"bytes\"}");
    assert.ok(ref.startsWith(join(".governance", "raw", "3")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two writes to the same run produce distinct files", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-raw-"));
  try {
    const a = writeRawOutput(root, 3, "one");
    const b = writeRawOutput(root, 3, "two");
    assert.notEqual(a, b);
    assert.equal(readFileSync(join(root, a), "utf8"), "one");
    assert.equal(readFileSync(join(root, b), "utf8"), "two");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
