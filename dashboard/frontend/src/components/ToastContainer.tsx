/**
 * ToastContainer — Bottom-right completion notifications.
 *
 * Like VSCode. Appears on every page when any background op completes.
 * Auto-dismisses after 5 seconds. Multiple toasts stack vertically.
 * Never unmounts — lives in DashboardLayout.
 */
import { useState, useEffect, useCallback } from "react";
import { operationsStore } from "../store/operationsStore";

interface Toast {
  id: number;
  name: string;
  result: string;
  visible: boolean;
}

let _toastId = 0;

export default function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    return operationsStore.onToast((name, result) => {
      const id = _toastId++;
      const toast: Toast = { id, name, result, visible: true };
      setToasts(prev => [...prev, toast]);
      // Auto-dismiss after 5s
      setTimeout(() => dismiss(id), 5000);
    });
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="w-72 rounded-xl border border-green-700 bg-zinc-950/95 backdrop-blur-sm shadow-2xl overflow-hidden"
          style={{ animation: "slideInRight 0.25s ease-out" }}
        >
          {/* Progress bar — drains over 5s */}
          <div className="h-0.5 bg-green-900">
            <div
              className="h-full bg-green-500"
              style={{
                width: "100%",
                transition: "width 5s linear",
                // Trick: animate to 0% after mount
                animation: "drainProgress 5s linear forwards",
              }}
            />
          </div>

          <div className="px-4 py-3 flex items-start gap-3">
            <span className="text-green-400 text-lg mt-0.5 shrink-0">✓</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white">{toast.name}</p>
              <p className="text-[11px] text-zinc-400 mt-0.5 font-mono leading-relaxed">{toast.result}</p>
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="text-zinc-600 hover:text-zinc-300 text-lg leading-none shrink-0 transition-colors"
            >
              ×
            </button>
          </div>
        </div>
      ))}

      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(100%); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes drainProgress {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
    </div>
  );
}
