import { readFileSync } from "node:fs";

// Exits 0 with output that is not JSON — the envelope parse failure case.
readFileSync(0);
console.log("not json at all");
