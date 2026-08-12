import { NextResponse } from "next/server";
import { EngineError, rpc } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";
import {
  PROFILE_TOKEN_HEADER,
  getLeagueStandings,
  getMyLeagues,
  optionalProfile,
} from "@/lib/server/profile";

export const dynamic = "force-dynamic";

/**
 * GET  /api/leagues            — the caller's leagues
 * GET  /api/leagues?id=…       — one league's table
 * POST /api/leagues            — create, join or leave
 *
 * A league is private: there is no directory and no listing. You get in with a
 * code somebody gave you, exactly like a room.
 */
export async function GET(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);

    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return errorResponse("NO_SUCH_LEAGUE", "No such league.", 404);
      }
      return NextResponse.json(await getLeagueStandings(id));
    }
    return NextResponse.json(await getMyLeagues(profile.profileId));
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}

type Body =
  | { action: "CREATE"; name: string }
  | { action: "JOIN"; code: string }
  | { action: "LEAVE"; leagueId: string };

export async function POST(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);

    const token = request.headers.get(PROFILE_TOKEN_HEADER);
    const body = (await request.json()) as Body;
    let result: Record<string, unknown>;

    switch (body.action) {
      case "CREATE":
        result = await rpc("dw_create_league", {
          p_profile_id: profile.profileId,
          p_token: token,
          p_name: String(body.name ?? "").slice(0, 32),
        });
        break;
      case "JOIN":
        result = await rpc("dw_join_league", {
          p_profile_id: profile.profileId,
          p_token: token,
          p_code: String(body.code ?? "").slice(0, 8),
        });
        break;
      case "LEAVE":
        result = await rpc("dw_leave_league", {
          p_profile_id: profile.profileId,
          p_token: token,
          p_league_id: body.leagueId,
        });
        break;
      default:
        return errorResponse("BAD_ACTION", "That is not something you can do here.");
    }

    if (result.ok === false) {
      return errorResponse(String(result.code), String(result.message), 409);
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
