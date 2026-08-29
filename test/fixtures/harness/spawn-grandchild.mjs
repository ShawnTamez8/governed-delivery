import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// Spawns a detached grandchild, records its pid to argv[2], then hangs like
// hang.mjs. Proves tree-kill reaches the grandchild, not just the immediate
// child.
readFileSync(0);
const grandchild = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
  stdio: "ignore",
  detached: true,
});
writeFileSync(process.argv[2], String(grandchild.pid));
setInterval(() => {}, 1 << 30);
