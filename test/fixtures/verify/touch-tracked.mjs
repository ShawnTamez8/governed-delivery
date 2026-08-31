import { appendFileSync } from "node:fs";
import { join } from "node:path";

// Appends a byte to a tracked file and exits 0 — a suite that rewrites
// snapshots and then passes. The stage must block on it: a green result
// against bytes the branch does not contain has verified nothing.
//
// The path is fixed and relative to the working directory rather than taken
// from argv, because a verification command's tokens are constrained to
// characters that survive a shell and a temp path is not one.
appendFileSync(join(process.cwd(), "base.txt"), "touched\n");
console.log("TOUCHED");
