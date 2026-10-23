/** @doc Detects Telegram Mini App context and signs the user into Supabase
 *  via the local /api/public/telegram-auth endpoint (verifies Telegram
 *  initData server-side and returns a token_hash we exchange for a real
 *  session). */
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  "https://qdnqxjzjecaieuavagvq.supabase.co";
const ANON_KEY =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkbnF4anpqZWNhaWV1YXZhZ3ZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MDY1NTcsImV4cCI6MjEwNDA4MjU1N30.eFK_7U7MRlktAAnQQ_9d4k7tF8N3qZ3QGhKVhH6C3Tg";

/** Fallback only — the live username comes from /api/public/telegram-auth GET. */
const FALLBACK_BOT_USERNAME = "Noveaibot";
const AUTH_ENDPOINT = "/api/public/telegram-auth";
let botUsernameCache: string | null = null;

type TgWebApp = {
  initData?: string;
  initDataUnsafe?: { user?: unknown };
  ready?: () => void;
  expand?: () => void;
  openTelegramLink?: (url: string) => void;
  platform?: string;
};

function tgWebApp(): TgWebApp | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { Telegram?: { WebApp?: TgWebApp } };
  return w.Telegram?.WebApp ?? null;
}

/** Call as early as possible so Telegram populates initData and expands the view. */
export function initTelegramWebApp(): void {
  const tg = tgWebApp();
  if (!tg) return;
  try { tg.ready?.(); } catch { /* ignore */ }
  try { tg.expand?.(); } catch { /* ignore */ }
}

/** Wait briefly for `initData` — the Telegram SDK sometimes populates it
 *  a tick after `WebApp` is available (especially on iOS/Android clients). */
async function waitForInitData(timeoutMs = 1500): Promise<string | null> {
  const tg = tgWebApp();
  if (!tg) return null;
  if (tg.initData && tg.initData.length > 0) return tg.initData;
  initTelegramWebApp();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = tgWebApp();
    if (t?.initData && t.initData.length > 0) return t.initData;
    await new Promise((r) => setTimeout(r, 80));
  }
  return null;
}

export function getTelegramInitData(): string | null {
  const tg = tgWebApp();
  if (tg?.initData && tg.initData.length > 0) return tg.initData;
  return null;
}

/** True when the page is running inside the Telegram in-app browser / Mini App,
 *  even if initData hasn't populated yet. */
export function isInsideTelegram(): boolean {
  const tg = tgWebApp();
  if (!tg) return false;
  if (tg.initData && tg.initData.length > 0) return true;
  if (tg.initDataUnsafe && (tg.initDataUnsafe as { user?: unknown }).user) return true;
  if (typeof tg.platform === "string" && tg.platform && tg.platform !== "unknown") return true;
  return false;
}

/** The bot username from the server (live), falling back to the last known one. */
export async function fetchBotUsername(): Promise<string> {
  if (botUsernameCache) return botUsernameCache;
  try {
    const res = await fetch(AUTH_ENDPOINT);
    const data = await res.json().catch(() => null);
    if (data?.botUsername) {
      botUsernameCache = String(data.botUsername);
      return botUsernameCache;
    }
  } catch { /* fall through */ }
  return FALLBACK_BOT_USERNAME;
}

/** Open the bot's Main Mini App directly. Launching the Mini App signs the
 *  user's identity into `initData` and our auto-login runs on arrival —
 *  no manual /start step needed. */
export async function openBotForLogin() {
  const username = await fetchBotUsername();
  const miniAppUrl = `https://t.me/${username}?startapp=login`;
  const tg = tgWebApp();
  // `tg.openTelegramLink` is a no-op stub outside the real Telegram client
  // (the telegram-web-app.js SDK is loaded globally, so `tg` is truthy in
  // regular browsers too). Only use it when we're actually inside Telegram;
  // otherwise fall back to opening the deep link in a new tab so desktop /
  // mobile Safari users are handed off to Telegram to launch the Mini App.
  if (isInsideTelegram() && tg?.openTelegramLink) {
    tg.openTelegramLink(miniAppUrl);
  } else if (typeof window !== "undefined") {
    // Same-tab navigation is more reliable on mobile than window.open(): it
    // hands the browser directly to Telegram instead of leaving the user in a
    // background tab that cannot ever receive Telegram initData.
    window.location.href = miniAppUrl;
  }
}

export async function signInWithTelegram(): Promise<{ ok: boolean; error?: string }> {
  try {
    // Give the Telegram SDK a moment to populate initData on slow clients.
    const initData = getTelegramInitData() ?? (await waitForInitData());
    if (!initData) {
      // Either not inside Telegram, or inside Telegram's in-app browser but
      // not launched as a Mini App (no initData). In both cases the fix is
      // the same: relaunch through the bot's Main Mini App gateway so
      // Telegram signs the user's identity into initData automatically.
      await openBotForLogin();
      return { ok: false, error: isInsideTelegram() ? "no_init_data" : "not_in_telegram" };
    }
    const resp = await fetch(AUTH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.token_hash || !data.email) {
      return { ok: false, error: data?.error || `auth_failed_${resp.status}` };
    }
    const { data: authData, error } = await supabase.auth.verifyOtp({
      token_hash: data.token_hash,
      // Supabase's current token-hash flow verifies email magic links with
      // type "email". "magiclink" is deprecated and can create/link the user
      // server-side while failing to persist a browser session client-side.
      type: "email",
    });
    if (error) return { ok: false, error: error.message };
    if (authData.session?.access_token && authData.session?.refresh_token) {
      const { error: setErr } = await supabase.auth.setSession({
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
      });
      if (setErr) return { ok: false, error: setErr.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Auto-login when opened inside Telegram Mini App and not already signed in. */
export async function tryAutoLoginTelegram(): Promise<boolean> {
  if (!isInsideTelegram()) return false;
  const { data } = await supabase.auth.getSession();
  if (data.session) return false;
  const r = await signInWithTelegram();
  return r.ok;
}
