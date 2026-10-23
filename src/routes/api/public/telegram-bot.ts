/** Public Telegram bot webhook — /api/public/telegram-bot
 *
 *  - /start silently creates/links the user's account from their Telegram
 *    identity and answers with a button that opens the Orange AI Mini App
 *    (the Mini App initData flow signs the user in automatically).
 *  - /101 is the admin panel (only for users with the admin role): user
 *    stats plus add / edit / delete reward tasks, each task carrying a name,
 *    a link and an image.
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

const DEFAULT_REWARD = 25;

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
}

type TgUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
};

type TgUpdate = {
  update_id: number;
  message?: { chat: { id: number }; from?: TgUser; text?: string };
  callback_query?: {
    id: string;
    from?: TgUser;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
};

// ---------- Telegram API ----------

async function tg(method: string, body: Record<string, unknown>): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return await res.json().catch(() => null);
  } catch (e) {
    console.error(`[telegram-bot] ${method} failed`, e);
    return null;
  }
}

async function reply(chatId: number, text: string, opts: Record<string, unknown> = {}): Promise<void> {
  await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...opts });
}

async function answerCallback(id: string, text = ""): Promise<void> {
  await tg("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📊 إحصائيات", callback_data: "adm:stats" }, { text: "📋 المهام", callback_data: "adm:list" }],
      [{ text: "➕ إضافة مهمة", callback_data: "adm:add" }],
    ],
  };
}

// ---------- accounts ----------

async function ensureAccount(from: TgUser): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  const { data: profile } = await db
    .from("telegram_profiles")
    .select("user_id")
    .eq("telegram_user_id", from.id)
    .maybeSingle();
  if (profile) return profile.user_id as string;

  const email = `tg${from.id}@${EMAIL_DOMAIN}`;
  const full_name = [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "Telegram user";
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name, telegram_id: from.id, provider: "telegram" },
  });
  let userId = created?.user?.id ?? null;
  if (error || !userId) {
    const { data: byEmail } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    const match = (byEmail?.users ?? []).find((u: { email?: string }) => u.email?.toLowerCase() === email);
    if (!match) return null;
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
  return userId;
}

async function isAdmin(telegramId: number): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: profile } = await db
      .from("telegram_profiles")
      .select("user_id")
      .eq("telegram_user_id", telegramId)
      .maybeSingle();
    if (!profile) return false;
    const { data } = await db.rpc("has_role", { _user_id: profile.user_id, _role: "admin" });
    return Boolean(data);
  } catch (e) {
    console.error("[telegram-bot] isAdmin failed", e);
    return false;
  }
}

// ---------- admin panel ----------

async function adminStats(): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const [{ count: users }, { count: tgUsers }, { count: activeSubs }, { count: cryptoPaid }] = await Promise.all([
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("telegram_profiles").select("user_id", { count: "exact", head: true }),
    db.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
    db.from("crypto_payments").select("id", { count: "exact", head: true }).eq("status", "paid"),
  ]);
  return [
    "<b>📊 إحصائيات Orange AI</b>",
    "",
    `👥 إجمالي المستخدمين: <b>${users ?? 0}</b>`,
    `✈️ مسجّلين من تليجرام: <b>${tgUsers ?? 0}</b>`,
    `⭐ اشتراكات نشطة: <b>${activeSubs ?? 0}</b>`,
    `🪙 مدفوعات كريبتو مكتملة: <b>${cryptoPaid ?? 0}</b>`,
  ].join("\n");
}

async function taskLine(t: Record<string, any>): Promise<string> {
  return `${t.image_url ? "🖼" : "•"} <b>${t.title}</b> — +${t.reward_credits}\n${t.action_url ?? ""}`;
}

async function adminTaskList(chatId: number): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: tasks } = await db
    .from("reward_tasks")
    .select("id, title, reward_credits, action_url, image_url, active")
    .order("sort_order", { ascending: true })
    .limit(50);
  if (!tasks?.length) {
    await reply(chatId, "مفيش مهام لسه. اضغط ➕ إضافة مهمة.");
    return;
  }
  const keyboard = tasks.map((t: any) => [
    {
      text: `${t.active ? "" : "⛔ "}${t.title}`,
      callback_data: `adm:task:${t.id}`,
    },
  ]);
  keyboard.push([{ text: "➕ إضافة مهمة", callback_data: "adm:add" }]);
  await tg("sendMessage", {
    chat_id: chatId,
    text: "<b>📋 المهام الحالية</b>\nاضغط على أي مهمة للتعديل أو الحذف:",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function adminTaskDetail(chatId: number, taskId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: t } = await db.from("reward_tasks").select("*").eq("id", taskId).maybeSingle();
  if (!t) {
    await reply(chatId, "المهمة دي مش موجودة.");
    return;
  }
  await tg("sendMessage", {
    chat_id: chatId,
    text: [
      `<b>${t.title}</b>`,
      `🔗 ${t.action_url ?? "—"}`,
      `🖼 ${t.image_url ?? "—"}`,
      `💰 +${t.reward_credits} نقطة · ${t.active ? "نشطة" : "موقوفة"}`,
      "",
      "التعديل: اضغط ✏️ وابعت السطر بالشكل: <code>الاسم | الرابط | رابط الصورة</code>",
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "✏️ تعديل", callback_data: `adm:edit:${t.id}` }, { text: "🗑 حذف", callback_data: `adm:del:${t.id}` }],
        [{ text: `${t.active ? "⏸ إيقاف" : "▶️ تشغيل"}`, callback_data: `adm:toggle:${t.id}:${t.active ? 0 : 1}` }],
        [{ text: "◀️ رجوع", callback_data: "adm:list" }],
      ],
    },
  });
}

async function setState(telegramId: number, action: string, taskId?: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  await db.from("bot_admin_state").upsert(
    { telegram_id: telegramId, action, task_id: taskId ?? null, created_at: new Date().toISOString() },
    { onConflict: "telegram_id" },
  );
}

async function getState(telegramId: number): Promise<{ action: string; task_id: string | null } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data } = await db
    .from("bot_admin_state")
    .select("action, task_id, created_at")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (!data) return null;
  if (Date.now() - new Date(data.created_at).getTime() > 10 * 60_000) {
    await db.from("bot_admin_state").delete().eq("telegram_id", telegramId);
    return null;
  }
  return { action: data.action, task_id: data.task_id };
}

async function clearState(telegramId: number): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  await db.from("bot_admin_state").delete().eq("telegram_id", telegramId);
}

function randomKey(): string {
  const buf = crypto.getRandomValues(new Uint8Array(4));
  return "adm_" + [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "الاسم | الرابط | رابط الصورة" — image part optional. */
