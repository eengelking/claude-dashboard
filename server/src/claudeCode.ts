import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ClaudeCodeUsage, DailyUsage, LogsStatus, ModelUsage, ProjectUsage } from "./types.js";

export const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

interface RawUsageEvent {
  date: string;
  model: string;
  project: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

async function findJsonlFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findJsonlFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseLine(line: string): RawUsageEvent | null {
  if (!line.trim()) return null;
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  const usage = obj?.message?.usage;
  const model = obj?.message?.model;
  const timestamp = obj?.timestamp;
  const cwd = obj?.cwd;
  if (!usage || typeof model !== "string" || typeof timestamp !== "string" || typeof cwd !== "string") {
    return null;
  }
  return {
    date: timestamp.slice(0, 10),
    model,
    project: path.basename(cwd) || cwd,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  };
}

async function readEvents(filePath: string): Promise<RawUsageEvent[]> {
  const content = await readFile(filePath, "utf-8");
  const events: RawUsageEvent[] = [];
  for (const line of content.split("\n")) {
    const event = parseLine(line);
    if (event) events.push(event);
  }
  return events;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function emptyUsageRow(): { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number } {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
}

function addEvent(
  row: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number },
  event: RawUsageEvent,
): void {
  row.inputTokens += event.inputTokens;
  row.outputTokens += event.outputTokens;
  row.cacheCreationTokens += event.cacheCreationTokens;
  row.cacheReadTokens += event.cacheReadTokens;
}

function total(row: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }): number {
  return row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens;
}

/** Check that the log folder can be listed, and say why if it cannot. */
async function checkLogs(dir: string): Promise<LogsStatus> {
  try {
    await readdir(dir);
    return { available: true, dir };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const reason =
      code === "ENOENT"
        ? "Folder not found."
        : code === "ENOTDIR"
          ? "Not a folder."
          : code === "EACCES" || code === "EPERM"
            ? "Permission denied."
            : `Cannot be read (${code ?? "unknown error"}).`;
    return { available: false, dir, reason };
  }
}

export async function scanClaudeCodeUsage(
  projectsDir: string = DEFAULT_PROJECTS_DIR,
  now: Date = new Date(),
): Promise<ClaudeCodeUsage> {
  const logs = await checkLogs(projectsDir);
  const files = await findJsonlFiles(projectsDir);
  const allEvents: RawUsageEvent[] = [];
  for (const file of files) {
    allEvents.push(...(await readEvents(file)));
  }

  const dailyMap = new Map<string, DailyUsage>();
  const modelMap = new Map<string, ModelUsage>();
  const projectMap = new Map<string, ProjectUsage>();

  const todayStr = isoDate(now);
  const weekStartStr = isoDate(startOfWeek(now));
  const monthStartStr = isoDate(startOfMonth(now));

  let todayTokens = 0;
  let weekTokens = 0;
  let monthTokens = 0;

  for (const event of allEvents) {
    const daily = dailyMap.get(event.date) ?? { date: event.date, ...emptyUsageRow() };
    addEvent(daily, event);
    dailyMap.set(event.date, daily);

    const model = modelMap.get(event.model) ?? { model: event.model, ...emptyUsageRow() };
    addEvent(model, event);
    modelMap.set(event.model, model);

    const project = projectMap.get(event.project) ?? { project: event.project, ...emptyUsageRow() };
    addEvent(project, event);
    projectMap.set(event.project, project);

    const eventTotal = total(event);
    if (event.date === todayStr) todayTokens += eventTotal;
    if (event.date >= weekStartStr) weekTokens += eventTotal;
    if (event.date >= monthStartStr) monthTokens += eventTotal;
  }

  const byTotalDesc = (a: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }, b: typeof a) =>
    total(b) - total(a);

  return {
    logs,
    daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byModel: [...modelMap.values()].sort(byTotalDesc),
    byProject: [...projectMap.values()].sort(byTotalDesc),
    today: { totalTokens: todayTokens },
    week: { totalTokens: weekTokens },
    month: { totalTokens: monthTokens },
  };
}
