import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Two rules the sandbox modules are held to (docs/features/sandboxed-implementer/plan.md):
 *
 * - Extension point 4: no package-manager logic in the sandbox, tool server,
 *   egress proxy or boundary code. Derived files come from `governed.yaml`'s
 *   `derived:` list, so these modules need no ecosystem knowledge, and a
 *   second stack must not have to edit them.
 * - No empty `catch`, and no `catch` that drops the error: every `catch` body
 *   uses the caught error or rethrows, so no failure in the new path is
 *   swallowed.
 */

const MODULES = ["src/container.ts", "src/tool-server.ts", "src/egress-proxy.ts", "src/workspace-commit.ts"];

const ECOSYSTEM = [/npm/i, /package\.json/i, /package-lock/i, /node_modules/i, /registry\.npmjs/i, /\byarn\b/i, /\bpnpm\b/i];

test("the sandbox modules name no package manager, manifest, lockfile, install directory or registry", () => {
  const offenders: string[] = [];
  for (const module of MODULES) {
    readFileSync(resolve(module), "utf8").split(/\r?\n/).forEach((line, index) => {
      for (const pattern of ECOSYSTEM) {
        if (pattern.test(line)) offenders.push(`${module}:${index + 1}: ${pattern} in ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

/**
 * Remove comments and string contents, keeping offsets and line breaks, so
 * braces and words in either do not count. A template literal's `${...}`
 * expressions are code and are kept.
 */
function codeOnly(source: string): string {
  let out = "";
  let i = 0;
  const blank = (ch: string) => (ch === "\n" ? "\n" : " ");
  // Scan code until `stop` (a closing brace at depth zero, for a template
  // expression) or the end.
  const scanCode = (closeOnBrace: boolean): void => {
    let depth = 0;
    while (i < source.length) {
      const c = source[i]!;
      const next = source[i + 1];
      if (closeOnBrace && c === "}" && depth === 0) return;
      if (c === "{") depth++;
      if (c === "}") depth--;
      if (c === "/" && next === "/") {
        while (i < source.length && source[i] !== "\n") {
          out += " ";
          i++;
        }
        continue;
      }
      if (c === "/" && next === "*") {
        const end = source.indexOf("*/", i + 2);
        const stop = end === -1 ? source.length : end + 2;
        out += source.slice(i, stop).replace(/[^\n]/g, " ");
        i = stop;
        continue;
      }
      if (c === '"' || c === "'") {
        out += c;
        i++;
        while (i < source.length && source[i] !== c && source[i] !== "\n") {
          if (source[i] === "\\") {
            out += "  ";
            i += 2;
            continue;
          }
          out += blank(source[i]!);
          i++;
        }
        out += source[i] ?? "";
        i++;
        continue;
      }
      if (c === "`") {
        out += c;
        i++;
        while (i < source.length && source[i] !== "`") {
          if (source[i] === "\\") {
            out += "  ";
            i += 2;
            continue;
          }
          if (source[i] === "$" && source[i + 1] === "{") {
            out += "${";
            i += 2;
            scanCode(true);
            out += source[i] ?? "";
            i++;
            continue;
          }
          out += blank(source[i]!);
          i++;
        }
        out += source[i] ?? "";
        i++;
        continue;
      }
      out += c;
      i++;
    }
  };
  scanCode(false);
  return out;
}

/** Each `catch` clause: its bound name, or null, and its body. */
export function catchClauses(source: string): { line: number; binding: string | null; body: string }[] {
  const code = codeOnly(source);
  const clauses: { line: number; binding: string | null; body: string }[] = [];
  const pattern = /\bcatch\s*(?:\(\s*([A-Za-z_$][\w$]*)[^)]*\))?\s*\{/g;
  for (let match = pattern.exec(code); match !== null; match = pattern.exec(code)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < code.length && depth > 0) {
      if (code[i] === "{") depth++;
      if (code[i] === "}") depth--;
      i++;
    }
    clauses.push({
      line: code.slice(0, match.index).split("\n").length,
      binding: match[1] ?? null,
      body: code.slice(start, i - 1),
    });
  }
  return clauses;
}

export function droppedCatches(source: string): string[] {
  return catchClauses(source)
    .filter(({ binding, body }) => {
      if (body.trim() === "") return true;
      if (/\bthrow\b/.test(body)) return false;
      return binding === null || !new RegExp(`\\b${binding.replace(/\$/g, "\\$")}\\b`).test(body);
    })
    .map(({ line, binding }) => `line ${line}: catch${binding === null ? "" : ` (${binding})`}`);
}

test("no sandbox module has an empty catch or one that drops its error", () => {
  const offenders: string[] = [];
  for (const module of MODULES) {
    for (const entry of droppedCatches(readFileSync(resolve(module), "utf8"))) offenders.push(`${module} ${entry}`);
  }
  assert.deepEqual(offenders, []);
});

test("the catch scan finds what it is meant to find", () => {
  assert.deepEqual(droppedCatches("try { a(); } catch {}"), ["line 1: catch"]);
  assert.deepEqual(droppedCatches("try { a(); } catch (err) { return null; }"), ["line 1: catch (err)"]);
  assert.deepEqual(droppedCatches("try { a(); } catch { return 1; }"), ["line 1: catch"]);
  assert.deepEqual(droppedCatches("try { a(); } catch (err) { log(err); }"), []);
  assert.deepEqual(droppedCatches("try { a(); } catch { throw new Error('x'); }"), []);
  assert.deepEqual(droppedCatches("try { a(); } catch (e) { if (x) { y(e); } }"), []);
  // A template literal's expression is code.
  assert.deepEqual(droppedCatches("try { a(); } catch (err) { log(`failed: ${(err as Error).message}`); }"), []);
  // A brace or the binding's name inside a string or comment does not count.
  assert.deepEqual(droppedCatches("try { a(); } catch (err) { s = '{ err }'; /* err */ }"), ["line 1: catch (err)"]);
});
