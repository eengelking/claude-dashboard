export interface DailyUsage {
  date: string; // YYYY-MM-DD
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface ProjectUsage {
  project: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface UsageRollup {
  totalTokens: number;
}

/** Whether the server can see Claude Code's log folder, and if not, why. */
export interface LogsStatus {
  available: boolean;
  dir: string;
  reason?: string;
}

export interface ClaudeCodeUsage {
  logs: LogsStatus;
  daily: DailyUsage[];
  byModel: ModelUsage[];
  byProject: ProjectUsage[];
  today: UsageRollup;
  week: UsageRollup;
  month: UsageRollup;
}

export interface ApiDailyUsage {
  date: string;
  totalTokens: number;
  costUsd: number;
}

export interface ApiModelUsage {
  model: string;
  totalTokens: number;
  costUsd: number;
}

export interface ApiUsageRollup {
  totalTokens: number;
  costUsd: number;
}

export interface ApiUsage {
  configured: boolean;
  daily: ApiDailyUsage[];
  byModel: ApiModelUsage[];
  today: ApiUsageRollup;
  week: ApiUsageRollup;
  month: ApiUsageRollup;
}
