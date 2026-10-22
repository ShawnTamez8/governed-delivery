import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import type { CommitVerificationResult } from "./commit-verification.ts";
import type { VerifyCommand } from "./governed-config.ts";

/**
 * The system's acceptance runner (docs/features/protected-acceptance-tests/plan.md).
 * The image holds Playwright, its Chromium and the committed
 * `container/acceptance.config.mjs` under `/opt/bw-browser`; the command below
 * is the only way a suite runs, so no model, target file or npm script takes
 * part in the invocation. A suite imports the runner by the absolute path the
 * image names in `BW_PLAYWRIGHT_TEST`, because a bare `@playwright/test` import
 * resolves only from a package planted in the worktree (Task 1 spike record).
 */
export const ACCEPTANCE_RUNNER = "/opt/bw-browser/node_modules/@playwright/test/cli.js";
export const ACCEPTANCE_CONFIG = "/opt/bw-browser/acceptance.config.mjs";
/**
 * The reproduction runner's config: the acceptance config with `testDir` at
 * `CHECKS_ROOT` (docs/features/reproduced-review-findings/plan.md). The
 * acceptance config cannot run a file there: it reports "No tests found"
 * (`test/fixtures/recorded/reproduction-report-acceptance-config.json`).
 */
export const CHECKS_CONFIG = "/opt/bw-browser/checks.config.mjs";
/** The runner config's `testDir`, which the report's test paths are relative to. */
const ACCEPTANCE_ROOT = "acceptance/";
/** Where the worktree is mounted in the container; error locations are absolute under it. */
const CONTAINER_WORKTREE = "/work/";
/**
 * The checks runner's `testDir`, by which a reproduction's tests and its error
 * locations are both named: `CHECKS_MOUNT` in `src/container.ts` and a slash.
 * Held apart, and pinned equal by a test, so this module keeps no runtime import.
 */
export const CHECKS_ROOT = "/bw-checks/";

/**
 * A reviewer reproduction's file name (docs/features/reproduced-review-findings/plan.md,
 * hazard 3): the one rule the reply schema, the boundary validator and the
 * reviewer prompt all read. A Playwright `.spec.mjs` file, so the checks
 * runner's default test match finds it. Held here, beside the runner, because
 * `src/prompts.ts` may import nothing else.
 */
export const REPRODUCTION_FILE_NAME = /^[a-z0-9][a-z0-9-]{0,63}\.spec\.mjs$/;
/** The most reproductions one reviewer reply may carry (operator, 2026-10-22). */
export const REPRODUCTION_MAX_COUNT = 5;
/** The most characters one reproduction's content may hold. */
export const REPRODUCTION_MAX_CHARS = 65_536;

/**
 * The blank page the gate's baseline run uses when the suite commit has no
 * `index.html`, written only in a throwaway checkout, so navigation succeeds and
 * each test reaches its own interactions (gate 3).
 */
export const ACCEPTANCE_STUB_PAGE = "<!doctype html><html><head><title></title></head><body></body></html>";

/** The first statement of every suite file (gate 5). */
export const ACCEPTANCE_IMPORT_LINE = "const { test, expect } = await import(process.env.BW_PLAYWRIGHT_TEST);";

/** The suite directory a run with `new-run --acceptance-tests` freezes. */
export function acceptanceDir(slug: string): string {
  return `${ACCEPTANCE_ROOT}${slug}/`;
}

/**
 * The acceptance command's name, which names its retained log. A run with a
 * suite reserves it among the frozen verify commands (`freezeProfile`).
 */
export const ACCEPTANCE_COMMAND_NAME = "acceptance";

/** The system's command for the suite under `dir` (`acceptance/<slug>/`), run from `/work`. */
export function acceptanceCommand(dir: string, repeatEach: number): VerifyCommand {
  return {
    name: ACCEPTANCE_COMMAND_NAME,
    command: ["node", ACCEPTANCE_RUNNER, "test", "--config", ACCEPTANCE_CONFIG, "--repeat-each", String(repeatEach), dir],
  };
}

/**
 * The system's command for one reproduction file at `path`
 * (`/bw-checks/<finding>/<reviewer>/<file>`), named `name`, which names its
 * retained log. The reviewer chooses no part of it.
 */
export function reproductionCommand(name: string, path: string): VerifyCommand {
  return { name, command: ["node", ACCEPTANCE_RUNNER, "test", "--config", CHECKS_CONFIG, "--repeat-each", "2", path] };
}

export interface AcceptanceError {
  message: string;
  /** Repository-relative file, line and column, or null when the runner gave none. */
  location: { file: string; line: number; column: number } | null;
  /** The runner keeps a stack only for a result's first error. */
  stack: string | null;
}

export interface AcceptanceResult {
  status: string;
  errors: AcceptanceError[];
}

/** One test and every repeat of it, in report order. */
export interface AcceptanceTest {
  title: string;
  /** Repository-relative: `acceptance/<slug>/<file>`. */
  file: string;
  results: AcceptanceResult[];
}

export interface AcceptanceReport {
  /** The report's top-level errors: a file that failed to load, or no tests found. */
  loadErrors: AcceptanceError[];
  tests: AcceptanceTest[];
}

/** A committed suite file: its repository-relative path and content. */
export interface AcceptanceFile {
  path: string;
  content: string;
}

const ANSI = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

function readError(raw: unknown, stack: string | null, containerPrefix: string): AcceptanceError {
  const error = raw as { message?: unknown; location?: { file?: unknown; line?: unknown; column?: unknown } };
  const loc = error.location;
  const file = typeof loc?.file === "string" && loc.file.startsWith(containerPrefix) ? loc.file.slice(containerPrefix.length) : loc?.file;
  return {
    message: typeof error.message === "string" ? stripAnsi(error.message) : "",
    location:
      loc && typeof file === "string" && typeof loc.line === "number" && typeof loc.column === "number"
        ? { file, line: loc.line, column: loc.column }
        : null,
    stack: stack === null ? null : stripAnsi(stack),
  };
}

