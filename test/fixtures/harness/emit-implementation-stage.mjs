import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// One fixture serves every implementation dispatch (one per phase of the plan's
// tasks, then the self-review), dispatching on EMIT_MODE (default "ok"). Which
// phase it is answering is read out of the prompt, never counted here: a fixture
// carrying its own counter would agree with whatever the stage did (hazard 4).
//
// Tool mode (docs/features/sandboxed-implementer/plan.md, Task 10): the
// implementer changes files through BuildWorks' tool server in the run's
// container, and its reply carries only a status and a summary. The fixture
// stands in for both: it writes its files into its working directory, which is
// the run's worktree, then answers in the workspace reply shape. The paths come
// *from the prompt*, never from a literal: the approved scope paths are read
// back out of the prompt the stage generated. A scrape that finds nothing
// throws: a broken fixture must fail loudly, never pass by falling back to a
// literal.
const stdin = readFileSync(0, "utf8");

// The marker sentence buildImplementationSelfReviewPrompt states, checked before
// the phase: the self-review prompt carries no phase.
const isSelfReview = stdin.includes("This is your own self-review of the complete change");

// `This is phase K of N.` — stated by buildImplementationAuthorPrompt.
const phaseMatch = isSelfReview ? null : /This is phase (\d+) of (\d+)\./.exec(stdin);
if (!isSelfReview && !phaseMatch) {
  throw new Error("emit-implementation-stage: no phase found in the prompt");
}
const phaseIndex = isSelfReview ? 0 : Number(phaseMatch[1]);

