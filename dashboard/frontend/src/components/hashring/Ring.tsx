import { motion } from "framer-motion";
import { TICK_RADIUS } from "../../utils/ringConstants";
import { polarToCartesian } from "../../utils/ringGeometry";

/** 72 ticks × 5° = full 360° coverage */
const ticks = Array.from({ length: 72 }, (_, i) => i * 5);

/**
 * Ring — static layer: glow ring, center dot, compass labels, hash ticks.
 * No props needed; all geometry is driven by ringConstants.
 */
export default function Ring() {
  return (
    <>
      {/* Animated glow ring */}
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: [1, 1.01, 1], opacity: 1 }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-0 rounded-full border-4 border-blue-500/30 shadow-[0_0_20px_rgba(59,130,246,.2)]"
      />

      {/* Center dot */}
      <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500" />

      {/* Compass labels */}
      <p className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-8 text-sm text-zinc-500">0°</p>
      <p className="absolute right-0 top-1/2 translate-x-8 -translate-y-1/2 text-sm text-zinc-500">90°</p>
      <p className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-8 text-sm text-zinc-500">180°</p>
      <p className="absolute left-0 top-1/2 -translate-x-8 -translate-y-1/2 text-sm text-zinc-500">270°</p>

      {/* Hash ticks — using TICK_RADIUS from constants */}
      {ticks.map((angle) => {
        const { x, y } = polarToCartesian(angle - 90, TICK_RADIUS);
        return (
          <div
            key={angle}
            className="absolute h-1 w-1 rounded-full bg-zinc-700"
            style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
          />
        );
      })}
    </>
  );
}
