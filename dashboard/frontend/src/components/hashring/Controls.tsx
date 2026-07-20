import { motion } from "framer-motion";

export interface ControlsProps {
  nodeCount: number;
  onAdd: () => void;
  onRemove: () => void;
  /** When true, ring is driven by the live backend — local buttons are hidden */
  live?: boolean;
}

export default function Controls({ nodeCount, onAdd, onRemove, live }: ControlsProps) {
  if (live) {
    return (
      <p className="text-sm text-zinc-500 italic">
        Ring is managed by the live backend — use <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300">POST /add-node</code> or{" "}
        <code className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300">POST /remove-node</code> to modify the cluster.
      </p>
    );
  }

  return (
    <div className="flex gap-4">
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        disabled={nodeCount >= 6}
        onClick={onAdd}
        className="rounded-lg bg-blue-600 px-4 py-2 font-semibold transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        + Add Node
      </motion.button>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        disabled={nodeCount <= 3}
        onClick={onRemove}
        className="rounded-lg bg-red-600 px-4 py-2 font-semibold transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        − Remove Node
      </motion.button>
    </div>
  );
}
