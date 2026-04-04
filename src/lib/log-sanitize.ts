import type { MachineCatalogEntry, LogSource } from "@/lib/fleet";

const INCLUDE_PATTERNS = [
  /\berror\b/i,
  /\bwarn(?:ing)?\b/i,
  /\bfailed?\b/i,
  /\bretry\b/i,
  /\btimeout\b/i,
  /\bblocked?\b/i,
  /\baction[_ -]?required\b/i,
  /\brsync\b/i,
  /\btransfer(?:red|ring)?\b/i,
  /\bupload(?:ed|ing)?\b/i,
  /\bflush(?:ed|ing)?\b/i,
  /\bworker\b/i,
  /\bqueue\b/i,
  /\bmanifest\b/i,
  /\bmismatch\b/i,
  /\bcopy(?:ied|ing)?\b/i,
  /\bthroughput\b/i,
  /\bgbps\b/i,
  /\boffline\b/i,
  /\bonline\b/i,
  /\brestart(?:ed|ing)?\b/i,
  /\bclaim(?:ed|ing)?\b/i,
  /\bseal(?:ed|ing)?\b/i,
  /\bprocessing\b/i,
];

const EXCLUDE_PATTERNS = [
  /\bheartbeat\b/i,
  /\bkeepalive\b/i,
  /\bfleet config fetched\b/i,
  /\bactive factory\b/i,
  /\bGET \/api\//,
];

function compact(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  return String(value).trim();
}

function pushLine(lines: string[], value: string) {
  const line = value.trim();
  if (!line) {
    return;
  }
  if (!lines.includes(line)) {
    lines.push(line);
  }
}

function summarizeMiniStatus(payload: Record<string, unknown>) {
  const lines: string[] = [];
  const startup = (payload.startup as Record<string, unknown> | undefined) ?? {};
  const activeFactory =
    (payload.active_factory as Record<string, unknown> | undefined) ?? {};
  const stats = (payload.stats as Record<string, unknown> | undefined) ?? {};
  const hubs = (payload.hubs as Record<string, unknown> | undefined) ?? {};
  const activeTransfers = Number(stats.rsync_active ?? 0);
  const nicThroughput = Number(stats.nic_throughput_mbps ?? 0);
  const totalGb = compact(stats.total_gb);

  pushLine(
    lines,
    `Factory: ${compact(activeFactory.name) || "none"} (${compact(activeFactory.status) || "idle"})`,
  );
  pushLine(
    lines,
    `Transfer: inserted=${compact(stats.cards_inserted)} done=${compact(stats.cards_done)} errors=${compact(stats.cards_error)} active=${compact(stats.rsync_active)}`,
  );

  if (activeTransfers > 0 || nicThroughput > 0) {
    pushLine(
      lines,
      `Throughput: ${compact(stats.nic_throughput_mbps)} Mbps total=${totalGb || "0"} GB`,
    );
  } else if (totalGb && totalGb !== "0" && totalGb !== "0.0") {
    pushLine(lines, `Transferred total: ${totalGb} GB`);
  }

  if (startup.blocking) {
    pushLine(lines, `Startup blocking: ${compact(startup.summary) || "operator action required"}`);
  }

  for (const [hubName, portsValue] of Object.entries(hubs)) {
    const ports = (portsValue as Record<string, unknown> | undefined) ?? {};
    for (const [portName, portValue] of Object.entries(ports)) {
      const port = (portValue as Record<string, unknown> | undefined) ?? {};
      const state = compact(port.state).toLowerCase();
      const workerCode = compact(port.worker_code);
      const error = compact(port.error);
      const throughput = compact(port.throughput_mbps);
      const throughputValue = Number(port.throughput_mbps ?? 0);

      if (error) {
        pushLine(
          lines,
          `${hubName}/${portName}: ${workerCode || "worker unknown"} error=${error}`,
        );
        continue;
      }

      if (
        state.includes("rsync") ||
        state.includes("copy") ||
        state.includes("upload") ||
        state.includes("blocked") ||
        state.includes("error")
      ) {
        const parts = [
          `${hubName}/${portName}:`,
          workerCode || "worker unknown",
          `state=${state || "unknown"}`,
        ];
        if (throughputValue > 0) {
          parts.push(`throughput=${throughput || "0"} Mbps`);
        }
        pushLine(
          lines,
          parts.join(" "),
        );
      }
    }
  }

  return lines;
}

