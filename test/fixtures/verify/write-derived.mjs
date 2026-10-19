import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Stands in for a derived artifact's command (`npm install
// --package-lock-only`): writes the file named by the first argument with the
// second argument as its content, so a test decides whether the command
// changes anything. A second argument of `@<path>` copies that file's content
// instead, so the derived file changes whenever the source does. A third
// argument adds a side effect: `stray` also writes a file that is not
// derived, which the regeneration must refuse; `ignored` also writes under an
// ignored `node_modules/`, which it must clean up.
const [path, content, mode] = process.argv.slice(2);
const body = content.startsWith("@") ? readFileSync(join(process.cwd(), content.slice(1)), "utf8") : `${content}\n`;
writeFileSync(join(process.cwd(), path), body);
if (mode === "stray") {
  writeFileSync(join(process.cwd(), "stray.txt"), "not derived\n");
}
if (mode === "ignored") {
  mkdirSync(join(process.cwd(), "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(process.cwd(), "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
}
console.log("WROTE_DERIVED");
