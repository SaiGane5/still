import { readJson, route } from "@/server/http";
import { deleteTask, parseId, patchSchema, updateTask } from "@/server/tasks";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export const PATCH = (req: Request, { params }: P) =>
  route(async ({ userId, timezone }) => {
    const id = parseId((await params).id);
    return updateTask(userId, timezone, id, patchSchema.parse(await readJson(req)));
  })(req);

export const DELETE = (req: Request, { params }: P) =>
  route(async ({ userId, timezone }) => deleteTask(userId, timezone, parseId((await params).id)))(req);
