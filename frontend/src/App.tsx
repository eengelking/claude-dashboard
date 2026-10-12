import { usePolling } from "./hooks/usePolling";
import { fetchClaudeCodeUsage, fetchApiUsageData } from "./api";
import { StatTile } from "./components/StatTile";
import { TimeSeriesChart } from "./components/TimeSeriesChart";
import { HorizontalBarChart } from "./components/HorizontalBarChart";
import { formatTokens, formatUsd } from "./format";

const CLAUDE_CODE_POLL_MS = 60_000;
const API_USAGE_POLL_MS = 60_000;

function tokenTotal(row: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }): number {
  return row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens;
}

export default function App() {
  const claudeCode = usePolling(fetchClaudeCodeUsage, CLAUDE_CODE_POLL_MS);
  const apiUsage = usePolling(fetchApiUsageData, API_USAGE_POLL_MS);

  const claudeCodeTokenSeries = (claudeCode.data?.daily ?? []).map((d) => ({
    date: d.date,
    value: tokenTotal(d),
  }));

  const apiCostSeries = (apiUsage.data?.daily ?? []).map((d) => ({
    date: d.date,
    value: d.costUsd,
  }));

  const modelTokenData = (claudeCode.data?.byModel ?? []).map((m) => ({
    label: m.model,
    value: tokenTotal(m),
  }));

  const apiModelCostData = (apiUsage.data?.byModel ?? []).map((m) => ({
    label: m.model,
    value: m.costUsd,
  }));

  const projectData = (claudeCode.data?.byProject ?? []).map((p) => ({
    label: p.project,
    value: tokenTotal(p),
  }));

  const apiConfigured = apiUsage.data?.configured ?? true;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Claude Usage Dashboard</h1>
      </header>

      {claudeCode.data && !claudeCode.data.logs.available && (
        <div className="logs-notice" role="status">
          <p>
            Podium can&apos;t see any Claude Code logs, so the Claude Code figures below are missing, not zero.{" "}
            {claudeCode.data.logs.reason} It looked in <code>{claudeCode.data.logs.dir}</code>.
          </p>
          <p>
            In container mode, mount your logs read-only: run <code>podiumctl config set PODIUMCTL_MOUNT_LOGS=1</code>, then{" "}
            <code>podiumctl restart</code>. Standalone mode reads them directly.
          </p>
        </div>
      )}

      <section className="stat-row">
        <StatTile label="Today — Claude Code" primaryValue={formatTokens(claudeCode.data?.today.totalTokens ?? 0)} secondaryValue="tokens" />
        <StatTile
          label="Today — API spend"
          primaryValue={apiConfigured ? formatUsd(apiUsage.data?.today.costUsd ?? 0) : "—"}
          secondaryValue={apiConfigured ? undefined : "Admin API key not configured"}
        />
        <StatTile label="This week — Claude Code" primaryValue={formatTokens(claudeCode.data?.week.totalTokens ?? 0)} secondaryValue="tokens" />
        <StatTile label="This week — API spend" primaryValue={apiConfigured ? formatUsd(apiUsage.data?.week.costUsd ?? 0) : "—"} />
        <StatTile label="This month — Claude Code" primaryValue={formatTokens(claudeCode.data?.month.totalTokens ?? 0)} secondaryValue="tokens" />
        <StatTile label="This month — API spend" primaryValue={apiConfigured ? formatUsd(apiUsage.data?.month.costUsd ?? 0) : "—"} />
      </section>

      <section className="chart-row">
        <TimeSeriesChart
          title="Claude Code tokens/day (last 30 days)"
          data={claudeCodeTokenSeries}
          color="var(--series-1)"
          valueFormatter={formatTokens}
        />
        <TimeSeriesChart title="API spend/day (last 30 days)" data={apiCostSeries} color="var(--series-2)" valueFormatter={formatUsd} />
      </section>

      <section className="chart-row">
        <HorizontalBarChart title="Claude Code tokens by model" data={modelTokenData} valueFormatter={formatTokens} />
        <HorizontalBarChart title="API spend by model" data={apiModelCostData} valueFormatter={formatUsd} />
      </section>

      <section className="chart-row">
        <HorizontalBarChart title="Claude Code tokens by project" data={projectData} valueFormatter={formatTokens} />
      </section>

      {claudeCode.error && <p className="error-banner">Claude Code data error: {claudeCode.error}</p>}
      {apiUsage.error && <p className="error-banner">API usage data error: {apiUsage.error}</p>}
    </div>
  );
}
