"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type { MachineCatalogEntry, LogSource } from "@/lib/fleet";
import { parseJsonResponse } from "@/lib/http";
import { summarizeStatusPayload } from "@/lib/log-sanitize";
import type { FleetOverview } from "@/lib/overview";

type LogPayload = {
  machine: MachineCatalogEntry;
  source: LogSource;
  resolvedSource: LogSource;
  command: string;
  output: string;
  fetchedAt: string;
  note?: string;
};

type MachineBoardItem = {
  machineName: string;
  status: "success" | "warning" | "error" | "neutral" | "info";
  headline: string;
  detail: string;
  loading: boolean;
};

type MachineHistoryItem = {
  machineName: string;
  source: LogSource;
  lines: string[];
  fetchedAt?: string;
  loading: boolean;
  error?: string;
};

const sourceLabels: Record<LogSource, string> = {
  status: "Live status",
  "agent.err": "Agent stderr",
  "agent.log": "Agent stdout",
  "agent_tail.err": "Agent tail stderr",
  "nic.log": "NIC stdout",
  "nic.err": "NIC stderr",
  "transfers.csv": "Transfers CSV",
  "upload-daemon": "Upload daemon journal",
  aggregator: "Aggregator journal",
};

const OVERVIEW_REFRESH_MS = 15000;
const LOG_REFRESH_MS = 3000;
const DIRECT_BASE_URL =
  process.env.NEXT_PUBLIC_INGEST_DIRECT_BASE_URL?.replace(/\/+$/, "") ?? "";

function isDirectBrowserMode() {
  return Boolean(DIRECT_BASE_URL);
}

function classifyLogLine(line: string) {
  if (/\b(error|failed|failure|blocked|action required|timeout|mismatch|invalid argument)\b/i.test(line)) {
    return "error";
  }
  if (/\b(warn|warning|retry|offline|degraded)\b/i.test(line)) {
    return "warning";
  }
  if (/\b(done|ok|online|uploaded|processed|completed|ready)\b/i.test(line)) {
    return "success";
  }
  return "neutral";
}

function deriveBoardStatus(lines: string[]) {
  let hasWarning = false;
  let hasSuccess = false;

  for (const line of lines) {
    const level = classifyLogLine(line);
    if (level === "error") {
      return "error" as const;
    }
    if (level === "warning") {
      hasWarning = true;
    }
    if (level === "success") {
      hasSuccess = true;
    }
  }

  if (hasWarning) {
    return "warning" as const;
  }
  if (hasSuccess) {
    return "success" as const;
  }
  return "neutral" as const;
}

function compactMetric(value: unknown, fallback = "0") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return String(value);
}

function getFleetStat(overview: FleetOverview, key: string) {
  const stats = (overview.fleetStatus?.stats as Record<string, unknown> | undefined) ?? {};
  return compactMetric(stats[key]);
}

