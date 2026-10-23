import { test } from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The page server's lexical containment rule (docs/features/served-browser-pages/plan.md,
 * Task 2), on the host. The cases come from the rule the plan states: the check
 * runs on the percent-decoded path, and a resolved path must be `/work` or under
 * `/work/`. The module is loaded by a variable URL, so `tsc` needs no declaration
 * for the `.mjs` file, and importing it must not start a server.
 */
const SERVER = pathToFileURL(join("container", "serve.mjs")).href;
const { resolveUnder } = (await import(SERVER)) as { resolveUnder: (rawPath: string) => string | null };

test("a path under /work resolves to its file there, without its query", () => {
  assert.equal(resolveUnder("/"), "/work/");
  assert.equal(resolveUnder("/index.html"), "/work/index.html");
  assert.equal(resolveUnder("/index.html?x=1#y"), "/work/index.html");
  assert.equal(resolveUnder("/sub/../index.html"), "/work/index.html");
  assert.equal(resolveUnder("/src/%6Dain.js"), "/work/src/main.js");
});

test("a decoded path that leaves /work, or only shares its prefix, is not servable", () => {
  for (const raw of ["/%2e%2e/etc/passwd", "/..%2fetc/passwd", "/../work-sibling/x", "/%2e%2e/work-sibling/x", "/..%2Fwork-sibling/x"]) {
    assert.equal(resolveUnder(raw), null, raw);
  }
});

test("a path that does not decode, or decodes to a NUL, is not servable", () => {
  assert.equal(resolveUnder("/%E0%A4%A"), null);
  assert.equal(resolveUnder("/index.html%00.js"), null);
});

test("importing the server starts nothing", async () => {
  const listening = await new Promise<boolean>((resolve) => {
    const socket = connect(47731, "127.0.0.1", () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
  assert.equal(listening, false);
});
