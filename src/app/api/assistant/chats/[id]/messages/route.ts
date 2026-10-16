import { readJson, route } from "@/server/http";
import { sendMessage, sendSchema } from "@/server/assistant";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export const POST = (req: Request, { params }: P) =>
  route(async ({ userId }) => {
    const body = sendSchema.parse(await readJson(req));
    return sendMessage(userId, (await params).id, body.content);
  })(req);
