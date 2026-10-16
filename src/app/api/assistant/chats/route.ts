import { route } from "@/server/http";
import { createChat, listChats } from "@/server/assistant";

export const dynamic = "force-dynamic";

export const GET = route(async ({ userId }) => ({ chats: await listChats(userId) }));

export const POST = route(async ({ userId }) => createChat(userId));
