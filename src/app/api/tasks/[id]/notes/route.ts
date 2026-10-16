import { readJson, route } from "@/server/http";
import { getNote, noteSchema, saveNote } from "@/server/notes";
import { parseId } from "@/server/tasks";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export const GET = (req: Request, { params }: P) =>
  route(async ({ userId }) => getNote(userId, parseId((await params).id)))(req);

export const PUT = (req: Request, { params }: P) =>
  route(async ({ userId }) => {
    const { content, baseVersion } = noteSchema.parse(await readJson(req));
    return saveNote(userId, parseId((await params).id), content, baseVersion);
  })(req);
// keepalive flush on page hide
export const POST = PUT;
