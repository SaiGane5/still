import { route } from "@/server/http";
import { deleteChat, getChat } from "@/server/assistant";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export const GET = (req: Request, { params }: P) =>
  route(async ({ userId }) => getChat(userId, (await params).id))(req);

export const DELETE = (req: Request, { params }: P) =>
  route(async ({ userId }) => {
    await deleteChat(userId, (await params).id);
    return { ok: true };
  })(req);
