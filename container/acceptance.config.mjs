// The system's acceptance runner configuration, copied into the image
// (docs/features/protected-acceptance-tests/plan.md). No model, target file or
// npm script takes part in the invocation: the system runs
// `node /opt/bw-browser/node_modules/@playwright/test/cli.js test --config
// /opt/bw-browser/acceptance.config.mjs --repeat-each 2 acceptance/<slug>/` from
// /work. The JSON report goes to stdout and every other output to the
// container's temporary directory, never the worktree (hazard 22). The action
// and navigation timeouts make a missing element or page fail as its own
// locator or navigation error, not as a whole-test timeout (Task 1 spike record).
// On the blank baseline page every test waits out one such timeout, so tests
// run four at a time, each test on its own: a serial baseline of more than
// about 80 tests exceeds the verification command ceiling (Task 4 round 1).
// Pages are served from /work by the system's page server on the container's
// loopback, not opened from `file:///work/`: from disk, a module script is
// refused by CORS and a root-absolute path resolves to `file:///src/...`, so
// the page runs no code (docs/features/served-browser-pages/plan.md). The
// server prints nothing and its streams are ignored, so the log stays one JSON
// report.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "/work/acceptance",
  outputDir: join(tmpdir(), "bw-acceptance-output"),
  reporter: [["json"]],
  workers: 4,
  fullyParallel: true,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  webServer: {
    command: "node /opt/bw-browser/serve.mjs",
    port: 47731,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "ignore",
    timeout: 10_000,
  },
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: "http://127.0.0.1:47731/",
    actionTimeout: 5_000,
    navigationTimeout: 5_000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