function summarizeServerStatus(payload: Record<string, unknown>) {
  const lines: string[] = [];
  const activeFactories = Array.isArray(payload.active_factories)
    ? (payload.active_factories as Array<Record<string, unknown>>)
    : [];

  pushLine(
    lines,
    `Uploads: active=${compact(payload.active_uploads)} queue=${compact(payload.queue_depth)} completed=${compact(payload.completed_uploads)} failed=${compact(payload.failed_uploads)}`,
  );
  pushLine(
    lines,
    `Workers: blocked=${compact(payload.blocked_workers)} action_required=${compact(payload.blocked_workers_action_required)} gateway=${payload.gateway_reachable === false ? "down" : "ok"}`,
  );

  const lastError = compact(payload.last_upload_error);
  if (lastError) {
    pushLine(lines, `Last upload error: ${lastError}`);
  }

  for (const factory of activeFactories.slice(0, 6)) {
    pushLine(
      lines,
      `Factory ${compact(factory.name)}: ready=${compact(factory.ready)} in_progress=${compact(factory.in_progress)} blocked=${compact(factory.blocked_action_required) || compact(factory.blocked)}`,
    );
  }

  return lines;
}

function summarizeAggregatorStatus(payload: Record<string, unknown>) {
  const lines: string[] = [];
  const health = (payload.health as Record<string, unknown> | undefined) ?? {};
  const fleetStatus =
    (payload.fleetStatus as Record<string, unknown> | undefined) ?? {};
  const serverStatus =
    (payload.serverStatus as Record<string, unknown> | undefined) ?? {};
  const minis = Array.isArray(fleetStatus.minis)
    ? (fleetStatus.minis as Array<Record<string, unknown>>)
    : [];
  const servers = Array.isArray(serverStatus.servers)
    ? (serverStatus.servers as Array<Record<string, unknown>>)
    : [];

  pushLine(
    lines,
    `Aggregator: ${compact(health.status) || "unknown"} minis_online=${compact(health.minis_online)}`,
  );
  pushLine(
    lines,
    `Fleet: inserted=${compact((fleetStatus.stats as Record<string, unknown> | undefined)?.cards_inserted)} done=${compact((fleetStatus.stats as Record<string, unknown> | undefined)?.cards_done)} errors=${compact((fleetStatus.stats as Record<string, unknown> | undefined)?.cards_error)} active_rsync=${compact((fleetStatus.stats as Record<string, unknown> | undefined)?.rsync_active)}`,
  );

  for (const mini of minis.filter((item) => item.online === false).slice(0, 8)) {
    pushLine(lines, `Mini offline: ${compact(mini.mini_id)}`);
  }

  for (const server of servers.filter((item) => item.online === false).slice(0, 4)) {
    pushLine(lines, `Server offline: ${compact(server.server_id) || compact(server.name)}`);
  }

  return lines;
}

function filterOperationalLines(output: string, source: LogSource) {
  const allLines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (source === "transfers.csv") {
    return allLines.slice(-40);
  }

  const filtered = allLines.filter((line) => {
    if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(line))) {
      return false;
    }
    return INCLUDE_PATTERNS.some((pattern) => pattern.test(line));
  });

  return (filtered.length ? filtered : allLines).slice(-80);
}

export function sanitizeLogOutput(
  machine: MachineCatalogEntry,
  source: LogSource,
  output: string,
) {
  const filtered = filterOperationalLines(output, source);

  if (filtered.length) {
    return filtered.join("\n");
  }

  return output.trim();
}

export function summarizeStatusPayload(
  machine: MachineCatalogEntry,
  payload: Record<string, unknown>,
) {
  const lines =
    machine.kind === "mini"
      ? summarizeMiniStatus(payload)
      : machine.kind === "server"
        ? summarizeServerStatus(payload)
        : summarizeAggregatorStatus(payload);

  return lines.length
    ? lines.join("\n")
    : JSON.stringify(payload, null, 2);
}
