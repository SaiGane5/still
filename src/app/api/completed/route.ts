import { route } from "@/server/http";
import { listCompletedWithNotes } from "@/server/tasks";

/** Archive of completed tasks that have notes (the completed-notes folder). */
export const GET = route(async ({ userId, req }) => {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const notesOnly = url.searchParams.get("all") !== "1";
  const query = url.searchParams.get("q") ?? "";
  return listCompletedWithNotes(userId, {
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
    notesOnly,
    query,
  });
});
