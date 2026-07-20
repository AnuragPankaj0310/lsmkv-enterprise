/**
 * NodeDistribution — shows per-node key counts as horizontal bars.
 * Belongs in components/rebalancing/ per folder structure.
 */
interface NodeDist {
  id: number;
  name: string;
  hex: string;
  keys: number;
}

interface NodeDistributionProps {
  nodes: NodeDist[];
  totalKeys: number;
}

export function NodeDistribution({ nodes, totalKeys }: NodeDistributionProps) {
  return (
    <div className="rounded-xl bg-zinc-900 p-5 space-y-3">
      <p className="text-xs text-zinc-500 uppercase tracking-wider">🗄 Key Distribution</p>
      {nodes.map((n) => {
        const pct = totalKeys > 0 ? (n.keys / totalKeys) * 100 : 0;
        return (
          <div key={n.id} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400 font-mono">{n.name}</span>
              <span className="text-zinc-500">{n.keys} keys ({pct.toFixed(1)}%)</span>
            </div>
            <div className="h-2 rounded-full bg-zinc-800">
              <div
                className="h-2 rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, backgroundColor: n.hex }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
