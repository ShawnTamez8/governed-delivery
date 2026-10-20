// A Docker stand-in for the suites, so they run on machines without an engine
// (docs/features/sandboxed-implementer/plan.md, Task 4). It implements only the
// forms src/container.ts issues and refuses every other one. Wherever
// src/container.ts parses Docker's output, the bytes come from the recorded
// real outputs in test/fixtures/recorded/docker-cli-outputs.json, with only the
// object reference substituted; test/docker-stand-in.test.ts holds the two
// together (hard rule 5).
//
// A command run through the exit-status wrapper (`docker exec -i <id> sh -c
// '<wrapper>' <seconds> <argv...>`) runs on the host, in the directory the test
// mounted at /work, with the frozen --env list plus PATH and SystemRoot, and
// with a shell on Windows as runVerifyCommand ran verification commands before
// the sandbox (hazard 8: `npm` is a Windows shim). Its exit code is written
// where the wrapper's file read finds it.
//
// State lives in BW_DOCKER_STAND_IN_STATE, or a shared directory under the OS
// temp directory. A test marks a container prefix `unremovable` (rm -f fails
// and inspect still finds it), `noexit` (the wrapper writes no exit status) or
// `unstartable` (`run -d` fails, as the daemon's 125 does).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const RECORDED = JSON.parse(
  readFileSync(new URL("../recorded/docker-cli-outputs.json", import.meta.url), "utf8")
);
const form = (label) => {
  const found = RECORDED.forms.find((f) => f.label === label);
  if (!found) throw new Error(`docker stand-in: no recorded form ${label}`);
  return found;
};
const IMAGE_ID = RECORDED.provenance.image.imageId;
const WRAPPER = /^timeout --signal=KILL "\$0" "\$@"; echo \$\? > \/tmp\/bw-exit-([0-9a-f]{16})$/;
const STATE = process.env.BW_DOCKER_STAND_IN_STATE ?? join(tmpdir(), "bw-docker-stand-in");
for (const dir of ["containers", "networks", "exits", "marks", "images"]) mkdirSync(join(STATE, dir), { recursive: true });

/** Thrown to end a form with an exit code, so buffered output is never cut off by `process.exit`. */
class Exit {
  constructor(code) {
    this.code = code;
  }
}
function out(text) {
  process.stdout.write(text);
}
function fail(stderr, code, stdout = "") {
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  throw new Exit(code);
}
/** A recorded error, with the recorded object reference replaced by `ref`. */
function recordedError(label, recordedRef, ref) {
  const f = form(label);
  fail(f.stderr.split(recordedRef).join(ref), f.exitCode, f.stdout);
}
function refuse(argv) {
  fail(`docker stand-in: unimplemented form: ${JSON.stringify(argv)}\n`, 2);
}
const newId = () => randomBytes(32).toString("hex");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

function containers() {
  return readdirSync(join(STATE, "containers")).map((f) => read(join(STATE, "containers", f)));
}
function findContainer(ref) {
  return containers().find((c) => c.id === ref || c.name === ref || (ref.length >= 12 && c.id.startsWith(ref))) ?? null;
}
function networks() {
  return readdirSync(join(STATE, "networks")).map((f) => read(join(STATE, "networks", f)));
}
function findNetwork(ref) {
  return networks().find((n) => n.id === ref || n.name === ref || (ref.length >= 12 && n.id.startsWith(ref))) ?? null;
}
function marked(kind, name) {
  return readdirSync(join(STATE, "marks"))
    .filter((f) => f.startsWith(`${kind}-`))
    .some((f) => name.startsWith(readFileSync(join(STATE, "marks", f), "utf8")));
}
const RECORDED_CONTAINER = form("container inspect, present").stdout.trim();
function noSuchContainer(label, ref) {
  recordedError(label, RECORDED_CONTAINER, ref);
}
function imageKnown(ref) {
  return ref === IMAGE_ID || ref.startsWith("bw-sandbox:") || existsSync(join(STATE, "images", encodeURIComponent(ref)));
}

const VALUE_FLAGS = new Set(["--name", "--label", "--network", "--cpus", "--memory", "--memory-swap", "--pids-limit",
  "--cap-drop", "--security-opt", "--user", "-v", "-w", "--env", "-e", "--alias", "--format", "--filter", "-t"]);
const BOOL_FLAGS = new Set(["-d", "--rm", "-i", "-a", "--internal", "-f"]);

