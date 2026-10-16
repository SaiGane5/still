import { route } from "@/server/http";
import { getState } from "@/server/tasks";

export const dynamic = "force-dynamic";
export const GET = route(async ({ userId, timezone }) => (await getState(userId, timezone)).progress);
