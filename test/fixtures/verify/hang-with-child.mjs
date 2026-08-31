import { spawn } from "node:child_process";

// Spawns a detached sleeping grandchild, prints its pid on stdout, then hangs
// well past any test ceiling. Proves the timeout's tree-kill reaches the
// grandchild, not just the immediate child. Modelled on
// `test/fixtures/harness/spawn-grandchild.mjs`; the pid goes to stdout rather
// than to a file named in argv, because a verification command's argv is
// constrained to tokens that survive a shell and a temp path is not one.
const grandchild = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
  stdio: "ignore",
  detached: true,
});
console.log(`grandchild=${grandchild.pid}`);
setInterval(() => {}, 1 << 30);
