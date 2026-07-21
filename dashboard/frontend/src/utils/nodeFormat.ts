/**
 * formatNodeName — convert internal node identifiers to user-friendly labels.
 *
 * Handles all of:
 *   "node0"                     → "Node 0"
 *   "node0.railway.internal"    → "Node 0"
 *   "node0.railway.internal:7001" → "Node 0"
 *   "node0:7001"               → "Node 0"
 */
export function formatNodeName(nameOrAddr: string): string {
  const bare = nameOrAddr.split(":")[0].split(".")[0];
  const match = bare.match(/^node(\d+)$/i);
  if (match) return `Node ${match[1]}`;
  return bare;
}

/**
 * formatMb — convert a MB value (possibly sub-1 MB, stored with 4 decimal places)
 * into the most readable unit: B / KB / MB.
 *
 * Examples:
 *   0.000048  → "49 B"
 *   0.0240    → "24.6 KB"
 *   1.2340    → "1.23 MB"
 *   null      → "—"
 */
export function formatMb(mb: number | null | undefined): string {
  if (mb == null) return "—";
  const bytes = mb * 1024 * 1024;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${mb.toFixed(2)} MB`;
}
