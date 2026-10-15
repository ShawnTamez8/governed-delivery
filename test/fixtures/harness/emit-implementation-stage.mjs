import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// One fixture serves every implementation dispatch (one per phase of the plan's
// tasks), dispatching on EMIT_MODE (default "ok"). Which phase it is answering
// is read out of the prompt, never counted here: a fixture carrying its own
// counter would agree with whatever the stage did (hazard 4).
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

// The marker sentence buildImplementationSelfReviewPrompt states, checked before
// the phase: the self-review prompt carries no phase.
const isSelfReview = stdin.includes("This is your own self-review of the complete change");

// `This is phase K of N.` — stated by buildImplementationAuthorPrompt.
const phaseMatch = isSelfReview ? null : /This is phase (\d+) of (\d+)\./.exec(stdin);
if (!isSelfReview && !phaseMatch) {
  throw new Error("emit-implementation-stage: no phase found in the prompt");
}
const phaseIndex = isSelfReview ? 0 : Number(phaseMatch[1]);

// Every dispatch this fixture serves sends `--json-schema <schema>` after the
// model and effort (docs/features/structured-patch-output/plan.md): the patch
// schema for a phase, the self-review schema (which requires
// proposedContentChanges) for the self-review. A prompt without it, or with the
// other one, is refused here, so a stage that stops sending the right schema
// fails loudly instead of passing on a reply the real CLI would not give it.
const schemaAt = process.argv.indexOf("--json-schema");
const schemaArg = schemaAt < 0 ? undefined : process.argv[schemaAt + 1];
const promptKind = isSelfReview ? "self-review" : "phase";
if (schemaArg === undefined) {
  throw new Error(`emit-implementation-stage: a ${promptKind} prompt arrived without --json-schema`);
}
if (JSON.parse(schemaArg).required.includes("proposedContentChanges") !== isSelfReview) {
  throw new Error(`emit-implementation-stage: a ${promptKind} prompt arrived with the wrong --json-schema`);
}
// The phase a failing mode acts on; 0 matches no phase.
const targetPhase = Number(process.env.EMIT_FAIL_PHASE ?? "0");

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

// The `- <path>` lines of the list that follows `heading` (the tail of a
// sentence stated by buildImplementationAuthorPrompt); `none.` is an empty list.
function listAfter(heading) {
  const block = new RegExp(`${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n\\n([\\s\\S]*?)\\n\\n`).exec(stdin)?.[1];
  if (block === undefined) {
    throw new Error(`emit-implementation-stage: no list after "${heading}" in the prompt`);
  }
  return block
    .split("\n")
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .filter((line) => line !== "" && line !== "none.");
}

const emitMode = process.env.EMIT_MODE ?? "ok";
// In the self-review modes every phase answers as ok does, so those modes run
// against a one-phase plan; the self-review itself answers by emitMode below.
const mode = emitMode.startsWith("self-review-") ? "ok" : emitMode;
const paths = scopePaths();

// The content embeds a committed project file read from the process working
// directory. Legacy fixtures carry base.txt; the generated static-web starter
// carries a root index.html that the BuildWorks checkout does not.
function markerContent() {
  const markerPath = existsSync("base.txt") ? "base.txt" : "index.html";
  const fromBase = readFileSync(markerPath, "utf8");
  return `export const fromBase = ${JSON.stringify(fromBase)};\n`;
}

function file(scopePath, action = "add") {
  return { path: scopePath, action, content: markerContent() };
}

// The phased modes give each phase its own content so that a modify of a path an
// earlier phase wrote is a real change: identical content stages nothing, and
// the stage refuses a patch whose staged set differs from the proposed one.
function phasedFile(scopePath, action) {
  return { path: scopePath, action, content: `${markerContent()}// phase ${phaseIndex}\n` };
}

