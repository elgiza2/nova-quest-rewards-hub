/** Public Telegram Mini App auth endpoint.
 *
 *  POST { initData } — verifies the Telegram initData signature server-side
 *  (HMAC-SHA256 with the bot token), finds or creates the matching Supabase
 *  user, and returns a magic-link token_hash the client exchanges for a real
 *  session via supabase.auth.verifyOtp.
 *
 *  GET — returns { botUsername } so the client can build the bot Mini App
 *  deep link without hardcoding it.
 */
import { createFileRoute } from "@tanstack/react-router";

type TgUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
};

const EMAIL_DOMAIN = "users.orangeai.telegram";

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeErrorDetails(error: unknown) {
  const value = error as { code?: unknown; name?: unknown; status?: unknown; message?: unknown } | null;
  const message = typeof value?.message === "string" ? value.message : "";
  return {
    name: typeof value?.name === "string" ? value.name.slice(0, 80) : "unknown",
    code: typeof value?.code === "string" ? value.code.slice(0, 80) : "unknown",
    status: typeof value?.status === "number" ? value.status : null,
    message: message
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
      .replace(/\b\d{7,}\b/g, "[id]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token]")
      .slice(0, 180),
  };
}

async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    "raw",
    key instanceof Uint8Array ? key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
}

/** Returns the parsed fields when initData is valid and fresh, else null. */
export async function verifyInitData(initData: string, botToken: string): Promise<TgUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  // Telegram derives the secret key as HMAC-SHA256(key="WebAppData", data=bot_token).
  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const computed = hex(await hmac(secret, dataCheckString));
  if (computed !== hash.toLowerCase()) return null;
  const authDate = Number(params.get("auth_date") || 0);
  // Reject data older than 24h — Telegram signs auth_date at Mini App launch.
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) return null;
  try {
    const user = JSON.parse(params.get("user") || "null") as TgUser | null;
    return user && Number.isFinite(user.id) ? user : null;
  } catch {
    return null;
  }
}

let cachedBotUsername: { value: string; at: number } | null = null;