interface RawSuite {
  title?: string;
  specs?: { title: string; file: string; tests: { results: { status: string; errors?: unknown[]; error?: { stack?: unknown } }[] }[] }[];
  suites?: RawSuite[];
}

/**
 * The JSON report the acceptance command wrote, read from its retained log:
 * the header line `runInSandbox` writes, then the runner's stdout. Repeats of
 * one test arrive as separate entries with the same file and title path, and
 * are grouped here. Anything that does not parse as a complete report is
 * refused by name, never read as an empty suite. Each test's file is `root`
 * and its path under the runner's `testDir`; each error location loses
 * `containerPrefix`, so both name the same file. The defaults read an
 * acceptance suite by its repository path; `readReproductionReport` keeps the
 * container's `/bw-checks/` path for both.
 */
export function readAcceptanceReport(
  log: string,
  root: string = ACCEPTANCE_ROOT,
  containerPrefix: string = CONTAINER_WORKTREE
): { ok: true; report: AcceptanceReport } | { ok: false; reason: string } {
  const body = log.startsWith("# ran in container ") ? log.slice(log.indexOf("\n") + 1) : log;
  let raw: { errors?: unknown; suites?: unknown };
  try {
    raw = JSON.parse(body) as typeof raw;
  } catch (err) {
    return { ok: false, reason: `the acceptance log is not a complete JSON report: ${(err as Error).message}` };
  }
  if (raw === null || typeof raw !== "object" || !Array.isArray(raw.errors) || !Array.isArray(raw.suites)) {
    return { ok: false, reason: "the acceptance log's JSON is not a Playwright report: it has no errors and suites arrays" };
  }
  const tests = new Map<string, AcceptanceTest>();
  const walk = (suite: RawSuite, path: string[]) => {
    for (const spec of suite.specs ?? []) {
      const file = root + spec.file;
      const key = JSON.stringify([file, ...path, spec.title]);
      const test = tests.get(key) ?? { title: spec.title, file, results: [] };
      tests.set(key, test);
      for (const entry of spec.tests) {
        for (const result of entry.results) {
          const stack = typeof result.error?.stack === "string" ? result.error.stack : null;
          test.results.push({
            status: result.status,
            errors: (result.errors ?? []).map((error, i) => readError(error, i === 0 ? stack : null, containerPrefix)),
          });
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...path, child.title ?? ""]);
  };
  // A top-level suite is a file, titled by its path; only nested suites add to the title path.
  for (const fileSuite of raw.suites as RawSuite[]) walk(fileSuite, []);
  return {
    ok: true,
    report: { loadErrors: (raw.errors as unknown[]).map((error) => readError(error, null, containerPrefix)), tests: [...tests.values()] },
  };
}

/** A reproduction's report, each test and error location named by its `/bw-checks/` path. */
export function readReproductionReport(log: string): ReturnType<typeof readAcceptanceReport> {
  return readAcceptanceReport(log, CHECKS_ROOT, "");
}

/**
 * Why a result failed. Only `valid_red` is evidence that a test exercised its
 * assertion against behaviour that is not there; every other class is a
 * broken test (gate 3).
 */
export type FailureClass = "valid_red" | "navigation" | "launch" | "hook" | "test_code" | "test_timeout";

const NAVIGATION = /net::ERR_|^\w*Error: page\.(goto|reload|goBack|goForward|waitForURL):/;
const MATCHER = /^Error: expect\(/;
/**
 * An assertion given a custom message, `expect(locator, "…")`, fails with that
 * message first and the matcher's header on its own line after a blank line.
 * An error a test throws itself with the same layout has no such header, and
 * stays `test_code` (Task 4 evaluation record, round 2).
 */
const CUSTOM_MESSAGE_MATCHER = /^Error: [\s\S]*?\n\nexpect\((?:locator|page)\)\.(?:not\.)?\w+\([^\n]*\) failed(?:\n|$)/;
const LOCATOR_TIMEOUT = /^TimeoutError: locator\.\w+: Timeout \d+ms exceeded\./;
/**
 * A matcher that refuses its own argument, such as `toHaveText(undefined)`,
 * fails under the same header as a mismatch, with or without a custom message,
 * but describes the argument on a line of its own: `Expected has value:
 * undefined`. No page can satisfy it, so it is the test's own error (Task 14;
 * the line appears in neither recorded mismatch nor locator timeout).
 */
const MATCHER_ARGUMENT = /\n(?:Expected|Received) has (?:type|value): /;

/**
 * Classify one failed result from its retained fields alone, by the rule pinned
 * against the real runner's reports (Task 1 spike record). A valid red is a
 * matcher failure, with or without a custom message, or a locator action's own
 * timeout, located in a suite file that declares no hook. A matcher that
 * refuses its own argument is not one.
 */
export function classifyFailure(result: AcceptanceResult, suiteFiles: AcceptanceFile[]): FailureClass {
  if (result.status === "timedOut") return "test_timeout";
  const first = result.errors[0];
  if (first === undefined) return "test_code";
  if (first.location === null) return "launch";
  const file = suiteFiles.find((f) => f.path === first.location!.file);
  if (file === undefined) return "test_code";
  if (declaresHook(parseSuiteFile(file.content))) return "hook";
  if (NAVIGATION.test(first.message)) return "navigation";
  if (MATCHER_ARGUMENT.test(first.message)) return "test_code";
  if (MATCHER.test(first.message) || CUSTOM_MESSAGE_MATCHER.test(first.message) || LOCATOR_TIMEOUT.test(first.message)) return "valid_red";
  return "test_code";
}

/**
 * A matcher whose locator matched no element: `expect(locator).toBeVisible()
 * failed`, then `Error: element(s) not found` on a line of its own
 * (`test/fixtures/recorded/acceptance-code-review-probes.json`, `browser[0]`).
 */
const MATCHER_NOT_FOUND = /\nError: element\(s\) not found(?:\n|$)/;

/**
 * Whether a failed result is a matcher failure: a valid red that is neither a
 * locator action's timeout nor a matcher whose locator found no element. Only
 * this confirms a reviewer's reproduction
 * (docs/features/reproduced-review-findings/plan.md): a locator that never
 * resolved, or resolved to an element it could not act on, says the page
 * differs from what the reproduction assumed, not that the defect is there
 * (operator, 2026-10-22, the code review's finding 2).
 */
export function isMatcherFailure(result: AcceptanceResult, files: AcceptanceFile[]): boolean {
  const message = result.errors[0]?.message ?? "";
  return classifyFailure(result, files) === "valid_red" && !LOCATOR_TIMEOUT.test(message) && !MATCHER_NOT_FOUND.test(message);
}

/** A call-log entry that records the retry loop's timing, not what the locator found. */
const RETRY_TIMING = /^(?:retrying \w+ action|waiting \d+ms)$/;

/**
 * Why a locator action timed out: the last entry of the call log in its
 * message that is not retry timing, with its repeat count and marker dropped.
 * For a locator that never resolved, that is `waiting for getByRole('button',
 * { name: '7' })`; for one that resolved to a hidden element it is `element
 * is not visible`, since the literal last entry is `waiting 500ms` (Task 1
 * spike record, `reproduction-report-hidden-locator.json`). Null when the
 * message has no call log.
 */
export function locatorWaitDetail(message: string): string | null {
  const start = message.indexOf("\nCall log:\n");
  if (start === -1) return null;
  const entries: string[] = [];
  for (const line of message.slice(start + "\nCall log:\n".length).split("\n")) {
    if (line.trim() === "") break;
    entries.push(line.trim().replace(/^(?:\d+ × )?- /, "").replace(/^\d+ × /, ""));
  }
  return entries.filter((entry) => !RETRY_TIMING.test(entry)).pop() ?? null;
}

export type TestOutcome = "pass" | "fail" | "flaky";

export interface ClassifiedTest {
  title: string;
  file: string;
  outcome: TestOutcome;
  /** The failure class shared by every failed result, or null for a pass or a flaky test whose classes differ. */
  failureClass: FailureClass | null;
  /** The first failed result's first error message, or null for a pass. */
  message: string | null;
}

/**
 * Each test's outcome over its repeats. A test is `flaky` when its results
 * differ in status or in failure class: a determinism measurement, never a
 * second chance (hazard 7).
 */
export function classifyAcceptance(report: AcceptanceReport, suiteFiles: AcceptanceFile[]): ClassifiedTest[] {
  return report.tests.map((test) => {
    const statuses = new Set(test.results.map((r) => r.status));
    const failed = test.results.filter((r) => r.status !== "passed");
    const classes = new Set(failed.map((r) => classifyFailure(r, suiteFiles)));
    const message = failed[0]?.errors[0]?.message ?? null;
    if (failed.length === 0) return { title: test.title, file: test.file, outcome: "pass", failureClass: null, message: null };
    if (statuses.size > 1 || classes.size > 1) {
      return { title: test.title, file: test.file, outcome: "flaky", failureClass: classes.size === 1 ? [...classes][0]! : null, message };
    }
    return { title: test.title, file: test.file, outcome: "fail", failureClass: [...classes][0]!, message };
  });
}

/**
 * A suite file parsed as an ES module by the TypeScript parser: syntax only,
 * nothing type-checked or run. Comments and string contents are never code, so
 * no rule below can match a word in a test title or a comment.
 */
function parseSuiteFile(content: string): ts.SourceFile {
  return ts.createSourceFile("suite.mjs", content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function everyNode(root: ts.Node, visit: (node: ts.Node) => void): void {
  const walk = (node: ts.Node): void => {
    visit(node);
    ts.forEachChild(node, walk);
  };
  walk(root);
}

function unwrap(expression: ts.Expression): ts.Expression {
  let e = expression;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

/** The called name: `f` for `f(…)`, `m` for `a.b.m(…)` and `a["m"](…)`. */
function calledName(call: ts.CallExpression | ts.NewExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) return callee.argumentExpression.text;
  return null;
}

/** Hook declarations. Gate 5 refuses hooks; a failure in a file that declares one is classed `hook`. */
const HOOKS = new Set(["beforeEach", "beforeAll", "afterEach", "afterAll"]);

function declaresHook(file: ts.SourceFile): boolean {
  let found = false;
  everyNode(file, (node) => {
    if (ts.isCallExpression(node) && HOOKS.has(calledName(node) ?? "")) found = true;
  });
  return found;
}

/** Calls whose function or string argument runs in the page, where DOM methods are synchronous. */
const PAGE_CONTEXT = new Set(["evaluate", "evaluateAll", "evaluateHandle", "$eval", "$$eval", "waitForFunction", "addInitScript"]);

function isPageContextCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && PAGE_CONTEXT.has(calledName(node) ?? "");
}

/** Whether `node` is inside a function passed to a page-context call. */
function inPageContext(node: ts.Node): boolean {
  for (let n: ts.Node = node; n.parent !== undefined; n = n.parent) {
    if (ts.isFunctionLike(n) && isPageContextCall(n.parent) && n.parent.arguments.some((a) => a === n)) return true;
  }
  return false;
}

/** Playwright's auto-retrying page and locator matchers, the only ones gate 5 allows. */
const RETRYING_MATCHERS = new Set([
  "toBeAttached", "toBeChecked", "toBeDisabled", "toBeEditable", "toBeEmpty", "toBeEnabled", "toBeFocused",
  "toBeHidden", "toBeInViewport", "toBeVisible", "toContainClass", "toContainText", "toHaveAccessibleDescription",
  "toHaveAccessibleErrorMessage", "toHaveAccessibleName", "toHaveAttribute", "toHaveClass", "toHaveCount",
  "toHaveCSS", "toHaveId", "toHaveJSProperty", "toHaveRole", "toHaveText", "toHaveValue", "toHaveValues",
  "toMatchAriaSnapshot", "toHaveTitle", "toHaveURL",
]);

/** Playwright test, page, locator, keyboard and mouse methods that return a promise. */
const PLAYWRIGHT_ASYNC = new Set([
  "click", "dblclick", "press", "pressSequentially", "fill", "type", "check", "uncheck", "setChecked", "selectOption",
  "selectText", "setInputFiles", "hover", "focus", "blur", "tap", "dragTo", "clear", "goto", "reload", "goBack",
  "goForward", "setContent", "waitFor", "waitForURL", "waitForSelector", "waitForFunction", "waitForLoadState",
  "waitForEvent", "waitForRequest", "waitForResponse", "evaluate", "evaluateHandle", "evaluateAll", "$eval", "$$eval",
  "scrollIntoViewIfNeeded", "setViewportSize", "emulateMedia", "bringToFront", "down", "up", "insertText", "move",
  "wheel", "textContent", "innerText", "innerHTML", "inputValue", "getAttribute", "isVisible", "isHidden", "isEnabled",
  "isDisabled", "isChecked", "isEditable", "count", "allTextContents", "allInnerTexts", "boundingBox", "title", "content",
  "screenshot", "addInitScript", "addScriptTag", "addStyleTag", "route", "unroute", "newPage", "close", "step",
]);

const PROMISE_STATICS = new Set(["all", "allSettled", "race", "any"]);

type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
}

/** The file's named functions: declarations and `const f = (…) => …` or `function (…) {…}`. */
function localFunctions(file: ts.SourceFile): Map<string, FunctionNode> {
  const functions = new Map<string, FunctionNode>();
  everyNode(file, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) functions.set(node.name.text, node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const init = unwrap(node.initializer);
      if (isFunctionNode(init)) functions.set(node.name.text, init);
    }
  });
  return functions;
}

