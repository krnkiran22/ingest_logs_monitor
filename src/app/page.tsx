import { DashboardShell } from "@/components/dashboard-shell";
import { getMachineCatalog } from "@/lib/fleet";
import { getFleetOverview } from "@/lib/overview";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [initialMachines, initialOverview] = await Promise.all([
    getMachineCatalog(),
    getFleetOverview(),
  ]);

  return (
    <DashboardShell
      initialMachines={initialMachines}
      initialOverview={initialOverview}
    />
  );
}
