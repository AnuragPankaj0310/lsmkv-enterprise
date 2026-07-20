type Status = "healthy" | "warning" | "offline";

type Props = {
  status: Status;
};

const colors = {
  healthy: "bg-green-500/10 text-green-400",
  warning: "bg-yellow-500/10 text-yellow-400",
  offline: "bg-red-500/10 text-red-400",
};

export default function StatusBadge({
  status,
}: Props) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-sm font-medium ${colors[status]}`}
    >
      {status.toUpperCase()}
    </span>
  );
}