/**
 * The value `name` is declared with where `from` uses it: the initializer, or
 * the function declaration, in the nearest enclosing block or file that
 * declares the name. Null when the nearest declaration is a parameter or has no
 * initializer, so two tests' helpers of the same name stay apart.
 */
function declaredValue(name: string, from: ts.Node): ts.Node | null {
  for (let scope = from.parent; scope !== undefined; scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === name)) return null;
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
      if (!ts.isVariableStatement(statement)) continue;
      for (const d of statement.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name) return d.initializer === undefined ? null : unwrap(d.initializer);
      }
    }
  }
  return null;
}

/**
 * The function `expression` names, resolved lexically: an identifier declared
 * as a function, or `object.method` where `object` is declared as an object
 * literal holding that method. Null for anything else.
 */
function namedFunction(expression: ts.Expression): ts.FunctionLikeDeclaration | null {
  const e = unwrap(expression);
  if (ts.isIdentifier(e)) {
    const value = declaredValue(e.text, e);
    return value !== null && isFunctionNode(value) ? value : null;
  }
  if (!ts.isPropertyAccessExpression(e) || !ts.isIdentifier(e.expression)) return null;
  const object = declaredValue(e.expression.text, e);
  if (object === null || !ts.isObjectLiteralExpression(object)) return null;
  const property = object.properties.find((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === e.name.text);
  if (property === undefined) return null;
  if (ts.isMethodDeclaration(property)) return property;
  if (ts.isShorthandPropertyAssignment(property)) return namedFunction(property.name);
  if (!ts.isPropertyAssignment(property)) return null;
  const value = unwrap(property.initializer);
  return isFunctionNode(value) ? value : null;
}

/**
 * Whether evaluating `expression` yields a promise, as far as syntax shows: a
 * Playwright async method, a retrying matcher, a `Promise` combinator or
 * `new Promise`, a `then` chain on any of them, or a call of a file-local
 * function that returns one. A `map` with an async callback yields an array of
 * promises, not a promise (`isPromiseArray`).
 */
function isPromise(expression: ts.Expression, promising: Set<string>): boolean {
  const e = unwrap(expression);
  if (ts.isNewExpression(e)) return ts.isIdentifier(e.expression) && e.expression.text === "Promise";
  if (ts.isConditionalExpression(e)) return isPromise(e.whenTrue, promising) || isPromise(e.whenFalse, promising);
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      return isPromise(e.left, promising) || isPromise(e.right, promising);
    }
    return false;
  }
  if (!ts.isCallExpression(e)) return false;
  const name = calledName(e);
  if (name === null) return false;
  if (ts.isIdentifier(e.expression)) return promising.has(name);
  if (!ts.isPropertyAccessExpression(e.expression)) return false;
  const object = e.expression.expression;
  if (ts.isIdentifier(object) && object.text === "Promise") return PROMISE_STATICS.has(name);
  if (name === "then" || name === "catch" || name === "finally") return isPromise(object, promising);
  return PLAYWRIGHT_ASYNC.has(name) || RETRYING_MATCHERS.has(name);
}

