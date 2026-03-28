"use client";

import {
  useCallback,
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
import type { MachineCatalogEntry, LogSource } from "@/lib/fleet";
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

const LOG_REFRESH_MS = 3000;
const OVERVIEW_REFRESH_MS = 15000;
const DIRECT_BASE_URL =
  process.env.NEXT_PUBLIC_INGEST_DIRECT_BASE_URL?.replace(/\/+$/, "") ?? "";

function isDirectBrowserMode() {
  return Boolean(DIRECT_BASE_URL);
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
  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : `${response.status} ${response.statusText}`,
    );
  }

  return payload ?? {};
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
      output: JSON.stringify(
        {
          health,
          fleetStatus,
          serverStatus,
        },
        null,
        2,
      ),
      fetchedAt: new Date().toISOString(),
      note:
        "Direct browser mode is active. This hosted view reads live status surfaces from the existing ingest backend instead of SSH logs.",
    };
  }

  const baseUrl = machineDirectBaseUrl(machine);
  const payload = await fetchJson(`${baseUrl}/api/status`);

  return {
    machine,
    source,
    resolvedSource: "status",
    command: `${baseUrl}/api/status`,
    output: JSON.stringify(payload, null, 2),
    fetchedAt: new Date().toISOString(),
    note:
      "Direct browser mode is active. This hosted view reads the machine status API exposed by the existing ingest services.",
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
  const [selectedMachineName, setSelectedMachineName] = useState(
    initialMachines[0]?.name ?? "",
  );
  const [selectedSource, setSelectedSource] = useState<LogSource>(
    isDirectBrowserMode() ? "status" : (initialMachines[0]?.availableLogs[0] ?? "aggregator"),
  );
  const [lineCount, setLineCount] = useState(160);
  const [logPayload, setLogPayload] = useState<LogPayload | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [followLog, setFollowLog] = useState(true);
  const logViewportRef = useRef<HTMLDivElement | null>(null);

  const selectedMachine =
    machines.find((machine) => machine.name === selectedMachineName) ?? machines[0];

  const visibleMachines = machines;

  useEffect(() => {
    if (!selectedMachine) {
      return;
    }

    if (!selectedMachine.availableLogs.includes(selectedSource)) {
      setSelectedSource(
        isDirectBrowserMode() && selectedMachine.availableLogs.includes("status")
          ? "status"
          : selectedMachine.availableLogs[0],
      );
    }
  }, [selectedMachine, selectedSource]);

  const refreshOverview = useCallback(async () => {
    try {
      const payload = isDirectBrowserMode()
        ? await fetchDirectOverview()
        : ((await (await fetch("/api/overview", { cache: "no-store" })).json()) as FleetOverview);
      startTransition(() => {
        setOverview(payload);
      });
    } catch {
      // Keep last good state.
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshOverview();
    }, OVERVIEW_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [refreshOverview]);

  const refreshLogs = useCallback(async (silent = false) => {
    if (!selectedMachine) {
      return;
    }

    if (!silent) {
      setLogLoading(true);
    }
    setLogError(null);

    try {
      const payload = isDirectBrowserMode()
        ? await fetchDirectLogPayload(selectedMachine, selectedSource)
        : await (async () => {
            const params = new URLSearchParams({
              machine: selectedMachine.name,
              source: selectedSource,
              lines: String(lineCount),
            });
            const response = await fetch(`/api/logs?${params.toString()}`, {
              cache: "no-store",
            });
            const payload = await response.json();

            if (!response.ok) {
              throw new Error(payload.error || "Failed to fetch logs");
            }

            return payload as LogPayload;
          })();

      startTransition(() => {
        setLogPayload(payload);
      });
    } catch (error) {
      startTransition(() => {
        setLogPayload(null);
        setLogError(error instanceof Error ? error.message : String(error));
      });
    } finally {
      if (!silent) {
        setLogLoading(false);
      }
    }
  }, [lineCount, selectedMachine, selectedSource]);

  useEffect(() => {
    void refreshLogs(false);
  }, [selectedMachine, selectedSource, lineCount, refreshLogs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshLogs(true);
    }, LOG_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [refreshLogs]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshOverview();
        void refreshLogs(true);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
    };
  }, [refreshLogs, refreshOverview]);

  useEffect(() => {
    if (!followLog || !logViewportRef.current) {
      return;
    }

    logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight;
  }, [followLog, logPayload?.output, logPayload?.fetchedAt]);

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

  const rawLines = (logError
    ? [`ERROR: ${logError}`]
    : (logPayload?.output || "No log output yet.").split(/\r?\n/)).filter(Boolean);
  const filteredLines = rawLines;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-[1720px] flex-col gap-6 px-4 py-6 md:px-8">
        <header className="rounded-[28px] border border-border bg-card px-5 py-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)] md:px-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Build AI
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] md:text-4xl">
                Ingest Monitor Dashboard
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Organized around the existing ingest backend surfaces only: aggregator state,
                upload-daemon status, and log files already present on the minis and servers.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
                value={String(overview.health?.status ?? "unknown")}
                tone={
                  String(overview.health?.status ?? "").toLowerCase() === "ok"
                    ? "success"
                    : "neutral"
                }
              />
            </div>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
          <aside className="rounded-[28px] border border-border bg-card p-4 shadow-[0_14px_40px_rgba(15,23,42,0.04)]">
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Machines
            </div>
            <div className="space-y-2">
              {visibleMachines.map((machine) => {
                const selected = machine.name === selectedMachine?.name;
                return (
                  <button
                    key={machine.name}
                    type="button"
                    onClick={() => setSelectedMachineName(machine.name)}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                      selected
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background hover:bg-secondary"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{machine.name}</div>
                        <div
                          className={`text-xs ${selected ? "text-white/70" : "text-muted-foreground"}`}
                        >
                          {machine.stationLabel}
                        </div>
                      </div>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${
                          selected ? "border-white/20 text-white/80" : "status-neutral"
                        }`}
                      >
                        {machine.kind}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="rounded-[28px] border border-border bg-card p-4 shadow-[0_14px_40px_rgba(15,23,42,0.04)] md:p-5">
            <div className="flex flex-col gap-4 border-b border-border pb-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Live log reader
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
                    {selectedMachine?.name}
                  </h2>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {selectedMachine?.primaryHost}
                    {selectedMachine?.secondaryHost ? ` · ${selectedMachine.secondaryHost}` : ""}
                  </div>
                  {isDirectBrowserMode() ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Browser-direct mode via {DIRECT_BASE_URL}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedMachine?.availableLogs.map((source) => (
                    <button
                      key={source}
                      type="button"
                      onClick={() => setSelectedSource(source)}
                      className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
                        selectedSource === source
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-background hover:bg-secondary"
                      }`}
                    >
                      {sourceLabels[source]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {selectedMachine?.notes.map((note) => (
                  <span
                    key={note}
                    className="rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground"
                  >
                    {note}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-[24px] border border-border bg-[#fafafa]">
              <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-sm font-semibold">
                      {sourceLabels[logPayload?.resolvedSource ?? selectedSource]}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {logPayload?.fetchedAt
                        ? `Fetched ${new Date(logPayload.fetchedAt).toLocaleString()}`
                        : "Waiting for data"}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setFollowLog((value) => !value)}
                      className={`rounded-full border px-3 py-2 text-xs font-medium ${
                        followLog
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-background text-muted-foreground"
                      }`}
                    >
                      {followLog ? "Follow log" : "Follow off"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void refreshLogs(false)}
                      className="rounded-full border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-secondary"
                    >
                      Refresh now
                    </button>
                    <select
                      value={lineCount}
                      onChange={(event) => setLineCount(Number(event.target.value))}
                      className="rounded-full border border-input bg-background px-3 py-2 text-xs"
                    >
                      <option value={160}>160 lines</option>
                      <option value={240}>240 lines</option>
                      <option value={320}>320 lines</option>
                      <option value={400}>400 lines</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border border-border bg-background px-3 py-1">
                    {filteredLines.length} lines
                  </span>
                  <span className="rounded-full border border-border bg-background px-3 py-1">
                    resolved: {logPayload?.resolvedSource ?? selectedSource}
                  </span>
                  <span className="rounded-full border border-border bg-background px-3 py-1">
                    updates every 3s
                  </span>
                  <span className="rounded-full border border-border bg-background px-3 py-1">
                    {logLoading ? "refreshing..." : "live"}
                  </span>
                  {isDirectBrowserMode() ? (
                    <span className="rounded-full border border-border bg-background px-3 py-1">
                      browser direct
                    </span>
                  ) : null}
                </div>
              </div>

              {logPayload?.note ? (
                <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                  {logPayload.note}
                </div>
              ) : null}

              <div
                ref={logViewportRef}
                className="max-h-[760px] overflow-auto px-2 py-2 font-mono text-[12px] leading-6"
              >
                {filteredLines.length ? (
                  filteredLines.map((line, index) => (
                    <div
                      key={`${logPayload?.fetchedAt ?? "initial"}-${index}-${line.slice(0, 32)}`}
                      className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-3 rounded-xl px-3 py-1.5 hover:bg-white"
                    >
                      <div className="select-none text-right text-[11px] text-muted-foreground">
                        {index + 1}
                      </div>
                      <div className="whitespace-pre-wrap break-words text-foreground">
                        {line}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-6 text-sm text-muted-foreground">
                    No lines match the current search.
                  </div>
                )}
              </div>
            </div>
          </section>

          <aside className="space-y-6">
            <section className="rounded-[28px] border border-border bg-card p-4 shadow-[0_14px_40px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Snapshot
                </div>
                <span className="rounded-full border status-info px-2 py-1 text-[11px]">
                  {overview.aggregatorUrl}
                </span>
              </div>
              <div className="mt-4 space-y-3">
                <JsonBlock label="Health" value={overview.health} />
                <JsonBlock
                  label="Fleet stats"
                  value={(overview.fleetStatus?.stats as Record<string, unknown>) ?? null}
                />
                <JsonBlock
                  label="Warnings"
                  value={overview.warnings.length ? overview.warnings : null}
                />
                <InfoBlock label="Mini logs" value="agent.err, agent.log, nic.log, nic.err" />
                <InfoBlock label="Extra files" value="agent_tail.err, transfers.csv" />
              </div>
            </section>
          </aside>
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
    <div className="rounded-2xl border border-border bg-background px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full border ${toneClass}`} />
        <span className="text-lg font-semibold tracking-[-0.02em]">{value}</span>
      </div>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-[12px] leading-5">{value}</div>
    </div>
  );
}

function JsonBlock({
  label,
  value,
}: {
  label: string;
  value: Record<string, unknown> | string[] | null;
}) {
  return (
    <div className="rounded-2xl border border-border bg-background px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-5">
        {value ? JSON.stringify(value, null, 2) : "None"}
      </pre>
    </div>
  );
}