// Every dispatch this fixture serves sends `--json-schema <schema>` (the
// workspace reply for a phase, the self-review reply, which requires a critique,
// for the self-review) and `--mcp-config <file>` naming the tool server. A
// prompt without either, or with the other schema, is refused here, so a stage
// that forgets either fails loudly instead of passing on a reply the real CLI
// would not give it.
function flag(name) {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}
const schemaArg = flag("--json-schema");
const promptKind = isSelfReview ? "self-review" : "phase";
if (schemaArg === undefined) {
  throw new Error(`emit-implementation-stage: a ${promptKind} prompt arrived without --json-schema`);
}
if (flag("--mcp-config") === undefined) {
  throw new Error(`emit-implementation-stage: a ${promptKind} prompt arrived without --mcp-config`);
}
if (JSON.parse(schemaArg).required.includes("critique") !== isSelfReview) {
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

/** Write one file into the worktree, as the tool server's write_file would. */
function write(path, content = markerContent()) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// The phased modes give each phase its own content, so that a later phase's
// write of a path an earlier phase wrote is a real change.
function writePhased(path) {
  write(path, `${markerContent()}// phase ${phaseIndex}\n`);
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

/** The workspace reply (WORKSPACE_REPLY_SCHEMA in src/agent-result.ts). */
function reply(status = "completed", summary = "fixture implementation", incompleteTasks = []) {
  return { status, summary, incompleteTasks };
}

// An object reply is emitted the way the CLI answers under --json-schema
// (the spike's recorded phase, test/fixtures/recorded/sandbox-spike-crew-chatter-phase-2.json,
// whose last tool call is StructuredOutput): init, the assistant's
// StructuredOutput tool call carrying the reply, and the result line carrying it
// as structured_output, with result its serialization. The tool server's own
// calls are not emitted: the fixture made its writes directly. A string reply
// (the not-json modes) never reached the structured channel, so it is emitted as
// text, the line sequence of test/fixtures/recorded/harness-stream-json-envelope.json
// reduced, with no structured_output. `test/harness-stream-fixtures.test.ts`
// checks both shapes.
function emit(answer) {
  const structured = typeof answer !== "string";
  const resultText = structured ? JSON.stringify(answer) : answer;
  const session_id = "fixture-session";
  for (const line of [
    { type: "system", subtype: "init", session_id, model: "fixture-model" },
    ...(structured
      ? [{
          type: "assistant",
          message: { role: "assistant", content: [{ type: "tool_use", id: "fixture-tool-use", name: "StructuredOutput", input: answer }] },
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
      ...(structured ? { structured_output: answer } : {}),
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: { "fixture-model": { inputTokens: 1, outputTokens: 1 } },
    },
  ]) {
    console.log(JSON.stringify(line));
  }
}

// The self-review's reply (docs/features/implementation-self-review/plan.md):
// the workspace reply plus the critique. Its fixes are written into the
// checkout, read from it, never built from a literal, like the phase modes.
function selfReview(critique, status = "completed") {
  return { ...reply(status, "fixture self-review"), critique };
}

function selfReviewResult() {
  const clean = () => selfReview(["fixture self-review: checked every task and criterion, found nothing to fix"]);
  switch (emitMode) {
    case "self-review-fix":
      appendFileSync(paths[0], "// self-review\n");
      return selfReview(["fixture self-review: appended a line"]);
    case "self-review-unchanged":
      // A write of the same bytes: the checkout is unchanged.
      write(paths[0], readFileSync(paths[0], "utf8"));
      return selfReview(["fixture self-review: rewrote a file unchanged"]);
    case "self-review-empty-critique":
      return selfReview([]);
    case "self-review-not-json":
      return "I reviewed the change and everything looks fine.";
    case "self-review-blocked":
      return selfReview(["fixture self-review: could not finish"], "blocked");
    case "self-review-long-critique":
      return selfReview(["x".repeat(2001), ...Array.from({ length: 50 }, (_, index) => `fixture entry ${index + 2}`)]);
    case "self-review-out-of-scope":
      write("src/never-approved.ts");
      return selfReview(["fixture self-review: wrote outside the scope"]);
    case "self-review-mutate":
      writeFileSync("unreported.txt", "fixture wrote this\n");
      return clean();
    case "self-review-mutate-fail":
      // A failed dispatch that also touched the tree: no envelope, a non-zero exit.
      writeFileSync("unreported.txt", "fixture wrote this\n");
      process.exit(1);
    case "self-review-commit": {
      // The agent's .git is read-only in the container; the fixture runs on the
      // host and can commit, which is the boundary failure this mode stands for.
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

let answer;
if (isSelfReview) {
  answer = selfReviewResult();
} else if (mode === "ok") {
  for (const p of paths) write(p);
  answer = reply();
} else if (mode === "out-of-scope") {
  write("src/never-approved.ts");
  answer = reply();
} else if (mode === "protected") {
  write(process.env.EMIT_PATH ?? "src/agents/evil.ts");
  answer = reply();
} else if (mode === "not-json") {
  // Prose instead of an answer: emitted as text, with no structured_output.
  answer = "I implemented the phase.";
} else if (mode === "empty") {
  // A completed reply that changed nothing.
  answer = reply();
} else if (mode === "mutate-then-propose") {
  // The recorded smoke's implementer wrote outside what it was asked to change.
  // This mode writes the scope paths and, beside them, an untracked file, a
  // modification to the tracked base.txt, and a file the test's .gitignore makes
  // ignored. The boundary refuses the two out-of-scope paths and removes the
  // ignored one.
  for (const p of paths) write(p);
  writeFileSync("unreported.txt", "fixture wrote this\n");
  appendFileSync("base.txt", "\nfixture mutation\n");
  writeFileSync("ignored-residue.txt", "fixture wrote this\n");
  answer = reply();
} else if (mode === "non-proposed") {
  answer = reply("blocked", "fixture implementation refused", ["Build the thing"]);
} else if (mode === "completed-with-incomplete") {
  // A reply that says completed and still lists a task it did not do.
  for (const p of paths) write(p);
  answer = reply("completed", "fixture implementation", ["Build the other thing"]);
} else if (mode === "commit") {
  // A phase that commits in the checkout, as self-review-commit does: the
  // boundary then fails on a moved head rather than refusing a diff.
  for (const p of paths) write(p);
  for (const args of [["add", "-A"], ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture commit"]]) {
    const git = spawnSync("git", args, { encoding: "utf8" });
    if (git.status !== 0) throw new Error(`emit-implementation-stage: git ${args.join(" ")} failed: ${git.stderr}`);
  }
  answer = reply();
} else if (mode === "phased") {
  // Each phase adds the one scope path numbered after it.
  writePhased(phasePath());
  answer = reply();
} else if (mode === "phased-modify") {
  // Phase 1 adds the first scope path; every later phase changes it again.
  writePhased(paths[0]);
  answer = reply();
} else if (mode === "fail-at-phase") {
  // The shape of the response team-notes run 6 recorded: a valid reply that
  // did not complete, and no change.
  if (phaseIndex === targetPhase) {
    answer = reply("blocked", "fixture refused this phase", [`phase ${phaseIndex}`]);
  } else {
    writePhased(phasePath());
    answer = reply();
  }
} else if (mode === "mutate-at-phase") {
  // The executor writes outside the scope in one phase only, beside its own file.
  if (phaseIndex === targetPhase) writeFileSync("unreported.txt", "fixture wrote this\n");
  writePhased(phasePath());
  answer = reply();
} else if (mode === "phased-restore") {
  // Phase 1 changes an existing file, phase 2 puts it back byte for byte, and
  // later phases add the remaining scope paths. The restore is derived from the
  // checkout (the appended line is removed), not from a literal.
  const SUFFIX = "\n// changed by phase 1\n";
  if (phaseIndex === 1) {
    write(paths[0], readFileSync(paths[0], "utf8") + SUFFIX);
  } else if (phaseIndex === 2) {
    const current = readFileSync(paths[0], "utf8");
    if (!current.endsWith(SUFFIX)) {
      throw new Error("emit-implementation-stage: phase 2 did not find phase 1's change in the checkout");
    }
    write(paths[0], current.slice(0, -SUFFIX.length));
  } else {
    writePhased(phasePath());
  }
  answer = reply();
} else if (mode === "phased-by-prompt") {
  // Every phase writes the first scope path and its own, after checking each
  // against the prompt's two existence lists and the checkout. A path in
  // neither list, or one a list misstates, throws, so a stage that stops
  // telling the model what exists fails here instead of passing by coincidence.
  const exists = listAfter("exist in the checkout now:");
  const missing = listAfter("do not exist yet:");
  const targets = phaseIndex === 1 ? [paths[0]] : [paths[0], phasePath()];
  for (const path of targets) {
    if (!exists.includes(path) && !missing.includes(path)) {
      throw new Error(`emit-implementation-stage: ${path} is in neither of the prompt's existence lists`);
    }
    if (exists.includes(path) !== existsSync(path)) {
      throw new Error(`emit-implementation-stage: the prompt's lists misstate whether ${path} exists`);
    }
    writePhased(path);
  }
  answer = reply();
} else if (mode === "add-dependency") {
  // Adds a package.json declaring one package: @tiptap/react at ^3, the first
  // package crew-chatter run 4's specification chose
  // (test/fixtures/recorded/spec-crew-chatter-run-4-dependency-in-prose.json).
  const manifest = paths.find((p) => p === "package.json" || p.endsWith("/package.json"));
  if (manifest === undefined) throw new Error("emit-implementation-stage: add-dependency needs a package.json in scope");
  write(manifest, `${JSON.stringify({ dependencies: { "@tiptap/react": "^3" } }, null, 2)}\n`);
  answer = reply();
} else {
  throw new Error(`emit-implementation-stage: unknown EMIT_MODE ${mode}`);
}
emit(answer);