/**
 * Whether `expression` yields an array of promises: a `map` whose callback,
 * inline or named, returns a promise, an array literal holding one or spreading
 * such an array, or a call of a file-local
 * function in `arrays`, awaited when that function is async. Awaiting the array
 * settles none of its promises (Task 15).
 */
function isPromiseArray(expression: ts.Expression, promising: Set<string>, arrays: Set<string>): boolean {
  const e = unwrap(expression);
  if (ts.isArrayLiteralExpression(e)) {
    return e.elements.some((element) =>
      ts.isSpreadElement(element) ? isPromiseArray(element.expression, promising, arrays) : isPromise(element, promising)
    );
  }
  const localCall = (call: ts.Expression): string | null => {
    const c = unwrap(call);
    return ts.isCallExpression(c) && ts.isIdentifier(c.expression) && arrays.has(c.expression.text) ? c.expression.text : null;
  };
  if (ts.isAwaitExpression(e)) {
    const name = localCall(e.expression);
    return name !== null && promising.has(name);
  }
  if (!ts.isCallExpression(e)) return false;
  const name = localCall(e);
  if (name !== null) return !promising.has(name);
  return calledName(e) === "map" && e.arguments.some((a) => {
    const callback = isFunctionNode(a) ? a : namedFunction(a);
    return callback !== null && returnsPromise(callback, promising);
  });
}

