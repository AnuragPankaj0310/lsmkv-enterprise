/**
 * DashboardLayout — Root shell. Never unmounts during navigation.
 *
 * Hosts:
 *   1. useSyncEngine()         — 5-second cluster polling (always on)
 *   2. useLogGenerator()       — background log ticker (always on)
 *   3. BackgroundTasksWidget   — top-right fixed overlay (always visible)
 *   4. ToastContainer          — bottom-right completion toasts (always visible)
 */
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import { Outlet } from "react-router-dom";
import { useSyncEngine } from "../store/syncEngine";
import { useCluster } from "../context/ClusterContext";
import { useLogGenerator } from "../hooks/useLogGenerator";
import BackgroundTasksWidget from "../components/BackgroundTasksWidget";
import ToastContainer from "../components/ToastContainer";

export default function DashboardLayout() {
  // Global 5-second poll — runs for the lifetime of the app session
  useSyncEngine();

  // Global log generator — survives all page navigation
  // Passes live node names so log entries reference real nodes
  const { nodes } = useCluster();
  const nodeNames = nodes.map(n => n.name || `node${n.id}`);
  useLogGenerator(nodeNames);

  return (
    <div className="flex h-screen bg-zinc-950 text-white overflow-hidden">
      <Sidebar />

      <div className="flex flex-1 flex-col min-w-0">
        <Navbar />

        {/* Pages manage their own internal layout/scroll */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>

      {/* ── Persistent overlays — survive all navigation ── */}
      <BackgroundTasksWidget />
      <ToastContainer />
    </div>
  );
}