// The scope path this phase adds, one per phase. A scope shorter than the phase
// count is a broken test, so it throws rather than reusing a path.
function phasePath() {
  const path = paths[phaseIndex - 1];
  if (path === undefined) {
    throw new Error(`emit-implementation-stage: scope has ${paths.length} paths, phase ${phaseIndex} has none`);
  }
  return path;
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

// An object reply is emitted the way the CLI answers under --json-schema
// (test/fixtures/recorded/json-schema-probe-web-calculator-phase-2.json): init,
// the assistant's StructuredOutput tool call carrying the reply, and the result
// line carrying it as structured_output, with result its serialization. No
// partial-message chunk: the recordings keep no input_json_delta to copy.
// A string reply (the self-review-not-json mode) never reached the structured
// channel, so it is emitted as text, the line sequence of
// test/fixtures/recorded/harness-stream-json-envelope.json reduced, with no
// structured_output. `test/harness-stream-fixtures.test.ts` checks both shapes.
function emit(agentResult) {
  const structured = typeof agentResult !== "string";
  const resultText = structured ? JSON.stringify(agentResult) : agentResult;
  const session_id = "fixture-session";
  for (const line of [
    { type: "system", subtype: "init", session_id, model: "fixture-model" },
    ...(structured
      ? [{
          type: "assistant",
          message: { role: "assistant", content: [{ type: "tool_use", id: "fixture-tool-use", name: "StructuredOutput", input: agentResult }] },
          session_id,
        }]
      : [
          {
            type: "stream_event",
            event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: resultText } },
            session_id,
          },
          { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: resultText }] }, session_id },
        ]),
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: resultText,
      ...(structured ? { structured_output: agentResult } : {}),
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: { "fixture-model": { inputTokens: 1, outputTokens: 1 } },
    },
  ]) {
    console.log(JSON.stringify(line));
  }
}

// The self-review's reply (docs/features/implementation-self-review/plan.md). Its
// patches are built from the prompt's base commit and scope and from the
// checkout, never from a literal, like the phase modes above.
function selfReview(critique, files) {
  return {
    status: "proposed",
    agent: "implementer",
    role: "author",
    executor: "claude-code",
    summary: "fixture self-review",
    proposedContentChanges: { selfReview: { critique } },
    proposedPatches: files === null ? [] : [{ baseCommit, files }],
  };
}

