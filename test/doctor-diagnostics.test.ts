import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import childProcess, { spawnSync } from "node:child_process";
import fs, {
  chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { delimiter, join, relative, resolve } from "node:path";
import { CLAUDE_CODE, type ExecutorDefinition } from "../src/executor.ts";
import { buildHarnessEnvironment, probeExecutor } from "../src/harness.ts";
import { sha256Hex } from "../src/canonical.ts";
import {
  collectAmbientProviderConfig, DOCTOR_CONFIG_MAX_BYTES, DOCTOR_OBSERVATION_NAMES,
  resolveDoctorExecutable, type AmbientProviderConfig, type DoctorExecutableLookup,
} from "../src/doctor-diagnostics.ts";

const WINDOWS = process.platform === "win32";
const NAME = "bw-doctor-native-fixture";
const NATIVE_NAME = NAME + (WINDOWS ? ".exe" : "");
const IDENTITY_ARGS = ["-e", "process.stdout.write(JSON.stringify({ executable: process.execPath, cwd: process.cwd(), argv: process.argv.slice(1) })); process.stderr.write('native diagnostic');", "--", "argument with spaces"];

function fixture(t: TestContext) {
  const root = mkdtempSync(resolve(".doctor-diagnostics-"));
  const cwd = join(root, "invocation");
  const first = join(root, "first path");
  const second = join(root, "second path");
  const target = join(root, "selected target");
  for (const directory of [cwd, first, second, target]) mkdirSync(directory);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function copy(directory: string, name = NATIVE_NAME): string {
    const path = join(directory, name);
    copyFileSync(process.execPath, path);
    if (!WINDOWS) chmodSync(path, 0o755);
    return path;
  }
  return { root, cwd, first, second, target, copy };
}

function withParentLookup(path: string | undefined, control: string | undefined, body: () => void): void {
  const oldPath = process.env.PATH;
  const oldControl = process.env.NoDefaultCurrentDirectoryInExePath;
  try {
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
    if (control === undefined) delete process.env.NoDefaultCurrentDirectoryInExePath;
    else process.env.NoDefaultCurrentDirectoryInExePath = control;
    body();
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldControl === undefined) delete process.env.NoDefaultCurrentDirectoryInExePath;
    else process.env.NoDefaultCurrentDirectoryInExePath = oldControl;
  }
}

function lookup(cwd: string, path?: string): DoctorExecutableLookup {
  return {
    cwd, env: path === undefined ? {} : { PATH: path },
    parentPath: process.env.PATH,
    noDefaultCurrentDirectoryInExePath: process.env.NoDefaultCurrentDirectoryInExePath !== undefined,
  };
}

function identity(path: string): string {
  const real = realpathSync.native(path);
  return WINDOWS ? real.toLowerCase() : real;
}

function nativeParity(command: string, context: DoctorExecutableLookup, expected: string): void {
  // The bare native spawn is independent of our resolver and never intercepted.
  // Sources: libuv v1.52.1 src/win/process.c search_path/path_search_walk_ext;
  // Node v24.0.0 doc/api/child_process.md, command lookup and env options.
  const native = spawnSync(command, IDENTITY_ARGS, {
    cwd: context.cwd, env: context.env, shell: false, encoding: "utf8", timeout: 5000,
  });
  assert.equal(native.error, undefined, native.error?.message);
  assert.equal(native.status, 0, native.stderr);
  const nativeIdentity = JSON.parse(native.stdout) as { executable: string };
  const selected = resolveDoctorExecutable(command, context);
  assert.equal(identity(selected), identity(nativeIdentity.executable), "resolver must agree with independent bare native spawn");
  assert.equal(identity(selected), identity(expected));
  const executor: ExecutorDefinition = { ...CLAUDE_CODE, probe: [command, ...IDENTITY_ARGS] };
  const probed = probeExecutor(executor, {
    executablePath: selected, cwd: context.cwd, env: { ...context.env }, timeoutMs: 5000,
  });
  const probeIdentity = JSON.parse(probed.stdout) as { executable: string; cwd: string; argv: string[] };
  assert.equal(identity(probeIdentity.executable), identity(nativeIdentity.executable));
  assert.deepEqual({ cwd: probeIdentity.cwd, argv: probeIdentity.argv }, {
    cwd: context.cwd, argv: ["argument with spaces"],
  });
  assert.equal(probed.stderr, native.stderr);
}

function nativeMissing(command: string, context: DoctorExecutableLookup, expectedCode: string): void {
  const native = spawnSync(command, IDENTITY_ARGS, {
    cwd: context.cwd, env: context.env, shell: false, encoding: "utf8", timeout: 5000,
  });
  const nativeCode = (native.error as NodeJS.ErrnoException | undefined)?.code;
  assert.equal(nativeCode, expectedCode);
  assert.throws(() => resolveDoctorExecutable(command, context), (error: unknown) => {
    assert.equal((error as NodeJS.ErrnoException).code, nativeCode);
    assert.match((error as Error).message, /executable resolution/);
    return true;
  });
}

test("native differential: PATH precedence agrees even when absolute probe follows selection", (t) => {
  const f = fixture(t);
  const first = f.copy(f.first);
  const second = f.copy(f.second);
  f.copy(f.target);
  withParentLookup(f.second, undefined, () => {
    nativeParity(NAME, lookup(f.cwd, [f.first, f.second].join(delimiter)), first);
    nativeParity(NAME, lookup(f.cwd, [f.second, f.first].join(delimiter)), second);
    nativeParity(NAME, lookup(f.cwd, [join(f.root, "missing"), f.second].join(delimiter)), second);
  });
});

