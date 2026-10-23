/** Public Telegram bot webhook — /api/public/telegram-bot (Orange AI)
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
import char01 from "@/assets/tg/char-01.jpg.asset.json";
import char02 from "@/assets/tg/char-02.jpg.asset.json";
import char03 from "@/assets/tg/char-03.jpg.asset.json";
import char04 from "@/assets/tg/char-04.jpg.asset.json";
import charactersGroup from "@/assets/tg/characters-together.jpg.asset.json";

/** Lovable-hosted origin that actually serves /__l5e asset files. */
const ASSET_HOST = "https://project--789553ce-ddf6-457a-bc18-082abf75e556-dev.lovable.app";

const EMAIL_DOMAIN = "users.orangeai.telegram";

const MINIAPP_URL =
  process.env.TELEGRAM_MINIAPP_URL ||
  "https://orange-ai-beta.vercel.app";

const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || "-1002616088306";
const COMMUNITY_URL = "https://t.me/oraien";
const BUY_ORANGE_URL =
  "https://app.ston.fi/swap?chartVisible=false&ft=GRAM&tt=EQCY5dx1kTGT-r1RPXA-LTRyv73_LtfcaTl0g1E_WBlRdUyI";

/** Unicode sans-serif bold — renders bold in every Telegram client, even where HTML is stripped. */
function bold(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 65 && c <= 90) out += String.fromCodePoint(0x1d5d4 + c - 65);
    else if (c >= 97 && c <= 122) out += String.fromCodePoint(0x1d5ee + c - 97);
    else if (c >= 48 && c <= 57) out += String.fromCodePoint(0x1d7ec + c - 48);
    else out += ch;
  }
  return out;
}

/** Channel post pool — the app's own characters, bold English captions, no emojis. */
const POST_POOL: { photo: string; caption: string }[] = [
  { photo: char01.url, caption: `<b>${bold("Orange AI is here.")}</b>\n\n<b>${bold("Your all-in-one AI assistant, right inside Telegram.")}</b>` },
  { photo: char02.url, caption: `<b>${bold("Reach new levels.")}</b>\n\n<b>${bold("Complete daily tasks, earn points and climb the ranks.")}</b>` },
  { photo: char03.url, caption: `<b>${bold("Stay on course.")}</b>\n\n<b>${bold("Check in every day and keep your rewards growing.")}</b>` },
  { photo: char04.url, caption: `<b>${bold("Your tasks are waiting.")}</b>\n\n<b>${bold("Open Orange AI, finish a task and turn minutes into points.")}</b>` },
];

/** Daily channel posts: two slots per day, lazily fired on webhook traffic. */
const DAILY_SLOTS = [
  { key: "morning", hourUTC: 9 },
  { key: "evening", hourUTC: 19 },
];

/** Daily personal notification to every Telegram user, sent in batches from webhook traffic. */
const NOTIFY_HOUR_UTC = 12;
const NOTIFY_BATCH = 80;
const NOTIFY_MESSAGES = [
  "Your daily credits are waiting. Check in today and keep your streak alive.",
  "New tasks are live. Finish one and turn a few minutes into points.",
  "Got a question or an idea? Your AI assistant is ready right now.",
  "Invite a friend today and you both earn free credits.",
];

function appButtons(webApp: boolean) {
  const open = webApp
    ? { text: "Open Orange AI", web_app: { url: MINIAPP_URL }, style: "success" }
    : { text: "Open Orange AI", url: MINIAPP_URL, style: "success" };
  return {
    inline_keyboard: [
      [open],
      [
        { text: "Community", url: COMMUNITY_URL, style: "primary" },
        { text: "Buy ORANGE", url: BUY_ORANGE_URL, style: "danger" },
      ],
    ],
  };
}

