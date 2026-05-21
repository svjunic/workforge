import { AgentSchema, SUPPORTED_AGENTS } from "./schemas.js";
import { shellQuote } from "./system.js";
import type { AgentAdapter, AgentName, Config, Task } from "./types.js";
import { CliError } from "./errors.js";

const adapters: Record<AgentName, AgentAdapter> = {
  claude: { name: "claude", command: "claude", args: [] },
  codex: { name: "codex", command: "codex", args: [] },
  aider: { name: "aider", command: "aider", args: [] }
};

export function formatSupportedAgents(): string {
  return SUPPORTED_AGENTS.join(", ");
}

export function resolveAgent(agentOption: string | undefined, config: Config): AgentName {
  if (!agentOption) return config.defaultAgent;
  const parsed = AgentSchema.safeParse(agentOption);
  if (!parsed.success) throw new CliError(`未対応のエージェントです: ${agentOption}。${formatSupportedAgents()} のいずれかを指定してください。`);
  return parsed.data;
}

export function buildAgentAdapter(agent: AgentName, isResume: boolean): AgentAdapter {
  const adapter = adapters[agent];
  switch (agent) {
    case "claude":
      return {
        ...adapter,
        args: ["--permission-mode", isResume ? "auto" : "plan", ...adapter.args]
      };
    case "aider":
      return {
        ...adapter,
        args: ["--architect", ...adapter.args]
      };
    default:
      return adapter;
  }
}

export function buildAgentPrompt(task: Task, isResume: boolean): string {
  const lines = [
    `WorkForge タスク ${task.id} を${isResume ? "再開" : "実装"}してください: ${task.title}`,
    "",
    "この git worktree の中だけで作業してください。main の worktree は変更しないでください。",
    "実装から検証まで完了させてください。"
  ];
  if (task.description) lines.splice(2, 0, task.description, "");
  return lines.join("\n");
}

export function buildTmuxShellCommand(adapter: AgentAdapter, prompt: string, logPath: string, keepPaneOnDone: boolean): string {
  const command = [adapter.command, ...adapter.args, prompt].map(shellQuote).join(" ");
  const logCommand = `tmux pipe-pane -o ${shellQuote(`cat >> ${logPath}`)}`;
  const suffix = keepPaneOnDone ? "; printf '\\n[workforge] プロセスが終了しました。この tmux pane/session を閉じるには Ctrl-D を押してください。\\n'; exec $SHELL" : "";
  return `${logCommand}; ${command}${suffix}`;
}
