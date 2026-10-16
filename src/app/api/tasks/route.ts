import { readJson, route } from "@/server/http";
import { createSchema, createTask } from "@/server/tasks";

export const dynamic = "force-dynamic";
export const POST = route(async ({ userId, req, timezone }) => {
  const input = createSchema.parse(await readJson(req));
  return createTask(userId, timezone, input);
});