async function maybeNotifyUsers(): Promise<void> {
  try {
    const now = new Date();
    if (now.getUTCHours() < NOTIFY_HOUR_UTC) return;
    const today = now.toISOString().slice(0, 10);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: st } = await db.from("bot_daily_state").select("last_posted_day, post_index, last_posted_at").eq("slot", "notify").maybeSingle();
    if (st?.last_posted_day === today) return;
    const startedToday = st?.last_posted_at?.slice(0, 10) === today;
    const cursor = startedToday ? Number(st?.post_index ?? 0) : 0;
    const { data: users } = await db
      .from("telegram_profiles")
      .select("telegram_user_id, first_name")
      .order("telegram_user_id", { ascending: true })
      .range(cursor, cursor + NOTIFY_BATCH - 1);
    const list = (users ?? []) as { telegram_user_id: number; first_name: string | null }[];
    const dayN = Math.floor(now.getTime() / 86_400_000);
    const line = NOTIFY_MESSAGES[dayN % NOTIFY_MESSAGES.length];
    await db.from("bot_daily_state").upsert(
      {
        slot: "notify",
        last_posted_at: now.toISOString(),
        last_posted_day: list.length < NOTIFY_BATCH ? today : st?.last_posted_day ?? null,
        post_index: cursor + list.length,
      },
      { onConflict: "slot" },
    );
    for (const u of list) {
      const name = (u.first_name ?? "there").replace(/[<>&]/g, "");
      await tg("sendMessage", {
        chat_id: u.telegram_user_id,
        text: `<b>${bold(`Hey ${name},`)}</b>\n\n<b>${bold(line)}</b>`,
        parse_mode: "HTML",
        reply_markup: appButtons(true),
      });
    }
  } catch (e) {
    console.error("[telegram-bot] daily notify failed", e);
  }
}

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
  message?: { chat: { id: number }; from?: TgUser; text?: string; photo?: { file_id: string }[]; document?: { file_id: string; mime_type?: string } };
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
      [{ text: "➕ إضافة مهمة", callback_data: "adm:add" }, { text: "📣 انشر دلوقتي", callback_data: "adm:post" }],
      [{ text: "📨 ابعت منشور لكل المستخدمين", callback_data: "adm:bcast" }],
    ],
  };
}

// ---------- channel posts ----------

function appUrlButton(): Record<string, unknown> {
  // web_app buttons only work in private chats; channel posts use a plain url button.
  return { text: "Open Orange AI", url: MINIAPP_URL };
}

/** Telegram needs absolute https URLs for photos; asset pointers are relative. */
function absoluteAssetUrl(pointerUrl: string): string {
  if (pointerUrl.startsWith("http")) return pointerUrl;
  return new URL(pointerUrl, ASSET_HOST).toString();
}

async function postToChannel(poolIndex: number): Promise<boolean> {
  const item = POST_POOL[poolIndex % POST_POOL.length];
  if (!item) return false;
  const res = await tg("sendPhoto", {
    chat_id: CHANNEL_ID,
    photo: absoluteAssetUrl(item.photo),
    caption: item.caption,
    parse_mode: "HTML",
    reply_markup: appButtons(false),
  });
  return Boolean(res?.ok);
}

/** Sends the same channel post privately to every Telegram user of the bot. */
async function broadcastPost(poolIndex: number): Promise<{ sent: number; failed: number }> {
  const item = POST_POOL[poolIndex % POST_POOL.length];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const ids: number[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("telegram_profiles").select("telegram_user_id").range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) if (r.telegram_user_id) ids.push(Number(r.telegram_user_id));
    if (data.length < 1000) break;
  }
  let sent = 0, failed = 0;
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    const res = await Promise.all(batch.map((id) => tg("sendPhoto", {
      chat_id: id, photo: absoluteAssetUrl(item.photo), caption: item.caption, parse_mode: "HTML", reply_markup: appButtons(true),
    })));
    for (const r of res) r?.ok ? sent++ : failed++;
    if (i + 20 < ids.length) await new Promise((r) => setTimeout(r, 1100));
  }
  return { sent, failed };
}

