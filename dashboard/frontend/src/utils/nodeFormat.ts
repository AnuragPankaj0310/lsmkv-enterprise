/**
 * formatNodeName — convert internal node identifiers to user-friendly labels.
 *
 * Handles all of:
 *   "node0"                     → "Node 0"
 *   "node0.railway.internal"    → "Node 0"
 *   "node0.railway.internal:7001" → "Node 0"
 *   "node0:7001"               → "Node 0"
 *
 * The full internal address is preserved in tooltips / debug views;
 * only the display label is formatted here.
 */
export function formatNodeName(nameOrAddr: string): string {
  // Strip port and any domain suffix → get the bare short name ("node0")
  const bare = nameOrAddr.split(":")[0].split(".")[0];
  const match = bare.match(/^node(\d+)$/i);
  if (match) return `Node ${match[1]}`;
  return bare; // fallback: return whatever short name we have
}
