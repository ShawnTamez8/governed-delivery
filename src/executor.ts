export interface ExecutorDefinition {
  id: string;
  command: string[];
  probe: string[];
  capabilities: string[];
  telemetry: {
    perInvocationModel: boolean;
    effectiveModel: boolean;
    tokenUsage: boolean;
    sessionCost: boolean;
  };
  sandbox: {
    allowedPaths: string[];
    deniedPaths: string[];
    commandAllowlist: string[];
    idleTimeoutSeconds: number;
    absoluteTimeoutSeconds: number;
    envPassthrough: string[];
    network: "inherit";
  };
}

/**
 * The one executor, hardcoded rather than loaded from configuration: a
 * config loader for a single fixed definition would be an abstraction with
 * no second consumer yet (hard rule 4). The shape matches section 11's YAML
 * exactly, plus the absolute ceiling the same section requires as "a
 * multiple of the idle budget."
 *
 * The invocation is read-only: proposal subprocesses run in restricted/safe
 * mode with the inventory fixed to Read, Glob, and Grep (see
 * test/executor.test.ts for the flag semantics and hazard 11 for why
 * `--bare` is absent). A prompt is a request; enforcement is this command
 * plus the stage's clean-tree assertions.
 */
export const CLAUDE_CODE: ExecutorDefinition = {
  id: "claude-code",
  command: [
    "claude",
    "-p",
    "--output-format",
    "json",
    "--restricted",
    "--safe-mode",
    "--tools",
    "Read,Glob,Grep",
    "--disallowedTools",
    "Write,Edit,NotebookEdit,Bash,mcp__*",
    "--permission-mode",
    "dontAsk",
    "--strict-mcp-config",
    "--no-session-persistence",
  ],
  probe: ["claude", "--version"],
  capabilities: ["spec", "plan", "review", "implementation"],
  telemetry: {
    perInvocationModel: true,
    effectiveModel: true,
    tokenUsage: true,
    // The recorded real envelope (test/fixtures/harness/claude-code-envelope.json)
    // carries total_cost_usd, so this harness does report session cost.
    sessionCost: true,
  },
  sandbox: {
    allowedPaths: ["docs/features/**"],
    deniedPaths: [".governance/**"],
    commandAllowlist: [],
    idleTimeoutSeconds: 600,
    absoluteTimeoutSeconds: 3600,
    envPassthrough: ["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "SystemRoot"],
    network: "inherit",
  },
};