async function saveDailyState(slot: string, poolIndex: number): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  await db.from("bot_daily_state").upsert(
    {
      slot,
      last_posted_at: new Date().toISOString(),
      last_posted_day: new Date().toISOString().slice(0, 10),
      post_index: poolIndex,
    },
    { onConflict: "slot" },
  );
}

async function nextPoolIndex(): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data } = await db.from("bot_daily_state").select("post_index").in("slot", DAILY_SLOTS.map((x) => x.key)).order("last_posted_at", { ascending: false }).limit(1);
  return ((data?.[0]?.post_index as number | undefined) ?? -1) + 1;
}

/** Posts the slot's channel message if its daily window hasn't been used yet. */
async function maybePostDaily(): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    for (const slot of DAILY_SLOTS) {
      if (now.getUTCHours() < slot.hourUTC) continue;
      const { data } = await db.from("bot_daily_state").select("last_posted_day").eq("slot", slot.key).maybeSingle();
      if (data?.last_posted_day === today) continue;
      const idx = await nextPoolIndex();
      if (await postToChannel(idx)) await saveDailyState(slot.key, idx);
      break; // one post per webhook at most; the next slot fires on later traffic
    }
  } catch (e) {
    console.error("[telegram-bot] daily post failed", e);
  }
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

type Draft = { name?: string; image?: string };

function parseStep(action: string): { mode: string; step: string; draft: Draft } {
  const [head, json] = action.split("|", 2);
  const [mode, step] = head.split(":");
  let draft: Draft = {};
  try { if (json) draft = JSON.parse(json); } catch { /* fresh draft */ }
  return { mode, step: step ?? "name", draft };
}