function selfReviewResult() {
  const clean = () => selfReview(["fixture self-review: checked every task and criterion, found nothing to fix"], null);
  switch (emitMode) {
    case "self-review-fix":
      return selfReview(["fixture self-review: appended a line"],
        [{ path: paths[0], action: "modify", content: `${readFileSync(paths[0], "utf8")}// self-review\n` }]);
    case "self-review-unchanged":
      return selfReview(["fixture self-review: returned a file unchanged"],
        [{ path: paths[0], action: "modify", content: readFileSync(paths[0], "utf8") }]);
    case "self-review-empty-critique":
      return selfReview([], null);
    case "self-review-not-json":
      return "I reviewed the change and everything looks fine.";
    case "self-review-bad-patch":
      return selfReview(["fixture self-review: a patch with no files"], []);
    case "self-review-blocked":
      return { status: "blocked", agent: "implementer", role: "author", executor: "claude-code", summary: "fixture self-review refused" };
    case "self-review-long-critique":
      return selfReview(["x".repeat(2001), ...Array.from({ length: 50 }, (_, index) => `fixture entry ${index + 2}`)], null);
    case "self-review-out-of-scope":
      return selfReview(["fixture self-review: wrote outside the scope"], [file("src/never-approved.ts")]);
    case "self-review-null-patch":
      // validateAgentResult reads a patch's fields without checking it is an object.
      return { ...selfReview(["fixture self-review: a null patch entry"], null), proposedPatches: [null] };
    case "self-review-mutate":
      writeFileSync("unreported.txt", "fixture wrote this\n");
      return clean();
    case "self-review-mutate-fail":
      // A failed dispatch that also touched the tree: no envelope, a non-zero exit.
      writeFileSync("unreported.txt", "fixture wrote this\n");
      process.exit(1);
    case "self-review-commit": {
      appendFileSync(paths[0], "// committed by the fixture\n");
      for (const args of [["add", "--", paths[0]], ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture commit"]]) {
        const git = spawnSync("git", args, { encoding: "utf8" });
        if (git.status !== 0) throw new Error(`emit-implementation-stage: git ${args.join(" ")} failed: ${git.stderr}`);
      }
      return clean();
    }
    default:
      // Every phase mode gets a clean self-review, so existing tests are unchanged by it.
      return clean();
  }
}

let agentResult;
if (isSelfReview) {
  agentResult = selfReviewResult();
} else if (mode === "ok") {
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
} else if (mode === "link-ordinary") {
  // A junction redirecting the write to an ordinary, unprotected directory
  // *inside* the worktree but outside any signed scope: nothing in the
  // resolved-target checks can refuse it (inside the worktree, not
  // protected, not dangling). Only the fail-closed link-component rule can.
  mkdirSync(join(process.cwd(), "src", "ordinary-target"), { recursive: true });
  symlinkSync(
    join(process.cwd(), "src", "ordinary-target"),
    join(process.cwd(), "src", "alias"),
    process.platform === "win32" ? "junction" : "dir"
  );
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
} else if (mode === "not-json") {
  // Prose instead of an answer: emitted as text, with no structured_output.
  agentResult = "I implemented the phase.";
} else if (mode === "empty") {
  agentResult = { ...proposed([]), proposedPatches: [] };
} else if (mode === "empty-files") {
  agentResult = proposed([]);
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
} else if (mode === "mutate-then-propose") {
  // The recorded smoke's implementer wrote the files it then proposed. This
  // mode simulates that exactly: an untracked file, a modification to the
  // tracked base.txt, and a file the test's .gitignore makes ignored — then
  // the ok proposal. The stage must refuse before applying anything.
  writeFileSync("unreported.txt", "fixture wrote this\n");
  appendFileSync("base.txt", "\nfixture mutation\n");
  writeFileSync("ignored-residue.txt", "fixture wrote this\n");
  agentResult = proposed(paths.map((p) => file(p)));
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
} else if (mode === "phased") {
  // Each phase adds the one scope path numbered after it.
  agentResult = proposed([phasedFile(phasePath(), "add")]);
} else if (mode === "phased-modify") {
  // Phase 1 adds the first scope path; every later phase modifies it again.
  agentResult = proposed([phasedFile(paths[0], phaseIndex === 1 ? "add" : "modify")]);
} else if (mode === "phased-add-existing") {
  // Every phase adds the first scope path, so phase 2 adds over a file phase 1
  // committed, which the patch applier refuses.
  agentResult = proposed([phasedFile(paths[0], "add")]);
} else if (mode === "fail-at-phase") {
  // The shape of the response team-notes run 6 recorded: a valid AgentResult
  // with status blocked and no patch.
  agentResult =
    phaseIndex === targetPhase
      ? {
          status: "blocked",
          agent: "implementer",
          role: "author",
          executor: "claude-code",
          summary: "fixture refused this phase",
        }
      : proposed([phasedFile(phasePath(), "add")]);
} else if (mode === "mutate-at-phase") {
  // The executor writes into the tree it was invited to read, in one phase
  // only, then proposes an ordinary patch.
  if (phaseIndex === targetPhase) writeFileSync("unreported.txt", "fixture wrote this\n");
  agentResult = proposed([phasedFile(phasePath(), "add")]);
} else if (mode === "phased-restore") {
  // Phase 1 changes an existing file, phase 2 puts it back byte for byte, and
  // later phases add the remaining scope paths. The restore is derived from the
  // checkout (the appended line is removed), not from a literal.
  const SUFFIX = "\n// changed by phase 1\n";
  if (phaseIndex === 1) {
    agentResult = proposed([{ path: paths[0], action: "modify", content: readFileSync(paths[0], "utf8") + SUFFIX }]);
  } else if (phaseIndex === 2) {
    const current = readFileSync(paths[0], "utf8");
    if (!current.endsWith(SUFFIX)) {
      throw new Error("emit-implementation-stage: phase 2 did not find phase 1's change in the checkout");
    }
    agentResult = proposed([{ path: paths[0], action: "modify", content: current.slice(0, -SUFFIX.length) }]);
  } else {
    agentResult = proposed([phasedFile(phasePath(), "add")]);
  }
} else if (mode === "phased-by-prompt") {
  // Every phase writes the first scope path and its own, and takes each action
  // from the prompt's two lists rather than from its phase number. A path in
  // neither list throws, so a stage that stops telling the model what exists
  // fails here instead of passing by coincidence.
  const exists = listAfter("exist in the checkout now, so each takes action modify:");
  const missing = listAfter("do not exist yet, so each takes action add:");
  const actionFor = (path) => {
    if (exists.includes(path)) return "modify";
    if (missing.includes(path)) return "add";
    throw new Error(`emit-implementation-stage: ${path} is in neither of the prompt's existence lists`);
  };
  const targets = phaseIndex === 1 ? [paths[0]] : [paths[0], phasePath()];
  agentResult = proposed(targets.map((p) => phasedFile(p, actionFor(p))));
} else if (mode === "phased-unchanged" || mode === "phased-all-unchanged") {
  // The shape web-calculator run 1's phase 2 returned: a file an earlier phase
  // committed, sent back byte for byte as a modify. The copy is read from the
  // checkout, never built from a literal. phased-unchanged sends it beside the
  // phase's own new file; phased-all-unchanged sends only the copy.
  if (phaseIndex === 1) {
    agentResult = proposed([phasedFile(phasePath(), "add")]);
  } else {
    const copy = { path: paths[0], action: "modify", content: readFileSync(paths[0], "utf8") };
    agentResult = proposed(mode === "phased-unchanged" ? [phasedFile(phasePath(), "add"), copy] : [copy]);
  }
} else {
  throw new Error(`emit-implementation-stage: unknown EMIT_MODE ${mode}`);
}
emit(agentResult);
