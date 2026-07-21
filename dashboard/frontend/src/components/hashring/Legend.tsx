import { motion } from "framer-motion";
import type { RingNode } from "../../types/hashRing";
import { COLORS } from "../../utils/ringConstants";
import { formatNodeName } from "../../utils/nodeFormat";

export interface LegendProps {
  nodes: RingNode[];
}

export default function Legend({ nodes }: LegendProps) {
  return (
    <motion.div layout className="flex flex-wrap gap-5 text-sm">
      {nodes.map((node) => {
        // Show "Node 0" from addr ("node0", "node0.railway.internal", etc.) or fall back to "Node-N"
        const label = node.addr ? formatNodeName(node.addr) : `Node-${node.id}`;

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
