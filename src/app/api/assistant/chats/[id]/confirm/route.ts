import { readJson, route } from "@/server/http";
import { confirmProposedTasks, confirmSchema } from "@/server/assistant";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export const POST = (req: Request, { params }: P) =>
  route(async ({ userId, timezone }) => {
    const body = confirmSchema.parse(await readJson(req));
    return confirmProposedTasks(userId, (await params).id, body.messageId, timezone);
  })(req);
