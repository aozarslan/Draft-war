import { NextResponse } from "next/server";
import { EngineError, rpc } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics?days=30
 *
 * Same gate as the rest of /api/admin: open in development, and in production
 * only when DRAFT_WAR_DEV_KEY is set and presented. Without it this answers
 * 404, so a deployed game exposes no dashboard.
 *
 * Nothing personal comes back. `dw_analytics` reports counts, rates and
 * distributions; the only names in it are category and item ids.
 */
function devAllowed(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const key = process.env.DRAFT_WAR_DEV_KEY;
  return Boolean(key) && request.headers.get("x-dw-dev-key") === key;
}

export async function GET(request: Request) {
  if (!devAllowed(request)) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const days = Number(new URL(request.url).searchParams.get("days") ?? 30);
    const data = await rpc("dw_analytics", {
      p_days: Number.isFinite(days) ? Math.min(365, Math.max(1, Math.round(days))) : 30,
    });
    if (data.ok === false) {
      return errorResponse(String(data.code ?? "ANALYTICS_ERROR"), String(data.message), 500);
    }
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
