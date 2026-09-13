import { GATE_RESULTS, ROLES, validateRunIdentity } from "./store.ts";
import { validateModelName } from "./profile.ts";

interface OptionDefinition {
  name: string;
  value?: string;
  required?: boolean;
  validate?: (value: string, name: string) => string | null;
}

interface CommandDefinition {
  description: string;
  options: readonly OptionDefinition[];
  exclusive?: readonly string[];
  requireExclusive?: boolean;
  acceptsRepo?: boolean;
}

const run: OptionDefinition = { name: "run", value: "id", required: true, validate: validateNumber };
const model: OptionDefinition = { name: "model", value: "name", validate: validateModelName };
const slug: OptionDefinition = {
  name: "slug", value: "slug", validate: (value) => validateRunIdentity({ slug: value }),
};
const json: OptionDefinition = { name: "json" };
const help: OptionDefinition = { name: "help" };

export const COMMANDS: Readonly<Record<string, CommandDefinition>> = {
  migrate: { description: "apply pending migrations", options: [] },
  "new-run": {
    description: "create a run and freeze its configuration",
    options: [
      { name: "project", value: "p", required: true },
      { name: "feature", value: "f", required: true, validate: (value) => validateRunIdentity({ featureId: value }) },
      { ...slug, value: "s", required: true },
      { name: "change-kind", value: "k", required: true, validate: (value) => validateRunIdentity({ changeKind: value }) },
      { ...model, required: true },
    ],
  },
  "stage-add": {
    description: "append a stage to the selected run",
    options: [run, { name: "kind", value: "k", required: true },
      { name: "input", value: "stage-id", validate: validateNumber }],
  },
  "stage-complete": {
    description: "record a stage output and gate result",
    options: [
      { name: "id", value: "id", required: true, validate: validateNumber },
      { name: "output", value: "ref", required: true },
      {
        name: "gate-result", value: "pass|block", required: true,
        validate: (value) => GATE_RESULTS.includes(value) ? null
          : `invalid gate_result ${value}: allowed values are ${GATE_RESULTS.join(", ")}`,
      },
    ],
  },
  dispatch: {
    description: "dispatch one frozen agent",
    options: [
      { name: "stage", value: "id", required: true, validate: validateNumber },
      { name: "agent", value: "id", required: true },
      {
        name: "role", value: "author|reviewer", required: true,
        validate: (value) => ROLES.includes(value) ? null
          : `invalid role ${value}: allowed values are ${ROLES.join(", ")}`,
      },
      { name: "prompt-file", value: "path", required: true }, model,
    ],
  },
  spec: { description: "run the spec and spec_review stages", options: [run, model] },
  plan: { description: "run the plan and plan_review stages", options: [run, model] },
  implement: { description: "run the implementation stage", options: [run, model] },
  verify: { description: "run the verification stage", options: [run] },
  review: { description: "run the bounded code_review loop", options: [run, model] },
  deliver: { description: "run the delivery check (step 8)", options: [run] },
  "approval-request": {
    description: "print the canonical payload for the operator to sign, or exclusively create --out",
    options: [run, { name: "expires", value: "iso" }, { name: "out", value: "path" }],
  },
  approve: {
    description: "verify and record the authorization; exactly one signature source",
    options: [run, { name: "expires", value: "iso", required: true },
      { name: "signature", value: "base64" }, { name: "signature-file", value: "path" }],
    exclusive: ["signature", "signature-file"], requireExclusive: true,
  },
  "verify-audit": { description: "recompute the whole audit chain", options: [] },
  "proposal-export": {
    description: "explicitly materialize a stored proposal in docs/proposals/",
    options: [
      { name: "proposal", value: "id", required: true, validate: validateNumber },
      {
        name: "name", value: "slug",
        validate: (value) => validateRunIdentity({ slug: value }) === null ? null
          : `invalid --name ${value}: must be lowercase kebab-case`,
      },
    ],
  },
  doctor: {
    description: "inspect local readiness without spending",
    options: [slug, { ...run, required: false }, json], exclusive: ["slug", "run"],
  },
  runs: {
    description: "list newest runs (limit 1-100, default 20)",
    options: [{ name: "limit", value: "n", validate: validateNumber }, json],
  },
  status: { description: "inspect one run without changing state", options: [run, json] },
  run: {
    description: "advance an existing run; consent covers every previewed group",
    options: [run, { name: "yes" }, json],
  },
  dashboard: {
    description: "serve a loopback-only read dashboard for selected repositories",
    options: [{ name: "repositories-file", value: "path", required: true }],
    acceptsRepo: false,
  },
};

export class UsageError extends Error {}

export interface CliArguments {
  command: string | null;
  args: ReadonlyMap<string, string>;
  flags: ReadonlySet<string>;
  repo: string | undefined;
  help: boolean;
}

function optionToken(token: string): { name: string; assigned: string | undefined } {
  if (!token.startsWith("--")) throw new UsageError(`unknown option ${token}`);
  const eq = token.indexOf("=");
  return eq < 0
    ? { name: token.slice(2), assigned: undefined }
    : { name: token.slice(2, eq), assigned: token.slice(eq + 1) };
}

