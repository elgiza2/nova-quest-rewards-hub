import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ verifyOtp: vi.fn(), setSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));

import { signInWithTelegram } from "./telegramAuth";

describe("Telegram sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(window, { Telegram: { WebApp: { initData: "signed-launch-data", platform: "android" } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token_hash: "single-use-token", email: "test@app.local" }),
    }));
    auth.verifyOtp.mockResolvedValue({ data: { session: { user: { id: "telegram-user" } } }, error: null });
  });

  it("shares one request and one token exchange between concurrent startup callers", async () => {
    const first = signInWithTelegram();
    const second = signInWithTelegram();
    expect(second).toBe(first);
    expect(await Promise.all([first, second])).toEqual([{ ok: true }, { ok: true }]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "single-use-token", type: "email" });
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it("allows a fresh retry after a failed shared attempt", async () => {
    auth.verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: { message: "Expired token" } });
    expect(await signInWithTelegram()).toEqual({ ok: false, error: "Expired token" });
    expect(await signInWithTelegram()).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(auth.verifyOtp).toHaveBeenCalledTimes(2);
  });

  it("does not report success without an established session", async () => {
    auth.verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: null });
    expect(await signInWithTelegram()).toEqual({ ok: false, error: "session_missing" });
  });
});