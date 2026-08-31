// Writes well beyond any budget a test would set, so the in-memory cap and
// the evidence file can be shown to diverge: the cap bounds memory, the file
// keeps everything.
const line = "x".repeat(1024) + "\n";
for (let i = 0; i < 256; i++) process.stdout.write(line);