/** Step-by-step task input: name → photo uploaded from the device → link. */
async function handleAdminInput(chatId: number, from: TgUser, msg: NonNullable<TgUpdate["message"]>): Promise<boolean> {
  const state = await getState(from.id);
  if (!state) return false;
  const text = (msg.text ?? "").trim();

  if (text === "إلغاء") {
    await clearState(from.id);
    await reply(chatId, "تم الإلغاء.", { reply_markup: mainMenuKeyboard() });
    return true;
  }

  const { mode, step, draft } = parseStep(state.action);
  const taskId = state.task_id ?? undefined;
  const save = (next: string, d: Draft) => setState(from.id, `${mode}:${next}|${JSON.stringify(d)}`, taskId);

  if (step === "name") {
    if (!text || text.length > 80) { await reply(chatId, "ابعت اسم المهمة كنص (لحد 80 حرف)."); return true; }
    await save("photo", { name: text });
    await reply(chatId, "🖼 <b>خطوة 2 من 3</b>\nابعت <b>صورة المهمة</b> من موبايلك (صورة عادية، مش رابط).", { parse_mode: "HTML" });
    return true;
  }

  if (step === "photo") {
    const fileId = msg.photo?.length ? msg.photo[msg.photo.length - 1].file_id
      : msg.document?.mime_type?.startsWith("image/") ? msg.document.file_id : null;
    if (!fileId) { await reply(chatId, "لازم تبعت صورة من جهازك 🙏"); return true; }
    await save("url", { ...draft, image: `tg:${fileId}` });
    await reply(chatId, "🔗 <b>خطوة 3 من 3</b>\nابعت <b>رابط المهمة</b> (يبدأ بـ https://).", { parse_mode: "HTML" });
    return true;
  }

  if (step === "url") {
    if (!/^https?:\/\/\S+$/i.test(text)) { await reply(chatId, "الرابط لازم يبدأ بـ https://"); return true; }
    if (!draft.name || !draft.image) { await clearState(from.id); await reply(chatId, "انتهت الخطوات، ابدأ من جديد.", { reply_markup: mainMenuKeyboard() }); return true; }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const fields = { title: draft.name, action_url: text, description: text, image_url: draft.image };
    const q = mode === "edit" && taskId
      ? db.from("reward_tasks").update(fields).eq("id", taskId).select().single()
      : db.from("reward_tasks").insert({ ...fields, task_key: randomKey(), reward_credits: DEFAULT_REWARD, action_type: "open_url", icon: "coins", active: true, sort_order: 50 }).select().single();
    const { data: row, error } = await q;
    await clearState(from.id);
    if (error || !row) { await reply(chatId, "حصل خطأ في الحفظ، جرّب تاني."); return true; }
    await tg("sendPhoto", {
      chat_id: chatId, photo: draft.image.slice(3),
      caption: `✅ ${mode === "edit" ? "المهمة اتعدّلت" : "المهمة اتضافت"}: <b>${row.title}</b> (+${row.reward_credits} نقطة)\n${text}`,
      parse_mode: "HTML", reply_markup: mainMenuKeyboard(),
    });
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
  if (cmd === "post") {
    await answerCallback(cb.id);
    const idx = await nextPoolIndex();
    const sent = await postToChannel(idx);
    if (sent) await saveDailyState("manual", idx);
    await reply(chatId, sent ? "✅ اتنشر المنشور في القناة." : "فشل النشر — اتأكد إن البوت أدمن في القناة.", {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  if (cmd === "bcast") {
    await answerCallback(cb.id, "جاري الإرسال…");
    const idx = await nextPoolIndex();
    const { sent, failed } = await broadcastPost(idx);
    await reply(chatId, `📨 المنشور اتبعت لـ <b>${sent}</b> مستخدم` + (failed ? ` · فشل ${failed} (غالبًا قفلوا البوت)` : ""), { parse_mode: "HTML", reply_markup: mainMenuKeyboard() });
    return;
  }
  if (cmd === "list") {
    await answerCallback(cb.id);
    await adminTaskList(chatId);
    return;
  }
  if (cmd === "add") {
    await answerCallback(cb.id);
    await setState(cb.from.id, "add:name");
    await reply(chatId, "➕ <b>مهمة جديدة — خطوة 1 من 3</b>\nابعت <b>اسم المهمة</b>.\n\nللإلغاء ابعت «إلغاء».", { parse_mode: "HTML" });
    return;
  }
  if (cmd === "task" && arg1) {
    await answerCallback(cb.id);
    await adminTaskDetail(chatId, arg1);
    return;
  }
  if (cmd === "edit" && arg1) {
    await answerCallback(cb.id);
    await setState(cb.from.id, "edit:name", arg1);
    await reply(chatId, "✏️ <b>تعديل المهمة — خطوة 1 من 3</b>\nابعت <b>الاسم الجديد</b>.\n\nللإلغاء ابعت «إلغاء».", { parse_mode: "HTML" });
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
          // Two daily channel posts, fired lazily on bot traffic (no cron needed).
          maybePostDaily();
          maybeNotifyUsers();
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
            await handleAdminInput(msg.chat.id, from, msg);
            return Response.json({ ok: true });
          }

          if (text === "/start" || text.startsWith("/start ")) {
            await ensureAccount(from);
            // Welcome message: clean character banner, bold English caption, app button.
            const name = (from.first_name ?? "friend").replace(/[<>&]/g, "");
            const caption =
              `<b>${bold(`Welcome to Orange AI, ${name}.`)}</b>\n\n` +
              `<b>${bold("Chat with top AI models, create images and videos, and earn rewards with daily tasks — all inside Telegram.")}</b>`;
            const sent = await tg("sendPhoto", {
              chat_id: msg.chat.id,
              photo: absoluteAssetUrl(charactersGroup.url),
              caption,
              parse_mode: "HTML",
              reply_markup: appButtons(true),
            });
            if (!sent?.ok) {
              console.error("[telegram-bot] start photo failed", sent);
              await reply(msg.chat.id, caption, { reply_markup: appButtons(true) });
            }
          } else if (text === "/help" || text === "/app") {
            await reply(msg.chat.id, "Tap /start to open Orange AI.", {
              reply_markup: { inline_keyboard: [[{ text: "Open Orange AI", web_app: { url: MINIAPP_URL } }]] },
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
