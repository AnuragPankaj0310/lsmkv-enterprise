import Card from "./Card";
import type { LucideIcon } from "lucide-react";

type StatCardProps = {
  title: string;
  value: string | number;
  icon: LucideIcon;
  subtitle?: string;
};

export default function StatCard({
  title,
  value,
  icon: Icon,
  subtitle,
}: StatCardProps) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">{title}</p>

        <Icon
          size={28}
          className="text-blue-400"
        />
      </div>

      <h2 className="mt-4 text-4xl font-bold">
        {value}
      </h2>

      {subtitle && (
        <p className="mt-3 text-sm text-zinc-500">
          {subtitle}
        </p>
      )}
    </Card>
  );
}