import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ACCEPTANCE_IMPORT_LINE,
  classifyAcceptance,
  classifyFailure,
  readAcceptanceReport,
  validateAcceptanceSuite,
  type AcceptanceFile,
  type AcceptanceReport,
} from "../src/acceptance.ts";
import { requireImage, sandboxImageTag } from "../src/container.ts";
import { STAND_IN, STAND_IN_IMAGE_ID, standInSandbox } from "./fixtures/docker/stand-in.ts";

/**
 * The acceptance runner's report parser and failure classifier
 * (docs/features/protected-acceptance-tests/plan.md, Task 2), over reports the
 * real runner wrote: `test/fixtures/recorded/acceptance-report-<case>.json`,
 * each captured through `createSandbox`, `runInSandbox` and `acceptanceCommand`
 * against the real image. The expected class of each case is the plan's gate 3
 * rule applied to what the case is, never a value read off the classifier.
 */

interface RecordedReport {
  provenance: { case: string };
  files: AcceptanceFile[];
  log: string;
}

const CASES = [
  "pass",
  "valid-red-matcher",
  "valid-red-locator",
  "valid-red-custom-message",
  "navigation",
  "launch",
  "hook-throw",
  "hook-locator-before",
  "hook-locator-after",
  "test-code",
  "test-code-expect-text",
  "matcher-argument",
  "matcher-argument-custom-message",
  "test-timeout",
  "flaky",
  "load-error",
] as const;

function recorded(name: (typeof CASES)[number]): RecordedReport {
  return JSON.parse(readFileSync(resolve("test", "fixtures", "recorded", `acceptance-report-${name}.json`), "utf8")) as RecordedReport;
}

function parsed(name: (typeof CASES)[number]): { report: AcceptanceReport; files: AcceptanceFile[] } {
  const fixture = recorded(name);
  const read = readAcceptanceReport(fixture.log);
  assert.ok(read.ok, `${name}: ${read.ok ? "" : read.reason}`);
  return { report: read.report, files: fixture.files };
}

test("every recorded report parses, with both repeats of each test grouped under one title", () => {
  for (const name of CASES) {
    const { report } = parsed(name);
    if (name === "load-error") continue;
    assert.equal(report.loadErrors.length, 0, name);
    assert.equal(report.tests.length, 1, name);
    assert.equal(report.tests[0]!.results.length, 2, name);
    assert.match(report.tests[0]!.title, /^AC-\d{3} /, name);
    assert.match(report.tests[0]!.file, /^acceptance\/[^/]+\/[^/]+\.spec\.mjs$/, name);
  }
});

test("each failing case gets its own class, and only the three valid-red reports classify as valid_red", () => {
  const expected = {
    "valid-red-matcher": "valid_red",
    "valid-red-locator": "valid_red",
    "valid-red-custom-message": "valid_red",
    navigation: "navigation",
    launch: "launch",
    "hook-throw": "hook",
    "hook-locator-before": "hook",
    "hook-locator-after": "hook",
    "test-code": "test_code",
    "test-code-expect-text": "test_code",
    // A matcher that refuses its own argument (Task 14): no page can satisfy it.
    "matcher-argument": "test_code",
    "matcher-argument-custom-message": "test_code",
    "test-timeout": "test_timeout",
  } as const;
  for (const [name, failureClass] of Object.entries(expected)) {
    const { report, files } = parsed(name as keyof typeof expected);
    for (const result of report.tests[0]!.results) {
      assert.equal(classifyFailure(result, files), failureClass, `${name}: ${result.errors[0]?.message.split("\n")[0]}`);
    }
    const [classified] = classifyAcceptance(report, files);
    assert.equal(classified!.outcome, "fail", name);
    assert.equal(classified!.failureClass, failureClass, name);
  }
  const { report, files } = parsed("pass");
  assert.deepEqual(
    classifyAcceptance(report, files).map((t) => [t.outcome, t.failureClass, t.message]),
    [["pass", null, null]]
  );
});

