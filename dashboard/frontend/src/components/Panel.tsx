type PanelProps = {
  title: string;
  children: React.ReactNode;
};

export default function Panel({ title, children }: PanelProps) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-lg">
      <h2 className="mb-4 text-xl font-semibold">{title}</h2>
      {children}
    </div>
  );
}