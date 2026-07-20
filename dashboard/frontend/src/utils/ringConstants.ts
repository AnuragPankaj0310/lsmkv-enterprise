export const RING_SIZE = 520;

export const CENTER = RING_SIZE / 2;   // 260

export const TICK_RADIUS = CENTER - 5;  // 255
export const NODE_RADIUS = CENTER - 40; // 220
export const KEY_RADIUS  = CENTER - 55; // 205

export const COLORS: Record<number, string> = {
  1: "bg-blue-400",
  2: "bg-green-400",
  3: "bg-yellow-400",
  4: "bg-pink-400",
  5: "bg-orange-400",
  6: "bg-cyan-400",
};

/** Hex equivalents used for animated backgroundColor in framer-motion */
export const COLOR_HEX: Record<number, string> = {
  1: "#60a5fa",
  2: "#4ade80",
  3: "#facc15",
  4: "#f472b6",
  5: "#fb923c",
  6: "#22d3ee",
};
