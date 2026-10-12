export interface DailyUsage {
  date: string;
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

export async function fetchClaudeCodeUsage(): Promise<ClaudeCodeUsage> {
  const res = await fetch("/api/claude-code");
  if (!res.ok) throw new Error(`Failed to load Claude Code usage: ${res.status}`);
  return res.json();
}

export async function fetchApiUsageData(): Promise<ApiUsage> {
  const res = await fetch("/api/api-usage");
  if (!res.ok) throw new Error(`Failed to load API usage: ${res.status}`);
  return res.json();
}
