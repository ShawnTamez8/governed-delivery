import { readFileSync } from "node:fs";

// Stands in for `claude -p --output-format json` in every test that does not
// need the real binary: reads all of stdin and reports how many bytes arrived
// plus the argv it was called with.
const stdin = readFileSync(0);
console.log(
  JSON.stringify({
    type: "result",
    stdinLength: stdin.length,
    argv: process.argv.slice(2),
  })
);