test("native differential Windows: dot-suffixed PATH uses native normalization without rewriting selection", { skip: !WINDOWS }, (t) => {
  const f = fixture(t);
  f.copy(f.first);
  f.copy(f.second);
  withParentLookup("", "1", () => {
    const alias = f.first + ".";
    for (const path of [alias, [alias, f.second].join(delimiter)]) {
      const context = lookup(f.cwd, path);
      const native = spawnSync(NAME, IDENTITY_ARGS, {
        cwd: context.cwd, env: context.env, shell: false, encoding: "utf8", timeout: 5000,
      });
      assert.equal(native.error, undefined);
      assert.equal(native.status, 0, native.stderr);
      const nativePath = (JSON.parse(native.stdout) as { executable: string }).executable;
      assert.equal(nativePath.toLowerCase(), join(alias, NATIVE_NAME).toLowerCase());
      let selected: string | undefined;
      assert.doesNotThrow(() => { selected = resolveDoctorExecutable(NAME, context); },
        "native-valid first candidate must resolve");
      assert.ok(selected);
      assert.equal(selected.toLowerCase(), nativePath.toLowerCase(), "native-valid first candidate must not be skipped");
      const probed = probeExecutor({ ...CLAUDE_CODE, probe: [NAME, ...IDENTITY_ARGS] }, {
        executablePath: selected, cwd: context.cwd, env: { ...context.env }, timeoutMs: 5000,
      });
      assert.equal((JSON.parse(probed.stdout) as { executable: string }).executable, nativePath);
    }
    // Win32 removes a single component-ending dot, not arbitrary whitespace
    // or dot runs; an explicit extended namespace disables normalization.
    for (const suffix of ["..", " ", ". "]) nativeMissing(NAME, lookup(f.cwd, f.first + suffix), "ENOENT");
    nativeMissing(NAME, lookup(f.cwd, `\\\\?\\${alias}`), "ENOENT");
    nativeParity(NAME, lookup(f.cwd, `\\\\?\\${f.first}`), join(f.first, NATIVE_NAME));
  });
});

test("native differential: relative PATH and path-bearing commands use invocation cwd, not target", (t) => {
  const f = fixture(t);
  const expected = f.copy(f.first);
  f.copy(f.target);
  withParentLookup(f.target, undefined, () => {
    nativeParity(NAME, lookup(f.cwd, relative(f.cwd, f.first)), expected);
    nativeParity(join(relative(f.cwd, f.first), NAME), lookup(f.cwd, f.target), expected);
    nativeParity(expected, lookup(f.cwd, f.target), expected);
    nativeMissing(join("missing", NAME), lookup(f.cwd, f.first), "ENOENT");
  });
});

test("native differential: missing binaries and candidate directories are not executable files", (t) => {
  const f = fixture(t);
  const expected = f.copy(f.second);
  mkdirSync(join(f.first, NATIVE_NAME));
  withParentLookup(f.first, undefined, () => {
    nativeMissing(NAME, lookup(f.cwd, join(f.root, "missing")), "ENOENT");
    nativeParity(NAME, lookup(f.cwd, [f.first, f.second].join(delimiter)), expected);
    nativeMissing(NAME, lookup(f.cwd, f.first), WINDOWS ? "ENOENT" : "EACCES");
  });
});

test("native differential Windows: .com precedes .exe, mixed case and explicit extensions", { skip: !WINDOWS }, (t) => {
  const f = fixture(t);
  const com = f.copy(f.first, NAME + ".CoM");
  const exe = f.copy(f.first, NAME + ".EXE");
  withParentLookup("", undefined, () => {
    nativeParity(NAME.toUpperCase(), lookup(f.cwd, f.first), com);
    nativeParity(NAME + ".exe", lookup(f.cwd, f.first), exe);
    nativeParity(join(relative(f.cwd, f.first), NAME), lookup(f.cwd, f.second), com);
    nativeParity(NAME + ".", lookup(f.cwd, f.first), com);
  });
});

test("native differential Windows: cwd search follows parent control presence, not child value", { skip: !WINDOWS }, (t) => {
  const f = fixture(t);
  const cwdCopy = f.copy(f.cwd);
  const pathCopy = f.copy(f.first);
  withParentLookup(f.first, undefined, () => {
    const context = lookup(f.cwd, f.first);
    context.env = { ...context.env, NoDefaultCurrentDirectoryInExePath: "child-only" };
    nativeParity(NAME, context, cwdCopy);
    nativeParity(NAME, lookup(f.cwd, ""), cwdCopy);
  });
  for (const value of ["1", ""]) {
    withParentLookup(f.first, value, () => {
      nativeParity(NAME, lookup(f.cwd, f.first), pathCopy);
      nativeMissing(NAME, lookup(f.cwd, ";;"), "ENOENT");
    });
  }
});

test("native differential Windows: quoted PATH, quoted semicolons, spaces and untrimmed entries", { skip: !WINDOWS }, (t) => {
  const f = fixture(t);
  const quoted = join(f.root, "quoted; path");
  mkdirSync(quoted);
  const expected = f.copy(quoted);
  const second = f.copy(f.second);
  withParentLookup("", "1", () => {
    for (const quote of ['"', "'"]) {
      nativeParity(NAME, lookup(f.cwd, `${quote}${quoted}${quote};${f.second}`), expected);
      nativeParity(NAME, lookup(f.cwd, `${quote}${relative(f.cwd, quoted)}${quote}`), expected);
    }
    nativeParity(NAME, lookup(f.cwd, ` ${f.first};${f.second}`), second);
    nativeMissing(NAME, lookup(f.cwd, ` ${f.second}`), "ENOENT");
  });
});

