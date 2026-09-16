import { spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync,
  type Dirent,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { Writable } from "node:stream";
import { parseGovernedConfig } from "./governed-config.ts";
import { GOVERNANCE_DIR, GOVERNANCE_PREFIX } from "./paths.ts";
import { inspectBootstrapPrerequisites } from "./readiness.ts";
import { resolveProjectTarget } from "./repo-root.ts";
import { validateRunIdentity } from "./store.ts";

export type GuidedPrompt = (message: string) => Promise<string>;

export interface ProjectBootstrapOptions {
  prompt: GuidedPrompt;
  stdout: Writable;
  invocationDirectory?: string;
}

export interface PreparedProject {
  rootDir: string;
  slug: string;
  waitingForDesign: boolean;
  scaffold: boolean;
}

const BASELINE_MESSAGE = "Initialize BuildWorks static-web project";
const DESIGN_MESSAGE_PREFIX = "Add BuildWorks design for ";
const WINDOWS = process.platform === "win32";

function git(rootDir: string, ...args: string[]) {
  return spawnSync("git", ["--no-optional-locks", ...args], {
    cwd: rootDir,
    encoding: "utf8",
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function checked(result: ReturnType<typeof spawnSync>, operation: string): string {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(`${operation}: ${stderr || `exited with code ${result.status}`}`);
  }
  return typeof result.stdout === "string" ? result.stdout : "";
}

function normalizeProjectName(name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized === "" ? "buildworks-project" : normalized.slice(0, 214).replace(/-+$/, "");
}

function generatedFiles(projectName: string, featureSlug: string): ReadonlyMap<string, string> {
  const packageJson = {
    name: projectName,
    private: true,
    type: "module",
    scripts: { test: "node --test" },
  };
  const packageLock = {
    name: projectName,
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: projectName } },
  };
  return new Map([
    [".gitignore", `${GOVERNANCE_PREFIX}\nnode_modules/\n`],
    ["README.md", `# ${projectName}\n\nA dependency-light static web project initialized by BuildWorks.\n\n1. Run \`npm ci\`.\n2. Run \`npm test\`.\n3. Author \`docs/features/${featureSlug}/design.md\` and rerun \`buildworks\`.\n`],
    ["governed.yaml", 'verify:\n  - name: install\n    command: ["npm", "ci"]\n  - name: test\n    command: ["npm", "test"]\n'],
    ["index.html", '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>BuildWorks starter</title>\n</head>\n<body>\n  <main id="app"></main>\n  <script type="module" src="./src/app.js"></script>\n</body>\n</html>\n'],
    ["package.json", `${JSON.stringify(packageJson, null, 2)}\n`],
    ["package-lock.json", `${JSON.stringify(packageLock, null, 2)}\n`],
    ["src/app.js", 'export const message = "BuildWorks starter";\n\nconst root = globalThis.document?.querySelector("#app");\nif (root) root.textContent = message;\n'],
    ["test/starter.test.js", 'import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";\nimport { message } from "../src/app.js";\n\ntest("the generated page loads its module", async () => {\n  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");\n  assert.match(html, /<script type="module" src="\\.\\/src\\/app\\.js"><\\/script>/);\n  assert.equal(message, "BuildWorks starter");\n});\n'],
  ]);
}

function existingDirectory(path: string): string {
  let current = path;
  while (!existsSync(current)) current = dirname(current);
  return current;
}

function directoryEntries(rootDir: string): Dirent[] {
  return existsSync(rootDir) ? readdirSync(rootDir, { withFileTypes: true }) : [];
}

function gitWorktreeRoot(rootDir: string): string | null {
  if (!existsSync(rootDir)) return null;
  const inside = git(rootDir, "rev-parse", "--is-inside-work-tree");
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return null;
  const top = git(rootDir, "rev-parse", "--show-toplevel");
  if (top.status !== 0 || top.stdout.trim() === "") return null;
  return realpathSync(top.stdout.trim());
}

function isGitWorktree(rootDir: string): boolean {
  return gitWorktreeRoot(rootDir) === realpathSync(rootDir);
}

function hasHead(rootDir: string): boolean {
  return git(rootDir, "rev-parse", "--verify", "HEAD").status === 0;
}

function walkFiles(rootDir: string, current = rootDir): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (current === rootDir && [".git", GOVERNANCE_DIR, "node_modules"].includes(entry.name)) continue;
    const full = join(current, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(rootDir, full));
    else files.push(relative(rootDir, full).replaceAll("\\", "/"));
  }
  return files.sort();
}

