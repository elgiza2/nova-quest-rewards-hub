/** Wallet checkout: connects a TON wallet with TonConnect and sends the exact
 *  TON or USDT (TON) payment as one signed transaction; the server confirms it
 *  on-chain by the invoice comment. Load only in the browser after Buffer. */
import "@/lib/bufferPolyfill";
import { useEffect, useState } from "react";
import { beginCell, Address } from "@ton/core";
import { TonConnectButton, TonConnectUIProvider, useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { Check, Loader2, RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useUserLang } from "@/lib/authI18n";
import { TON_USDT_MASTER } from "@/lib/crypto/verification";

type Invoice = { id: string; wallet: string; payAmount: number; memo: string; expectedNano: string; expiresAt: string };
type Props = { tier: string; interval: string; sku?: string | null };

const MANIFEST = "https://orange-ai-beta.vercel.app/tonconnect-manifest.json";

function commentCell(text: string) {
  return beginCell().storeUint(0, 32).storeStringTail(text).endCell();
}

async function usdtWalletOf(owner: string): Promise<string> {
  const ownerAddr = Address.parse(owner);
  // 1) toncenter v3 index
  try {
    const r = await fetch(`https://toncenter.com/api/v3/jetton/wallets?owner_address=${encodeURIComponent(ownerAddr.toString())}&jetton_address=${encodeURIComponent(TON_USDT_MASTER)}&limit=1`);
    if (r.ok) {
      const j = (await r.json()) as { jetton_wallets?: { address?: string }[] };
      const a = j.jetton_wallets?.[0]?.address;
      if (a) return a;
    }
  } catch { /* try next */ }
  // 2) tonapi
  try {
    const r = await fetch(`https://tonapi.io/v2/accounts/${encodeURIComponent(ownerAddr.toRawString())}/jettons/${encodeURIComponent(TON_USDT_MASTER)}`);
    if (r.ok) {
      const j = (await r.json()) as { wallet_address?: { address?: string } };
      if (j.wallet_address?.address) return j.wallet_address.address;
    }
  } catch { /* try next */ }
  // 3) ask the USDT master contract directly
  const cell = beginCell().storeAddress(ownerAddr).endCell().toBoc().toString("base64");
  const r = await fetch("https://toncenter.com/api/v2/runGetMethod", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: TON_USDT_MASTER, method: "get_wallet_address", stack: [["tvm.Slice", cell]] }),
  });
  const j = (await r.json()) as { ok?: boolean; result?: { stack?: any[] } };
  const b64 = j.result?.stack?.[0]?.[1]?.bytes;
  if (!j.ok || !b64) throw new Error("no_usdt");
  const { Cell } = await import("@ton/core");
  return Cell.fromBase64(b64).beginParse().loadAddress().toString();
}

