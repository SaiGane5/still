import { readJson, route } from "@/server/http";
import { parseId, timerSchema, updateTimer } from "@/server/tasks";

export const dynamic = "force-dynamic";

export const PUT = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  route(async ({ userId, timezone }) =>
    updateTimer(userId, timezone, parseId((await params).id), timerSchema.parse(await readJson(req))),
  )(req);
// sendBeacon / keepalive fallbacks use POST
export const POST = PUT;
