import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GOVERNED_CONFIG_PATH,
  loadGovernedConfigAtCommit,
  parseGovernedConfig,
} from "../src/governed-config.ts";

const VALID = `# the repository's verification commands
verify:
  - name: typecheck
    command: ["npm", "run", "typecheck"]

  - name: test
    command: ["npm", "test"]
`;

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** A real repository with one commit, so the reader is exercised against git. */
function withRepo(fn: (root: string, commit: string) => void, seed: string | null = VALID): void {
  const root = mkdtempSync(join(tmpdir(), "bw-governed-"));
  try {
    assert.equal(git(root, ["init", "-q"]).status, 0);
    writeFileSync(join(root, "base.txt"), "base\n");
    if (seed !== null) writeFileSync(join(root, GOVERNED_CONFIG_PATH), seed);
    assert.equal(git(root, ["add", "-A"]).status, 0);
    const commit = git(root, [
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "-m",
      "base",
    ]);
    assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
    const head = git(root, ["rev-parse", "HEAD"]);
    assert.equal(head.status, 0);
    fn(root, head.stdout.trim());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function refusal(text: string): string {
  const result = parseGovernedConfig(text);
  assert.equal(result.ok, false, "expected a refusal, got an accepted config");
  return (result as { ok: false; reason: string }).reason;
}

test("the accepted shape parses into commands in file order", () => {
  const result = parseGovernedConfig(VALID);
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  assert.ok(result.ok);
  assert.deepEqual(result.config.commands, [
    { name: "typecheck", command: ["npm", "run", "typecheck"] },
    { name: "test", command: ["npm", "test"] },
  ]);
});

test("CRLF line endings parse identically", () => {
  // git's autocrlf can hand this parser either ending. A parser that split on
  // "\n" alone would leave a trailing carriage return on every line and
  // refuse a valid file.
  const result = parseGovernedConfig(VALID.replace(/\n/g, "\r\n"));
  assert.ok(result.ok);
  assert.equal(result.config.commands.length, 2);
});

test("rule 1: a non-verify top-level key is refused with its line", () => {
  const reason = refusal(`checks:\n  - name: a\n    command: ["npm", "test"]\n`);
  assert.match(reason, /line 1/);
  assert.match(reason, /must be exactly "verify:"/);
});

test("rule 2: an entry opening with command: instead of name: is refused", () => {
  const reason = refusal(`verify:\n  - command: ["npm", "test"]\n    name: a\n`);
  assert.match(reason, /line 2/);
  assert.match(reason, /expected an entry opening with "  - name: <name>"/);
});

test("rule 3: a command that is a plain string is refused", () => {
  const reason = refusal(`verify:\n  - name: a\n    command: npm test\n`);
  assert.match(reason, /line 3/);
  assert.match(reason, /every token double-quoted/);
});

test("rule 4: a name carrying a path separator is refused", () => {
  const reason = refusal(`verify:\n  - name: ../escape\n    command: ["npm", "test"]\n`);
  assert.match(reason, /line 2/);
  assert.match(reason, /invalid command name/);
});

test("rule 5: a duplicate name is refused", () => {
  const reason = refusal(
    `verify:\n  - name: a\n    command: ["npm", "test"]\n  - name: a\n    command: ["npm", "test"]\n`
  );
  assert.match(reason, /line 4/);
  assert.match(reason, /duplicate command name "a"/);
});

test("rule 6: unquoted tokens are refused", () => {
  const reason = refusal(`verify:\n  - name: a\n    command: [npm, test]\n`);
  assert.match(reason, /line 3/);
  assert.match(reason, /not a readable token list/);
});

test("rule 6: an empty token list is refused", () => {
  const reason = refusal(`verify:\n  - name: a\n    command: []\n`);
  assert.match(reason, /line 3/);
  assert.match(reason, /must name at least one token/);
});

test("rule 7: a token containing a space is refused", () => {
  const reason = refusal(`verify:\n  - name: a\n    command: ["npm run test"]\n`);
  assert.match(reason, /line 3/);
  assert.match(reason, /would reinterpret/);
});

test("rule 7: a token containing an ampersand is refused", () => {
  // The shell would run a second command the audit never records.
  const reason = refusal(`verify:\n  - name: a\n    command: ["npm", "test", "&&", "rm"]\n`);
  assert.match(reason, /line 3/);
  assert.match(reason, /"&&"/);
  assert.match(reason, /would reinterpret/);
});

test("rule 8: a verify: block naming no commands is refused", () => {
  const reason = refusal(`verify:\n`);
  assert.match(reason, /names no commands/);
});

test("rule 9: unrecognized trailing content is refused", () => {
  const reason = refusal(`verify:\n  - name: a\n    command: ["npm", "test"]\nextra: 1\n`);
  assert.match(reason, /line 4/);
  assert.match(reason, /expected an entry opening/);
});

test("an entry with no command: line is refused", () => {
  const reason = refusal(`verify:\n  - name: a\n`);
  assert.match(reason, /line 2/);
  assert.match(reason, /has no command: line/);
});

test("an empty file is refused", () => {
  assert.match(refusal("\n\n# only comments\n"), /is empty/);
});

test("loadGovernedConfigAtCommit reads the file as committed", () => {
  withRepo((root, commit) => {
    const result = loadGovernedConfigAtCommit(root, commit);
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.deepEqual(result.config.commands.map((c) => c.name), ["typecheck", "test"]);
  });
});

test("loadGovernedConfigAtCommit refuses a file present on disk but never committed", () => {
  withRepo((root, commit) => {
    writeFileSync(join(root, GOVERNED_CONFIG_PATH), VALID);
    const result = loadGovernedConfigAtCommit(root, commit);
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; reason: string }).reason, /is not committed at/);
  }, null);
});

