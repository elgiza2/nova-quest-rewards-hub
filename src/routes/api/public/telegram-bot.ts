/** Public Telegram bot webhook — /api/public/telegram-bot
 *
 *  Replaces the old "set your Telegram username first" flow: /start now
 *  silently creates/links the user's account from their Telegram identity and
 *  answers with a button that opens the Orange AI Mini App, where the Mini App
 *  initData flow signs the user in automatically.
 *
 *  Security: Telegram signs deliveries with X-Telegram-Bot-Api-Secret-Token
 *  (base64url SHA-256 of "telegram-webhook:<bot token>") — verified here
 *  before anything else happens.
 */
import { createFileRoute } from "@tanstack/react-router";

const EMAIL_DOMAIN = "users.orangeai.telegram";

const MINIAPP_URL =
  process.env.TELEGRAM_MINIAPP_URL ||
  "https://project--789553ce-ddf6-457a-bc18-082abf75e556-dev.lovable.app";

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
}

type TgUpdate = {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string; is_premium?: boolean };
    text?: string;
  };
};

async function ensureAccount(from: TgUpdate["message"] extends undefined ? never : NonNullable<NonNullable<TgUpdate["message"]>["from"]>): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  const { data: profile } = await db
    .from("telegram_profiles")
    .select("user_id")
    .eq("telegram_user_id", from.id)
    .maybeSingle();
  if (profile) return;

  const email = `tg${from.id}@${EMAIL_DOMAIN}`;
  const full_name = [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "Telegram user";
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name, telegram_id: from.id, provider: "telegram" },
  });
  let userId = created?.user?.id ?? null;
  if (error || !userId) {
    // Email already registered (signed up normally earlier) — find the user.
    const { data: byEmail } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    const match = (byEmail?.users ?? []).find((u: { email?: string }) => u.email?.toLowerCase() === email);
    if (!match) return; // cannot link right now; Mini App flow can still link later
    userId = match.id;
  }
  await db.from("telegram_profiles").upsert(
    {
      user_id: userId,
      telegram_user_id: from.id,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
      language_code: from.language_code ?? null,
      is_premium: from.is_premium ?? false,
    },
    { onConflict: "user_id" },
  );
}

async function reply(chatId: number, text: string, withMiniAppButton: boolean): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (withMiniAppButton) {
    body.reply_markup = {
      inline_keyboard: [[{ text: "🚀 افتح Orange AI", web_app: { url: MINIAPP_URL } }]],
    };
  }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error("[telegram-bot] sendMessage failed", e);
  }
}

export const Route = createFileRoute("/api/public/telegram-bot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) return Response.json({ ok: false }, { status: 500 });

        // Verify Telegram's delivery signature before parsing anything.
        const expected = b64url(await sha256(`telegram-webhook:${token}`));
        const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!actual || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const update = (await request.json().catch(() => null)) as TgUpdate | null;
        if (!update) return Response.json({ ok: true });

        const msg = update.message;
        const text = (msg?.text ?? "").trim();
        const from = msg?.from;

        if (msg?.chat?.id && from && (text === "/start" || text.startsWith("/start "))) {
          try {
            await ensureAccount(from);
          } catch (e) {
            console.error("[telegram-bot] ensureAccount failed", e);
          }
          const name = from.first_name ? ` يا ${from.first_name}` : "";
          await reply(
            msg.chat.id,
            `أهلًا${name} 👋\nحسابك في <b>Orange AI</b> جاهز ومربوط بتليجرام.\nاضغط الزر تحت علشان تفتح التطبيق وتكمل تلقائيًا من غير تسجيل دخول.`,
            true,
          );
        } else if (msg?.chat?.id && (text === "/help" || text === "/app")) {
          await reply(msg.chat.id, "اضغط /start علشان تفتح التطبيق.", true);
        }

        return Response.json({ ok: true });
      },
    },
  },
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
