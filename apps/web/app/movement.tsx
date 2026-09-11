export function Movement({ delta }: { delta: number | null }) {
  if (!delta) return null;

  const up = delta > 0;
  return (
    <span
      className={`shrink-0 text-[11px] font-bold tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}
      title={`${up ? "Up" : "Down"} ${Math.abs(delta)} since your last visit`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(delta)}
    </span>
  );
}
