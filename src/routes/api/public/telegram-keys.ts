/** Telegram bot that fills the provider key pools (Cerebras / AgentSky / Browser Use).
 *  Only Telegram (verified by the webhook secret header) can call it; only
 *  registered admins can add, list or remove keys. The first person to send
 *  /start becomes the admin.
 *
 *  Rotation model (no new logic needed — it reuses the existing clean system):
 *  - Cerebras + Browser Use go to the encrypted `service_keys` vault
 *    (providers `cerebras` / `browser-use`). Edge runtime reads them
 *    least-recently-used first, bans a key after 3 consecutive failures and
 *    revives cooled-down keys automatically (`keyVault.ts`).
 *  - AgentSky keeps its existing `agentsky_keys` pool with LRU
 *    (`take_agentsky_key()`), unchanged.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";
import { validateAgentSkyKey } from "@/lib/agentsky/agentsky.server";

export function telegramWebhookSecret(token: string) {
  return createHash("sha256").update(`megsy-keys:${token}`).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const mask = (k: string) => (k.length > 12 ? `${k.slice(0, 6)}…${k.slice(-4)}` : "••••");

type ProviderId = "cerebras" | "agentsky" | "browser-use";

const PROVIDERS: Record<ProviderId, { label: string; icon: string }> = {
  cerebras: { label: "Cerebras", icon: "🧠" },
  agentsky: { label: "AgentSky", icon: "🤖" },
  "browser-use": { label: "Browser Use", icon: "🌐" },
};

// Webhook instances are stateless, so the pending provider lives in memory AND
// every action also has an explicit command form (/add_cerebras KEY …) that
// works even if the instance restarted between the tap and the key message.
const pendingProvider = new Map<number, ProviderId>();

function normalizeProvider(raw: string): ProviderId | null {
  const v = raw.trim().toLowerCase().replace(/_/g, "-");
  if (v === "cerebras" || v === "c") return "cerebras";
  if (v === "agentsky" || v === "agent" || v === "a") return "agentsky";
  if (v === "browser-use" || v === "browseruse" || v === "browser" || v === "b")
    return "browser-use";
  return null;
}

const HELP = [
  "🔑 <b>مفاتيح المزودين</b>",
  "",
  "اختار المزود من الأزرار، وبعدين ابعت المفتاح كرسالة عادية.",
  "أو ابعت مباشرة: <code>/add_cerebras KEY</code> أو <code>/add_agentsky KEY</code> أو <code>/add_browseruse KEY</code>",
  "",
  "/keys — عرض كل المزودين",
  "/keys_cerebras — مفاتيح Cerebras",
  "/keys_agentsky — مفاتيح AgentSky",
  "/keys_browseruse — مفاتيح Browser Use",
  "/del_cerebras رقم — حذف مفتاح",
  "/on_cerebras رقم — تفعيل مفتاح",
  "(نفس الصيغة لـ agentsky و browseruse)",
].join("\n");

function providerMenu() {
  return {
    inline_keyboard: [
      [
        { text: "🧠 Cerebras", callback_data: "keys:provider:cerebras" },
        { text: "🤖 AgentSky", callback_data: "keys:provider:agentsky" },
      ],
      [{ text: "🌐 Browser Use", callback_data: "keys:provider:browser-use" }],
      [{ text: "📊 الإحصائيات", callback_data: "keys:stats" }],
    ],
  };
}

async function validateCerebrasKey(key: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.cerebras.ai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    // 401/403 = bad key. Anything else (200, 404, 405…) means auth passed.
    if (res.status === 401 || res.status === 403) return false;
    return res.ok || res.status === 404 || res.status === 405;
  } catch {
    return false;
  }
}

async function validateBrowserUseKey(key: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.browser-use.com/api/v2/tasks", {
      headers: { "X-Browser-Use-API-Key": key },
    });
    // Credit/auth rejections belong to the key → invalid for rotation.
    if ([401, 402, 403].includes(res.status)) return false;
    return true;
  } catch {
    return false;
  }
}

function vaultAvailable() {
  return Boolean(process.env.KEY_VAULT_SECRET?.trim());
}

/** Node-side AES-GCM encryption compatible with supabase/functions/_shared/keyVault.ts */
async function encryptVaultKey(plain: string): Promise<{ cipher: string; iv: string } | null> {
  const secret = process.env.KEY_VAULT_SECRET?.trim();
  if (!secret) return null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    const aesKey = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
      "encrypt",
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aesKey,
      new TextEncoder().encode(plain),
    );
    const toB64 = (buf: ArrayBuffer) => Buffer.from(buf).toString("base64");
    const toB64Bytes = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
    return { cipher: toB64(enc), iv: toB64Bytes(iv) };
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/telegram-keys")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.TELEGRAM_KEYS_BOT_TOKEN;
        if (!token) return new Response("not configured", { status: 500 });
        const header = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(header, telegramWebhookSecret(token)))
          return new Response("Unauthorized", { status: 401 });

        const update = await request.json().catch(() => null);
        const send = (chatId: number, text: string, replyMarkup?: unknown) =>
          fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              parse_mode: "HTML",
              ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
            }),
          });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;

        const { data: admins } = await db.from("telegram_key_admins").select("telegram_user_id");
        const isAdminUser = (id: number) =>
          (admins ?? []).some((a: any) => Number(a.telegram_user_id) === Number(id));

        // ---- Inline button taps (callback_query) ----
        const callback = update?.callback_query;
        if (callback) {
          const fromId = Number(callback?.from?.id);
          const chatId = Number(callback?.message?.chat?.id);
          const data = String(callback?.data ?? "");
          await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callback_query_id: callback.id }),
          }).catch(() => undefined);
          if (!chatId || !fromId || !isAdminUser(fromId)) return Response.json({ ok: true });

          if (data === "keys:stats") {
            const { data: rows } = await db.from("service_keys").select("provider,status");
            const counts: Record<string, { active: number; banned: number }> = {};
            for (const r of (rows ?? []) as Array<{ provider: string; status: string }>) {
              counts[r.provider] ??= { active: 0, banned: 0 };
              if (r.status === "banned") counts[r.provider].banned += 1;
              else counts[r.provider].active += 1;
            }
            const { data: agents } = await db.from("agentsky_keys").select("id,active");
            const aActive = (agents ?? []).filter((r: any) => r.active).length;
            const aOff = (agents ?? []).length - aActive;
            await send(
              chatId,
              [
                "📊 <b>المفاتيح</b>",
                `🧠 Cerebras: ${counts["cerebras"]?.active ?? 0} نشط / ${counts["cerebras"]?.banned ?? 0} محظور`,
                `🤖 AgentSky: ${aActive} نشط / ${aOff} متوقف`,
                `🌐 Browser Use: ${counts["browser-use"]?.active ?? 0} نشط / ${counts["browser-use"]?.banned ?? 0} محظور`,
                "",
                "التدوير تلقائي: الأقل استخدامًا أولًا، وحظر بعد 3 فشل متتالي مع إحياء تلقائي.",
              ].join("\n"),
              providerMenu(),
            );
            return Response.json({ ok: true });
          }

          const picked = data.startsWith("keys:provider:")
            ? normalizeProvider(data.slice(15))
            : null;
          if (picked) {
            pendingProvider.set(fromId, picked);
            const p = PROVIDERS[picked];
            await send(
              chatId,
              `${p.icon} <b>${p.label}</b>\n\nابعت المفتاح كرسالة عادية، أو استخدم:\n<code>/add_${picked.replace("-", "")} KEY</code>`,
            );
          }
          return Response.json({ ok: true });
        }

        const msg = update?.message;
        const chatId = msg?.chat?.id;
        const fromId = msg?.from?.id;
        const text = String(msg?.text ?? "").trim();
        if (!chatId || !fromId || !text) return Response.json({ ok: true });
        const reply = (body: string, markup?: unknown) => send(chatId, body, markup);

        let isAdmin = isAdminUser(fromId);
        if (!isAdmin && (admins ?? []).length === 0 && text.startsWith("/start")) {
          await db.from("telegram_key_admins").insert({ telegram_user_id: fromId });
          isAdmin = true;
        }
        if (!isAdmin) {
          await reply("غير مسموح.");
          return Response.json({ ok: true });
        }

        const listAgentsky = async () => {
          const { data } = await db
            .from("agentsky_keys")
            .select("id,key_value,active,last_used_at,last_error")
            .order("created_at");
          return (data ?? []) as any[];
        };
        const listVault = async (provider: string) => {
          const { data } = await db
            .from("service_keys")
            .select("id,key_hint,status,last_error,last_used_at")
            .eq("provider", provider)
            .order("created_at");
          return (data ?? []) as any[];
        };
        const formatVaultRows = (rows: any[], icon: string, label: string) =>
          rows.length
            ? [
                `${icon} <b>${label}</b>`,
                ...rows.map(
                  (r, i) =>
                    `${i + 1}. <code>••••${r.key_hint ?? "••••"}</code> ${r.status === "banned" ? "⛔" : "🟢"}${r.last_error ? ` — ${String(r.last_error).slice(0, 60)}` : ""}`,
                ),
              ].join("\n")
            : `${icon} <b>${label}</b>\nمفيش مفاتيح لسه.`;

        const addKey = async (provider: ProviderId, key: string) => {
          if (provider === "agentsky") {
            const ok = await validateAgentSkyKey(key).catch(() => false);
            if (!ok) {
              await reply("المفتاح ده مش شغال عند المزود ❌");
              return;
            }
            const { error } = await db
              .from("agentsky_keys")
              .insert({ key_value: key, added_by_telegram: fromId });
            await reply(
              error
                ? error.code === "23505"
                  ? "المفتاح ده متضاف قبل كده."
                  : "حصلت مشكلة في الحفظ."
                : `اتضاف ${mask(key)} ✅`,
            );
            return;
          }
          const vaultProvider = provider === "cerebras" ? "cerebras" : "browser-use";
          const ok =
            provider === "cerebras"
              ? await validateCerebrasKey(key)
              : await validateBrowserUseKey(key);
          if (!ok) {
            await reply("المفتاح ده مش شغال عند المزود ❌");
            return;
          }
          if (!vaultAvailable()) {
            await reply(
              "KEY_VAULT_SECRET مش متظبط على السيرفر — المفتاح سليم لكن الحفظ المشفر متوقف ❌",
            );
            return;
          }
          const enc = await encryptVaultKey(key.trim());
          if (!enc) {
            await reply("حصلت مشكلة في التشفير قبل الحفظ ❌");
            return;
          }
          const { error } = await db.from("service_keys").insert({
            provider: vaultProvider,
            key_cipher: enc.cipher,
            key_iv: enc.iv,
            key_hint: key.trim().slice(-4),
            label: "telegram",
            status: "active",
            fail_count: 0,
            success_count: 0,
          });
          await reply(
            error
              ? "حصلت مشكلة في الحفظ."
              : `اتضاف ${mask(key)} ✅\nهيدخل التدوير تلقائيًا (الأقل استخدامًا أولًا).`,
          );
        };

        // ---- Commands ----
        if (text.startsWith("/start") || text.startsWith("/help")) {
          await reply(HELP, providerMenu());
          return Response.json({ ok: true });
        }

        const addMatch = text.match(
          /^\/add[_-]?(cerebras|agentsky|agent|browseruse|browser-use|browser)\s+(\S+)\s*$/i,
        );
        if (addMatch) {
          const provider = normalizeProvider(addMatch[1]);
          if (provider) {
            pendingProvider.delete(fromId);
            await addKey(provider, addMatch[2]);
            return Response.json({ ok: true });
          }
        }

        const selectMatch = text.match(
          /^\/(cerebras|agentsky|agent|browseruse|browser-use|browser)\s*$/i,
        );
        if (selectMatch) {
          const provider = normalizeProvider(selectMatch[1]);
          if (provider) {
            pendingProvider.set(fromId, provider);
            const p = PROVIDERS[provider];
            await reply(`${p.icon} <b>${p.label}</b>\n\nابعت المفتاح كرسالة عادية.`);
            return Response.json({ ok: true });
          }
        }

        if (/^\/keys\b/i.test(text)) {
          const rest = text
            .replace(/^\/keys\b/i, "")
            .trim()
            .replace(/_/g, "-")
            .replace(/^-+/, "");
          const only = rest ? normalizeProvider(rest) : null;
          if (only === "cerebras" || only === "browser-use") {
            const vaultProvider = only === "cerebras" ? "cerebras" : "browser-use";
            await reply(
              formatVaultRows(
                await listVault(vaultProvider),
                PROVIDERS[only].icon,
                PROVIDERS[only].label,
              ),
              providerMenu(),
            );
          } else if (only === "agentsky") {
            const rows = await listAgentsky();
            await reply(
              rows.length
                ? [
                    "🤖 <b>AgentSky</b>",
                    ...rows.map(
                      (r, i) =>
                        `${i + 1}. <code>${mask(r.key_value)}</code> ${r.active ? "🟢" : "🔴"}${r.last_error && !r.active ? ` — ${r.last_error.slice(0, 60)}` : ""}`,
                    ),
                  ].join("\n")
                : "🤖 <b>AgentSky</b>\nمفيش مفاتيح لسه.",
              providerMenu(),
            );
          } else if (/^\/keys$/i.test(text)) {
            const [c, b, a] = await Promise.all([
              listVault("cerebras"),
              listVault("browser-use"),
              listAgentsky(),
            ]);
            await reply(
              [
                formatVaultRows(c, "🧠", "Cerebras"),
                "",
                formatVaultRows(b, "🌐", "Browser Use"),
                "",
                a.length
                  ? [
                      "🤖 <b>AgentSky</b>",
                      ...a.map(
                        (r, i) =>
                          `${i + 1}. <code>${mask(r.key_value)}</code> ${r.active ? "🟢" : "🔴"}`,
                      ),
                    ].join("\n")
                  : "🤖 <b>AgentSky</b>\nمفيش مفاتيح لسه.",
              ].join("\n"),
              providerMenu(),
            );
          } else {
            await reply(HELP, providerMenu());
          }
          return Response.json({ ok: true });
        }

        const modMatch = text.match(
          /^\/(del|on)[_-]?(cerebras|agentsky|agent|browseruse|browser-use|browser)?\s+(\d+)\s*$/i,
        );
        if (modMatch) {
          const cmd = modMatch[1].toLowerCase();
          const provider = normalizeProvider(modMatch[2] || "agentsky") ?? "agentsky";
          const n = Number(modMatch[3]);
          if (provider === "agentsky") {
            const row = (await listAgentsky())[n - 1];
            if (!row) await reply("الرقم ده مش موجود.");
            else if (cmd === "del") {
              await db.from("agentsky_keys").delete().eq("id", row.id);
              await reply(`اتحذف ${mask(row.key_value)} ✅`);
            } else {
              await db
                .from("agentsky_keys")
                .update({ active: true, last_error: null })
                .eq("id", row.id);
              await reply(`اتفعل ${mask(row.key_value)} ✅`);
            }
          } else {
            const vaultProvider = provider === "cerebras" ? "cerebras" : "browser-use";
            const row = (await listVault(vaultProvider))[n - 1];
            if (!row) await reply("الرقم ده مش موجود.");
            else if (cmd === "del") {
              await db.from("service_keys").delete().eq("id", row.id);
              await reply(`اتحذف ••••${row.key_hint ?? "••••"} ✅`);
            } else {
              await db
                .from("service_keys")
                .update({ status: "active", fail_count: 0, banned_at: null, last_error: null })
                .eq("id", row.id);
              await reply(`اتفعل ••••${row.key_hint ?? "••••"} ✅`);
            }
          }
          return Response.json({ ok: true });
        }

        // Backward-compatible: /del N and /on N manage AgentSky keys.
        if (/^\/(del|on)\s+\d+/.test(text)) {
          const [cmd, n] = text.split(/\s+/);
          const row = (await listAgentsky())[Number(n) - 1];
          if (!row) await reply("الرقم ده مش موجود.");
          else if (cmd === "/del") {
            await db.from("agentsky_keys").delete().eq("id", row.id);
            await reply(`اتحذف ${mask(row.key_value)} ✅`);
          } else {
            await db
              .from("agentsky_keys")
              .update({ active: true, last_error: null })
              .eq("id", row.id);
            await reply(`اتفعل ${mask(row.key_value)} ✅`);
          }
          return Response.json({ ok: true });
        }

        // Plain key message → pending provider (button-selected) or AgentSky legacy.
        if (/^\S{20,300}$/.test(text)) {
          const provider = pendingProvider.get(fromId) ?? "agentsky";
          pendingProvider.delete(fromId);
          await addKey(provider, text);
          return Response.json({ ok: true });
        }

        await reply(HELP, providerMenu());
        return Response.json({ ok: true });
      },
    },
  },
});
