import { guard } from "@/lib/api";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024;
const MAX_REPORTS = 5;
const MAX_FIELD = 300;

// Anyone can POST here, so nothing is trusted: only these keys are read, each is truncated,
// and none is echoed back. The point is a name for what broke, not a faithful record.
const KEEP = [
  "documentURL",
  "document-uri",
  "effectiveDirective",
  "effective-directive",
  "violated-directive",
  "blockedURL",
  "blocked-uri",
  "disposition",
  "lineNumber",
  "line-number",
] as const;

function field(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value ? value.slice(0, MAX_FIELD) : undefined;
}

// `report-uri` posts {"csp-report": {…}}; the newer `report-to` posts [{"body": {…}}, …].
function bodies(parsed: unknown): unknown[] {
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.slice(0, MAX_REPORTS).map((entry) => {
    if (typeof entry !== "object" || entry === null) return entry;
    const raw = entry as Record<string, unknown>;
    return raw["csp-report"] ?? raw.body ?? raw;
  });
}

export async function POST(request: Request): Promise<Response> {
  const refusal = guard(request, "reports");
  if (refusal) return refusal;

  // 204 either way: a browser has nothing to do with an error here, and saying so only
  // invites it to retry.
  const accepted = new Response(null, { status: 204 });

  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BYTES) return accepted;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return accepted;
  }

  for (const body of bodies(parsed)) {
    if (typeof body !== "object" || body === null) continue;
    const raw = body as Record<string, unknown>;
    const fields: Record<string, string> = {};
    for (const key of KEEP) {
      const value = field(raw[key]);
      if (value !== undefined) fields[key] = value;
    }
    if (Object.keys(fields).length > 0) log("warn", "csp_violation", fields);
  }

  return accepted;
}
