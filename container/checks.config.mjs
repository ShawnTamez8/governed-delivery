// The system's reproduction runner configuration, copied into the image
// (docs/features/reproduced-review-findings/plan.md). It is the acceptance
// runner's config with `testDir: "/bw-checks"`, where the system mounts the
// reviewers' reproductions read-only: a runner whose `testDir` is
// `/work/acceptance` discovers no file under `/bw-checks` (Task 1 spike record).
// The system runs `node /opt/bw-browser/node_modules/@playwright/test/cli.js test
// --config /opt/bw-browser/checks.config.mjs --repeat-each 2
// /bw-checks/<finding>/<reviewer>/<file>` from /work, one file per command. The
// JSON report goes to stdout and every other output to the container's
// temporary directory, never the worktree (hazard 22).
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "/bw-checks",
  outputDir: join(tmpdir(), "bw-checks-output"),
  reporter: [["json"]],
  workers: 4,
  fullyParallel: true,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: "file:///work/",
    actionTimeout: 5_000,
    navigationTimeout: 5_000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