function parseTaskInput(text: string): { name: string; url: string; image: string | null } | null {
  const parts = text.split(/\s*[|\n]\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const [name, url, image] = parts;
  const isHttp = (s: string) => /^https?:\/\/\S+$/i.test(s);
  if (!isHttp(url)) return null;
  if (image && !isHttp(image)) return null;
  return { name, url, image: image || null };
}

async function handleAdminTextInput(chatId: number, from: TgUser, text: string): Promise<boolean> {
  const state = await getState(from.id);
  if (!state) return false;

  if (text === "إلغاء") {
    await clearState(from.id);
    await reply(chatId, "تم الإلغاء.", { reply_markup: mainMenuKeyboard() });
    return true;
  }

  const parsed = parseTaskInput(text);
  if (!parsed) {
    await reply(
      chatId,
      "الصيغة مش صح 🙏\nابعت المهمة بالشكل ده:\n<code>اسم المهمة | https://الرابط | https://رابط-الصورة</code>\n\nأو ابعت «إلغاء».",
      { parse_mode: "HTML" },
    );
    return true;
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  if (state.action === "add") {
    const { data: created, error } = await db
      .from("reward_tasks")
      .insert({
        task_key: randomKey(),
        title: parsed.name,
        description: parsed.url,
        reward_credits: DEFAULT_REWARD,
        action_type: "open_url",
        action_url: parsed.url,
        image_url: parsed.image,
        icon: "coins",
        active: true,
        sort_order: 50,
      })
      .select()
      .single();
    await clearState(from.id);
    if (error || !created) {
      await reply(chatId, "حصل خطأ في الحفظ، جرّب تاني.");
      return true;
    }
    await reply(chatId, `✅ المهمة اتضافت: <b>${created.title}</b> (+${created.reward_credits} نقطة)`, {
      parse_mode: "HTML",
    });
    if (created.image_url) {
      await tg("sendPhoto", { chat_id: chatId, photo: created.image_url, caption: created.title }).catch(() => {});
    }
    return true;
  }

  if (state.action === "edit" && state.task_id) {
    const { data: updated, error } = await db
      .from("reward_tasks")
      .update({
        title: parsed.name,
        action_url: parsed.url,
        description: parsed.url,
        image_url: parsed.image,
      })
      .eq("id", state.task_id)
      .select()
      .single();
    await clearState(from.id);
    if (error || !updated) {
      await reply(chatId, "حصل خطأ في التعديل، جرّب تاني.");
      return true;
    }
    await reply(chatId, `✅ المهمة اتعدّلت: <b>${updated.title}</b>`, { parse_mode: "HTML" });
    return true;
  }

  return false;
}

async function handleAdminCallback(cb: NonNullable<TgUpdate["callback_query"]>): Promise<void> {
  const chatId = cb.message?.chat?.id;
  if (!chatId || !cb.from) return;
  const data = cb.data ?? "";
  if (!data.startsWith("adm:")) return;
  if (!(await isAdmin(cb.from.id))) {
    await answerCallback(cb.id, "مش مسموح");
    return;
  }

  const [, cmd, arg1, arg2] = data.split(":");

  if (cmd === "stats") {
    await answerCallback(cb.id);
    await reply(chatId, await adminStats(), { parse_mode: "HTML", reply_markup: mainMenuKeyboard() });
    return;
  }
  if (cmd === "list") {
    await answerCallback(cb.id);
    await adminTaskList(chatId);
    return;
  }
  if (cmd === "add") {
    await answerCallback(cb.id);
    await setState(cb.from.id, "add");
    await reply(
      chatId,
      "➕ ابعت المهمة الجديدة بالشكل ده:\n<code>اسم المهمة | https://الرابط | https://رابط-الصورة</code>\n\nرابط الصورة اختياري · نقاط المهمة الافتراضية 25.\nللإلغاء ابعت «إلغاء».",
      { parse_mode: "HTML" },
    );
    return;
  }
  if (cmd === "task" && arg1) {
    await answerCallback(cb.id);
    await adminTaskDetail(chatId, arg1);
    return;
  }
  if (cmd === "edit" && arg1) {
    await answerCallback(cb.id);
    await setState(cb.from.id, "edit", arg1);
    await reply(chatId, "✏️ ابعت السطر الجديد بالشكل: <code>الاسم | الرابط | رابط الصورة</code>\nللإلغاء ابعت «إلغاء».", {
      parse_mode: "HTML",
    });
    return;
  }
  if (cmd === "del" && arg1) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    await db.from("reward_tasks").delete().eq("id", arg1);
    await answerCallback(cb.id, "تم الحذف");
    await reply(chatId, "🗑 المهمة اتحذفت.");
    return;
  }
  if (cmd === "toggle" && arg1 && arg2 !== undefined) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    await db.from("reward_tasks").update({ active: arg2 === "1" }).eq("id", arg1);
    await answerCallback(cb.id, "تم");
    await adminTaskDetail(chatId, arg1);
    return;
  }
  await answerCallback(cb.id);
}

