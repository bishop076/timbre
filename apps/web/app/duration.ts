const pad = (value: number) => value.toString().padStart(2, "0");

function clock(total: number, hours: boolean): string {
  return hours
    ? `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
    : `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  return clock(total, total >= 3600);
}

export function formatClock(seconds: number): string {
  return Number.isFinite(seconds) && seconds >= 0 ? clock(Math.floor(seconds), false) : "0:00";
}

export function formatElapsed(seconds: number, totalSeconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return totalSeconds >= 3600 ? "0:00:00" : "0:00";
  return clock(Math.floor(seconds), !(totalSeconds < 3600));
}