function Inner({ tier, interval, sku }: Props) {
  const ar = useUserLang() === "ar-eg";
  const [tonConnectUI] = useTonConnectUI();
  const owner = useTonAddress(false);
  const [asset, setAsset] = useState<"usdt_ton" | "ton">("usdt_ton");
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "sending" | "pending" | "paid" | "expired" | "error">("loading");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  async function request(url: string, body?: object) {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error(ar ? "افتح التطبيق من تليجرام للدفع" : "Open the app from Telegram to pay");
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await res.json();
    if (!res.ok || !result.ok) throw new Error(ar ? "الدفع غير متاح الآن، جرّب تاني" : "Payment is unavailable right now. Please retry.");
    return result;
  }

  useEffect(() => {
    let alive = true;
    setInvoice(null); setStatus("loading"); setError("");
    request("/api/crypto/invoice", sku ? { sku, asset } : { tier, interval, asset })
      .then((d) => { if (alive) { setInvoice(d.invoice); setStatus("ready"); } })
      .catch((e) => { if (alive) { setStatus("error"); setError(e.message); } });
    return () => { alive = false; };
  }, [tier, interval, sku, asset, retry]);

  useEffect(() => {
    if (!invoice || status !== "pending") return;
    let alive = true;
    const check = async () => {
      try { const d = await request(`/api/crypto/invoice?id=${invoice.id}`); if (alive && d.status !== "pending") setStatus(d.status); }
      catch { /* keep waiting; a failed check never confirms payment */ }
    };
    void check();
    const t = setInterval(() => void check(), 8000);
    return () => { alive = false; clearInterval(t); };
  }, [invoice, status]);

  const pay = async () => {
    if (!invoice) return;
    if (!owner) { await tonConnectUI.openModal(); return; }
    setStatus("sending"); setError("");
    try {
      const validUntil = Math.floor(Date.now() / 1000) + 600;
      let message;
      if (asset === "ton") {
        message = { address: invoice.wallet, amount: invoice.expectedNano, payload: commentCell(invoice.memo).toBoc().toString("base64") };
      } else {
        const jettonWallet = await usdtWalletOf(owner);
        const body = beginCell()
          .storeUint(0xf8a7ea5, 32).storeUint(Date.now(), 64)
          .storeCoins(BigInt(invoice.expectedNano))
          .storeAddress(Address.parse(invoice.wallet))
          .storeAddress(Address.parse(owner))
          .storeBit(0)
          .storeCoins(1n)
          .storeBit(1).storeRef(commentCell(invoice.memo))
          .endCell();
        message = { address: jettonWallet, amount: "50000000", payload: body.toBoc().toString("base64") };
      }
      await tonConnectUI.sendTransaction({ validUntil, messages: [message] });
      setStatus("pending");
    } catch (e: any) {
      setStatus("ready");
      setError(e?.message === "no_usdt"
        ? (ar ? "محفظتك مفيهاش USDT على شبكة TON" : "Your wallet has no USDT on TON")
        : (ar ? "الدفع اتلغى أو فشل؛ مفيش فلوس اتسحبت" : "Payment was cancelled or failed; nothing was charged"));
    }
  };

  const unit = asset === "ton" ? "TON" : "USDT";
  return (
    <div className="manual-crypto-panel space-y-5" dir={ar ? "rtl" : "ltr"}>
      <div className="flex gap-2" role="tablist" aria-label="Crypto asset">
        {(["usdt_ton", "ton"] as const).map((k) => (
          <Button key={k} variant="outline" role="tab" aria-selected={asset === k} disabled={status === "sending" || status === "pending"} onClick={() => setAsset(k)}>
            {k === "ton" ? "TON" : "USDT"}
          </Button>
        ))}
      </div>
      <div className="flex justify-center"><TonConnectButton /></div>
      {status === "loading" && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{ar ? "بنجهز الدفع…" : "Preparing payment…"}</p>}
      {invoice && status !== "paid" && status !== "loading" && (
        <>
          <div>
            <p className="text-xs text-muted-foreground">{ar ? "المبلغ" : "Amount"}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">{invoice.payAmount} {unit}</p>
          </div>
          {(status === "ready" || status === "sending") && (
            <Button className="w-full" size="lg" disabled={status === "sending"} onClick={() => void pay()}>
              {status === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
              {owner ? (ar ? `ادفع ${invoice.payAmount} ${unit}` : `Pay ${invoice.payAmount} ${unit}`) : (ar ? "اربط المحفظة" : "Connect wallet")}
            </Button>
          )}
          {status === "pending" && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{ar ? "المعاملة اتبعتت، بنأكدها على الشبكة…" : "Transaction sent, confirming on-chain…"}</p>}
          {status === "expired" && <p role="status" className="text-sm">{ar ? "انتهت صلاحية الطلب" : "Invoice expired"}</p>}
        </>
      )}
      {status === "paid" && <p role="status" className="flex items-center gap-2 font-semibold"><Check className="h-5 w-5" />{ar ? "الدفع مؤكد والاشتراك اتفعّل" : "Payment confirmed and purchase activated"}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {(status === "expired" || status === "error") && <Button variant="outline" onClick={() => setRetry((v) => v + 1)}><RefreshCw className="h-4 w-4" />{ar ? "حاول تاني" : "Try again"}</Button>}
    </div>
  );
}

export default function TonWalletPayment(props: Props) {
  return (
    <TonConnectUIProvider manifestUrl={MANIFEST} actionsConfiguration={{ twaReturnUrl: "https://t.me/" as `${string}://${string}` }}>
      <Inner {...props} />
    </TonConnectUIProvider>
  );
}
