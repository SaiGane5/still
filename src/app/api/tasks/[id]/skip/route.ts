import { z } from "zod";
import { readJson, route } from "@/server/http";
import { skipTask, parseId } from "@/server/tasks";

export const dynamic = "force-dynamic";
const body = z.object({ startNext: z.boolean().default(true) });

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  route(async ({ userId, timezone }) => {
    const { startNext } = body.parse(await readJson(req));
    return skipTask(userId, timezone, parseId((await params).id), startNext);
  })(req);