// ---------- webhook ----------

export const Route = createFileRoute("/api/public/telegram-bot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) return Response.json({ ok: false }, { status: 500 });

        const expected = b64url(await sha256(`telegram-webhook:${token}`));
        const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!actual || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const update = (await request.json().catch(() => null)) as TgUpdate | null;
        if (!update) return Response.json({ ok: true });

        try {
          if (update.callback_query) {
            await handleAdminCallback(update.callback_query);
            return Response.json({ ok: true });
          }

          const msg = update.message;
          const text = (msg?.text ?? "").trim();
          const from = msg?.from;
          if (!msg?.chat?.id || !from) return Response.json({ ok: true });

          if (text === "/101") {
            if (await isAdmin(from.id)) {
              await reply(msg.chat.id, "<b>🛠 لوحة أدمن Orange AI</b>\nاختار من القايمة:", {
                parse_mode: "HTML",
                reply_markup: mainMenuKeyboard(),
              });
            } else {
              await reply(msg.chat.id, "الأمر ده للأدمن بس.");
            }
            return Response.json({ ok: true });
          }

          // Admin pending task input (add / edit).
          if ((await isAdmin(from.id)) && (await getState(from.id))) {
            await handleAdminTextInput(msg.chat.id, from, text);
            return Response.json({ ok: true });
          }

          if (text === "/start" || text.startsWith("/start ")) {
            await ensureAccount(from);
            const name = from.first_name ? ` يا ${from.first_name}` : "";
            await reply(
              msg.chat.id,
              `أهلًا${name} 👋\nحسابك في <b>Orange AI</b> جاهز ومربوط بتليجرام.\nاضغط الزر تحت علشان تفتح التطبيق وتكمل تلقائيًا من غير تسجيل دخول.`,
              { reply_markup: { inline_keyboard: [[{ text: "🚀 افتح Orange AI", web_app: { url: MINIAPP_URL } }]] } },
            );
          } else if (text === "/help" || text === "/app") {
            await reply(msg.chat.id, "اضغط /start علشان تفتح التطبيق.", {
              reply_markup: { inline_keyboard: [[{ text: "🚀 افتح Orange AI", web_app: { url: MINIAPP_URL } }]] },
            });
          }
        } catch (e) {
          console.error("[telegram-bot] update failed", e);
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