function getHostLabel(url: string | null | undefined) {
  if (!url) {
    return "-";
  }

  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function machineDirectBaseUrl(machine: MachineCatalogEntry) {
  if (machine.kind === "aggregator") {
    return DIRECT_BASE_URL;
  }

  const port = machine.kind === "server" ? 8090 : 8080;
  return `http://${machine.primaryHost}:${port}`;
}

async function fetchJson(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  return parseJsonResponse<Record<string, unknown>>(
    response,
    `Received an empty response from ${url}.`,
  );
}

async function fetchDirectOverview() {
  if (!DIRECT_BASE_URL) {
    throw new Error("NEXT_PUBLIC_INGEST_DIRECT_BASE_URL is not configured.");
  }

  const [health, fleetStatus, serverStatus] = await Promise.all([
    fetchJson(`${DIRECT_BASE_URL}/api/health`).catch(() => null),
    fetchJson(`${DIRECT_BASE_URL}/api/fleet-status`).catch(() => null),
    fetchJson(`${DIRECT_BASE_URL}/api/server-status`).catch(() => null),
  ]);

  return {
    aggregatorUrl: DIRECT_BASE_URL,
    fetchedAt: new Date().toISOString(),
    health,
    fleetStatus,
    serverStatus,
    warnings: [],
  } satisfies FleetOverview;
}

async function fetchDirectLogPayload(
  machine: MachineCatalogEntry,
  source: LogSource,
): Promise<LogPayload> {
  if (machine.kind === "aggregator") {
    const [health, fleetStatus, serverStatus] = await Promise.all([
      fetchJson(`${DIRECT_BASE_URL}/api/health`).catch((error) => ({
        error: String(error),
      })),
      fetchJson(`${DIRECT_BASE_URL}/api/fleet-status`).catch((error) => ({
        error: String(error),
      })),
      fetchJson(`${DIRECT_BASE_URL}/api/server-status`).catch((error) => ({
        error: String(error),
      })),
    ]);

    return {
      machine,
      source,
      resolvedSource: "status",
      command: `${DIRECT_BASE_URL}/api/{health,fleet-status,server-status}`,
      output: summarizeStatusPayload(machine, {
        health,
        fleetStatus,
        serverStatus,
      }),
      fetchedAt: new Date().toISOString(),
      note:
        "Direct browser mode is active. Showing only operational summary lines from the existing ingest backend.",
    };
  }

  const baseUrl = machineDirectBaseUrl(machine);
  const payload = await fetchJson(`${baseUrl}/api/status`);

  return {
    machine,
    source,
    resolvedSource: "status",
    command: `${baseUrl}/api/status`,
    output: summarizeStatusPayload(machine, payload),
    fetchedAt: new Date().toISOString(),
    note:
      "Direct browser mode is active. Showing only operational summary lines from the machine status API.",
  };
}

function buildBoardItem(machine: MachineCatalogEntry, payload: LogPayload | null, error?: string) {
  if (error) {
    return {
      machineName: machine.name,
      status: "error" as const,
      headline: "Fetch failed",
      detail: error,
      loading: false,
    };
  }

  const lines = (payload?.output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const status = deriveBoardStatus(lines);
  const headline =
    lines.find((line) => classifyLogLine(line) === "error") ??
    lines.find((line) => classifyLogLine(line) === "warning") ??
    lines[0] ??
    "No current status";
  const detail =
    lines.find((line) => line !== headline) ??
    (machine.kind === "mini" ? "No active mini issues" : "No active server issues");

  return {
    machineName: machine.name,
    status,
    headline,
    detail,
    loading: false,
  };
}

function getDefaultHistorySource(machine: MachineCatalogEntry): LogSource {
  if (machine.kind === "aggregator") {
    return "aggregator";
  }
  if (machine.kind === "server") {
    return "upload-daemon";
  }
  return "agent.err";
}

function buildHistoryItem(machine: MachineCatalogEntry, payload: LogPayload | null, error?: string) {
  if (error) {
    return {
      machineName: machine.name,
      source: getDefaultHistorySource(machine),
      lines: [error],
      loading: false,
      error,
    };
  }

  const lines = (payload?.output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-12);

  return {
    machineName: machine.name,
    source: payload?.resolvedSource ?? getDefaultHistorySource(machine),
    lines: lines.length ? lines : ["No recent logs"],
    fetchedAt: payload?.fetchedAt,
    loading: false,
  };
}

export function DashboardShell({
  initialMachines,
  initialOverview,
}: {
  initialMachines: MachineCatalogEntry[];
  initialOverview: FleetOverview;
}) {
  const [machines] = useState(initialMachines);
  const [overview, setOverview] = useState(initialOverview);
  const [machineBoard, setMachineBoard] = useState<Record<string, MachineBoardItem>>({});
  const [machineHistory, setMachineHistory] = useState<Record<string, MachineHistoryItem>>({});

  const refreshOverview = useCallback(async () => {
    try {
      const payload = isDirectBrowserMode()
        ? await fetchDirectOverview()
        : await parseJsonResponse<FleetOverview>(
            await fetch("/api/overview", { cache: "no-store" }),
            "Overview response was empty.",
          );
      startTransition(() => {
        setOverview(payload);
      });
    } catch {
      // Keep last good state.
    }
  }, []);

  useEffect(() => {
    void refreshOverview();

    const timer = window.setInterval(() => {
      void refreshOverview();
    }, OVERVIEW_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [refreshOverview]);

  const refreshMachineBoard = useCallback(async () => {
    const targets = machines.filter((machine) => machine.availableLogs.includes("status"));

    startTransition(() => {
      setMachineBoard((current) => {
        const next = { ...current };
        for (const machine of targets) {
          next[machine.name] = current[machine.name] ?? {
            machineName: machine.name,
            status: "neutral",
            headline: "Loading status",
            detail: machine.stationLabel,
            loading: true,
          };
          next[machine.name] = { ...next[machine.name], loading: true };
        }
        return next;
      });
    });

    const updates = await Promise.all(
      targets.map(async (machine) => {
        try {
          const params = new URLSearchParams({
            machine: machine.name,
            source: "status",
            lines: "40",
          });
          const response = await fetch(`/api/logs?${params.toString()}`, {
            cache: "no-store",
          });
          const payload = await parseJsonResponse<LogPayload>(
            response,
            `Status response for ${machine.name} was empty.`,
          );

          return [machine.name, buildBoardItem(machine, payload)] as const;
        } catch (error) {
          return [
            machine.name,
            buildBoardItem(
              machine,
              null,
              error instanceof Error ? error.message : String(error),
            ),
          ] as const;
        }
      }),
    );

    startTransition(() => {
      setMachineBoard((current) => {
        const next = { ...current };
        for (const [machineName, item] of updates) {
          next[machineName] = item;
        }
        return next;
      });
    });
  }, [machines]);

  useEffect(() => {
    void refreshMachineBoard();

    const timer = window.setInterval(() => {
      void refreshMachineBoard();
    }, LOG_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [refreshMachineBoard]);

  const refreshMachineHistory = useCallback(async () => {
    startTransition(() => {
      setMachineHistory((current) => {
        const next = { ...current };
        for (const machine of machines) {
          next[machine.name] = current[machine.name] ?? {
            machineName: machine.name,
            source: getDefaultHistorySource(machine),
            lines: [],
            loading: true,
          };
          next[machine.name] = { ...next[machine.name], loading: true };
        }
        return next;
      });
    });

    const updates = await Promise.all(
      machines.map(async (machine) => {
        try {
          const defaultSource = getDefaultHistorySource(machine);

          const payload = isDirectBrowserMode()
            ? await fetchDirectLogPayload(machine, "status")
            : await (async () => {
                const params = new URLSearchParams({
                  machine: machine.name,
                  source: defaultSource,
                  lines: "24",
                });
                const response = await fetch(`/api/logs?${params.toString()}`, {
                  cache: "no-store",
                });
                return parseJsonResponse<LogPayload>(
                  response,
                  `Log response for ${machine.name} was empty.`,
                );
              })();

          return [machine.name, buildHistoryItem(machine, payload)] as const;
        } catch (error) {
          return [
            machine.name,
            buildHistoryItem(
              machine,
              null,
              error instanceof Error ? error.message : String(error),
            ),
          ] as const;
        }
      }),
    );

    startTransition(() => {
      setMachineHistory((current) => {
        const next = { ...current };
        for (const [machineName, item] of updates) {
          next[machineName] = item;
        }
        return next;
      });
    });
  }, [machines]);

  useEffect(() => {
    void refreshMachineHistory();

    const timer = window.setInterval(() => {
      void refreshMachineHistory();
    }, LOG_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [refreshMachineHistory]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshOverview();
        void refreshMachineBoard();
        void refreshMachineHistory();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
    };
  }, [refreshMachineBoard, refreshMachineHistory, refreshOverview]);

  const minis = Array.isArray(overview.fleetStatus?.minis)
    ? (overview.fleetStatus.minis as Array<{ online?: boolean }>)
    : [];
  const servers = Array.isArray(overview.serverStatus?.servers)
    ? (overview.serverStatus.servers as Array<{ online?: boolean }>)
    : [];
  const totalMiniCount =
    minis.length || machines.filter((machine) => machine.kind === "mini").length;
  const totalServerCount =
    servers.length || machines.filter((machine) => machine.kind === "server").length;
  const minisOnline = minis.filter((machine) => Boolean(machine.online)).length;
  const serversOnline = servers.filter((machine) => Boolean(machine.online)).length;
  const aggregatorStatus = String(overview.health?.status ?? "unknown");
  const statusTone =
    aggregatorStatus.toLowerCase() === "ok"
      ? "success"
      : overview.warnings.length > 0
        ? "warning"
        : "neutral";
  const snapshotRows = [
    { label: "Inserted", value: getFleetStat(overview, "cards_inserted") },
    { label: "Done", value: getFleetStat(overview, "cards_done") },
    { label: "Errors", value: getFleetStat(overview, "cards_error") },
    { label: "Copying", value: getFleetStat(overview, "rsync_active") },
  ];
  const aggregatorMachine = machines.find((machine) => machine.kind === "aggregator");

  return (
    <main className="min-h-screen text-foreground">
      <div className="mx-auto max-w-[1760px] px-4 py-4 md:px-6">
        <header className="rounded-[28px] border border-white/80 bg-white/92 px-5 py-4 shadow-[0_18px_60px_rgba(15,23,42,0.06)] backdrop-blur md:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Build AI Ingest
              </div>
              <h1 className="font-display mt-1 text-[2rem] font-semibold tracking-[-0.04em] md:text-[2.35rem]">
                Fleet Logs
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Aggregator, servers, and all 11 Mac minis on one page with recent logs visible directly.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <MetricCard
                label="Minis online"
                value={`${minisOnline}/${totalMiniCount}`}
                tone={minisOnline > 0 ? "success" : "warning"}
              />
              <MetricCard
                label="Servers online"
                value={`${serversOnline}/${totalServerCount}`}
                tone={serversOnline > 0 ? "info" : "warning"}
              />
              <MetricCard
                label="Warnings"
                value={String(overview.warnings.length)}
                tone={overview.warnings.length > 0 ? "warning" : "success"}
              />
              <MetricCard
                label="Aggregator"
                value={aggregatorStatus}
                tone={statusTone}
              />
            </div>
          </div>
        </header>

        <section className="mt-4 space-y-4">
          <section className="rounded-[28px] border border-white/80 bg-white/95 p-4 shadow-[0_16px_48px_rgba(15,23,42,0.06)] backdrop-blur md:p-5">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {snapshotRows.map((item) => (
                <CompactStat key={item.label} label={item.label} value={item.value} />
              ))}
            </div>
            {overview.warnings.length ? (
              <div className="mt-3 space-y-2">
                {overview.warnings.map((warning) => (
                  <div
                    key={warning}
                    className="rounded-2xl border border-[color:var(--warning)] bg-[color:var(--warning-muted)] px-3 py-2 text-sm text-[color:var(--warning-foreground)]"
                  >
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <FleetSection
            title="Mac Minis"
            countLabel={`${machines.filter((machine) => machine.kind === "mini").length} total`}
            cards={machines
              .filter((machine) => machine.kind === "mini")
              .map((machine) => ({
                machine,
                item: machineBoard[machine.name],
                history: machineHistory[machine.name],
              }))}
          />

          <FleetSection
            title="Servers"
            countLabel={`${machines.filter((machine) => machine.kind === "server").length} total`}
            cards={machines
              .filter((machine) => machine.kind === "server")
              .map((machine) => ({
                machine,
                item: machineBoard[machine.name],
                history: machineHistory[machine.name],
              }))}
          />

          {aggregatorMachine ? (
            <FleetSection
              title="Aggregator"
              countLabel={getHostLabel(overview.aggregatorUrl)}
              cards={[
                {
                  machine: aggregatorMachine,
                  item: {
                    machineName: aggregatorMachine.name,
                    status: statusTone,
                    headline: `Aggregator ${aggregatorStatus}`,
                    detail: overview.warnings[0] || "Fleet-wide monitor",
                    loading: false,
                  },
                  history: machineHistory[aggregatorMachine.name],
                },
              ]}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "info" | "neutral";
}) {
  const toneClass =
    tone === "success"
      ? "status-success"
      : tone === "warning"
        ? "status-warning"
        : tone === "info"
          ? "status-info"
          : "status-neutral";

  return (
    <div className="rounded-[22px] border border-border bg-white px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full border ${toneClass}`} />
        <span className="font-display text-lg font-semibold tracking-[-0.03em]">{value}</span>
      </div>
    </div>
  );
}

function FleetSection({
  title,
  countLabel,
  cards,
}: {
  title: string;
  countLabel: string;
  cards: Array<{ machine: MachineCatalogEntry; item?: MachineBoardItem; history?: MachineHistoryItem }>;
}) {
  return (
    <section className="rounded-[28px] border border-white/80 bg-white/95 p-4 shadow-[0_16px_48px_rgba(15,23,42,0.06)] backdrop-blur md:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </div>
        <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
          {countLabel}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {cards.map(({ machine, item, history }) => (
          <BoardCard
            key={machine.name}
            machine={machine}
            item={item}
            history={history}
          />
        ))}
      </div>
    </section>
  );
}

function BoardCard({
  machine,
  item,
  history,
}: {
  machine: MachineCatalogEntry;
  item?: MachineBoardItem;
  history?: MachineHistoryItem;
}) {
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const toneClass =
    item?.status === "error"
      ? "status-error"
      : item?.status === "warning"
        ? "status-warning"
        : item?.status === "success"
          ? "status-success"
          : item?.status === "info"
            ? "status-info"
            : "status-neutral";

  const lines = history?.lines.length ? history.lines : ["Loading recent logs…"];
  const logLineCount = history?.lines.length ?? 0;

  useEffect(() => {
    const container = logContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [history?.fetchedAt, logLineCount]);

  return (
    <div className="w-full rounded-[22px] border border-border bg-white px-3 py-3 text-left">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-[-0.02em]">{machine.name}</div>
          <div className="text-xs text-muted-foreground">{machine.stationLabel}</div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${toneClass}`}>
          {machine.kind}
        </span>
      </div>
      <div className="mt-3 text-sm font-medium text-foreground">
        {item?.headline || "Loading status"}
      </div>
      <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
        {item?.loading ? "Refreshing machine status…" : item?.detail || "No active issues"}
      </div>
      <div className="mt-3 rounded-[18px] border border-border bg-[linear-gradient(180deg,#fbfbfd_0%,#f7f7f8_100%)] px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {sourceLabels[history?.source ?? getDefaultHistorySource(machine)]}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {history?.fetchedAt ? new Date(history.fetchedAt).toLocaleTimeString() : ""}
          </div>
        </div>
        <div
          ref={logContainerRef}
          className="max-h-48 space-y-1 overflow-y-auto pr-1 font-mono text-[11px] leading-5"
        >
          {lines.map((line, index) => (
            <div
              key={`${machine.name}-${index}-${line.slice(0, 24)}`}
              className={`rounded-xl border px-2 py-1 ${
                classifyLogLine(line) === "error"
                  ? "border-[color:var(--error)] bg-[color:var(--error-muted)] text-[color:var(--error-foreground)]"
                  : classifyLogLine(line) === "warning"
                    ? "border-[color:var(--warning)] bg-[color:var(--warning-muted)] text-[color:var(--warning-foreground)]"
                    : classifyLogLine(line) === "success"
                      ? "border-[color:var(--success)] bg-[color:var(--success-muted)] text-[color:var(--success-foreground)]"
                      : "border-white bg-white text-foreground"
              }`}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-border bg-background px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="font-display mt-1 text-xl font-semibold tracking-[-0.03em]">{value}</div>
    </div>
  );
}