function featureDirectories(rootDir: string): string[] {
  const directory = join(rootDir, "docs", "features");
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function promptValue(
  prompt: GuidedPrompt,
  message: string,
  validate: (value: string) => string | null,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const value = (await prompt(message)).trim();
    const reason = value === "" ? "a non-empty response is required" : validate(value);
    if (reason === null) return value;
  }
  throw new Error(`no valid response was provided for ${message.trim()}`);
}

async function confirm(prompt: GuidedPrompt, message: string): Promise<boolean> {
  return (await prompt(message)).trim().toLowerCase() === "yes";
}

function validateExistingGeneratedFiles(rootDir: string, expected: ReadonlyMap<string, string>): void {
  const actual = walkFiles(rootDir);
  const unexpected = actual.filter((path) => !expected.has(path));
  if (unexpected.length > 0) {
    throw new Error(`refusing unrelated path(s) in the partial starter: ${unexpected.join(", ")}`);
  }
  for (const [path, contents] of expected) {
    const full = join(rootDir, ...path.split("/"));
    if (existsSync(full) && readFileSync(full, "utf8") !== contents) {
      throw new Error(`refusing to overwrite mismatched starter file: ${path}`);
    }
  }
}

function writeMissingGeneratedFiles(rootDir: string, expected: ReadonlyMap<string, string>): void {
  for (const [path, contents] of expected) {
    const full = join(rootDir, ...path.split("/"));
    if (existsSync(full)) continue;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents, { encoding: "utf8", flag: "wx" });
  }
}

function statusPaths(rootDir: string): string[] {
  const output = checked(git(rootDir, "status", "--porcelain=v1", "-z", "--untracked-files=all"), "cannot inspect the working tree");
  const entries = output.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    paths.push(entry.slice(3).replaceAll("\\", "/").replace(/^"|"$/g, ""));
    if (entry.startsWith("R") || entry.startsWith("C")) index++;
  }
  return paths;
}

function requireOnlyPaths(rootDir: string, allowed: ReadonlySet<string>, context: string): void {
  const paths = statusPaths(rootDir);
  const unrelated = paths.filter((path) => !allowed.has(path));
  if (unrelated.length > 0) {
    throw new Error(`refusing ${context} while unrelated path(s) are present: ${unrelated.join(", ")}`);
  }
}