test("native differential Windows: absent PATH uses captured parent fallback, empty PATH does not", { skip: !WINDOWS }, (t) => {
  const f = fixture(t);
  const expected = f.copy(f.first);
  withParentLookup(f.first, "1", () => {
    nativeParity(NAME, lookup(f.cwd), expected);
    nativeMissing(NAME, lookup(f.cwd, ""), "ENOENT");
    const context = lookup(f.cwd);
    process.env.PATH = f.second;
    assert.equal(identity(resolveDoctorExecutable(NAME, context)), identity(expected));
  });
  withParentLookup(undefined, "1", () => nativeMissing(NAME, lookup(f.cwd), "ENOENT"));
});

test("native differential Windows: .cmd-only installations never use PATHEXT or shell fallback", { skip: !WINDOWS }, (t) => {
  const f = fixture(t);
  writeFileSync(join(f.first, NAME + ".cmd"), "@exit /b 0\r\n");
  withParentLookup("", "1", () => {
    const context = lookup(f.cwd, f.first);
    context.env = { ...context.env, PATHEXT: ".CMD;.EXE;.COM" };
    nativeMissing(NAME, context, "ENOENT");
  });
});

test("native differential Windows: selected nonlaunchable file never falls through to later executable", { skip: !WINDOWS }, (t) => {
  const f = fixture(t);
  const bad = join(f.first, NATIVE_NAME);
  writeFileSync(bad, "This file is deliberately not a PE executable.");
  f.copy(f.second);
  withParentLookup("", "1", () => {
    const context = lookup(f.cwd, [f.first, f.second].join(delimiter));
    const selected = resolveDoctorExecutable(NAME, context);
    assert.equal(selected, bad);
    const native = spawnSync(NAME, IDENTITY_ARGS, { cwd: context.cwd, env: context.env, shell: false, encoding: "utf8" });
    const absolute = spawnSync(selected, IDENTITY_ARGS, { cwd: context.cwd, env: context.env, shell: false, encoding: "utf8" });
    assert.ok(native.error);
    assert.equal((native.error as NodeJS.ErrnoException).code, (absolute.error as NodeJS.ErrnoException | undefined)?.code);
    assert.throws(() => probeExecutor({ ...CLAUDE_CODE, probe: [NAME, ...IDENTITY_ARGS] }, {
      executablePath: selected, cwd: context.cwd, env: { ...context.env }, timeoutMs: 5000,
    }), /probe failed for executor claude-code/);
    assert.equal(resolveDoctorExecutable(NAME, context), bad);
  });
});

