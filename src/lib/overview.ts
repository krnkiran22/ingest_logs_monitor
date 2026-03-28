import { getEnv } from "@/lib/env";
import { getDefaultAggregatorUrl, getFleetInventory } from "@/lib/fleet";

export type FleetOverview = {
  aggregatorUrl: string;
  fetchedAt: string;
  health: Record<string, unknown> | null;
  fleetStatus: Record<string, unknown> | null;
  serverStatus: Record<string, unknown> | null;
  warnings: string[];
};

async function fetchJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

export async function getFleetOverview(): Promise<FleetOverview> {
  const inventory = await getFleetInventory();
  const aggregatorUrl = getEnv("INGEST_AGGREGATOR_URL") || getDefaultAggregatorUrl(inventory);
  const warnings: string[] = [];

  const [health, fleetStatus, serverStatus] = await Promise.all([
    fetchJson(`${aggregatorUrl}/api/health`).catch((error) => {
      warnings.push(`Aggregator health failed: ${String(error)}`);
      return null;
    }),
    fetchJson(`${aggregatorUrl}/api/fleet-status`).catch((error) => {
      warnings.push(`Fleet status failed: ${String(error)}`);
      return null;
    }),
    fetchJson(`${aggregatorUrl}/api/server-status`).catch((error) => {
      warnings.push(`Server status failed: ${String(error)}`);
      return null;
    }),
  ]);

  return {
    aggregatorUrl,
    fetchedAt: new Date().toISOString(),
    health,
    fleetStatus,
    serverStatus,
    warnings,
  };
}