/** Split `args` into flags (name -> values) and positionals, stopping flag parsing at the first positional. */
function parse(args) {
  const flags = new Map();
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (VALUE_FLAGS.has(a)) {
      flags.set(a, [...(flags.get(a) ?? []), args[i + 1]]);
      i++;
    } else if (BOOL_FLAGS.has(a)) {
      flags.set(a, [true]);
    } else if (a.startsWith("-")) {
      return null;
    } else {
      break;
    }
  }
  return { flags, rest: args.slice(i) };
}
function mounts(flags) {
  const map = {};
  for (const spec of flags.get("-v") ?? []) {
    const at = spec.indexOf(":/", 2);
    const host = spec.slice(0, at);
    const target = spec.slice(at + 1).replace(/:ro$/, "");
    map[target] = host;
  }
  return map;
}
function labels(flags) {
  return Object.fromEntries((flags.get("--label") ?? []).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
}

function runCommandOnHost(container, argv, seconds, token) {
  const cwd = container.mounts["/work"];
  const env = {};
  for (const assignment of container.env) env[assignment.slice(0, assignment.indexOf("="))] = assignment.slice(assignment.indexOf("=") + 1);
  for (const name of ["PATH", "SystemRoot"]) if (process.env[name] !== undefined) env[name] = process.env[name];
  // On Windows the argv is joined here, as the shell would join it, because
  // Node warns (DEP0190) on stderr when args accompany `shell: true`, and that
  // warning would reach the command's own stderr.
  const windows = process.platform === "win32";
  const child = spawn(windows ? argv.join(" ") : argv[0], windows ? [] : argv.slice(1), {
    cwd,
    env,
    shell: windows,
    stdio: ["ignore", "inherit", "inherit"],
  });
  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    if (process.platform === "win32") {
      spawn(join(process.env.SystemRoot ?? "C:\\WINDOWS", "System32", "taskkill.exe"), ["/pid", String(child.pid), "/t", "/f"]);
    } else {
      child.kill("SIGKILL");
    }
  }, Number(seconds) * 1000);
  let finished = false;
  const finish = (code) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    const status = killed ? 137 : code ?? 137;
    if (!marked("noexit", container.name)) writeFileSync(join(STATE, "exits", `${container.id}-${token}`), `${status}\n`);
    // The real wrapper's last command is the `echo` into the file, so `docker exec` itself exits 0.
    process.exitCode = 0;
  };
  child.on("error", (err) => {
    process.stderr.write(`sh: 1: ${argv[0]}: not found (${err.message})\n`);
    finish(127);
  });
  child.on("close", finish);
}

const argv = process.argv.slice(2);
const [verb, ...args] = argv;

try {
  main();
} catch (err) {
  if (!(err instanceof Exit)) throw err;
  process.exitCode = err.code;
}