test("a valid red keeps the runner's message, location and stack, with colour codes stripped", () => {
  const { report } = parsed("valid-red-matcher");
  const error = report.tests[0]!.results[0]!.errors[0]!;
  assert.match(error.message, /^Error: expect\(locator\)\.toHaveText\(expected\) failed/);
  assert.doesNotMatch(error.message, /\x1b\[/);
  assert.equal(error.location?.file, "acceptance/red-expect/red-expect.spec.mjs");
  assert.match(error.stack ?? "", /at \/work\/acceptance\/red-expect\/red-expect\.spec\.mjs:\d+:\d+/);
});

test("an assertion's custom message comes first, and the matcher's header follows it after a blank line", () => {
  const { report } = parsed("valid-red-custom-message");
  assert.match(report.tests[0]!.results[0]!.errors[0]!.message, /^Error: the output\n\nexpect\(locator\)\.toHaveText\(expected\) failed\n/);
  const thrown = parsed("test-code-expect-text").report.tests[0]!.results[0]!.errors[0]!.message;
  assert.match(thrown, /^Error: the output\n\nexpect\(the output\) to show 5\n/, "the thrown error has the same layout, with no matcher header");
});

test("a matcher's argument error opens with the same header as a mismatch, with or without a custom message", () => {
  for (const name of ["matcher-argument", "matcher-argument-custom-message"] as const) {
    const message = parsed(name).report.tests[0]!.results[0]!.errors[0]!.message;
    assert.match(message, /^Error: expect\(locator\)\.toHaveText\(expected\) failed\n\n/, name);
    assert.match(message, /\nError: expected value must be a string or regular expression\nExpected has value: undefined\n/, name);
  }
});

test("the flaky test is flaky, never pass", () => {
  const { report, files } = parsed("flaky");
  assert.deepEqual(report.tests[0]!.results.map((r) => r.status), ["passed", "failed"]);
  const [classified] = classifyAcceptance(report, files);
  assert.equal(classified!.outcome, "flaky");
});

test("the load-error report yields load errors and no tests", () => {
  const { report } = parsed("load-error");
  assert.ok(report.loadErrors.length > 0);
  assert.match(report.loadErrors[0]!.message, /^SyntaxError: /);
  assert.equal(report.tests.length, 0);
});

test("a truncated log is refused by name, never read as an empty suite", () => {
  const { log } = recorded("valid-red-matcher");
  const read = readAcceptanceReport(log.slice(0, Math.floor(log.length / 2)));
  assert.equal(read.ok, false);
  assert.match(read.ok ? "" : read.reason, /^the acceptance log is not a complete JSON report: /);
});

test("the image tag covers every file in the image directory, by path and bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "bw-image-tag-"));
  try {
    cpSync(resolve("container"), dir, { recursive: true });
    const before = sandboxImageTag(dir);
    assert.match(before, /^bw-sandbox:[0-9a-f]{12}$/);
    assert.equal(sandboxImageTag(dir), before, "an unchanged directory keeps its tag");
    assert.equal(sandboxImageTag(dir), sandboxImageTag(resolve("container")), "a copy has the committed directory's tag");

    const config = join(dir, "acceptance.config.mjs");
    const original = readFileSync(config);
    writeFileSync(config, Buffer.concat([original, Buffer.from("// changed\n")]));
    assert.notEqual(sandboxImageTag(dir), before, "a config-only change changes the tag");
    writeFileSync(config, original);
    assert.equal(sandboxImageTag(dir), before);

    renameSync(config, join(dir, "acceptance.config.renamed.mjs"));
    assert.notEqual(sandboxImageTag(dir), before, "a rename changes the tag");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a frozen run's image ID is honoured without reading the image tag", () => {
  const dir = mkdtempSync(join(tmpdir(), "bw-frozen-image-"));
  try {
    const log = join(dir, "argv.log");
    const recorder = join(dir, "record-docker.mjs");
    writeFileSync(
      recorder,
      [
        'import { appendFileSync } from "node:fs";',
        `appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
        `await import(${JSON.stringify(pathToFileURL(STAND_IN).href)});`,
        "",
      ].join("\n")
    );
    const frozen = standInSandbox({ dockerCommand: [process.execPath, recorder] });
    requireImage(frozen);
    const calls = readFileSync(log, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as string[]);
    assert.deepEqual(calls, [["image", "inspect", "--format", "{{.Id}}", STAND_IN_IMAGE_ID]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The validity gate (Task 3). Suites are composed from the recorded reports
 * unchanged, with each test keeping its recorded title, so the criteria a
 * case names are its recorded titles' IDs. The lint cases add one line to a
 * recorded file that passes the lint as captured.
 */

function suite(...names: (typeof CASES)[number][]): { report: AcceptanceReport; files: AcceptanceFile[] } {
  const parts = names.map(parsed);
  return {
    report: { loadErrors: parts.flatMap((p) => p.report.loadErrors), tests: parts.flatMap((p) => p.report.tests) },
    files: parts.flatMap((p) => p.files),
  };
}

test("a suite covering every criterion with valid red tests passes the gate", () => {
  const result = validateAcceptanceSuite({ ...suite("valid-red-matcher", "valid-red-locator"), criteria: ["AC-004", "AC-005"] });
  assert.deepEqual(result.refusals, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.tests.map((t) => [t.criterion, t.role]), [["AC-004", "red"], ["AC-005", "red"]]);
  assert.deepEqual(result.alreadySatisfied, []);
});

test("an uncovered criterion and a title with an unknown ID are each refused by name", () => {
  const uncovered = validateAcceptanceSuite({ ...suite("valid-red-matcher"), criteria: ["AC-004", "AC-099"] });
  assert.equal(uncovered.ok, false);
  assert.deepEqual(uncovered.refusals, ["criterion AC-099 has no test"]);

  const unknown = validateAcceptanceSuite({ ...suite("valid-red-matcher", "valid-red-locator"), criteria: ["AC-004"] });
  assert.deepEqual(unknown.refusals, ['test "AC-005 pressing 7 works" does not begin with a criterion ID the specification defines']);
});

test("a criterion whose only failing test is broken is refused, for each broken class", () => {
  const cases = [
    ["navigation", "AC-006", "navigation"],
    ["launch", "AC-001", "launch"],
    ["hook-throw", "AC-007", "hook"],
    ["hook-locator-after", "AC-013", "hook"],
    ["test-code", "AC-008", "test_code"],
    ["matcher-argument", "AC-021", "test_code"],
    ["matcher-argument-custom-message", "AC-022", "test_code"],
    ["test-timeout", "AC-009", "test_timeout"],
  ] as const;
  for (const [name, criterion, failureClass] of cases) {
    const result = validateAcceptanceSuite({ ...suite(name), criteria: [criterion] });
    assert.equal(result.ok, false, name);
    assert.ok(result.refusals.some((r) => r.startsWith(`test "${criterion} `) && r.includes(`is broken (${failureClass})`)), `${name}: ${result.refusals.join(" | ")}`);
    assert.ok(result.refusals.includes(`criterion ${criterion} has neither a valid red test nor a passing guard`), name);
  }
});

test("a flaky test and a load error are each refused", () => {
  const flaky = validateAcceptanceSuite({ ...suite("flaky"), criteria: ["AC-010"] });
  assert.ok(flaky.refusals.some((r) => r.startsWith('test "AC-010 the heading alternates" is flaky')), flaky.refusals.join(" | "));
  assert.equal(flaky.ok, false);

  const load = validateAcceptanceSuite({ ...suite("load-error"), criteria: ["AC-011"] });
  assert.ok(load.refusals.some((r) => r.startsWith("the suite does not load: SyntaxError: ")), load.refusals.join(" | "));
  assert.ok(load.refusals.includes("the suite has no tests"));
  assert.ok(load.refusals.includes("criterion AC-011 has no test"));
});

test("a criterion covered only by passing tests is accepted as already_satisfied, its tests regression guards", () => {
  const result = validateAcceptanceSuite({ ...suite("pass"), criteria: ["AC-001"] });
  assert.deepEqual(result.refusals, []);
  assert.deepEqual(result.alreadySatisfied, ["AC-001"]);
  assert.deepEqual(result.tests.map((t) => t.role), ["guard"]);
});

test("a guard beside a valid red test for the same criterion passes, and the criterion is not already_satisfied", () => {
  const composed = suite("pass", "valid-red-matcher");
  composed.report.tests[1] = { ...composed.report.tests[1]!, title: "AC-001 the output shows 5" };
  const result = validateAcceptanceSuite({ ...composed, criteria: ["AC-001"] });
  assert.deepEqual(result.refusals, []);
  assert.deepEqual(result.tests.map((t) => t.role), ["guard", "red"]);
  assert.deepEqual(result.alreadySatisfied, []);
});

/** The recorded valid-red file with `line` inserted before the test's closing line, and the gate's lint refusals for it. */
function lintWith(line: string, ...replace: [string, string][]): string[] {
  const { report, files } = suite("valid-red-matcher");
  let content = files[0]!.content.replace(/\n\}\);\n$/, `\n${line}\n});\n`);
  for (const [from, to] of replace) content = content.replace(from, to);
  return validateAcceptanceSuite({ report, files: [{ ...files[0]!, content }], criteria: ["AC-004"] }).refusals;
}

test("the recorded valid-red file passes the lint as captured", () => {
  assert.deepEqual(lintWith(""), []);
});

test("each forbidden call is refused, naming its file, line and rule", () => {
  const cases: [string, RegExp][] = [
    ['  await page.locator("#go").dispatchEvent("click");', /:6: dispatchEvent\( sends untrusted input$/],
    ['  await page.evaluate("document.activeElement.dispatchEvent(new KeyboardEvent(\'keydown\'))");', /:6: dispatchEvent\( sends untrusted input$/],
    ["  await page.evaluate(() => document.body.dispatchEvent(new MouseEvent(\"click\")));", /:6: an event constructor sends untrusted input$/],
    ["  await page.waitForTimeout(500);", /:6: waitForTimeout\( is a fixed wait$/],
    ["  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));", /:6: setTimeout\( is a delay or a hard-coded timeout$/],
    ["  await page.evaluate(() => setInterval(() => {}, 100));", /:6: setInterval\( is a delay$/],
    ["  test.setTimeout(60_000);", /:6: setTimeout\( is a delay or a hard-coded timeout$/],
    ["  test.slow();", /:6: test\.slow\( changes the timeout$/],
    ["  page.setDefaultTimeout(1_000);", /:6: a default-timeout call is a hard-coded timeout$/],
    ['  await expect(page.locator("#out")).toHaveText("5", { timeout: 10_000 });', /:6: a timeout: option is a hard-coded timeout$/],
    ['  await page.waitForLoadState("networkidle");', /:6: networkidle waits on the network, not the page$/],
    ['  await page.goto("index.html", { waitUntil: "NetworkIdle" });', /:6: networkidle waits on the network, not the page$/],
    ["  test.beforeEach(async ({ page }) => { await page.goto(\"index.html\"); });", /:6: a hook; each test opens its own page$/],
    ["  test.afterAll(async () => {});", /:6: a hook; each test opens its own page$/],
  ];
  for (const [line, refusal] of cases) {
    const refusals = lintWith(line);
    assert.ok(refusals.some((r) => r.startsWith("acceptance/red-expect/red-expect.spec.mjs:") && refusal.test(r)), `${line}\n${refusals.join("\n")}`);
  }
  const only = lintWith("", ['test("AC-004', 'test.only("AC-004']);
  assert.ok(only.some((r) => /:3: \.only\( focuses the suite$/.test(r)), only.join("\n"));
});

test("a forbidden word in a comment or a test title is not refused", () => {
  assert.deepEqual(lintWith("  // waitForTimeout(500) and dispatchEvent( are never used here; beforeEach( either"), []);
  assert.deepEqual(lintWith("", ['"AC-004 the output shows 5"', '"AC-004 the output shows 5 before a timeout: and a hook beforeEach("']), []);
});

test("a missing await, expect(await …), a non-retrying matcher and expect members are each refused", () => {
  const cases: [string, RegExp][] = [
    ['  expect(page.locator("#out")).toHaveText("5");', /:6: an expect\( that is not awaited$/],
    ['  page.getByRole("button", { name: "Go" }).click();', /:6: a call of click\( that is not awaited$/],
    ['  page.keyboard.press("Enter");', /:6: a call of press\( that is not awaited$/],
    ['  const text = page.locator("#out").textContent();', /:6: a promise assigned to text is never awaited$/],
    ['  void page.locator("#out").click();', /:6: a call of click\( that is not awaited$/],
    ['  ["1", "2"].forEach(async (key) => { await page.keyboard.press(key); });', /:6: forEach\( does not wait for the promises its callback returns$/],
    ['  await page.keyboard.press("1", { delay: 50 });', /:6: a delay: option is a hard-coded delay$/],
    ['  await page.evaluate(() => document.body.dispatchEvent(new Event("click")));', /:6: an event constructor sends untrusted input$/],
    ['  await expect(await page.locator("#out").textContent()).toBe("5");', /:6: expect\(await …\) asserts once on a value instead of retrying on the page$/],
    ['  await expect(page.locator("#out")).toBe("5");', /:6: toBe is not one of Playwright's auto-retrying matchers$/],
    ['  await expect.soft(page.locator("#out")).toHaveText("5");', /:6: expect\.soft is not a retrying assertion on the page$/],
    ["  await expect.poll(async () => 1).toBe(1);", /:6: expect\.poll is not a retrying assertion on the page$/],
  ];
  for (const [line, refusal] of cases) {
    const refusals = lintWith(line);
    assert.ok(refusals.some((r) => refusal.test(r)), `${line}\n${refusals.join("\n")}`);
  }
  assert.deepEqual(lintWith('  await expect(page.locator("#out")).not.toHaveText("6");'), []);
  assert.deepEqual(lintWith('  for (const key of ["9", "*"]) await page.keyboard.press(key);'), []);
  assert.deepEqual(lintWith('  const light = await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor);'), []);
});

test("a missing or different import line, and a test with no retrying assertion, are refused", () => {
  const importLine = /:1: the first statement must be exactly /;
  assert.ok(lintWith("", [ACCEPTANCE_IMPORT_LINE, 'import { test, expect } from "@playwright/test";']).some((r) => importLine.test(r)));
  assert.ok(lintWith("", [ACCEPTANCE_IMPORT_LINE, "const {test, expect} = await import(process.env.BW_PLAYWRIGHT_TEST);"]).some((r) => importLine.test(r)));

  const local = lintWith("", ['await expect(page.locator("#out")).toHaveText("5");', 'const out = page.locator("#out");\n  await expect(out).toHaveText("5");']);
  assert.deepEqual(local, [], "a name assigned from page counts");
  const none = lintWith("", ['await expect(page.locator("#out")).toHaveText("5");', 'await page.locator("#out").click();']);
  assert.ok(none.some((r) => /:3: a test with no retrying assertion$/.test(r)), none.join("\n"));
});

/**
 * Shapes the first lint refused in every Task 4 sample although each settles
 * its promise or runs in the page (plan, Task 4 evaluation record): written
 * here in the form those suites used them, each must pass the lint.
 */
test("helpers that return promises or build locators, page-context DOM calls and assertions in helpers pass the lint", () => {
  const helpers = [
    "const display = (p) => p.locator(\"#out\");",
    "const press = (p, key) => p.keyboard.press(key);",
    "function focusOut(p) { return p.locator(\"#out\").evaluate((el) => el.blur()); }",
    "async function expectOut(p, text) { await expect(display(p)).toHaveText(text); }",
    "",
  ].join("\n");
  const withHelpers = (body: string) =>
    lintWith("", [ACCEPTANCE_IMPORT_LINE, `${ACCEPTANCE_IMPORT_LINE}\n${helpers}`], ['await expect(page.locator("#out")).toHaveText("5");', body]);
  assert.deepEqual(withHelpers('await press(page, "5");\n  await expect(display(page)).toHaveText("5");'), []);
  assert.deepEqual(withHelpers("await focusOut(page);\n  await expectOut(page, \"5\");"), [], "an assertion inside a helper counts");
  assert.deepEqual(withHelpers("await page.evaluate(() => { document.activeElement.blur(); document.body.focus(); });\n  await expectOut(page, \"5\");"), []);
  assert.deepEqual(withHelpers('await Promise.all(["1", "2"].map((key) => press(page, key)));\n  await expectOut(page, "5");'), []);
  assert.deepEqual(withHelpers('const typed = press(page, "5");\n  await typed;\n  await expectOut(page, "5");'), [], "a promise awaited after assignment is settled");
  assert.ok(withHelpers('press(page, "5");\n  await expectOut(page, "5");').some((r) => /a call of press\( that is not awaited$/.test(r)));
});

/** The lint's refusals alone for `files`: the gate over an empty report, less the gates that read it. */
function lintOnly(files: AcceptanceFile[]): string[] {
  return validateAcceptanceSuite({ report: { loadErrors: [], tests: [] }, files, criteria: [] }).refusals.filter((r) =>
    files.some((f) => r.startsWith(`${f.path}:`))
  );
}

/** The code review's counterexample suite (review Findings 2 and 4), as its probe recorded it. */
const REVIEW_PROBE = (
  JSON.parse(readFileSync(resolve("test", "fixtures", "recorded", "acceptance-code-review-probes.json"), "utf8")) as {
    browser: { files: AcceptanceFile[] }[];
  }
).browser[0]!.files;

/**
 * Every distinct suite file the test author wrote in the Task 4 evaluations
 * (`test-author-evaluation-*.json`): idiomatic model code written without
 * reference to this lint, which must stay at zero refusals as the lint changes.
 */
function recordedAuthorFiles(): AcceptanceFile[] {
  const dir = resolve("test", "fixtures", "recorded");
  const byContent = new Map<string, AcceptanceFile>();
  for (const name of readdirSync(dir).filter((n) => n.startsWith("test-author-evaluation-"))) {
    const record = JSON.parse(readFileSync(join(dir, name), "utf8")) as { samples: { suite?: AcceptanceFile[] }[] };
    for (const sample of record.samples) for (const file of sample.suite ?? []) byContent.set(file.content, file);
  }
  return [...byContent.values()];
}

test("every suite file the recorded test authors wrote passes the lint", () => {
  const files = recordedAuthorFiles();
  assert.equal(files.length, 53, "the distinct files in the five evaluation records");
  for (const file of files) assert.deepEqual(lintOnly([file]), [], file.path);
});

test("an assertion only in a function the test declares and never calls or passes on is refused (review Finding 2)", () => {
  const refusals = lintOnly(REVIEW_PROBE);
  assert.ok(refusals.some((r) => /review\.spec\.mjs:6: a test with no retrying assertion$/.test(r)), refusals.join("\n"));
  // The same helper, once the test calls it, counts.
  const called = REVIEW_PROBE.map((f) => ({ ...f, content: f.content.replace("click();\n});", "click();\n  await assertResult();\n});") }));
  assert.notEqual(called[0]!.content, REVIEW_PROBE[0]!.content);
  assert.ok(!lintOnly(called).some((r) => /:6: /.test(r)), lintOnly(called).join("\n"));
});

test("an assertion in a nested helper the test calls, or in a callback it passes to a call, counts", () => {
  const callback = [
    "async function keyboardCriterion(page, check) {",
    '  await page.keyboard.press("Enter");',
    "  await check();",
    "}",
    "",
  ].join("\n");
  const body = (text: string) => lintWith("", [ACCEPTANCE_IMPORT_LINE, `${ACCEPTANCE_IMPORT_LINE}\n${callback}`], ['await expect(page.locator("#out")).toHaveText("5");', text]);
  assert.deepEqual(body('const check = async () => { await expect(page.locator("#out")).toHaveText("5"); };\n  await check();'), []);
  assert.deepEqual(body('await keyboardCriterion(page, async () => { await expect(page.locator("#out")).toHaveText("5"); });'), []);
  assert.deepEqual(body('await test.step("the output", async () => { await expect(page.locator("#out")).toHaveText("5"); });'), []);
  assert.deepEqual(body('await (async () => { await expect(page.locator("#out")).toHaveText("5"); })();'), []);
  assert.ok(body('const check = async () => { await expect(page.locator("#out")).toHaveText("5"); };').some((r) => /:\d+: a test with no retrying assertion$/.test(r)));
  assert.ok(body('function check() { return expect(page.locator("#out")).toHaveText("5"); }').some((r) => /:\d+: a test with no retrying assertion$/.test(r)));
});

test("an awaited array of promises settles nothing, and only Promise.all over it does (review Finding 4)", () => {
  const unjoined = /: an array of promises (assigned to \w+ |that )is never passed to Promise\.all; awaiting the array settles none of them$/;
  const refusals = lintOnly(REVIEW_PROBE);
  assert.ok(
    refusals.includes("acceptance/review-probes/review.spec.mjs:13: an array of promises assigned to operations is never passed to Promise.all; awaiting the array settles none of them"),
    refusals.join("\n")
  );
  const joined = REVIEW_PROBE.map((f) => ({ ...f, content: f.content.replace("await operations;", "await Promise.all(operations);") }));
  assert.notEqual(joined[0]!.content, REVIEW_PROBE[0]!.content);
  assert.ok(!lintOnly(joined).some((r) => unjoined.test(r)), lintOnly(joined).join("\n"));

  const press = 'async (key) => { await page.keyboard.press(key); }';
  const line = (text: string) => lintWith(text);
  assert.deepEqual(line(`  await Promise.all(["1", "2"].map(${press}));`), []);
  assert.deepEqual(line(`  await Promise.allSettled([page.keyboard.press("1"), page.keyboard.press("2")]);`), []);
  assert.ok(line(`  await ["1", "2"].map(${press});`).some((r) => /:6: an array of promises that is never passed/.test(r)));
  assert.ok(line(`  ["1", "2"].map(${press});`).some((r) => /:6: an array of promises that is never passed/.test(r)));
  assert.ok(line(`  await [page.keyboard.press("1"), page.keyboard.press("2")];`).some((r) => /:6: an array of promises that is never passed/.test(r)));
  assert.ok(line(`  await Promise.race(["1", "2"].map(${press}));`).some((r) => /:6: an array of promises that is never passed/.test(r)));

  // An array returned from a named helper is held to the rule where the helper is called.
  const helper = 'const pressAll = (p, keys) => keys.map((key) => p.keyboard.press(key));';
  const withHelper = (text: string) =>
    lintWith("", [ACCEPTANCE_IMPORT_LINE, `${ACCEPTANCE_IMPORT_LINE}\n${helper}`], ['await expect(page.locator("#out")).toHaveText("5");', `${text}\n  await expect(page.locator("#out")).toHaveText("5");`]);
  assert.deepEqual(withHelper('await Promise.all(pressAll(page, ["1", "2"]));'), []);
  assert.ok(withHelper('await pressAll(page, ["1", "2"]);').some((r) => unjoined.test(r)), withHelper('await pressAll(page, ["1", "2"]);').join("\n"));
});

// The re-review of Tasks 12 to 15 (2026-10-21): shapes the first fixes refused or let through.
const ASSERT_OUT = 'await expect(page.locator("#out")).toHaveText("5");';

test("a helper resolves to the declaration in scope where the test calls it, so two tests' same-named helpers stay apart", () => {
  const asserting = `const check = async () => { ${ASSERT_OUT} };\n  await check();`;
  const clicking = 'const check = async () => { await page.locator("#go").click(); };\n  await check();';
  const twoTests = (first: string, second: string) =>
    lintOnly([
      {
        path: "acceptance/x/two.spec.mjs",
        content: [
          ACCEPTANCE_IMPORT_LINE,
          'test("AC-001 one", async ({ page }) => {',
          '  await page.goto("index.html");',
          `  ${first}`,
          "});",
          'test("AC-002 two", async ({ page }) => {',
          '  await page.goto("index.html");',
          `  ${second}`,
          "});",
          "",
        ].join("\n"),
      },
    ]);
  assert.deepEqual(twoTests(asserting, `${clicking}\n  ${ASSERT_OUT}`), []);
  assert.deepEqual(twoTests(clicking, asserting), ["acceptance/x/two.spec.mjs:2: a test with no retrying assertion"]);
});

test("an assertion in an object literal's method counts when the test calls it, and not otherwise", () => {
  const body = (text: string) => lintWith("", ['await expect(page.locator("#out")).toHaveText("5");', text]);
  const arrow = `const calc = { expectOut: async () => { ${ASSERT_OUT} } };`;
  const method = `const calc = { async expectOut() { ${ASSERT_OUT} } };`;
  const shorthand = `const expectOut = async () => { ${ASSERT_OUT} };\n  const calc = { expectOut };`;
  for (const helper of [arrow, method, shorthand]) {
    assert.deepEqual(body(`${helper}\n  await calc.expectOut();`), [], helper);
    assert.ok(body(helper).some((r) => /:\d+: a test with no retrying assertion$/.test(r)), helper);
  }
});

test("a named promise-returning callback to map makes an array of promises, and a spread of one still reaches Promise.all", () => {
  const unjoined = /: an array of promises (assigned to \w+ |that )is never passed to Promise\.all; awaiting the array settles none of them$/;
  const press = "const press = async (key) => { await page.keyboard.press(key); };";
  const line = (text: string) => lintWith(`  ${press}\n  ${text}`);
  assert.ok(line('await ["1", "2"].map(press);').some((r) => unjoined.test(r)));
  assert.ok(line('const ops = ["1", "2"].map(press);\n  await ops;').some((r) => unjoined.test(r)));
  assert.deepEqual(line('await Promise.all(["1", "2"].map(press));'), []);
  assert.deepEqual(line('await Promise.all([...["1", "2"].map(press)]);'), []);
  assert.deepEqual(line('const ops = ["1", "2"].map(press);\n  await Promise.all([...ops, page.keyboard.press("3")]);'), []);
  assert.ok(line('const ops = ["1", "2"].map(press);\n  const all = [...ops];\n  await all;').some((r) => unjoined.test(r)));
  // A named callback that returns no promise makes no array of promises.
  assert.deepEqual(lintWith('  const label = (key) => key;\n  ["1", "2"].map(label);'), []);
});
