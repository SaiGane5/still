import { readJson, route } from "@/server/http";
import { reorderSchema, reorderTasks } from "@/server/tasks";

export const dynamic = "force-dynamic";
export const POST = route(async ({ userId, req, timezone }) =>
  reorderTasks(userId, timezone, reorderSchema.parse(await readJson(req)).orderedIds),
);