function main() {
if (verb === "version" && JSON.stringify(args) === JSON.stringify(["--format", "{{.Server.Os}} {{.Server.Version}}"])) {
  out(form("version").stdout);
} else if (verb === "image" && args[0] === "inspect" && args[1] === "--format" && args[2] === "{{.Id}}" && args.length === 4) {
  if (imageKnown(args[3])) out(form("image inspect, present ID").stdout);
  else recordedError("image inspect, absent", `sha256:${"0".repeat(64)}`, args[3]);
} else if (verb === "build" && args[0] === "-t" && args.length === 3) {
  writeFileSync(join(STATE, "images", encodeURIComponent(args[1])), IMAGE_ID);
  out(`stand-in built ${args[1]}\n`);
} else if (verb === "network" && args[0] === "create") {
  const parsed = parse(args.slice(1));
  if (!parsed || parsed.rest.length !== 1 || !parsed.flags.has("--internal")) refuse(argv);
  const id = newId();
  writeFileSync(join(STATE, "networks", `${id}.json`), JSON.stringify({ id, name: parsed.rest[0], labels: labels(parsed.flags) }));
  out(`${id}\n`);
} else if (verb === "network" && args[0] === "connect" && args[1] === "--alias" && args.length === 5) {
  if (!findNetwork(args[3]) || !findContainer(args[4])) fail(`Error response from daemon: stand-in cannot connect ${args[4]} to ${args[3]}\n`, 1);
} else if (verb === "network" && args[0] === "rm" && args.length === 2) {
  const network = findNetwork(args[1]);
  if (!network) recordedError("network rm, removed", form("network rm").stdout.trim(), args[1]);
  rmSync(join(STATE, "networks", `${network.id}.json`));
  out(`${network.id}\n`);
} else if (verb === "network" && args[0] === "ls" && args[1] === "--filter" && args[3] === "--format" && args[4] === "{{.ID}} {{.Name}}") {
  const [key, value] = args[2].replace(/^label=/, "").split("=");
  out(networks().filter((n) => n.labels[key] === value).map((n) => `${n.id.slice(0, 12)} ${n.name}\n`).join(""));
} else if (verb === "ps" && args[0] === "-a" && args[1] === "--filter" && args[3] === "--format" && args[4] === "{{.ID}} {{.Names}}") {
  const [key, value] = args[2].replace(/^label=/, "").split("=");
  out(containers().filter((c) => c.labels[key] === value).map((c) => `${c.id.slice(0, 12)} ${c.name}\n`).join(""));
} else if (verb === "run") {
  const parsed = parse(args);
  if (!parsed) refuse(argv);
  const [image, ...command] = parsed.rest;
  if (!imageKnown(image)) recordedError("image inspect, absent", `sha256:${"0".repeat(64)}`, image);
  if (parsed.flags.has("-d")) {
    const id = newId();
    const name = parsed.flags.get("--name")?.[0] ?? id.slice(0, 12);
    if (marked("unstartable", name)) fail(`docker: Error response from daemon: stand-in marked ${name} unstartable.\n`, 125);
    const container = {
      id,
      name,
      labels: labels(parsed.flags),
      mounts: mounts(parsed.flags),
      env: parsed.flags.get("--env") ?? [],
      command,
    };
    writeFileSync(join(STATE, "containers", `${id}.json`), JSON.stringify(container));
    out(`${id}\n`);
  } else if (parsed.flags.has("--rm") && command[0] === "sh" && command[1] === "-c" && command[3] === "sh") {
    const script = command[2];
    const values = command.slice(4);
    if (script === 'for p in "$@"; do command -v "$p" >/dev/null 2>&1 || echo "missing $p"; done') {
      const recorded = form("program check");
      // After the script comes `sh` as $0, then the programs asked about.
      const asked = recorded.argv.slice(recorded.argv.indexOf(script) + 2);
      const missing = new Set(recorded.stdout.split("\n").filter(Boolean).map((l) => l.slice("missing ".length)));
      const present = new Set(asked.filter((p) => !missing.has(p)));
      out(values.filter((p) => !present.has(p)).map((p) => `missing ${p}\n`).join(""));
    } else if (script === 'rm -rf -- "$@"') {
      const root = mounts(parsed.flags)["/work"];
      for (const path of values) {
        if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) fail(`docker stand-in: refusing to remove ${path}\n`, 2);
        rmSync(resolve(root, path), { recursive: true, force: true });
      }
    } else {
      refuse(argv);
    }
  } else {
    refuse(argv);
  }
} else if (verb === "exec" && args[0] === "-i" && args[2] === "sh" && args[3] === "-c") {
  const container = findContainer(args[1]);
  if (!container) noSuchContainer("exec against a removed container", args[1]);
  const match = WRAPPER.exec(args[4]);
  if (!match || args.length < 7) refuse(argv);
  runCommandOnHost(container, args.slice(6), args[5], match[1]);
} else if (verb === "exec" && args.length === 3 && args[1] === "cat" && /^\/tmp\/bw-exit-[0-9a-f]{16}$/.test(args[2])) {
  const container = findContainer(args[0]);
  if (!container) noSuchContainer("exit-status file read, removed container", args[0]);
  const token = args[2].slice("/tmp/bw-exit-".length);
  const file = join(STATE, "exits", `${container.id}-${token}`);
  if (existsSync(file)) out(readFileSync(file, "utf8"));
  else recordedError("exit-status file read, absent", form("exit-status file read, absent").stderr.match(/bw-exit-([0-9a-f]{16})/)[1], token);
} else if (verb === "rm" && args[0] === "-f" && args.length === 2) {
  const container = findContainer(args[1]);
  if (!container) {
    out(form("rm -f, removed").stdout);
  } else if (marked("unremovable", container.name)) {
    fail(`Error response from daemon: cannot remove container "/${container.name}": stand-in marked it unremovable\n`, 1);
  } else {
    rmSync(join(STATE, "containers", `${container.id}.json`));
    out(`${container.id}\n`);
  }
} else if (verb === "container" && args[0] === "inspect" && args[1] === "--format" && args[2] === "{{.Id}}" && args.length === 4) {
  const container = findContainer(args[3]);
  if (!container) noSuchContainer("container inspect, removed", args[3]);
  out(`${container.id}\n`);
} else if (verb === "logs" && args.length === 1) {
  if (!findContainer(args[0])) noSuchContainer("container inspect, removed", args[0]);
  out(form("logs").stdout);
} else {
  refuse(argv);
}
}