/** The names of file-local functions that return an array of promises, to a fixed point. */
function promiseArrayFunctions(functions: Map<string, FunctionNode>, promising: Set<string>): Set<string> {
  const arrays = new Set<string>();
  const returnsArray = (fn: FunctionNode): boolean => {
    const body = fn.body;
    if (body === undefined) return false;
    if (!ts.isBlock(body)) return isPromiseArray(body, promising, arrays);
    let found = false;
    const walk = (node: ts.Node): void => {
      if (found || isFunctionNode(node)) return;
      if (ts.isReturnStatement(node) && node.expression !== undefined && isPromiseArray(node.expression, promising, arrays)) found = true;
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(body, walk);
    return found;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, fn] of functions) {
      if (!arrays.has(name) && returnsArray(fn)) {
        arrays.add(name);
        changed = true;
      }
    }
  }
  return arrays;
}

/**
 * Whether an array of promises is joined where `reference` uses it: passed to
 * `Promise.all` or `Promise.allSettled`, whose own promise the promise rule
 * then holds, or returned from a named file-local function, whose calls are
 * held to this rule in turn.
 */
function joins(reference: ts.Node, named: Set<FunctionNode>): boolean {
  let child = reference;
  let n = reference.parent;
  // Through parentheses, and through a spread into an array literal, which holds the same promises.
  for (;;) {
    if (ts.isParenthesizedExpression(n)) {
      child = n;
      n = n.parent;
    } else if (ts.isSpreadElement(n) && ts.isArrayLiteralExpression(n.parent)) {
      child = n.parent;
      n = n.parent.parent;
    } else break;
  }
  if (ts.isCallExpression(n) && n.arguments.some((a) => a === child)) {
    const callee = n.expression;
    return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Promise" &&
      (callee.name.text === "all" || callee.name.text === "allSettled");
  }
  const returned = ts.isReturnStatement(n) || (ts.isArrowFunction(n) && n.body === child);
  const owner = ts.findAncestor(n, isFunctionNode);
  return returned && owner !== undefined && named.has(owner);
}

/** Whether a function returns a promise: it is `async`, or its body or a `return` of its own yields one. */
function returnsPromise(fn: ts.FunctionLikeDeclaration, promising: Set<string>): boolean {
  if ((ts.getCombinedModifierFlags(fn) & ts.ModifierFlags.Async) !== 0) return true;
  const body = fn.body;
  if (body === undefined) return false;
  if (!ts.isBlock(body)) return isPromise(body, promising);
  let found = false;
  const walk = (node: ts.Node): void => {
    if (found || isFunctionNode(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined && isPromise(node.expression, promising)) found = true;
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(body, walk);
  return found;
}

/** The names of file-local functions that return a promise, to a fixed point, since helpers call helpers. */
function promisingFunctions(functions: Map<string, FunctionNode>): Set<string> {
  const promising = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, fn] of functions) {
      if (!promising.has(name) && returnsPromise(fn, promising)) {
        promising.add(name);
        changed = true;
      }
    }
  }
  return promising;
}

/** The `expect(…)` call a matcher call is made on, through one `.not`, or null when `call` is not a matcher call. */
function assertionOf(call: ts.CallExpression): ts.CallExpression | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  let target = call.expression.expression;
  if (ts.isPropertyAccessExpression(target) && target.name.text === "not") target = target.expression;
  return ts.isCallExpression(target) && ts.isIdentifier(target.expression) && target.expression.text === "expect" ? target : null;
}

function isRetryingAssertion(node: ts.Node): boolean {
  return ts.isCallExpression(node) && RETRYING_MATCHERS.has(calledName(node) ?? "") && assertionOf(node) !== null;
}

/** Whether a reference to a promise is settled: awaited, returned, or an arrow function's expression body. */
function settles(reference: ts.Node): boolean {
  for (let child = reference, n = reference.parent; n !== undefined; child = n, n = n.parent) {
    if (ts.isAwaitExpression(n) || ts.isReturnStatement(n)) return true;
    if (ts.isArrowFunction(n)) return n.body === child;
    if (isFunctionNode(n) || ts.isBlock(n) || ts.isSourceFile(n)) return false;
  }
  return false;
}

/** Calls refused by name anywhere, page context included. */
const FORBIDDEN_CALLS = new Map<string, string>([
  ["dispatchEvent", "dispatchEvent( sends untrusted input"],
  ["createEvent", "an event constructor sends untrusted input"],
  ["waitForTimeout", "waitForTimeout( is a fixed wait"],
  ["setTimeout", "setTimeout( is a delay or a hard-coded timeout"],
  ["setInterval", "setInterval( is a delay"],
  ["slow", "test.slow( changes the timeout"],
  ["setDefaultTimeout", "a default-timeout call is a hard-coded timeout"],
  ["setDefaultNavigationTimeout", "a default-timeout call is a hard-coded timeout"],
  ["only", ".only( focuses the suite"],
  ...[...HOOKS].map((hook): [string, string] => [hook, "a hook; each test opens its own page"]),
]);