test("Windows resolver skips code-bearing attribute failures but propagates programming errors", { skip: !WINDOWS }, (t) => {
  const f = fixture(t);
  const first = f.copy(f.first);
  const second = f.copy(f.second);
  const original = fs.statSync;
  let injected: Error = Object.assign(new Error("denied attribute lookup"), { code: "EACCES" });
  const mocked = t.mock.method(fs, "statSync", (path: fs.PathLike, ...args: unknown[]) => {
    if (String(path).startsWith(f.first) || String(path).startsWith(`\\\\.\\${f.first}`)) throw injected;
    return Reflect.apply(original, fs, [path, ...args]);
  });
  syncBuiltinESMExports();
  try {
    const context = { cwd: f.cwd, env: { PATH: [f.first, f.second].join(delimiter) }, noDefaultCurrentDirectoryInExePath: true };
    assert.equal(resolveDoctorExecutable(NAME, context), second);
    injected = new TypeError("programming defect");
    assert.throws(() => resolveDoctorExecutable(NAME, context), (error) => error === injected);
    assert.notEqual(first, second);
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

test("native differential POSIX: denied candidates continue, otherwise preserve EACCES", { skip: WINDOWS }, (t) => {
  const f = fixture(t);
  const denied = f.copy(f.first);
  chmodSync(denied, 0o644);
  const executable = f.copy(f.second);
  nativeParity(NAME, lookup(f.cwd, [f.first, f.second].join(delimiter)), executable);
  nativeMissing(NAME, lookup(f.cwd, f.first), "EACCES");
  nativeMissing(denied, lookup(f.cwd, f.second), "EACCES");
});

test("native differential POSIX: exact names, literal quotes and empty PATH entries", { skip: WINDOWS }, (t) => {
  const f = fixture(t);
  const cwdCopy = f.copy(f.cwd);
  f.copy(f.first, NAME + ".exe");
  nativeMissing(NAME, lookup(f.cwd, f.first), "ENOENT");
  nativeParity(NAME, lookup(f.cwd, ""), cwdCopy);
  nativeParity(NAME, lookup(f.cwd, `${f.first}::${f.second}`), cwdCopy);
  nativeMissing(NAME, lookup(f.cwd, `"${f.cwd}"`), "ENOENT");
});

test("native differential POSIX: missing PATH uses Node documented /usr/bin:/bin default", { skip: WINDOWS }, (t) => {
  const f = fixture(t);
  // Compare an OS-installed command, not an assumed Node installation in /usr/bin.
  const command = "sh";
  const native = spawnSync(command, ["-c", "exit 0"], { cwd: f.cwd, env: {}, shell: false, encoding: "utf8" });
  assert.equal(native.status, 0, native.error?.message);
  const selected = resolveDoctorExecutable(command, lookup(f.cwd));
  const explicit = resolveDoctorExecutable(command, lookup(f.cwd, "/usr/bin:/bin"));
  assert.equal(selected, explicit);
  nativeMissing(command, lookup(f.cwd, ""), "ENOENT");
});

test("absolute probe receives selected command and preserves args, environment, cwd and timeout", (t) => {
  const f = fixture(t);
  const expected = f.copy(f.first);
  const context = lookup(f.cwd, f.first);
  const selected = resolveDoctorExecutable(NAME, context);
  const original = childProcess.spawnSync;
  const calls: unknown[][] = [];
  const mocked = t.mock.method(childProcess, "spawnSync", (...args: unknown[]) => {
    calls.push(args);
    return Reflect.apply(original, childProcess, args);
  });
  syncBuiltinESMExports();
  try {
    const env = { ...context.env };
    const executor = { ...CLAUDE_CODE, probe: [NAME, ...IDENTITY_ARGS] };
    probeExecutor(executor, { executablePath: selected, cwd: f.cwd, env, timeoutMs: 5000 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], expected);
    assert.deepEqual(calls[0][1], executor.probe.slice(1));
    assert.deepEqual(calls[0][2], { shell: false, encoding: "utf8", timeout: 5000, env, cwd: f.cwd });
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

test("resolver rejects relative lookup cwd and retains named errors", () => {
  assert.throws(() => resolveDoctorExecutable(NAME, { cwd: ".", env: {} }), /EINVAL.*cwd must be absolute/);
  assert.throws(() => resolveDoctorExecutable("", { cwd: process.cwd(), env: {} }), /ENOENT.*empty executable name/);
});

function homeFixture(t: TestContext) {
  const root = mkdtempSync(resolve(".doctor-config-"));
  const home = join(root, "owned home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ambient = { HOME: home, USERPROFILE: home };
  const child = buildHarnessEnvironment(CLAUDE_CODE, ambient);
  const settings = join(home, ".claude", "settings.json");
  const state = join(home, ".claude.json");
  return {
    root, home, ambient, child, settings, state,
    collect: () => collectAmbientProviderConfig(CLAUDE_CODE, ambient, child),
  };
}

function assertRecords(result: AmbientProviderConfig): void {
  assert.deepEqual(result.files.map((file) => file.name), ["user_settings", "user_state"]);
  for (const file of result.files) {
    assert.deepEqual(Object.keys(file).sort(), ["contentHash", "name", "path", "reason", "sizeBytes", "state"]);
    if (file.state === "readable") {
      assert.match(file.contentHash!, /^[a-f0-9]{64}$/);
      assert.equal(file.reason, null);
      assert.equal(typeof file.sizeBytes, "number");
    } else {
      assert.equal(file.contentHash, null);
      if (file.state === "absent") {
        assert.equal(file.sizeBytes, null);
        assert.equal(file.reason, null);
      } else {
        assert.ok(file.reason);
      }
    }
  }
}

function withFilesystemMocks(t: TestContext, install: () => void, body: () => void): void {
  install();
  syncBuiltinESMExports();
  try {
    body();
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
}

test("ambient observations use only canonical declared names, captured values and own child membership", (t) => {
  const f = homeFixture(t);
  const ambient = Object.freeze({
    ...f.ambient, PATH: "", APPDATA: f.root, LOCALAPPDATA: f.root, TEMP: f.root,
    TMP: f.root, SystemRoot: f.root, UNRELATED_SECRET: "excluded synthetic secret",
    Path: "noncanonical-snapshot-key",
  });
  const child = Object.freeze(buildHarnessEnvironment(CLAUDE_CODE, ambient));
  const executorBefore = JSON.stringify(CLAUDE_CODE);
  const result = collectAmbientProviderConfig(CLAUDE_CODE, ambient, child);
  assert.deepEqual(result.environment.map((entry) => entry.name),
    [...new Set([...CLAUDE_CODE.sandbox.envPassthrough,
      "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "OPENAI_BASE_URL", "CLAUDE_CONFIG_DIR"])].sort());
  assert.deepEqual(DOCTOR_OBSERVATION_NAMES,
    ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "OPENAI_BASE_URL", "CLAUDE_CONFIG_DIR"]);
  for (const entry of result.environment) {
    assert.equal(entry.present, Object.hasOwn(ambient, entry.name));
    assert.equal(entry.passedToChild, Object.hasOwn(child, entry.name));
    assert.equal(entry.valueHash, Object.hasOwn(ambient, entry.name)
      ? sha256Hex(ambient[entry.name as keyof typeof ambient]) : null);
  }
  assert.equal(result.environment.find((entry) => entry.name === "PATH")!.valueHash,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  const inherited = Object.create({ PATH: "inherited-not-supplied" }) as Record<string, string>;
  assert.equal(collectAmbientProviderConfig(CLAUDE_CODE, { PATH: "" }, inherited)
    .environment.find((entry) => entry.name === "PATH")!.passedToChild, false);
  assert.equal(JSON.stringify(CLAUDE_CODE), executorBefore);
  assert.ok(!JSON.stringify(result).includes(ambient.UNRELATED_SECRET));
  assert.ok(!JSON.stringify(result).includes(ambient.Path));
  assertRecords(result);
});

test("ambient privacy: every override is presence-only, never a value or value hash", (t) => {
  const f = homeFixture(t);
  for (const name of ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "OPENAI_BASE_URL", "CLAUDE_CONFIG_DIR"]) {
    for (const value of [`synthetic-private-value-${name}`, ""]) {
      const snapshot = { ...f.ambient, [name]: value };
      const child = buildHarnessEnvironment(CLAUDE_CODE, snapshot);
      const result = collectAmbientProviderConfig(CLAUDE_CODE, snapshot, child);
      const observed = result.environment.find((entry) => entry.name === name)!;
      assert.deepEqual(observed, { name, present: true, passedToChild: false, valueHash: null });
      assert.ok(!JSON.stringify(result).includes(sha256Hex(value)));
      if (value !== "") assert.ok(!JSON.stringify(result).includes(value));
      const unset = collectAmbientProviderConfig(CLAUDE_CODE, f.ambient, f.child);
      assert.deepEqual(unset.environment.find((entry) => entry.name === name), {
        name, present: false, passedToChild: false, valueHash: null,
      });
    }
  }
});

test("ambient privacy: a credential-like passthrough is delivered but never fingerprinted", (t) => {
  const f = homeFixture(t);
  const executor = structuredClone(CLAUDE_CODE);
  executor.sandbox.envPassthrough.push("DOCTOR_CREDENTIAL", "UNCLASSIFIED_SETTING");
  const ambient = { ...f.ambient, DOCTOR_CREDENTIAL: "synthetic-token", UNCLASSIFIED_SETTING: "synthetic-nonsecret" };
  const result = collectAmbientProviderConfig(executor, ambient, buildHarnessEnvironment(executor, ambient));
  for (const name of ["DOCTOR_CREDENTIAL", "UNCLASSIFIED_SETTING"]) {
    assert.deepEqual(result.environment.find((entry) => entry.name === name),
      { name, present: true, passedToChild: true, valueHash: null });
    assert.ok(!JSON.stringify(result).includes(ambient[name as keyof typeof ambient]));
    assert.ok(!JSON.stringify(result).includes(sha256Hex(ambient[name as keyof typeof ambient])));
  }
  assert.ok(!CLAUDE_CODE.sandbox.envPassthrough.includes("DOCTOR_CREDENTIAL"));
});

test("collector reads exactly two passed-home locations and never excluded config-dir or live home", (t) => {
  const f = homeFixture(t);
  const excluded = join(f.root, "excluded config dir");
  mkdirSync(excluded);
  writeFileSync(join(excluded, "settings.json"), "excluded synthetic settings");
  writeFileSync(join(f.home, ".claude", "credentials.json"), "never inventory this");
  const ambient = { ...f.ambient, CLAUDE_CONFIG_DIR: excluded, APPDATA: excluded };
  const child = buildHarnessEnvironment(CLAUDE_CODE, ambient);
  const paths: string[] = [];
  const original = fs.lstatSync;
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  process.env.HOME = excluded;
  process.env.USERPROFILE = excluded;
  try {
    withFilesystemMocks(t, () => {
      t.mock.method(fs, "lstatSync", (path: fs.PathLike, ...args: unknown[]) => {
        paths.push(String(path));
        return Reflect.apply(original, fs, [path, ...args]);
      });
    }, () => {
      const result = collectAmbientProviderConfig(CLAUDE_CODE, ambient, child);
      assert.deepEqual(paths, [f.settings, f.state]);
      assert.equal(result.homeVariable, WINDOWS ? "USERPROFILE" : "HOME");
      assert.deepEqual(result.files.map((file) => file.path), [f.settings, f.state]);
      assert.ok(result.files.every((file) => file.state === "absent"));
      assertRecords(result);
    });
  } finally {
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
  }
});

test("missing empty relative or excluded home has two explicit unavailable records without filesystem access", (t) => {
  const f = homeFixture(t);
  const homeName = WINDOWS ? "USERPROFILE" : "HOME";
  withFilesystemMocks(t, () => {
    t.mock.method(fs, "lstatSync", () => { throw new Error("must not inspect any home fallback"); });
  }, () => {
    for (const home of [undefined, "", "relative-home"]) {
      const ambient = { [homeName]: home };
      const child = buildHarnessEnvironment(CLAUDE_CODE, ambient);
      const result = collectAmbientProviderConfig(CLAUDE_CODE, ambient, child);
      assertRecords(result);
      for (const file of result.files) {
        assert.equal(file.state, "unavailable");
        assert.equal(file.path, null);
        assert.equal(file.sizeBytes, null);
        assert.match(file.reason!, /unavailable home/);
        assert.ok(file.reason!.includes(homeName));
      }
    }
    const excluded = collectAmbientProviderConfig(CLAUDE_CODE, f.ambient, {});
    assert.ok(excluded.files.every((file) => file.path === null && file.state === "unavailable"));
  });
});

test("missing configuration files remain absent and missing parents are never created", (t) => {
  const f = homeFixture(t);
  rmSync(join(f.home, ".claude"), { recursive: true });
  const result = f.collect();
  assertRecords(result);
  assert.ok(result.files.every((file) => file.state === "absent"));
  assert.deepEqual(fs.readdirSync(f.home), []);
});

test("whole-file fingerprints retain empty digest and exact BOM CRLF bytes for both files", (t) => {
  const f = homeFixture(t);
  writeFileSync(f.settings, Buffer.alloc(0));
  const contents = Buffer.from("\ufeff{\r\n  \"synthetic-state\": \"private local data\"\r\n}\r\n");
  writeFileSync(f.state, contents);
  const result = f.collect();
  assertRecords(result);
  assert.equal(result.files[0].contentHash, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(result.files[0].sizeBytes, 0);
  assert.equal(result.files[1].contentHash, sha256Hex(readFileSync(f.state)));
  assert.equal(result.files[1].sizeBytes, contents.length);
  assert.notEqual(result.files[1].contentHash, sha256Hex(contents.toString().replace(/^\ufeff/, "").replace(/\r\n/g, "\n")));
  assert.ok(!JSON.stringify(result).includes("private local data"));
  assert.ok(!JSON.stringify(result).includes(contents.toString()));
});

test("same-size exact-byte changes alter both user_settings and user_state whole-file hashes", (t) => {
  const f = homeFixture(t);
  const beforeBytes = Buffer.from("\ufeff{\"local\":\"A\"}\r\n");
  const afterBytes = Buffer.from("\ufeff{\"local\":\"B\"}\r\n");
  assert.equal(beforeBytes.length, afterBytes.length);
  for (const path of [f.settings, f.state]) writeFileSync(path, beforeBytes);
  const before = f.collect();
  for (const path of [f.settings, f.state]) writeFileSync(path, afterBytes);
  const after = f.collect();
  for (const [index, path] of [f.settings, f.state].entries()) {
    assert.equal(after.files[index].state, "readable");
    assert.equal(before.files[index].sizeBytes, after.files[index].sizeBytes);
    assert.notEqual(before.files[index].contentHash, after.files[index].contentHash);
    assert.equal(after.files[index].contentHash, sha256Hex(readFileSync(path)));
    assert.deepEqual(readFileSync(path), afterBytes);
  }
});

test("directory and special-file type refusals happen before opening and never carry a hash", (t) => {
  const f = homeFixture(t);
  mkdirSync(f.settings);
  const directory = f.collect().files[0];
  assert.equal(directory.state, "unavailable");
  assert.equal(directory.sizeBytes, null);
  assert.match(directory.reason!, /non-regular/);
  rmSync(f.settings, { recursive: true });
  writeFileSync(f.settings, "synthetic special-file stand-in");
  const original = fs.lstatSync;
  withFilesystemMocks(t, () => {
    t.mock.method(fs, "lstatSync", (path: fs.PathLike, ...args: unknown[]) => {
      const stats = Reflect.apply(original, fs, [path, ...args]) as fs.Stats;
      if (String(path) === f.settings) stats.isFile = () => false;
      return stats;
    });
    t.mock.method(fs, "openSync", () => { throw new Error("special files must not be opened"); });
  }, () => {
    const result = f.collect();
    assertRecords(result);
    assert.equal(result.files[0].sizeBytes, null);
    assert.match(result.files[0].reason!, /non-regular/);
  });
});

test("leaf symlinks and dangling links are refused before opening", (t) => {
  const f = homeFixture(t);
  const target = join(f.root, "link target");
  mkdirSync(target);
  // Junctions exercise the real Windows leaf-link check without requiring
  // Developer Mode or a privilege grant; POSIX uses directory symlinks.
  symlinkSync(target, f.settings, WINDOWS ? "junction" : "dir");
  const linked = f.collect().files[0];
  assert.equal(linked.state, "unavailable");
  assert.equal(linked.sizeBytes, null);
  assert.match(linked.reason!, /leaf symlink/);
  rmSync(target, { recursive: true });
  const dangling = f.collect().files[0];
  assert.equal(dangling.state, "unavailable");
  assert.equal(dangling.contentHash, null);
  assert.match(dangling.reason!, /leaf symlink/);
});

test("file leaf symlink is refused when platform permits creation", (t) => {
  const f = homeFixture(t);
  writeFileSync(f.state, "synthetic linked contents");
  try {
    symlinkSync(f.state, f.settings, "file");
  } catch (error) {
    if (WINDOWS && (error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("Windows file symlink creation requires a privilege not available to this test");
      return;
    }
    throw error;
  }
  const result = f.collect();
  assertRecords(result);
  assert.match(result.files[0].reason!, /leaf symlink/);
  assert.equal(result.files[0].sizeBytes, null);
});

test("filesystem errors name the operation code and path, preserve known size, and hide error payloads", (t) => {
  const f = homeFixture(t);
  writeFileSync(f.settings, "owned configuration bytes");
  const size = fs.statSync(f.settings).size;
  const operations = ["lstatSync", "openSync", "fstatSync", "readSync", "closeSync"] as const;
  for (const operation of operations) {
    const original = fs[operation];
    let didThrow = false;
    let closed = 0;
    const originalClose = fs.closeSync;
    withFilesystemMocks(t, () => {
      t.mock.method(fs, operation, (...args: unknown[]) => {
        if (!didThrow) {
          didThrow = true;
          if (operation === "closeSync") {
            Reflect.apply(original, fs, args);
            closed++;
          }
          throw Object.assign(new Error("synthetic private payload must not appear"), {
            code: operation === "openSync" ? "EACCES" : "EIO",
          });
        }
        return Reflect.apply(original, fs, args);
      });
      if (operation !== "closeSync") {
        t.mock.method(fs, "closeSync", (descriptor: number) => { closed++; originalClose(descriptor); });
      }
    }, () => {
      const result = f.collect();
      assertRecords(result);
      const file = result.files[0];
      assert.equal(file.state, "unavailable");
      assert.equal(file.sizeBytes, operation === "lstatSync" ? null : size);
      assert.ok(file.reason!.includes(operation.replace("Sync", "")));
      assert.ok(file.reason!.includes(operation === "openSync" ? "EACCES" : "EIO"));
      assert.ok(file.reason!.includes(f.settings));
      assert.ok(!JSON.stringify(result).includes("synthetic private payload"));
      assert.equal(result.files[1].state, "absent", "one file failure must not prevent the second observation");
      assert.equal(closed, operation === "lstatSync" || operation === "openSync" ? 0 : 1);
    });
  }
});

test("unexpected filesystem programming errors propagate while opened descriptors still close", (t) => {
  const f = homeFixture(t);
  writeFileSync(f.settings, "owned configuration bytes");
  const defect = Object.assign(new TypeError("programming defect"), { code: "ERR_INVALID_ARG_TYPE" });
  const originalClose = fs.closeSync;
  let closed = 0;
  withFilesystemMocks(t, () => {
    t.mock.method(fs, "readSync", () => { throw defect; });
    t.mock.method(fs, "closeSync", (descriptor: number) => { closed++; originalClose(descriptor); });
  }, () => {
    assert.throws(f.collect, (error) => error === defect);
    assert.equal(closed, 1);
  });
});

test("short successful reads loop to EOF and hash the complete file, not the first chunk", (t) => {
  const f = homeFixture(t);
  const contents = Buffer.from("\ufeff{\"complete\":\"short reads retain every byte\"}\r\n");
  writeFileSync(f.settings, contents);
  const original = fs.readSync;
  let reads = 0;
  let sawEof = false;
  withFilesystemMocks(t, () => {
    t.mock.method(fs, "readSync", (descriptor: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
      reads++;
      const count = original(descriptor, buffer, offset, Math.min(length, 3), position);
      if (count === 0) sawEof = true;
      return count;
    });
  }, () => {
    const result = f.collect();
    assertRecords(result);
    assert.ok(reads > 2);
    assert.ok(sawEof);
    assert.equal(result.files[0].state, "readable");
    assert.equal(result.files[0].sizeBytes, contents.length);
    assert.equal(result.files[0].contentHash, sha256Hex(readFileSync(f.settings)));
    assert.notEqual(result.files[0].contentHash, sha256Hex(contents.subarray(0, 3)));
  });
});

test("exact per-file ceiling is readable, one byte over never yields an oversized prefix hash", (t) => {
  const f = homeFixture(t);
  assert.equal(DOCTOR_CONFIG_MAX_BYTES, 1024 * 1024);
  const contents = Buffer.alloc(DOCTOR_CONFIG_MAX_BYTES, 0x61);
  for (const path of [f.settings, f.state]) writeFileSync(path, contents);
  const exact = f.collect();
  assertRecords(exact);
  for (const file of exact.files) {
    assert.equal(file.state, "readable");
    assert.equal(file.sizeBytes, contents.length);
    assert.equal(file.contentHash, sha256Hex(contents));
  }
  for (const path of [f.settings, f.state]) writeFileSync(path, Buffer.concat([contents, Buffer.from("b")]));
  const over = f.collect();
  assertRecords(over);
  for (const file of over.files) {
    assert.equal(file.state, "unavailable");
    assert.equal(file.sizeBytes, contents.length + 1);
    assert.equal(file.contentHash, null);
    assert.match(file.reason!, /ceiling/);
    assert.ok(file.reason!.includes(String(DOCTOR_CONFIG_MAX_BYTES)));
  }
});

test("bounded read stops at ceiling plus one sentinel even when metadata understates a growing file", (t) => {
  const f = homeFixture(t);
  writeFileSync(f.settings, Buffer.alloc(DOCTOR_CONFIG_MAX_BYTES + 20, 0x62));
  const originalLstat = fs.lstatSync;
  const originalFstat = fs.fstatSync;
  const originalRead = fs.readSync;
  let readTotal = 0;
  withFilesystemMocks(t, () => {
    t.mock.method(fs, "lstatSync", (path: fs.PathLike, ...args: unknown[]) => {
      const stats = Reflect.apply(originalLstat, fs, [path, ...args]) as fs.Stats;
      stats.size = DOCTOR_CONFIG_MAX_BYTES;
      return stats;
    });
    t.mock.method(fs, "fstatSync", (descriptor: number) => {
      const stats = originalFstat(descriptor);
      stats.size = DOCTOR_CONFIG_MAX_BYTES;
      return stats;
    });
    t.mock.method(fs, "readSync", (descriptor: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
      assert.ok(readTotal + length <= DOCTOR_CONFIG_MAX_BYTES + 1);
      const count = originalRead(descriptor, buffer, offset, length, position);
      readTotal += count;
      return count;
    });
  }, () => {
    const result = f.collect();
    assertRecords(result);
    assert.equal(readTotal, DOCTOR_CONFIG_MAX_BYTES + 1);
    assert.equal(result.files[0].state, "unavailable");
    assert.equal(result.files[0].contentHash, null);
    assert.equal(result.files[0].sizeBytes, DOCTOR_CONFIG_MAX_BYTES);
    assert.match(result.files[0].reason!, /ceiling/);
  });
});

test("EOF byte-count mismatch and failed partial reads never produce a prefix hash", (t) => {
  const f = homeFixture(t);
  const contents = Buffer.from("complete synthetic config");
  writeFileSync(f.settings, contents);
  for (const failRead of [false, true]) {
    const original = fs.readSync;
    let reads = 0;
    withFilesystemMocks(t, () => {
      t.mock.method(fs, "readSync", (descriptor: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
        if (reads++ === 0) return original(descriptor, buffer, offset, Math.min(length, 4), position);
        if (failRead) throw Object.assign(new Error("read failed"), { code: "EIO" });
        return 0;
      });
    }, () => {
      const result = f.collect();
      assertRecords(result);
      assert.equal(result.files[0].state, "unavailable");
      assert.equal(result.files[0].sizeBytes, contents.length);
      assert.match(result.files[0].reason!, failRead ? /read EIO/ : /EOF\/byte count/);
    });
  }
});

test("metadata size mtime ctime and identity changes before or after reading refuse stable-file claims", (t) => {
  const f = homeFixture(t);
  writeFileSync(f.settings, "synthetic changing configuration");
  for (const field of ["size", "mtimeMs", "ctimeMs", "ino"] as const) {
    for (const phase of ["before", "after"]) {
      const original = fs.fstatSync;
      let statsRead = 0;
      withFilesystemMocks(t, () => {
        t.mock.method(fs, "fstatSync", (descriptor: number) => {
          const stats = original(descriptor);
          if (++statsRead === (phase === "before" ? 1 : 2)) {
            const previous = stats[field];
            stats[field] = field === "ino" ? (previous === 0 ? 1 : 0) : previous + 1;
            assert.notEqual(stats[field], previous, `${field} ${phase}: injected metadata must actually differ`);
          }
          return stats;
        });
      }, () => {
        const result = f.collect();
        assertRecords(result);
        assert.equal(result.files[0].state, "unavailable", `${field} ${phase}`);
        assert.match(result.files[0].reason!, phase === "before" ? /changed before read/ : /changed during read/);
      });
    }
  }
});

test("opened descriptor must still be regular and descriptor stat failures preserve known file size", (t) => {
  const f = homeFixture(t);
  writeFileSync(f.settings, "synthetic descriptor");
  const size = fs.statSync(f.settings).size;
  for (const phase of [1, 2]) {
    const original = fs.fstatSync;
    let statsRead = 0;
    withFilesystemMocks(t, () => {
      t.mock.method(fs, "fstatSync", (descriptor: number) => {
        const stats = original(descriptor);
        if (++statsRead === phase) stats.isFile = () => false;
        return stats;
      });
    }, () => {
      const result = f.collect();
      assertRecords(result);
      assert.equal(result.files[0].state, "unavailable");
      assert.equal(result.files[0].sizeBytes, size);
      assert.match(result.files[0].reason!, /non-regular opened descriptor/);
    });
  }
  const original = fs.fstatSync;
  let statsRead = 0;
  withFilesystemMocks(t, () => {
    t.mock.method(fs, "fstatSync", (descriptor: number) => {
      if (++statsRead === 2) throw Object.assign(new Error("stat failed"), { code: "EIO" });
      return original(descriptor);
    });
  }, () => {
    const file = f.collect().files[0];
    assert.equal(file.contentHash, null);
    assert.equal(file.sizeBytes, size);
    assert.match(file.reason!, /fstat after read EIO/);
  });
});

test("collector opens read-only nonblocking descriptors and preserves owned home inventory and bytes", (t) => {
  const f = homeFixture(t);
  writeFileSync(f.settings, "synthetic settings\r\n");
  writeFileSync(f.state, "\ufeffsynthetic state\r\n");
  function inventory() {
    return fs.readdirSync(f.home, { recursive: true }).map((entry) => {
      const path = join(f.home, String(entry));
      const stats = fs.lstatSync(path);
      return { path, size: stats.size, mtime: stats.mtimeMs, ctime: stats.ctimeMs,
        hash: stats.isFile() ? sha256Hex(readFileSync(path)) : null };
    });
  }
  const before = inventory();
  const originalOpen = fs.openSync;
  const originalRead = fs.readSync;
  const originalClose = fs.closeSync;
  const readCounts = new Map<number, number>();
  const openedPaths: string[] = [];
  let closed = 0;
  withFilesystemMocks(t, () => {
    t.mock.method(fs, "openSync", (path: fs.PathLike, flags: number) => {
      assert.equal(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC), 0);
      assert.equal(flags & (fs.constants.O_NONBLOCK ?? 0), fs.constants.O_NONBLOCK ?? 0);
      assert.equal(flags & (fs.constants.O_NOFOLLOW ?? 0), fs.constants.O_NOFOLLOW ?? 0);
      openedPaths.push(String(path));
      const descriptor = originalOpen(path, flags);
      readCounts.set(descriptor, 0);
      return descriptor;
    });
    t.mock.method(fs, "readSync", (descriptor: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
      assert.ok(readCounts.get(descriptor)! + length <= DOCTOR_CONFIG_MAX_BYTES + 1);
      const count = originalRead(descriptor, buffer, offset, length, position);
      readCounts.set(descriptor, readCounts.get(descriptor)! + count);
      return count;
    });
    t.mock.method(fs, "closeSync", (descriptor: number) => { closed++; originalClose(descriptor); });
  }, () => {
    const result = f.collect();
    assertRecords(result);
    assert.deepEqual(openedPaths, [f.settings, f.state]);
    assert.equal(closed, 2);
  });
  assert.deepEqual(inventory(), before);
});
