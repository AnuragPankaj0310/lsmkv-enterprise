import { NavLink } from "react-router-dom";

import {
  LayoutDashboard,
  Server,
  Network,
  HardDrive,
  ShieldCheck,
  BarChart3,
  Camera,
  ScrollText,
} from "lucide-react";

const menuItems = [
  { name: "Dashboard",   path: "/",            icon: LayoutDashboard },
  { name: "Cluster",     path: "/cluster",     icon: Server },
  { name: "Hash Ring",   path: "/ring",        icon: Network },
  { name: "Storage",     path: "/storage",     icon: HardDrive },
  { name: "Replication", path: "/replication", icon: ShieldCheck },
  { name: "Metrics",     path: "/metrics",     icon: BarChart3 },
  { name: "Logs",        path: "/logs",        icon: ScrollText },
  { name: "Snapshots",   path: "/snapshots",   icon: Camera },
];

export default function Sidebar() {
  return (
    <aside className="w-56 border-r border-zinc-800 bg-zinc-950 flex flex-col">
      {/* Brand */}
      <div className="px-6 py-5 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-blue-600 flex items-center justify-center">
            <span className="text-[11px] font-black text-white">KV</span>
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-none">LSMKV</h1>
            <p className="text-[10px] text-zinc-500 mt-0.5">Distributed Store</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {menuItems.map(({ name, path, icon: Icon }) => (
          <NavLink
            key={name}
            to={path}
            end={path === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-150 ${
                isActive
                  ? "bg-blue-600/20 text-blue-400 border border-blue-600/30 font-semibold"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`
            }
          >
            <Icon size={16} />
            <span>{name}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-zinc-800">
        <p className="text-[10px] text-zinc-600">LSM-Tree Key-Value Store</p>
        <p className="text-[10px] text-zinc-700">Prometheus · WebSocket · Raft</p>
      </div>
    </aside>
  );
}