import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Writes into ignored paths and exits 0, the way `npm ci` leaves
// `node_modules/` and a build leaves `dist/`. Crew-chatter run 6 (2026-10-13)
// passed `npm ci`, typecheck, lint and build, and code review then refused the
// worktree for `!! backend/dist/`, `!! frontend/node_modules/`,
// `!! node_modules/` and similar. The paths are fixed and relative to the
// working directory, as in `touch-tracked.mjs`.
mkdirSync(join(process.cwd(), "node_modules", "pkg"), { recursive: true });
writeFileSync(join(process.cwd(), "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
mkdirSync(join(process.cwd(), "frontend", "dist"), { recursive: true });
writeFileSync(join(process.cwd(), "frontend", "dist", "index.html"), "<!doctype html>\n");
console.log("WROTE_IGNORED");
