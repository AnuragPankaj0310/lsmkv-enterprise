import { Bell, Settings, Activity, AlertCircle, RefreshCw, XCircle } from "lucide-react";
import { useCluster } from "../context/ClusterContext";

export default function Navbar() {
  const { nodes, partitions } = useCluster();

  let statusText = "Healthy";
  let statusColor = "text-green-400 bg-green-500/10";
  let StatusIcon = Activity;

  const hasUnreachable = nodes.some(n => n.state === "UNREACHABLE");
  const hasRebalancing = nodes.some(n => n.state === "REBALANCING");
  const hasSuspect = nodes.some(n => n.state === "SUSPECT") || partitions.length > 0;
  const hasRecovering = nodes.some(n => n.state === "RECOVERING");

  if (hasUnreachable) {
    statusText = "Failure";
    statusColor = "text-red-400 bg-red-500/10 border border-red-500/20";
    StatusIcon = XCircle;
  } else if (hasRebalancing) {
    statusText = "Rebalancing";
    statusColor = "text-orange-400 bg-orange-500/10 border border-orange-500/20";
    StatusIcon = RefreshCw;
  } else if (hasSuspect || hasRecovering) {
    statusText = "Degraded";
    statusColor = "text-yellow-400 bg-yellow-500/10 border border-yellow-500/20";
    StatusIcon = AlertCircle;
  }

  return (
    <header className="flex h-16 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-8">
      <div>
        <h1 className="text-2xl font-bold">LSMKV Enterprise</h1>
        <p className="text-sm text-zinc-500">
          Distributed Key-Value Store Control Plane
        </p>
      </div>

      <div className="flex items-center gap-6">
        <div className={`flex items-center gap-2 rounded-full px-3 py-1 transition-colors ${statusColor}`}>
          <StatusIcon size={16} className={hasRebalancing ? "animate-spin" : ""} />
          <span className="text-sm font-bold tracking-wide uppercase">{statusText}</span>
        </div>

        <Bell className="cursor-pointer text-zinc-400 hover:text-white transition" />
        <Settings className="cursor-pointer text-zinc-400 hover:text-white transition" />
      </div>
    </header>
  );
}