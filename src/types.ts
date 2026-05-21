import type { z } from "zod";

import type { AgentSchema } from "./schemas.js";

export type AgentName = z.infer<typeof AgentSchema>;
export type TmuxPanePlacement = "default" | "rightColumnPairs";
export type TmuxShellMode = "loginInteractive" | "direct";
export type TaskStatus = "created" | "running" | "stopped" | "review" | "deleted";
export type TmuxTargetType = "session" | "window" | "pane";

export interface Config {
  defaultAgent: AgentName;
  worktreeRoot: string;
  tmuxSessionPrefix: string;
  keepPaneOnDone: boolean;
  tmuxPanePlacement: TmuxPanePlacement;
  tmuxShellMode: TmuxShellMode;
}

export interface TmuxLayout {
  windows: Record<string, {
    anchorPaneId: string;
    pendingTopPaneId?: string;
  }>;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  slug: string;
  branch: string;
  baseBranch: string;
  worktreePath: string;
  status: TaskStatus;
  agent?: AgentName;
  tmuxSession?: string;
  tmuxWindow?: string;
  tmuxTargetType?: TmuxTargetType;
  createdAt: string;
  updatedAt: string;
}

export interface TasksFile {
  tasks: Task[];
}

export interface RepoContext {
  root: string;
  workforgeDir: string;
}

export interface AgentAdapter {
  name: AgentName;
  command: string;
  args: string[];
}

export interface CreateInput {
  title: string;
  description?: string;
}
