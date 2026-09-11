export function RowSkeletons() {
  return (
    <ul className="divide-y divide-[var(--line)]" aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="flex items-center gap-4 px-3 py-3">
          <div className="size-14 shrink-0 animate-pulse rounded-lg bg-[var(--surface-2)]" />
          <div className="flex-1 space-y-2">
            <div
              className="h-4 animate-pulse rounded bg-[var(--surface-2)]"
              style={{ width: `${55 - index * 4}%` }}
            />
            <div
              className="h-3 animate-pulse rounded bg-[var(--surface-2)]"
              style={{ width: `${35 - index * 2}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
