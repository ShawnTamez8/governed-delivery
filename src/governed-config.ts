import { spawnSync } from "node:child_process";

/**
 * The verification configuration, read from `governed.yaml` as committed at
 * the run's starting commit (architecture section 7: the file is authored
 * before the first run and is never part of any run's scope).
 *
 * **The accepted shape, in full.** One top-level key, then one or more
 * entries, each two lines in a fixed key order:
 *
 * ```yaml
 * verify:
 *   - name: typecheck
 *     command: ["npm", "run", "typecheck"]
 * ```
 *
 * Blank lines and lines whose first non-space character is `#` are ignored
 * anywhere. Anything else is refused by name with the line it was found on.
 *
 * Every command token is double-quoted, and that is a requirement rather
 * than a style: it makes the bracket span valid JSON as well as valid YAML,
 * so `JSON.parse` reads it and this module needs no YAML dependency — the
 * repository has no runtime dependencies and this is not the place to gain
 * one.
 *
 * The parser is a strict subset by intent. Every shape it does not accept is
 * a shape nothing in this repository has to be correct about.
 */
export interface VerifyCommand {
  name: string;
  command: string[];
}

export interface VerificationConfig {
  commands: VerifyCommand[];
}

export type ParseResult =
  | { ok: true; config: VerificationConfig }
  | { ok: false; reason: string };

/**
 * A command name becomes part of a retained evidence filename and reaches a
 * path join, so it is held to the same rule as a model name and a feature
 * id: no separators, no traversal, no shell metacharacters.
 */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Command tokens are constrained to characters that survive a Windows shell.
 * `runVerifyCommand` spawns with `shell: true` (hazard 8: npm-shimmed
 * executables need shell resolution), and a token containing a space, quote,
 * or metacharacter would be reinterpreted there — the argv the audit records
 * would not be the argv that ran. `src/profile.ts` states the same risk for
 * model names.
 */
const TOKEN = /^[A-Za-z0-9._:=@+/-]+$/;

/** The file this module reads, fixed and non-configurable (section 7). */
export const GOVERNED_CONFIG_PATH = "governed.yaml";

interface ContentLine {
  text: string;
  /** 1-based, so a refusal names the line the operator sees in the editor. */
  number: number;
}

function contentLines(text: string): ContentLine[] {
  const out: ContentLine[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    out.push({ text: line, number: i + 1 });
  }
  return out;
}

/**
 * Parse `governed.yaml`. Never throws: every rejection is a named reason
 * carrying the line number, because the operator authored this file by hand
 * and a refusal they cannot locate is a refusal they cannot fix.
 */