function strictUtf8(path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
  } catch (error) {
    throw new Error(`cannot read ${path} as UTF-8: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function committedFile(rootDir: string, path: string): string | null {
  const result = git(rootDir, "show", `HEAD:${path}`);
  return result.status === 0 ? result.stdout : null;
}

function requirePathMatchesHead(rootDir: string, path: string, subject = "selected design"): void {
  const result = git(rootDir, "-c", "diff.autoRefreshIndex=false", "diff", "--quiet", "HEAD", "--", path);
  if (result.status === 1) {
    throw new Error(subject === "generated starter"
      ? `the generated starter no longer matches its committed bytes: ${path}`
      : `the selected design differs from its committed bytes: ${path}`);
  }
  if (result.status !== 0) {
    throw new Error(`cannot compare the ${subject} with HEAD: ${result.stderr.trim()}`);
  }
}

function committedUtf8(rootDir: string, path: string): string | null {
  const result = spawnSync("git", ["--no-optional-locks", "show", `HEAD:${path}`], {
    cwd: rootDir,
    encoding: "buffer",
    shell: false,
  });
  if (result.status !== 0) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(result.stdout as Buffer);
  } catch {
    return null;
  }
}

function trackedPaths(rootDir: string): string[] {
  return checked(git(rootDir, "ls-tree", "-r", "--name-only", "HEAD"), "cannot enumerate committed files")
    .split(/\r?\n/).filter(Boolean).sort();
}

function scaffoldSlug(rootDir: string): string | null {
  const directories = featureDirectories(rootDir);
  let slug = directories.length === 1 ? directories[0]! : null;
  if (slug === null && directories.length === 0) {
    try {
      const readme = readFileSync(join(rootDir, "README.md"), "utf8");
      slug = /docs\/features\/([a-z0-9]+(?:-[a-z0-9]+)*)\/design\.md/.exec(readme)?.[1] ?? null;
    } catch {
      return null;
    }
  }
  if (slug === null || directories.length > 1 || validateRunIdentity({ slug }) !== null) return null;
  const expected = generatedFiles(normalizeProjectName(basename(rootDir)), slug);
  const design = `docs/features/${slug}/design.md`;
  const tracked = trackedPaths(rootDir);
  const allowed = new Set([...expected.keys(), design]);
  if (tracked.some((path) => !allowed.has(path)) || [...expected.keys()].some((path) => !tracked.includes(path))) {
    return null;
  }
  for (const [path, contents] of expected) {
    if (committedFile(rootDir, path) !== contents) return null;
    const full = join(rootDir, ...path.split("/"));
    if (!existsSync(full)) {
      throw new Error(`the generated starter no longer matches its committed bytes: ${path}`);
    }
    requirePathMatchesHead(rootDir, path, "generated starter");
  }
  return slug;
}

function committedDesigns(rootDir: string): string[] {
  const paths = trackedPaths(rootDir).filter((path) =>
    /^docs\/features\/[a-z0-9]+(?:-[a-z0-9]+)*\/design\.md$/.test(path));
  return paths.filter((path) => {
    const content = committedUtf8(rootDir, path);
    return content !== null && content.trim() !== "";
  }).map((path) => path.split("/")[2]!).sort();
}

async function chooseDisplayed(
  prompt: GuidedPrompt,
  label: string,
  values: readonly string[],
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const answer = (await prompt(`${label} (enter 1-${values.length}): `)).trim();
    if (/^\d+$/.test(answer)) {
      const index = Number(answer) - 1;
      if (index >= 0 && index < values.length) return values[index]!;
    }
  }
  throw new Error(`no listed ${label.toLowerCase()} was selected`);
}

async function commitDesign(
  rootDir: string,
  slug: string,
  prompt: GuidedPrompt,
  stdout: Writable,
): Promise<boolean> {
  const ref = `docs/features/${slug}/design.md`;
  const path = join(rootDir, ...ref.split("/"));
  const committed = committedFile(rootDir, ref);
  if (committed !== null) {
    const current = strictUtf8(path);
    if (current.trim() === "") throw new Error(`committed design is empty: ${ref}`);
    requirePathMatchesHead(rootDir, ref);
    return true;
  }
  if (!existsSync(path)) {
    stdout.write(`Design required at ${path}\nRepository path: ${ref}\n`);
    return false;
  }
  if (strictUtf8(path).trim() === "") throw new Error(`design must be nonempty UTF-8: ${ref}`);
  requireOnlyPaths(rootDir, new Set([ref]), "the design commit");
  checked(git(rootDir, "add", "--", ref), `cannot stage ${ref}`);
  const diff = checked(git(rootDir, "-c", "diff.autoRefreshIndex=false", "diff", "--cached", "--no-ext-diff", "--", ref),
    `cannot display the staged design diff for ${ref}`);
  stdout.write(`Design to commit: ${ref}\n${diff}`);
  if (!await confirm(prompt, `Commit only ${ref}? Type yes to confirm: `)) {
    throw new Error(`design commit declined; ${ref} remains staged for inspection`);
  }
  checked(git(rootDir, "commit", "-m", `${DESIGN_MESSAGE_PREFIX}${slug}`), `cannot commit ${ref}`);
  if (statusPaths(rootDir).length !== 0) throw new Error("the worktree is not clean after the design commit");
  return true;
}

function ensureIdentity(rootDir: string, prompt: GuidedPrompt): Promise<void> {
  const name = git(rootDir, "config", "--get", "user.name");
  const email = git(rootDir, "config", "--get", "user.email");
  if (name.status === 0 && name.stdout.trim() !== "" && email.status === 0 && email.stdout.trim() !== "") {
    return Promise.resolve();
  }
  return (async () => {
    const localName = await promptValue(prompt, "Git author name for this repository: ",
      (value) => /[\r\n]/.test(value) ? "Git author name cannot contain a line break" : null);
    const localEmail = await promptValue(prompt, "Git author email for this repository: ",
      (value) => /^[^\s@]+@[^\s@]+$/.test(value) ? null : "Git author email must contain one address");
    checked(git(rootDir, "config", "--local", "user.name", localName), "cannot set repository-local Git author name");
    checked(git(rootDir, "config", "--local", "user.email", localEmail), "cannot set repository-local Git author email");
  })();
}

async function bootstrap(
  rootDir: string,
  existed: boolean,
  options: ProjectBootstrapOptions,
): Promise<PreparedProject> {
  const probeCwd = existingDirectory(rootDir);
  const failed = inspectBootstrapPrerequisites(probeCwd).filter((check) => check.status !== "pass");
  if (failed.length > 0) {
    throw new Error(`project preflight failed: ${failed.map((check) => `${check.name}: ${check.evidence}`).join("; ")}`);
  }
  const type = await promptValue(options.prompt, "Project type (only static-web is supported; type static-web): ",
    (value) => value === "static-web" ? null : "project type must be static-web");
  if (type !== "static-web") throw new Error("project type must be static-web");
  const existingSlugs = existed ? featureDirectories(rootDir) : [];
  const slug = existingSlugs.length === 1
    ? existingSlugs[0]!
    : await promptValue(options.prompt, "Feature slug (lowercase kebab-case): ",
      (value) => validateRunIdentity({ slug: value }));
  if (existingSlugs.length > 1) {
    throw new Error(`refusing ambiguous partial starter feature directories: ${existingSlugs.join(", ")}`);
  }
  const expected = generatedFiles(normalizeProjectName(basename(rootDir)), slug);
  if (!existed) mkdirSync(rootDir, { recursive: true });
  if (!isGitWorktree(rootDir)) {
    const entries = directoryEntries(rootDir);
    if (entries.length > 0) {
      throw new Error(`refusing nonempty non-Git target: ${rootDir}`);
    }
    checked(git(rootDir, "init", "-q"), "cannot initialize Git");
  }
  await ensureIdentity(rootDir, options.prompt);
  validateExistingGeneratedFiles(rootDir, expected);
  writeMissingGeneratedFiles(rootDir, expected);
  mkdirSync(join(rootDir, "docs", "features", slug), { recursive: true });
  const config = parseGovernedConfig(expected.get("governed.yaml")!);
  if (!config.ok) throw new Error(config.reason);
  checked(spawnSync("npm", ["ci"], { cwd: rootDir, encoding: "utf8", shell: WINDOWS }),
    "generated npm ci failed");
  checked(spawnSync("npm", ["test"], { cwd: rootDir, encoding: "utf8", shell: WINDOWS }),
    "generated npm test failed");
  const owned = new Set(expected.keys());
  requireOnlyPaths(rootDir, owned, "the baseline commit");
  checked(git(rootDir, "add", "--", ...owned), "cannot stage the generated baseline");
  const diff = checked(git(rootDir, "-c", "diff.autoRefreshIndex=false", "diff", "--cached", "--no-ext-diff"),
    "cannot display the generated baseline diff");
  options.stdout.write(`Generated static-web baseline:\n${diff}`);
  if (!await confirm(options.prompt, `Commit the generated baseline in ${rootDir}? Type yes to confirm: `)) {
    throw new Error("baseline commit declined; generated files remain staged for inspection");
  }
  checked(git(rootDir, "commit", "-m", BASELINE_MESSAGE), "cannot commit the generated baseline");
  if (statusPaths(rootDir).length !== 0) throw new Error("the worktree is not clean after the baseline commit");
  const designPath = join(rootDir, "docs", "features", slug, "design.md");
  options.stdout.write(`Design required at ${designPath}\nRepository path: docs/features/${slug}/design.md\n`);
  return { rootDir, slug, waitingForDesign: true, scaffold: true };
}

export async function prepareGuidedProject(
  targetInput: string,
  options: ProjectBootstrapOptions,
): Promise<PreparedProject> {
  const target = resolveProjectTarget(targetInput, options.invocationDirectory ?? process.cwd());
  if (!target.exists) {
    const enclosing = gitWorktreeRoot(existingDirectory(target.path));
    if (enclosing !== null) {
      throw new Error(`refusing to create a nested project inside the existing Git worktree ${enclosing}`);
    }
    return bootstrap(target.path, false, options);
  }
  if (target.exists && !statSync(target.path).isDirectory()) {
    throw new Error(`target is not a directory: ${target.path}`);
  }
  const enclosing = gitWorktreeRoot(target.path);
  if (enclosing === null && directoryEntries(target.path).length === 0) {
    return bootstrap(target.path, target.exists, options);
  }
  if (enclosing === null) {
    throw new Error(`refusing nonempty non-Git target: ${target.path}`);
  }
  const rootDir = enclosing;
  if (!hasHead(rootDir)) {
    return bootstrap(rootDir, true, options);
  }
  const generatedSlug = scaffoldSlug(rootDir);
  if (generatedSlug !== null) {
    mkdirSync(join(rootDir, "docs", "features", generatedSlug), { recursive: true });
    const ready = await commitDesign(rootDir, generatedSlug, options.prompt, options.stdout);
    return { rootDir, slug: generatedSlug, waitingForDesign: !ready, scaffold: true };
  }
  const designs = committedDesigns(rootDir);
  if (designs.length === 0) {
    throw new Error("no committed nonempty docs/features/<slug>/design.md was found");
  }
  const slug = designs.length === 1 ? designs[0]! : await chooseDisplayed(
    options.prompt,
    `Select a feature:\n${designs.map((value, index) => `  ${index + 1}. ${value}`).join("\n")}\nSelection`,
    designs,
  );
  const designRef = `docs/features/${slug}/design.md`;
  const committed = committedUtf8(rootDir, designRef);
  const current = strictUtf8(join(rootDir, ...designRef.split("/")));
  if (committed === null || current.trim() === "") throw new Error(`committed design is empty: ${designRef}`);
  requirePathMatchesHead(rootDir, designRef);
  return { rootDir, slug, waitingForDesign: false, scaffold: false };
}
