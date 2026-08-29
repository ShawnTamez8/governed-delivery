import { readFileSync } from "node:fs";

// Exits 3 after writing partial stdout and a stderr diagnostic — stands in
// for a harness that fails after producing some output.
readFileSync(0);
process.stdout.write("partial");
process.stderr.write("boom");
process.exit(3);
