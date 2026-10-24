import { describe, expect, it } from "vitest";
import { verifyInitData } from "./telegram-auth";

async function hmac(key: Uint8Array | ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const rawKey =
    key instanceof Uint8Array
      ? key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength)
      : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signedInitData(botToken: string, authDate: number): Promise<string> {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAEAAAB-test-query",
    user: JSON.stringify({ id: 123456789, first_name: "Telegram", username: "test_user" }),
  });
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secretKey = await hmac(new TextEncoder().encode(botToken), "WebAppData");
  params.set("hash", toHex(await hmac(secretKey, dataCheckString)));
  return params.toString();
}

describe("Telegram initData verification", () => {
  const botToken = "123456789:unit-test-bot-token";

  it("accepts initData signed with HMAC(bot token, WebAppData)", async () => {
    const initData = await signedInitData(botToken, Math.floor(Date.now() / 1000));

    await expect(verifyInitData(initData, botToken)).resolves.toEqual({
      id: 123456789,
      first_name: "Telegram",
      username: "test_user",
    });
  });

  it("rejects initData signed for a different bot token", async () => {
    const initData = await signedInitData(botToken, Math.floor(Date.now() / 1000));

    await expect(verifyInitData(initData, "987654321:another-bot-token")).resolves.toBeNull();
  });

  it("rejects expired initData even when its signature is valid", async () => {
    const initData = await signedInitData(botToken, Math.floor(Date.now() / 1000) - 86_401);

    await expect(verifyInitData(initData, botToken)).resolves.toBeNull();
  });
});
