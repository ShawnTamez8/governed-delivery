import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// One fixture serves the implementation stage's single dispatch, dispatching
// on EMIT_MODE (default "ok").
//
// The patch set is built *from the prompt*, not from a literal: the
// baseCommit and the approved scope paths are read back out of the prompt
// the stage generated. A fixture carrying its own hardcoded base commit
// would agree with whatever the code produced and prove nothing about the
// binding — which is the failure mode hazard 4 names. A scrape that finds
// nothing throws: a broken fixture must fail loudly, never pass by falling
// back to a literal.
const stdin = readFileSync(0, "utf8");

// `baseCommit must be exactly: <40 or 64 hex>` — stated by
// buildImplementationAuthorPrompt.
const baseCommitMatch = /baseCommit must be exactly: ([0-9a-f]{40}|[0-9a-f]{64})/.exec(stdin);
if (!baseCommitMatch) {
  throw new Error("emit-implementation-stage: no baseCommit found in the prompt");
}
const baseCommit = baseCommitMatch[1];

// The scope block: `- <path>` lines between the "Patch only these paths:"
// line and the blank line that ends the list.
function scopePaths() {
  const block = /Patch only these paths:\n\n([\s\S]*?)\n\n/.exec(stdin)?.[1];
  if (!block) {
    throw new Error("emit-implementation-stage: no scope block found in the prompt");
  }
  const paths = block
    .split("\n")
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .filter((line) => line !== "");
  if (paths.length === 0) {
    throw new Error("emit-implementation-stage: no scope paths found in the prompt");
  }
  return paths;
}

const mode = process.env.EMIT_MODE ?? "ok";
const paths = scopePaths();

// The content embeds base.txt read from the process working directory —
// base.txt exists only in the worktree, so an applied file carrying this
// marker proves the harness ran with its cwd set to the worktree (a read
// failure throws and fails the dispatch instead).
function markerContent() {
  const fromBase = readFileSync("base.txt", "utf8");
  return `export const fromBase = ${JSON.stringify(fromBase)};\n`;
}

function file(scopePath, action = "add") {
  return { path: scopePath, action, content: markerContent() };
}

function proposed(files, base = baseCommit) {
  return {
    status: "proposed",
    agent: "implementer",
    role: "author",
    executor: "claude-code",
    summary: "fixture implementation",
    proposedPatches: [{ baseCommit: base, files }],
  };
}

function emit(agentResult) {
  console.log(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: JSON.stringify(agentResult),
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: { "fixture-model": { inputTokens: 1, outputTokens: 1 } },
    })
  );
}

let agentResult;
if (mode === "ok") {
  agentResult = proposed(paths.map((p) => file(p)));
} else if (mode === "base-mismatch") {
  agentResult = proposed(paths.map((p) => file(p)), "0".repeat(40));
} else if (mode === "out-of-scope") {
  agentResult = proposed([file("src/never-approved.ts")]);
} else if (mode === "protected") {
  agentResult = proposed([file(process.env.EMIT_PATH ?? "src/agents/evil.ts")]);
} else if (mode === "symlink-dir") {
  // The fixture is the only party that can place the link: on this machine a
  // committed symlink checks out as a plain file under core.symlinks=false.
  // The junction target must exist for the resolution chain, so the fixture
  // creates it too.
  mkdirSync(join(process.cwd(), "src", "agents"), { recursive: true });
  symlinkSync(
    join(process.cwd(), "src", "agents"),
    join(process.cwd(), "src", "alias"),
    process.platform === "win32" ? "junction" : "dir"
  );
  agentResult = proposed([file("src/alias/x.ts")]);
} else if (mode === "dangling-link") {
  // A directory link whose target was removed after the link was created:
  // the link itself still exists (lstat sees it) but cannot be resolved, so
  // the write would either fail or land somewhere unverifiable. Constructible
  // on every platform — Windows junctions cannot be created dangling, but a
  // junction to a directory that is then removed dangles.
  mkdirSync(join(process.cwd(), "src", "agents"), { recursive: true });
  const alias = join(process.cwd(), "src", "alias");
  symlinkSync(join(process.cwd(), "src", "agents"), alias, process.platform === "win32" ? "junction" : "dir");
  rmSync(join(process.cwd(), "src", "agents"), { recursive: true, force: true });
  agentResult = proposed([file("src/alias/x.ts")]);
} else if (mode === "escape-link") {
  // A directory junction inside the worktree pointing *outside* it: the
  // lexical checks cannot see the redirect, and only the isPathInside
  // backstop refuses the resolved target. The outside directory is a sibling
  // of the main repository root, created by the fixture so the junction
  // resolves.
  const outside = join(process.cwd(), "..", "..", "outside-escape");
  mkdirSync(outside, { recursive: true });
  mkdirSync(join(process.cwd(), "src"), { recursive: true });
  symlinkSync(outside, join(process.cwd(), "src", "escape"), process.platform === "win32" ? "junction" : "dir");
  agentResult = proposed([file("src/escape/x.ts")]);
} else if (mode === "symlink-design") {
  // The link target is created so the file symlink resolves; the refusal
  // fires on the resolved path (`docs/features/<slug>/design.md` is the
  // run's own design document), not on anything that happens to exist.
  const slug = /\bfeature: ([a-z0-9-]+)/.exec(stdin)?.[1] ?? "demo";
  mkdirSync(join(process.cwd(), "src"), { recursive: true });
  const designDir = join(process.cwd(), "docs", "features", slug);
  mkdirSync(designDir, { recursive: true });
  writeFileSync(join(designDir, "design.md"), "# design\n");
  symlinkSync(join(designDir, "design.md"), join(process.cwd(), "src", "alias.md"), "file");
  agentResult = proposed([{ path: "src/alias.md", action: "modify", content: markerContent() }]);
} else if (mode === "empty") {
  agentResult = { ...proposed([]), proposedPatches: [] };
} else if (mode === "two-patches") {
  agentResult = {
    ...proposed([]),
    proposedPatches: [
      { baseCommit, files: paths.map((p) => file(p)) },
      // The second patch re-touches a path the first already applied: the
      // branch has moved there since proposal, which the head-moved
      // re-validation must refuse.
      { baseCommit, files: [{ path: paths[0], action: "modify", content: markerContent() }] },
    ],
  };
} else if (mode === "add-existing") {
  agentResult = proposed([file(paths[0])]);
} else if (mode === "modify-missing") {
  agentResult = proposed([{ path: paths[0], action: "modify", content: markerContent() }]);
} else if (mode === "non-proposed") {
  agentResult = {
    status: "failed",
    agent: "implementer",
    role: "author",
    executor: "claude-code",
    summary: "fixture implementation refused",
    proposedPatches: [{ baseCommit, files: paths.map((p) => file(p)) }],
  };
} else {
  throw new Error(`emit-implementation-stage: unknown EMIT_MODE ${mode}`);
}
emit(agentResult);
