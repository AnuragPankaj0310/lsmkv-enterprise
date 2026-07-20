import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { RingNode, RingKey } from "../../types/hashRing";
import { KEY_RADIUS, COLOR_HEX } from "../../utils/ringConstants";
import { polarToCartesian, resolveOwnerIndex } from "../../utils/ringGeometry";

export interface KeysProps {
  keys: RingKey[];
  nodes: RingNode[];
}

export default function Keys({ keys, nodes }: KeysProps) {
  const [hoveredKey, setHoveredKey] = useState<RingKey | null>(null);

  return (
    <>
      {keys.map((key) => {
        const ownerIndex = resolveOwnerIndex(key, nodes);
        const { x, y } = polarToCartesian(key.angle - 90, KEY_RADIUS);
        const color = COLOR_HEX[ownerIndex] ?? "#94a3b8";

        return (
          <motion.div
            layout
            key={key.id}
            animate={{ backgroundColor: color }}
            transition={{ duration: 0.5 }}
            whileHover={{ scale: 2.5, boxShadow: "0 0 15px rgba(255,255,255,0.8)" }}
            onHoverStart={() => setHoveredKey(key)}
            onHoverEnd={() => setHoveredKey(null)}
            className="absolute h-2.5 w-2.5 rounded-full cursor-pointer z-10"
            style={{ left: x, top: y, transform: "translate(-50%,-50%)" }}
          />
        );
      })}

      <AnimatePresence>
        {hoveredKey && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute z-50 pointer-events-none rounded-lg bg-zinc-900 border border-zinc-700 p-3 shadow-2xl backdrop-blur-sm"
            style={{
              left: polarToCartesian(hoveredKey.angle - 90, KEY_RADIUS).x,
              top: polarToCartesian(hoveredKey.angle - 90, KEY_RADIUS).y - 45,
              transform: "translate(-50%, -100%)",
            }}
          >
            <p className="text-xs font-bold text-white whitespace-nowrap mb-1">Key {hoveredKey.id}</p>
            <div className="text-[10px] text-zinc-400 font-mono space-y-0.5">
              <p>Owner: <span className="text-zinc-200">{hoveredKey.owner ?? `Node-${resolveOwnerIndex(hoveredKey, nodes)}`}</span></p>
              <p>Angle: <span className="text-zinc-200">{hoveredKey.angle.toFixed(1)}°</span></p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
