import { readFileSync } from "node:fs";

// Reads stdin fully (so the harness's stdin-close still lets it start), then
// sleeps forever without writing anything — triggers the idle timeout.
readFileSync(0);
setInterval(() => {}, 1 << 30);