function optionValue(argv: readonly string[], index: number, option: OptionDefinition): [string, number] {
  const { assigned } = optionToken(argv[index]);
  const value = assigned ?? argv[index + 1];
  if (value === undefined || value === "" || (assigned === undefined && value.startsWith("--"))) {
    const message = option.required || option.name === "expires"
      ? `missing required option --${option.name}`
      : `option --${option.name} was given without a value`;
    throw new UsageError(message);
  }
  return [value, assigned === undefined ? index + 1 : index];
}

function validateNumber(value: string, name: string): string | null {
  if (!/^\d+$/.test(value)) {
    return `--${name} must be a non-negative integer, got ${value}`;
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    return `--${name} must be a safe integer, got ${value}`;
  }
  if (name === "limit" && (number < 1 || number > 100)) {
    return "--limit must be between 1 and 100";
  }
  return null;
}

export function parseArguments(argv: readonly string[]): CliArguments {
  let repo: string | undefined;
  const remaining: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--repo" || argv[index].startsWith("--repo=")) {
      if (repo !== undefined) throw new UsageError("duplicate option --repo");
      [repo, index] = optionValue(argv, index, { name: "repo", value: "path" });
    } else {
      remaining.push(argv[index]);
    }
  }

  const first = remaining.shift();
  let command: string | null = null;
  let helpRequested = false;
  if (first === "help") {
    helpRequested = true;
    if (remaining[0] !== undefined && !remaining[0].startsWith("-")) command = remaining.shift()!;
  } else if (first !== undefined && !first.startsWith("-")) {
    command = first;
  } else if (first !== undefined) {
    remaining.unshift(first);
  }
  if (command !== null && !Object.hasOwn(COMMANDS, command)) {
    throw new UsageError(`unknown command ${command}`);
  }
  const definition = command === null ? null : COMMANDS[command];
  if (repo !== undefined && definition?.acceptsRepo === false) {
    throw new UsageError(`${command} does not accept --repo; use --repositories-file`);
  }
  const options = [...(definition?.options ?? []), help];
  const args = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < remaining.length; index++) {
    const token = remaining[index];
    if (!token.startsWith("-")) throw new UsageError(`unexpected argument ${token}`);
    const { name, assigned } = optionToken(token);
    const option = options.find((candidate) => candidate.name === name);
    if (!option) throw new UsageError(`unknown option --${name}`);
    if (args.has(name) || flags.has(name)) throw new UsageError(`duplicate option --${name}`);
    if (option.value === undefined) {
      if (assigned !== undefined) throw new UsageError(`--${name} must be a bare flag`);
      flags.add(name);
    } else {
      let value: string;
      [value, index] = optionValue(remaining, index, option);
      args.set(name, value);
    }
  }
  helpRequested ||= flags.has("help");
  if (command === null && !helpRequested) throw new UsageError("missing command");

  for (const option of options) {
    const value = args.get(option.name);
    if (value === undefined) continue;
    const reason = option.validate?.(value, option.name);
    if (reason) throw new UsageError(reason);
  }
  const exclusive = definition?.exclusive ?? [];
  if (exclusive.filter((name) => args.has(name)).length > 1) {
    throw new UsageError(`${exclusive.map((name) => `--${name}`).join(" and ")} are mutually exclusive`);
  }
  if (!helpRequested) {
    for (const option of options) {
      if (option.required && !args.has(option.name)) throw new UsageError(`missing required option --${option.name}`);
    }
    if (definition?.requireExclusive && !exclusive.some((name) => args.has(name))) {
      throw new UsageError(`missing required option ${exclusive.map((name) => `--${name}`).join(" or ")}`);
    }
  }
  return { command, args, flags, repo, help: helpRequested };
}

function synopsis(command: string): string {
  const definition = COMMANDS[command];
  return [command, ...definition.options.map((option) => {
    const value = option.value === undefined ? "" : ` <${option.value}>`;
    const text = `--${option.name}${value}`;
    return option.required ? text : `[${text}]`;
  })].join(" ");
}

export function formatHelp(command: string | null = null): string {
  const target = "  --repo <path>  existing local Git worktree; defaults to the invocation directory\n";
  const help = "  --help         show help without opening state";
  if (command !== null) {
    const definition = COMMANDS[command];
    return `usage: bw ${synopsis(command)}\n${definition.description}\n${definition.exclusive
      ? `Options ${definition.exclusive.map((name) => `--${name}`).join(" and ")} are mutually exclusive.\n` : ""}\nGlobal options:\n${definition.acceptsRepo === false ? help : target + help}\n`;
  }
  return `usage: bw <command> [options]\ncommands:\n${Object.entries(COMMANDS)
    .map(([name, definition]) => `  ${synopsis(name).padEnd(78)} ${definition.description}`)
    .join("\n")}\n  help [command]  show general or command-specific help\n\nGlobal options:\n${target}${help}\n`;
}
