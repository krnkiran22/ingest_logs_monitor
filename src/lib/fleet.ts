import { readFile } from "node:fs/promises";
import path from "node:path";

export type MiniInventory = {
  name: string;
  user: string;
  host: string;
  ingest_ip: string;
  tailnet_host: string;
  station: number;
  server: string;
  nic_mac: string;
};

export type ServerInventory = {
  name: string;
  user: string;
  lan_host: string;
  tailnet_host: string;
  ingest_ip: string;
  station_ids: number[];
  link_gbps: number;
};

export type AggregatorInventory = {
  name: string;
  user: string;
  lan_host: string;
  tailnet_host: string;
  remote_dir: string;
};

export type FleetInventory = {
  cluster_id: string;
  api_url: string;
  gcs_bucket: string;
  gcs_project: string;
  aggregator: AggregatorInventory;
  minis: MiniInventory[];
  servers: ServerInventory[];
};

export type MachineKind = "mini" | "server" | "aggregator";

export type LogSource =
  | "agent.err"
  | "agent.log"
  | "agent_tail.err"
  | "nic.log"
  | "nic.err"
  | "transfers.csv"
  | "upload-daemon"
  | "aggregator";

export type MachineCatalogEntry = {
  kind: MachineKind;
  name: string;
  user: string;
  stationLabel: string;
  primaryHost: string;
  secondaryHost?: string;
  availableLogs: LogSource[];
  notes: string[];
};

const INVENTORY_PATH = path.resolve(process.cwd(), "..", "fleet", "inventory.json");

let inventoryPromise: Promise<FleetInventory> | null = null;

export async function getFleetInventory(): Promise<FleetInventory> {
  inventoryPromise ??= readFile(INVENTORY_PATH, "utf8").then(
    (raw) => JSON.parse(raw) as FleetInventory,
  );
  return inventoryPromise;
}

export async function getMachineCatalog(): Promise<MachineCatalogEntry[]> {
  const inventory = await getFleetInventory();

  const aggregator: MachineCatalogEntry = {
    kind: "aggregator",
    name: inventory.aggregator.name,
    user: inventory.aggregator.user,
    stationLabel: "Fleet-wide",
    primaryHost: inventory.aggregator.tailnet_host,
    secondaryHost: inventory.aggregator.lan_host,
    availableLogs: ["aggregator"],
    notes: [
      `Cluster ${inventory.cluster_id}`,
      "Status surface: /api/fleet-status and /api/server-status",
      "Service logs: journalctl -u aggregator",
    ],
  };

  const servers: MachineCatalogEntry[] = inventory.servers.map((server) => ({
    kind: "server",
    name: server.name,
    user: server.user,
    stationLabel: `Stations ${server.station_ids.join(", ")}`,
    primaryHost: server.tailnet_host,
    secondaryHost: server.lan_host,
    availableLogs: ["upload-daemon"],
    notes: [
      `Ingest IP ${server.ingest_ip}`,
      `Link ${server.link_gbps}G`,
      "Status surface: http://localhost:8090/api/status",
    ],
  }));

  const minis: MachineCatalogEntry[] = inventory.minis.map((mini) => ({
    kind: "mini",
    name: mini.name,
    user: mini.user,
    stationLabel: `Station ${mini.station}`,
    primaryHost: mini.tailnet_host,
    secondaryHost: mini.host,
    availableLogs: [
      "agent.err",
      "agent.log",
      "agent_tail.err",
      "nic.log",
      "nic.err",
      "transfers.csv",
    ],
    notes: [
      `Assigned server ${mini.server}`,
      `Ingest IP ${mini.ingest_ip}`,
      "Status surface: http://localhost:8080/api/status",
    ],
  }));

  return [aggregator, ...servers, ...minis];
}

export async function getMachineByName(name: string) {
  const machines = await getMachineCatalog();
  return machines.find((machine) => machine.name === name) ?? null;
}

export function getDefaultAggregatorUrl(inventory: FleetInventory) {
  return `http://${inventory.aggregator.lan_host}:8080`;
}