test("loadGovernedConfigAtCommit reads the committed bytes, not the working copy", () => {
  withRepo((root, commit) => {
    // The working copy names a command the commit does not. The run branch is
    // created from the commit, so the commit is what the run verifies
    // against; a working-copy fallback would freeze bytes the branch does not
    // contain.
    writeFileSync(
      join(root, GOVERNED_CONFIG_PATH),
      `verify:\n  - name: working-copy-only\n    command: ["npm", "test"]\n`
    );
    const result = loadGovernedConfigAtCommit(root, commit);
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.deepEqual(result.config.commands.map((c) => c.name), ["typecheck", "test"]);
  });
});

test("loadGovernedConfigAtCommit refuses a committed but unparseable file", () => {
  withRepo((root, commit) => {
    const result = loadGovernedConfigAtCommit(root, commit);
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; reason: string }).reason, /must be exactly "verify:"/);
  }, `checks:\n  - name: a\n`);
});

test("loadGovernedConfigAtCommit outside a git repository refuses without claiming the file is uncommitted", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-governed-norepo-"));
  try {
    const result = loadGovernedConfigAtCommit(root, "0".repeat(40));
    assert.equal(result.ok, false);
    const reason = (result as { ok: false; reason: string }).reason;
    assert.match(reason, /cannot read governed\.yaml/);
    assert.doesNotMatch(reason, /is not committed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- hazard 11: this repository's own seeded configuration ---

test("the repository's committed governed.yaml names commands that exist in package.json", () => {
  // The expected values come from `package.json` read at test time, never
  // from a literal written beside the code: renaming an npm script without
  // updating `governed.yaml` must fail here rather than at the first run
  // that reaches verification.
  const result = parseGovernedConfig(
    readFileSync(join(process.cwd(), GOVERNED_CONFIG_PATH), "utf8")
  );
  assert.ok(result.ok, result.ok ? "" : result.reason);
  assert.ok(result.config.commands.length > 0, "the repository must be able to verify itself");
  const scripts = Object.keys(
    (JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }).scripts
  );
  for (const command of result.config.commands) {
    if (command.command[0] === "npm" && command.command[1] === "run") {
      assert.ok(
        scripts.includes(command.command[2]),
        `governed.yaml names npm script ${command.command[2]}, which package.json does not define`
      );
    }
  }
});
