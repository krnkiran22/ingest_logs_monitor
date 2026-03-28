import { DashboardShell } from "@/components/dashboard-shell";
import { getMachineCatalog } from "@/lib/fleet";
import type { FleetOverview } from "@/lib/overview";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initialMachines = await getMachineCatalog();
  const initialOverview: FleetOverview = {
    aggregatorUrl: "",
    fetchedAt: new Date().toISOString(),
    health: null,
    fleetStatus: null,
    serverStatus: null,
    warnings: [],
  };

  return (
    <DashboardShell
      initialMachines={initialMachines}
      initialOverview={initialOverview}
    />
  );
}
