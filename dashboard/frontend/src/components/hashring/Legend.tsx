import { motion } from "framer-motion";
import type { RingNode } from "../../types/hashRing";
import { COLORS } from "../../utils/ringConstants";

export interface LegendProps {
  nodes: RingNode[];
}

export default function Legend({ nodes }: LegendProps) {
  return (
    <motion.div layout className="flex flex-wrap gap-5 text-sm">
      {nodes.map((node) => {
        // Show real addr (e.g. "node0") when available, else "Node-1"
        const label = node.addr
          ? node.addr.split(":")[0]
          : `Node-${node.id}`;

        return (
          <motion.div
            layout
            key={node.id}
            className="flex items-center gap-2"
          >
            <div className={`h-2.5 w-2.5 rounded-full ${COLORS[node.id]}`} />
            <span className="font-medium text-zinc-300">{label}</span>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
