import { z } from "zod";

export const SUPPORTED_AGENTS = ["claude", "codex", "aider", "copilot"] as const;

export const AgentSchema = z.enum(SUPPORTED_AGENTS);

export const TmuxPanePlacementSchema = z.enum(["default", "rightColumnPairs"]);

export const ConfigSchema = z.object({
  defaultAgent: AgentSchema.default("claude"),
  worktreeRoot: z.string().default(".workforge/worktrees"),
  tmuxSessionPrefix: z.string().default("workforge"),
  keepPaneOnDone: z.boolean().default(true),
  tmuxPanePlacement: TmuxPanePlacementSchema.default("rightColumnPairs")
});

export const TmuxLayoutSchema = z.object({
  windows: z.record(z.object({
    anchorPaneId: z.string(),
    pendingTopPaneId: z.string().optional()
  })).default({})
});

export const TaskStatusSchema = z.enum(["created", "running", "stopped", "review", "deleted"]);

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  slug: z.string(),
  branch: z.string(),
  baseBranch: z.string(),
  worktreePath: z.string(),
  status: TaskStatusSchema,
  agent: AgentSchema.optional(),
  tmuxSession: z.string().optional(),
  tmuxWindow: z.string().optional(),
  tmuxTargetType: z.enum(["session", "window", "pane"]).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const TasksSchema = z.object({
  tasks: z.array(TaskSchema)
});
