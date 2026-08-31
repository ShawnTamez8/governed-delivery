import { spawnSync } from "node:child_process";

// Advances the branch and exits 0 — a command that leaves the tree clean but
// no longer at the commit under verification. The stage must block: a pass
// recorded against a moved head names a commit that was never the one tested.
const result = spawnSync(
  "git",
  ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "moved"],
  { cwd: process.cwd(), encoding: "utf8" }
);
if (result.status !== 0) {
  console.error(`git commit failed: ${result.stderr ?? result.error?.message}`);
  process.exit(9);
}
console.log("MOVED");