export function parseGovernedConfig(text: string): ParseResult {
  const lines = contentLines(text);
  if (lines.length === 0) {
    return { ok: false, reason: `${GOVERNED_CONFIG_PATH} is empty: it must declare a verify: block` };
  }
  // Rule 1: the top-level key.
  if (lines[0].text !== "verify:") {
    return {
      ok: false,
      reason: `${GOVERNED_CONFIG_PATH} line ${lines[0].number}: the first content line must be exactly "verify:", found ${JSON.stringify(lines[0].text)}`,
    };
  }

  const commands: VerifyCommand[] = [];
  const seen = new Set<string>();
  let i = 1;
  while (i < lines.length) {
    const entry = lines[i];
    // Rule 2: the entry opens with the name. Key order is fixed — an entry
    // opening with `command:` is refused here rather than accepted, because
    // supporting both orders doubles the states this parser has to be
    // correct about and buys nothing.
    const nameMatch = /^ {2}- name: (.*)$/.exec(entry.text);
    if (!nameMatch) {
      return {
        ok: false,
        reason: `${GOVERNED_CONFIG_PATH} line ${entry.number}: expected an entry opening with "  - name: <name>", found ${JSON.stringify(entry.text)}`,
      };
    }
    const name = nameMatch[1].trim();
    // Rule 4: the name is a filename-safe token.
    if (!NAME.test(name)) {
      return {
        ok: false,
        reason: `${GOVERNED_CONFIG_PATH} line ${entry.number}: invalid command name ${JSON.stringify(name)}: must be 1-64 characters of letters, digits, dot, underscore, or hyphen, starting with a letter or digit`,
      };
    }
    // Rule 5: names are unique — the name identifies the retained evidence.
    if (seen.has(name)) {
      return {
        ok: false,
        reason: `${GOVERNED_CONFIG_PATH} line ${entry.number}: duplicate command name ${JSON.stringify(name)}`,
      };
    }
    seen.add(name);

    // Rule 3: the command line follows immediately.
    const commandLine = lines[i + 1];
    if (!commandLine) {
      return {
        ok: false,
        reason: `${GOVERNED_CONFIG_PATH} line ${entry.number}: command ${JSON.stringify(name)} has no command: line`,
      };
    }
    const commandMatch = /^ {4}command: (\[.*\])$/.exec(commandLine.text);
    if (!commandMatch) {
      return {
        ok: false,
        reason: `${GOVERNED_CONFIG_PATH} line ${commandLine.number}: expected "    command: [\\"...\\"]" with every token double-quoted, found ${JSON.stringify(commandLine.text)}`,
      };
    }
    // Rule 6: the bracket span is a non-empty array of non-empty strings.
    let parsed: unknown;
    try {
      parsed = JSON.parse(commandMatch[1]);
    } catch (err) {
      return {
        ok: false,
        reason: `${GOVERNED_CONFIG_PATH} line ${commandLine.number}: command ${JSON.stringify(name)} is not a readable token list — every token must be double-quoted: ${(err as Error).message}`,
      };
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return {
        ok: false,
        reason: `${GOVERNED_CONFIG_PATH} line ${commandLine.number}: command ${JSON.stringify(name)} must name at least one token`,
      };
    }
    const tokens: string[] = [];
    for (const token of parsed) {
      if (typeof token !== "string" || token === "") {
        return {
          ok: false,
          reason: `${GOVERNED_CONFIG_PATH} line ${commandLine.number}: command ${JSON.stringify(name)} has a token that is not a non-empty string`,
        };
      }
      // Rule 7: the token survives the shell unchanged.
      if (!TOKEN.test(token)) {
        return {
          ok: false,
          reason: `${GOVERNED_CONFIG_PATH} line ${commandLine.number}: command ${JSON.stringify(name)} token ${JSON.stringify(token)} contains a character the shell would reinterpret: allowed are letters, digits, and . _ - : = @ + /`,
        };
      }
      tokens.push(token);
    }
    commands.push({ name, command: tokens });
    i += 2;
  }

  // Rule 8: a verify: block naming nothing cannot verify anything, and a run
  // frozen against it could only ever block after every stage has spent.
  if (commands.length === 0) {
    return {
      ok: false,
      reason: `${GOVERNED_CONFIG_PATH}: the verify: block names no commands`,
    };
  }
  return { ok: true, config: { commands } };
}

/**
 * Read and parse `governed.yaml` as it exists **at the given commit**.
 *
 * There is deliberately no working-copy fallback. The run branch is created
 * from this commit, so working-copy bytes are not what the run will verify
 * against; a file that exists on disk but was never committed is refused as
 * uncommitted, naming the commit, rather than silently freezing bytes the
 * branch does not contain (hazard 12).
 *
 * git is spawned directly, no shell, the way `resolveStartingCommit` spawns
 * it.
 */
export function loadGovernedConfigAtCommit(rootDir: string, commit: string): ParseResult {
  let result;
  try {
    result = spawnSync("git", ["show", `${commit}:${GOVERNED_CONFIG_PATH}`], {
      cwd: rootDir,
      encoding: "utf8",
    });
  } catch (err) {
    return { ok: false, reason: `cannot read ${GOVERNED_CONFIG_PATH} at ${commit}: ${(err as Error).message}` };
  }
  if (result.error) {
    return { ok: false, reason: `cannot read ${GOVERNED_CONFIG_PATH} at ${commit}: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const detail = (result.stderr ?? "").trim();
    // git reports a path missing from the tree two ways: "does not exist in"
    // when it is absent everywhere, and "exists on disk, but not in" when the
    // operator wrote the file and never committed it. Both are the
    // uncommitted refusal and both name the commit; anything else — no
    // repository, an unknown object — is a different failure and says so,
    // because a checkout problem reported as an uncommitted file sends the
    // operator to the wrong fix.
    const missingPath = /does not exist in|exists on disk, but not in/.test(detail);
    if (!missingPath) {
      return {
        ok: false,
        reason: `cannot read ${GOVERNED_CONFIG_PATH} at ${commit}: git show exited with code ${result.status}${detail ? `: ${detail}` : ""}`,
      };
    }
    return {
      ok: false,
      reason: `${GOVERNED_CONFIG_PATH} is not committed at ${commit}: the verification configuration must be committed before a run is created`,
    };
  }
  if (typeof result.stdout !== "string") {
    return { ok: false, reason: `cannot read ${GOVERNED_CONFIG_PATH} at ${commit}: git returned no output` };
  }
  return parseGovernedConfig(result.stdout);
}
