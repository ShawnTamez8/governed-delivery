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
 */
export const CLAUDE_CODE: ExecutorDefinition = {
  id: "claude-code",
  command: ["claude", "-p", "--output-format", "json"],
  probe: ["claude", "--version"],
  capabilities: ["plan", "review"],
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
