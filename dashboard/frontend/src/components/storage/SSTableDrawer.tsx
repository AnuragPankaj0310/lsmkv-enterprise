import { motion, AnimatePresence } from "framer-motion";
import { useEffect } from "react";

export interface SSTableMeta {
  id: string;
  level: number;
  fileSize: string;
  created: string;
  entries: number;
  minKey: string;
  maxKey: string;
  bloomFpRate: string;
  indexBlocks: number;
  dataBlocks: number;
  compression: string;
  seqNumMin: number;
  seqNumMax: number;
  checksum: string;
  restartInterval: number;
}

interface SSTableDrawerProps {
  table: SSTableMeta | null;
  onClose: () => void;
}

function Row({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-zinc-800/60 last:border-0 gap-4">
      <span className="text-xs text-zinc-500 shrink-0">{label}</span>
      <span className={`text-xs font-mono text-right ${highlight ? "text-yellow-400" : "text-zinc-200"}`}>
        {value}
      </span>
    </div>
  );
}

export function SSTableDrawer({ table, onClose }: SSTableDrawerProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <AnimatePresence>
      {table && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          />

          {/* Drawer */}
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
            className="fixed right-0 top-0 h-full w-96 bg-zinc-950 border-l border-zinc-800 z-50 flex flex-col shadow-2xl"
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider">SSTable Inspector</p>
                <p className="font-mono font-bold text-white mt-0.5">{table.id}</p>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-white transition"
              >
                ✕ Close
              </button>
            </div>

            {/* Level badge */}
            <div className="px-5 py-3 border-b border-zinc-800">
              <span className="rounded-full border border-blue-700 bg-blue-950/50 px-3 py-1 text-xs font-bold text-blue-400">
                Level {table.level}
              </span>
            </div>

            {/* Metadata fields */}
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-0">
              <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2 mt-1">File Info</p>
              <Row label="File Size"         value={table.fileSize} />
              <Row label="Created"           value={table.created} />
              <Row label="Compression"       value={table.compression} />
              <Row label="Checksum"          value={table.checksum} />

              <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2 mt-4">Data</p>
              <Row label="Entries"           value={table.entries.toLocaleString()} />
              <Row label="Min Key"           value={table.minKey} highlight />
              <Row label="Max Key"           value={table.maxKey} highlight />
              <Row label="Seq Num (min)"     value={table.seqNumMin} />
              <Row label="Seq Num (max)"     value={table.seqNumMax} />

              <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2 mt-4">Index & Filter</p>
              <Row label="Index Blocks"      value={table.indexBlocks} />
              <Row label="Data Blocks"       value={table.dataBlocks} />
              <Row label="Restart Interval"  value={table.restartInterval} />
              <Row label="Bloom FP Rate"     value={table.bloomFpRate} />

              {/* Mini key range preview */}
              <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2 mt-4">Key Range</p>
              <div className="rounded-lg bg-zinc-900 p-3 space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                  <span className="text-zinc-500">min</span>
                  <span className="font-mono text-green-400 ml-auto">{table.minKey}</span>
                </div>
                <div className="h-1 mx-5 rounded-full bg-gradient-to-r from-green-400/40 via-blue-400/30 to-yellow-400/40" />
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />
                  <span className="text-zinc-500">max</span>
                  <span className="font-mono text-yellow-400 ml-auto">{table.maxKey}</span>
                </div>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