async function botUsername(botToken: string): Promise<string | null> {
  if (cachedBotUsername && Date.now() - cachedBotUsername.at < 3600_000) return cachedBotUsername.value;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const json = (await res.json()) as { ok?: boolean; result?: { username?: string } };
    const name = json.ok ? json.result?.username ?? null : null;
    if (name) cachedBotUsername = { value: name, at: Date.now() };
    return name;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/telegram-auth")({
  server: {
    handlers: {
      GET: async () => {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        console.info("[telegram-auth] GET bot username", { configured: Boolean(token) });
        if (!token) return Response.json({ ok: false, error: "not_configured" }, { status: 500 });
        const username = await botUsername(token);
        return Response.json({ ok: true, botUsername: username });
      },
      POST: async ({ request }) => {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
          console.error("[telegram-auth] POST rejected: bot token is not configured");
          return Response.json({ ok: false, error: "not_configured" }, { status: 500 });
        }

        const body = (await request.json().catch(() => null)) as { initData?: string } | null;
        const initData = body?.initData;
        console.info("[telegram-auth] POST received", {
          hasInitData: Boolean(initData),
          initDataLength: typeof initData === "string" ? initData.length : 0,
        });
        if (!initData) {
          console.warn("[telegram-auth] POST rejected: initData is missing");
          return Response.json({ ok: false, error: "missing_init_data" }, { status: 400 });
        }

        const tgUser = await verifyInitData(initData, botToken);
        if (!tgUser) {
          const params = new URLSearchParams(initData);
          const authDate = Number(params.get("auth_date") || 0);
          const ageSeconds = authDate ? Math.round(Date.now() / 1000 - authDate) : null;
          const reason = !params.has("hash")
            ? "missing_hash"
            : !authDate
              ? "missing_auth_date"
              : Math.abs(ageSeconds ?? 0) > 86400
                ? "stale_auth_date"
                : "signature_or_user_invalid";
          console.warn("[telegram-auth] initData rejected", { reason, ageSeconds });
          return Response.json({ ok: false, error: "invalid_init_data" }, { status: 401 });
        }
        console.info("[telegram-auth] Telegram signature verified");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;

        // Find the linked app user for this Telegram account.
        const { data: profile } = await db
          .from("telegram_profiles")
          .select("user_id")
          .eq("telegram_user_id", tgUser.id)
          .maybeSingle();

        let userId: string | null = profile?.user_id ?? null;
        let email: string;

        if (userId) {
          const { data: authUser } = await db.auth.admin.getUserById(userId);
          email = authUser?.user?.email ?? `tg${tgUser.id}@${EMAIL_DOMAIN}`;
        } else {
          email = `tg${tgUser.id}@${EMAIL_DOMAIN}`;
          const full_name =
            [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || tgUser.username || "Telegram user";
          const { data: created, error: createErr } = await db.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: { full_name, telegram_id: tgUser.id, provider: "telegram" },
          });
          if (createErr) {
            // The email may already exist (e.g. signed up normally earlier) — recover it.
            if (String((createErr as { code?: string }).code ?? "").includes("already") ||
                String((createErr as { message?: string }).message ?? "").toLowerCase().includes("already registered")) {
              const { data: byEmail } = await db.auth.admin.listUsers({ page: 1, perPage: 50 });
              let match = (byEmail?.users ?? []).find(
                (u: { email?: string }) => u.email?.toLowerCase() === email,
              );
              if (!match) {
                for (let page = 2; page <= 20 && !match; page += 1) {
                  const { data: more } = await db.auth.admin.listUsers({ page, perPage: 50 });
                  const found = (more?.users ?? []).find(
                    (u: { email?: string }) => u.email?.toLowerCase() === email,
                  );
                  if (found) match = found; else if ((more?.users ?? []).length < 50) break;
                }
              }
              if (match) {
                userId = match.id;
                email = match.email ?? email;
              } else {
                console.error("[telegram-auth] Existing auth user could not be recovered");
                return Response.json({ ok: false, error: "user_create_failed" }, { status: 500 });
              }
            } else {
              console.error("[telegram-auth] Supabase user creation failed", {
                ...safeErrorDetails(createErr),
              });
              return Response.json({ ok: false, error: "user_create_failed" }, { status: 500 });
            }
          } else {
            userId = created.user?.id ?? null;
          }

          if (userId) {
            await db.from("telegram_profiles").upsert(
              {
                user_id: userId,
                telegram_user_id: tgUser.id,
                username: tgUser.username ?? null,
                first_name: tgUser.first_name ?? null,
                last_name: tgUser.last_name ?? null,
                language_code: tgUser.language_code ?? null,
                is_premium: tgUser.is_premium ?? false,
                photo_url: tgUser.photo_url ?? null,
              },
              { onConflict: "user_id" },
            );
          }
        }

        if (!userId) return Response.json({ ok: false, error: "user_create_failed" }, { status: 500 });

        const fullName=[tgUser.first_name,tgUser.last_name].filter(Boolean).join(" ") || tgUser.username || "Telegram user";
        await db.from("telegram_profiles").upsert({user_id:userId,telegram_user_id:tgUser.id,username:tgUser.username??null,first_name:tgUser.first_name??null,last_name:tgUser.last_name??null,photo_url:tgUser.photo_url??null},{onConflict:"user_id"});
        if (tgUser.photo_url && /^https:\/\//.test(tgUser.photo_url)) {
          await db.from("profiles").update({avatar_url:tgUser.photo_url,display_name:fullName}).eq("id",userId);
          await db.auth.admin.updateUserById(userId,{user_metadata:{avatar_url:tgUser.photo_url,full_name:fullName,telegram_id:tgUser.id,provider:"telegram"}});
        }

        // Mint a session the browser can claim: Supabase generateLink for an
        // already-confirmed user returns a hashed token instead of sending mail.
        const { data: link, error: linkErr } = await db.auth.admin.generateLink({
          type: "magiclink",
          email,
        });
        const tokenHash = (link?.properties as { hashed_token?: string } | undefined)?.hashed_token;
        if (linkErr || !tokenHash) {
          console.error("[telegram-auth] Supabase session token mint failed", {
            code: String((linkErr as { code?: string } | null)?.code ?? "missing_token_hash"),
          });
          return Response.json({ ok: false, error: "session_mint_failed" }, { status: 500 });
        }
        console.info("[telegram-auth] Session token minted successfully");
        return Response.json({ ok: true, token_hash: tokenHash, email });
      },
    },
  },
});