/** The same refusals inside a script passed to a page-context call as a string. */
const FORBIDDEN_IN_SCRIPT: [RegExp, string][] = [
  [/\bdispatchEvent\s*\(/, "dispatchEvent( sends untrusted input"],
  [/\bnew\s+\w*Event\b|\bcreateEvent\s*\(/, "an event constructor sends untrusted input"],
  [/\bsetTimeout\s*\(/, "setTimeout( is a delay or a hard-coded timeout"],
  [/\bsetInterval\s*\(/, "setInterval( is a delay"],
];

/**
 * Every gate 5 refusal for one suite file, each naming its path and line. The
 * rules state intent, not shapes: a promise must be settled, not merely
 * prefixed by `await`, so a helper that returns `locator.click()` passes and a
 * statement that drops it is refused; code inside a page-context function runs
 * in the browser and is not held to the promise rule; and an assertion's
 * subject is left to Playwright, whose retrying matchers refuse anything but a
 * locator or page at run time.
 */
export function lintSuiteFile(file: AcceptanceFile): string[] {
  const source = parseSuiteFile(file.content);
  const refusals: string[] = [];
  const refuse = (node: ts.Node, rule: string) =>
    refusals.push(`${file.path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${rule}`);

  const first = source.statements[0];
  if (first === undefined || first.getText(source) !== ACCEPTANCE_IMPORT_LINE) {
    refuse(first ?? source, `the first statement must be exactly ${ACCEPTANCE_IMPORT_LINE}`);
  }

  const functions = localFunctions(source);
  const promising = promisingFunctions(functions);
  const arrays = promiseArrayFunctions(functions, promising);
  const named = new Set(functions.values());

  everyNode(source, (node) => {
    // Untrusted input, fixed waits, timeout changes, hooks and .only, by name.
    if (ts.isCallExpression(node)) {
      const rule = FORBIDDEN_CALLS.get(calledName(node) ?? "");
      if (rule !== undefined) refuse(node, rule);
      if (isPageContextCall(node)) {
        for (const arg of node.arguments) {
          if (!ts.isStringLiteralLike(arg) && !ts.isTemplateExpression(arg)) continue;
          for (const [pattern, scriptRule] of FORBIDDEN_IN_SCRIPT) if (pattern.test(arg.getText(source))) refuse(arg, scriptRule);
        }
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && /Event$/.test(node.expression.text)) {
      refuse(node, "an event constructor sends untrusted input");
    }
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ts.isIdentifier(node.name)) {
      if (/timeout$/i.test(node.name.text)) refuse(node, `a ${node.name.text}: option is a hard-coded timeout`);
      if (node.name.text === "delay") refuse(node, "a delay: option is a hard-coded delay");
    }
    if (ts.isStringLiteralLike(node) && node.text.trim().toLowerCase() === "networkidle") {
      refuse(node, "networkidle waits on the network, not the page");
    }

    // Retrying assertions only.
    if (ts.isIdentifier(node) && node.text === "expect") {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        refuse(node, `expect.${parent.name.text} is not a retrying assertion on the page`);
      } else if (ts.isCallExpression(parent) && parent.expression === node) {
        const subject = parent.arguments[0];
        if (subject !== undefined && ts.isAwaitExpression(unwrap(subject))) {
          refuse(node, "expect(await …) asserts once on a value instead of retrying on the page");
        }
        let chain: ts.Node = parent;
        if (ts.isPropertyAccessExpression(chain.parent) && chain.parent.name.text === "not") chain = chain.parent;
        const access = chain.parent;
        const matcher =
          ts.isPropertyAccessExpression(access) && ts.isCallExpression(access.parent) && access.parent.expression === access ? access.name.text : null;
        if (matcher === null || !RETRYING_MATCHERS.has(matcher)) {
          refuse(node, `${matcher ?? "an expect( with no matcher call"} is not one of Playwright's auto-retrying matchers`);
        }
      }
    }

    // No promise left unsettled outside the page.
    if (inPageContext(node)) return;
    if (ts.isExpressionStatement(node)) {
      let e = unwrap(node.expression);
      if (ts.isVoidExpression(e)) e = unwrap(e.expression);
      if (isPromise(e, promising)) {
        refuse(node, ts.isCallExpression(e) && isRetryingAssertion(e) ? "an expect( that is not awaited" : `a call of ${ts.isCallExpression(e) ? calledName(e) : "a promise"}( that is not awaited`);
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined && isPromise(node.initializer, promising)) {
      const name = node.name.text;
      const scope = ts.findAncestor(node.parent, (n) => isFunctionNode(n) || ts.isSourceFile(n))!;
      let settled = false;
      everyNode(scope, (n) => {
        if (n !== node.name && ts.isIdentifier(n) && n.text === name && settles(n)) settled = true;
      });
      if (!settled) refuse(node, `a promise assigned to ${name} is never awaited`);
    }
    if (ts.isCallExpression(node) && calledName(node) === "forEach" && node.arguments.some((a) => isFunctionNode(a) && returnsPromise(a, promising))) {
      refuse(node, "forEach( does not wait for the promises its callback returns");
    }
    // An array of promises is settled only through Promise.all, never by awaiting the array.
    if (ts.isExpression(node) && !ts.isParenthesizedExpression(node) && isPromiseArray(node, promising, arrays)) {
      let top: ts.Node = node;
      while (ts.isParenthesizedExpression(top.parent)) top = top.parent;
      const declaration = top.parent;
      if (ts.isVariableDeclaration(declaration) && declaration.initializer === top && ts.isIdentifier(declaration.name)) {
        const name = declaration.name.text;
        const scope = ts.findAncestor(declaration.parent, (n) => isFunctionNode(n) || ts.isSourceFile(n))!;
        let joined = false;
        everyNode(scope, (n) => {
          if (n !== declaration.name && ts.isIdentifier(n) && n.text === name && joins(n, named)) joined = true;
        });
        if (!joined) refuse(declaration, `an array of promises assigned to ${name} is never passed to Promise.all; awaiting the array settles none of them`);
      } else if (!joins(node, named)) {
        refuse(node, "an array of promises that is never passed to Promise.all; awaiting the array settles none of them");
      }
    }
  });

  // Every test runs a retrying assertion: in its own body, or in a function it
  // calls or passes to a call, followed through file-local helpers and
  // object-literal methods by the declaration each name resolves to. A function
  // the test declares and neither calls nor passes on runs nothing (Task 13).
  const runsAssertion = (fn: ts.FunctionLikeDeclaration, seen: Set<ts.Node>): boolean => {
    if (seen.has(fn)) return false;
    seen.add(fn);
    let found = false;
    const walk = (n: ts.Node): void => {
      if (found || inPageContext(n)) return;
      if (isRetryingAssertion(n)) {
        found = true;
        return;
      }
      if (ts.isFunctionLike(n)) {
        // An inline function runs when it is called on the spot or handed to a
        // call; a named one or a method only through a call that names it, below.
        let site: ts.Node = n;
        while (ts.isParenthesizedExpression(site.parent)) site = site.parent;
        const call = site.parent;
        if (isFunctionNode(n) && ts.isCallExpression(call) && (call.expression === site || call.arguments.some((a) => a === site)) && runsAssertion(n, seen)) found = true;
        return;
      }
      if (ts.isCallExpression(n)) {
        for (const named of [n.expression, ...n.arguments]) {
          const helper = namedFunction(named);
          if (helper !== null && runsAssertion(helper, seen)) found = true;
        }
      }
      ts.forEachChild(n, walk);
    };
    ts.forEachChild(fn, walk);
    return found;
  };
  everyNode(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "test") return;
    const body = node.arguments[node.arguments.length - 1];
    if (body !== undefined && isFunctionNode(body) && !runsAssertion(body, new Set())) refuse(node, "a test with no retrying assertion");
  });
  return refusals;
}

/** A test's place in the gate's record. */
export interface GateTest extends ClassifiedTest {
  /** The criterion ID its title begins with, or null when it begins with none the specification defines. */
  criterion: string | null;
  /** `red` for valid red evidence, `guard` for a test that already passes at the baseline (PASS_TO_PASS), or null. */
  role: "red" | "guard" | null;
}

export interface AcceptanceGateResult {
  ok: boolean;
  /** Every refusal, not only the first. */
  refusals: string[];
  tests: GateTest[];
  /** Criteria covered only by tests that already pass at the baseline: the author's claim, shown to the reviewers. */
  alreadySatisfied: string[];
}

/**
 * The validity gate over a suite's baseline report and its committed files
 * (gates 1 to 5 of docs/features/protected-acceptance-tests/plan.md). `criteria`
 * are the `AC-NNN` IDs the approved specification defines. It decides by
 * deterministic rules only and returns every reason it refuses.
 */
export function validateAcceptanceSuite(input: {
  report: AcceptanceReport;
  files: AcceptanceFile[];
  criteria: string[];
}): AcceptanceGateResult {
  const refusals: string[] = [];
  // Gate 1: loads.
  for (const error of input.report.loadErrors) {
    refusals.push(`the suite does not load: ${error.message.split("\n")[0]}${error.location ? ` (${error.location.file}:${error.location.line})` : ""}`);
  }
  if (input.report.tests.length === 0) refusals.push("the suite has no tests");

  const tests: GateTest[] = classifyAcceptance(input.report, input.files).map((test) => {
    const id = /^(AC-\d+)(?=\s|$)/.exec(test.title)?.[1] ?? null;
    const criterion = id !== null && input.criteria.includes(id) ? id : null;
    const role = test.outcome === "pass" ? "guard" : test.outcome === "fail" && test.failureClass === "valid_red" ? "red" : null;
    return { ...test, criterion, role };
  });

  // Gate 2: traces.
  for (const test of tests) {
    if (test.criterion === null) refusals.push(`test "${test.title}" does not begin with a criterion ID the specification defines`);
  }
  // Gates 3 and 4: red for the right reason, and deterministic.
  for (const test of tests) {
    if (test.outcome === "flaky") refusals.push(`test "${test.title}" is flaky: its repeats differ (${test.message?.split("\n")[0] ?? "a pass and a failure"})`);
    else if (test.outcome === "fail" && test.failureClass !== "valid_red") {
      refusals.push(`test "${test.title}" is broken (${test.failureClass}): ${test.message?.split("\n")[0] ?? "no error"}`);
    }
  }
  const alreadySatisfied: string[] = [];
  for (const criterion of input.criteria) {
    const covering = tests.filter((t) => t.criterion === criterion);
    if (covering.length === 0) {
      refusals.push(`criterion ${criterion} has no test`);
    } else if (!covering.some((t) => t.role !== null)) {
      refusals.push(`criterion ${criterion} has neither a valid red test nor a passing guard`);
    } else if (covering.every((t) => t.role === "guard")) {
      alreadySatisfied.push(criterion);
    }
  }
  // Gate 5: the lint.
  for (const file of input.files) refusals.push(...lintSuiteFile(file));

  return { ok: refusals.length === 0, refusals, tests, alreadySatisfied };
}

/** One test of an acceptance run at a verification point, as its `result.json` records it. */
export interface RecordedAcceptanceTest {
  title: string;
  outcome: TestOutcome;
  /** Null for a pass, or a flaky test whose classes differ. */
  failureClass: FailureClass | null;
  /** The first failed result's first error message, or null for a pass. */
  message: string | null;
}

/**
 * The suite's verdict at a verification point (docs/features/protected-acceptance-tests/plan.md,
 * Task 8): each test's outcome, and the block reason that replaces the
 * command's exit code. A failing test is named under `acceptance failed`; a
 * test whose repeats differ is named under `acceptance flaky`, which points at
 * the test rather than the code. A suite that does not load, or holds no test,
 * fails. A log that is not a complete report is refused by name.
 */
export function judgeAcceptanceRun(
  log: string,
  suiteFiles: AcceptanceFile[]
): { ok: true; tests: RecordedAcceptanceTest[]; blockReason: string | null } | { ok: false; reason: string } {
  const read = readAcceptanceReport(log);
  if (!read.ok) return read;
  const tests = classifyAcceptance(read.report, suiteFiles).map(({ title, outcome, failureClass, message }) => ({ title, outcome, failureClass, message }));
  const failed = tests.filter((t) => t.outcome === "fail").map((t) => t.title);
  const flaky = tests.filter((t) => t.outcome === "flaky").map((t) => t.title);
  let blockReason: string | null = null;
  if (read.report.loadErrors.length > 0) blockReason = `acceptance failed: the suite does not load: ${read.report.loadErrors[0]!.message.split("\n")[0]}`;
  else if (tests.length === 0) blockReason = "acceptance failed: the suite has no tests";
  else if (failed.length > 0) blockReason = `acceptance failed: ${failed.join(", ")}`;
  else if (flaky.length > 0) blockReason = `acceptance flaky: ${flaky.join(", ")}`;
  return { ok: true, tests, blockReason };
}

/**
 * One reproduction's run, read from its retained log
 * (docs/features/reproduced-review-findings/plan.md): `matcher_failure` when
 * the report loads with at least one test and every result failed on a
 * matcher, `passed` when every result passed, and `other` for anything else.
 * `detail` says why it did not pass: a locator timeout's call-log entry, the
 * locator a matcher found no element for, or the first line of the first
 * error, of the load error, or of the refusal to read the report. `file` is
 * the reproduction at its `/bw-checks/` path. A log whose JSON is shaped
 * unlike any report, which the model-written file can print itself, is
 * `other`, never a throw.
 */
export function judgeReproductionRun(
  log: string,
  file: AcceptanceFile
): { kind: "matcher_failure" | "passed" | "other"; detail: string | null } {
  let read: ReturnType<typeof readReproductionReport>;
  try {
    read = readReproductionReport(log);
  } catch (err) {
    return { kind: "other", detail: `the report cannot be read: ${(err as Error).message}` };
  }
  if (!read.ok) return { kind: "other", detail: read.reason };
  const firstLine = (text: string) => text.split("\n")[0]!;
  const { report } = read;
  if (report.loadErrors.length > 0) {
    return { kind: "other", detail: `the reproduction does not load: ${firstLine(report.loadErrors[0]!.message)}` };
  }
  if (report.tests.length === 0) return { kind: "other", detail: "the reproduction has no tests" };
  const results = report.tests.flatMap((test) => test.results);
  const failed = results.filter((result) => result.status !== "passed");
  if (failed.length === 0) return { kind: "passed", detail: null };
  const error = failed[0]!.errors[0];
  let detail = error === undefined
    ? `a test ended ${failed[0]!.status} with no error`
    : LOCATOR_TIMEOUT.test(error.message)
      ? locatorWaitDetail(error.message) ?? firstLine(error.message)
      : MATCHER_NOT_FOUND.test(error.message)
        ? `element(s) not found: ${/\nLocator: (.*)/.exec(error.message)?.[1] ?? "the locator"}`
        : firstLine(error.message);
  if (failed.length === results.length && failed.every((result) => isMatcherFailure(result, [file]))) {
    return { kind: "matcher_failure", detail };
  }
  if (report.tests.some((test) => new Set(test.results.map((result) => result.status)).size > 1)) {
    detail = `a test's repeats differ: ${detail}`;
  }
  return { kind: "other", detail };
}

/**
 * The suite's tests a blocked reply disputes (Task 9): each test title that one
 * of its `incompleteTasks` entries contains whole, in suite order. The patch
 * prompts ask for the exact title, and only a whole title counts, so an entry
 * that merely names a criterion ID, as "could not implement AC-005" does, is
 * not a dispute.
 */
export function disputedTests(incompleteTasks: string[], titles: string[]): string[] {
  return [...new Set(titles)].filter((title) => incompleteTasks.some((entry) => entry.includes(title)));
}

/** Every file under the suite directory `dir` of `worktreePath`, repository-relative. */
export function readSuiteFiles(worktreePath: string, dir: string): AcceptanceFile[] {
  return (readdirSync(join(worktreePath, dir), { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((entry) => entry.isFile())
    .map((entry) => relative(worktreePath, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort()
    .map((path) => ({ path, content: readFileSync(join(worktreePath, path), "utf8") }));
}

/**
 * Apply the suite's verdict to a verification point's result, where the
 * acceptance command ran last (Task 8). When the command's own outcome was its
 * exit code, the classified outcome decides instead, and its tests are recorded
 * beside the commands. Any other reason the command blocked (a ceiling, an
 * output budget, a dirty worktree) stands as it was, as does an earlier
 * command's block or a sandbox failure.
 */
export function applyAcceptanceVerdict(
  rootDir: string,
  worktreePath: string,
  dir: string,
  result: CommitVerificationResult
): CommitVerificationResult {
  const record = result.record;
  if (record === null) return result;
  const ran = record.commands.find((c) => c.name === ACCEPTANCE_COMMAND_NAME);
  if (ran === undefined) return result;
  if (ran.blockedBecause !== null && ran.blockedBecause !== `the command exited with code ${ran.exitCode}`) return result;
  const decide = (because: string | null, tests: RecordedAcceptanceTest[] | null): CommitVerificationResult => {
    const commands = record.commands.map((c) => (c === ran ? { ...c, blockedBecause: because } : c));
    const withTests = tests === null ? {} : { acceptance: { tests } };
    if (because === null) return { record: { ...record, commands, ...withTests }, reason: result.reason };
    return { record: { ...record, outcome: "block", blockingCommand: ran.name, commands, ...withTests }, reason: because };
  };
  let verdict: ReturnType<typeof judgeAcceptanceRun>;
  try {
    verdict = judgeAcceptanceRun(readFileSync(join(rootDir, ran.evidenceRef), "utf8"), readSuiteFiles(worktreePath, dir));
  } catch (err) {
    return decide(`the acceptance report cannot be read: ${(err as Error).message}`, null);
  }
  if (!verdict.ok) return decide(`the acceptance report cannot be read: ${verdict.reason} (${ran.evidenceRef})`, null);
  // A non-zero exit with every test passing still blocks, on the exit code.
  return decide(verdict.blockReason ?? ran.blockedBecause, verdict.tests);
}
