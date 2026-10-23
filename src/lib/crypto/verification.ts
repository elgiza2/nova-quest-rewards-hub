export const TON_USDT_MASTER = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiXPCkPNd3kCincpSx-u";
export type PaymentExpectation = { asset: string; wallet: string; amount: string; memo: string; createdAt: string; expiresAt: string };
function address(value: string): string | null {
  if (/^-?\d+:[a-f\d]{64}$/i.test(value)) return value.toLowerCase();
  try {
    const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    if (bytes.length !== 36) return null;
    return `${bytes[1] > 127 ? bytes[1] - 256 : bytes[1]}:${Array.from(bytes.slice(2, 34), b => b.toString(16).padStart(2, "0")).join("")}`;
  } catch { return null; }
}
export function sameTonAddress(a: string, b: string): boolean {
  const normalized = address(a);
  return normalized !== null && normalized === address(b);
}
export function matchPaymentEvent(event: any, expected: PaymentExpectation): string | null {
  const time = Number(event.timestamp) * 1000;
  if (event.in_progress !== false || event.is_scam || !Number.isFinite(time) || time < Date.parse(expected.createdAt) || time > Date.parse(expected.expiresAt) || Date.now() - time < 30_000) return null;
  if (!/^[a-f\d]{64}$/i.test(event.event_id ?? "")) return null;
  for (const action of event.actions ?? []) {
    if (action.status !== "ok") continue;
    const transfer = expected.asset === "ton" && action.type === "TonTransfer" ? action.TonTransfer : expected.asset === "usdt_ton" && action.type === "JettonTransfer" ? action.JettonTransfer : null;
    if (!transfer || transfer.refund || transfer.encrypted_comment || transfer.comment !== expected.memo) continue;
    if (!sameTonAddress(transfer.recipient?.address ?? "", expected.wallet)) continue;
    if (String(transfer.amount) !== expected.amount) continue;
    if (expected.asset === "usdt_ton" && !sameTonAddress(transfer.jetton?.address ?? "", TON_USDT_MASTER)) continue;
    return event.event_id;
  }
  return null;
}