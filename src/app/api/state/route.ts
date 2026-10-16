import { route } from "@/server/http";
import { getState } from "@/server/tasks";

export const dynamic = "force-dynamic";
export const GET = route(({ userId, timezone }) => getState(userId, timezone));
