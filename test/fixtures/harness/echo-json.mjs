import { readFileSync } from "node:fs";

// Stands in for `claude -p --output-format stream-json` in every test that
// does not need the real binary: reads all of stdin and reports how many
// bytes arrived plus the argv it was called with. The last line is the result
// line and carries those two facts; the lines before it follow the line types
// in test/fixtures/recorded/harness-stream-json-envelope.json.
const stdin = readFileSync(0);
const session_id = "fixture-session";
for (const line of [
  { type: "system", subtype: "init", session_id, model: "fixture-model" },
  {
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "echo" } },
    session_id,
  },
  {
    type: "result",
    subtype: "success",
    stdinLength: stdin.length,
    argv: process.argv.slice(2),
    total_cost_usd: 0.125,
  },
]) {
  console.log(JSON.stringify(line));
}
