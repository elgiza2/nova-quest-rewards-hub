/** @doc Crypto checkout — pay with TON / USDT (TON, Ethereum, BSC, Tron, Solana).
 *  Wallets are connected and the transaction is built and sent automatically —
 *  the user never copies an address for the automatic networks. The server
 *  verifies the payment on-chain and grants credits/plan.
 *  Browser-only module: loaded lazily behind <ClientOnly>/lazy so SSR never
 *  imports TonConnect. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { TonConnectUIProvider, useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import "@/lib/bufferPolyfill";
import { beginCell, Address } from "@ton/core";
import QRCode from "qrcode";
import { ArrowLeft, Check, Copy, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useUserLang } from "@/lib/authI18n";
import SEOHead from "@/components/common/SEOHead";

const TON_USDT_MASTER = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiXPCkPNd3kCincpSx-u";
const TRON_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

type Asset = "ton" | "usdt_ton" | "usdt_eth" | "usdt_bsc" | "usdt_sol" | "usdt_tron";

const ASSET_LABELS: Record<Asset, { en: string; ar: string }> = {
  ton: { en: "TON", ar: "TON" },
  usdt_ton: { en: "USDT · TON", ar: "USDT · تون" },
  usdt_eth: { en: "USDT · Ethereum", ar: "USDT · إيثريوم" },
  usdt_bsc: { en: "USDT · BNB Chain", ar: "USDT · بي إن بي" },
  usdt_sol: { en: "USDT · Solana", ar: "USDT · سولانا" },
  usdt_tron: { en: "USDT · Tron", ar: "USDT · ترون" },
};

const AUTO_ASSETS: Asset[] = ["ton", "usdt_ton", "usdt_tron"];

type Invoice = {
  id: string;
  asset: Asset;
  label: string;
  network: string;
  wallet: string;
  payAmount: number;
  decimals: number;
  expectedNano: string;
  memo: string;
  usd: number;
  credits: number;
};

const T = {
  en: {
    title: "Pay with crypto",
    subtitle: "Connect your wallet and the payment is sent automatically.",
    connect: "Connect wallet",
    pay: "Send payment",
    paying: "Confirm in your wallet…",
    waiting: "Waiting for payment…",
    statusPaid: "Payment confirmed — unlocking your credits…",
    fallback: "Send exactly this amount to this address (network auto-checks for you):",
    amount: "Amount",
    address: "Address",
    copy: "Copy",
    copied: "Copied",
    paid: "Payment received 🎉",
    back: "Back",
    noTron: "Install TronLink to pay automatically, or use the address below.",
  },
  ar: {
    title: "ادفع بعملة مشفرة",
    subtitle: "وصّل محفظتك والعامة بتتبعت تلقائي — من غير ما تنسخ أي عنوان.",
    connect: "وصّل المحفظة",
    pay: "ابعت الدفع",
    paying: "أكّد في محفظتك…",
    waiting: "مستنيين الدفع…",
    statusPaid: "الدفع وصل — بنفتح نقاطك حالًا…",
    fallback: "ابعت المبلغ ده بالظبط على العنوان ده (التحقق بيحصل تلقائي):",
    amount: "المبلغ",
    address: "العنوان",
    copy: "انسخ",
    copied: "تم النسخ",
    paid: "وصل الدفع 🎉",
    back: "رجوع",
    noTron: "نزّل TronLink للدفع التلقائي، أو استخدم العنوان تحت.",
  },
};

function jettonTransferPayload(dest: string, amountNano: string): string {
  return beginCell()
    .storeUint(0xf8a7ea5, 32) // jetton transfer op
    .storeUint(0, 64) // query id
    .storeCoins(BigInt(amountNano))
    .storeAddress(Address.parse(dest))
    .storeAddress(null) // response address
    .storeUint(0, 1) // no custom payload
    .storeCoins(0) // forward ton amount
    .storeUint(0, 1) // no forward payload
    .endCell()
    .toBoc()
    .toString("base64");
}

export default function CryptoCheckoutInner() {
  const manifestUrl =
    !window.location.hostname.startsWith("localhost")
      ? `${window.location.origin}/tonconnect-manifest.json`
      : "https://orange-ai-woad.vercel.app/tonconnect-manifest.json";
  return (
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <CheckoutContent />
    </TonConnectUIProvider>
  );
}

function CheckoutContent() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const lang = useUserLang();
  const ar = lang === "ar-eg";
  const t = ar ? T.ar : T.en;

  const sku = params.get("sku");
  const tier = params.get("tier") ?? "pro";
  const interval = params.get("interval") ?? "monthly";

  const [asset, setAsset] = useState<Asset>("usdt_ton");
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [status, setStatus] = useState<"loading" | "pending" | "paid" | "expired">("loading");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  const [tonConnectUI] = useTonConnectUI();
  const tonConnected = Boolean(useTonAddress());
  const qrCanvas = useRef<HTMLCanvasElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const authFetch = useCallback(
    async (url: string, init?: RequestInit) => {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init?.headers ?? {}),
        },
      });
      return { res, token };
    },
    [],
  );

  const createInvoice = useCallback(
    async (which: Asset) => {
      setStatus("loading");
      setInvoice(null);
      const { res, token } = await authFetch("/api/crypto/invoice", {
        method: "POST",
        body: JSON.stringify(
          sku ? { sku, asset: which } : { tier, interval, asset: which },
        ),
      });
      if (!token) {
        navigate(`/auth?redirect=/checkout/crypto?${sku ? `sku=${sku}` : `tier=${tier}&interval=${interval}`}`);
        return;
      }
      const j = await res.json().catch(() => null);
      if (j?.ok) {
        setInvoice(j.invoice as Invoice);
        setStatus("pending");
      } else {
        toast.error(j?.error === "wallet_not_configured" ? "Wallet not configured yet" : "Could not create the payment");
      }
    },
    [authFetch, interval, navigate, sku, tier],
  );

  useEffect(() => {
    void createInvoice(asset);
  }, [asset, createInvoice]);

  // Poll the invoice status; the server verifies the chain and fulfils.
  useEffect(() => {
    if (!invoice || status !== "pending") return;
    const tick = async () => {
      try {
        const { res } = await authFetch(`/api/crypto/invoice?id=${invoice.id}`);
        const j = await res.json().catch(() => null);
        if (j?.status === "paid") {
          setStatus("paid");
          toast.success(t.paid);
          if (pollRef.current) clearInterval(pollRef.current);
          setTimeout(() => navigate("/billing/success"), 1600);
        } else if (j?.status === "expired") {
          setStatus("expired");
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        /* keep polling */
      }
    };
    pollRef.current = setInterval(tick, 5000);
    void tick();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [invoice, status, authFetch, navigate, t.paid]);

  // QR for fallback networks.
  useEffect(() => {
    if (!invoice || !qrCanvas.current) return;
    void QRCode.toCanvas(qrCanvas.current, invoice.wallet, { width: 220, margin: 1 });
  }, [invoice, asset]);

  const payWithTon = async () => {
    if (!invoice) return;
    setSending(true);
    try {
      if (invoice.asset === "ton") {
        await tonConnectUI.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 300,
          network: "-239",
          messages: [
            { address: invoice.wallet, amount: invoice.expectedNano },
          ],
        });
      } else {
        await tonConnectUI.sendTransaction({
          validUntil: Math.floor(Date.now() / 1000) + 300,
          network: "-239",
          messages: [
            {
              address: TON_USDT_MASTER,
              amount: "100000000", // 0.1 TON attached for gas
              payload: jettonTransferPayload(invoice.wallet, invoice.expectedNano),
            },
          ],
        });
      }
      toast.info(t.waiting);
    } catch (e: any) {
      if (!String(e?.message ?? "").toLowerCase().includes("cancel")) {
        toast.error(e?.message ?? "Payment failed");
      }
    } finally {
      setSending(false);
    }
  };

  const payWithTron = async () => {
    if (!invoice) return;
    const tron = (window as any).tronWeb;
    if (!tron?.contract) return;
    setSending(true);
    try {
      const contract = await tron.contract().at(TRON_USDT_CONTRACT);
      await contract.transfer(invoice.wallet, invoice.expectedNano).send();
      toast.info(t.waiting);
    } catch (e: any) {
      toast.error(e?.message ?? "Payment failed");
    } finally {
      setSending(false);
    }
  };

  const copyAddress = async () => {
    if (!invoice) return;
    await navigator.clipboard.writeText(invoice.wallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const hasTron = typeof window !== "undefined" && Boolean((window as any).tronWeb);
  const isAuto = invoice ? AUTO_ASSETS.includes(invoice.asset) && (invoice.asset !== "usdt_tron" || hasTron) : false;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEOHead title="Crypto checkout | Orange AI" description="Pay for Orange AI with TON or USDT." path="/checkout/crypto" />
      <div className="mx-auto max-w-xl px-4 py-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t.back}
        </button>

        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          {(Object.keys(ASSET_LABELS) as Asset[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAsset(a)}
              className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                asset === a ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground/50"
              }`}
            >
              {ar ? ASSET_LABELS[a].ar : ASSET_LABELS[a].en}
            </button>
          ))}
        </div>

        {status === "loading" && (
          <div className="flex justify-center py-14 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
          </div>
        )}

        {invoice && status !== "loading" && (
          <div className="mt-6 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{invoice.label}</span>
              <span className="text-lg font-semibold tabular-nums">${invoice.usd}</span>
            </div>
            {invoice.credits > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">+{invoice.credits.toLocaleString()} MC</p>
            )}

            {status === "paid" ? (
              <div className="mt-6 flex items-center justify-center gap-2 py-8 text-emerald-600 dark:text-emerald-400">
                <Check className="h-5 w-5" /> {t.statusPaid}
              </div>
            ) : status === "expired" ? (
              <div className="mt-6 text-center">
                <p className="text-sm text-muted-foreground">Expired</p>
                <button
                  type="button"
                  onClick={() => createInvoice(asset)}
                  className="mt-3 rounded-full bg-foreground px-5 py-2 text-sm font-semibold text-background"
                >
                  New payment
                </button>
              </div>
            ) : isAuto ? (
              <div className="mt-6">
                {invoice.asset === "usdt_tron" ? (
                  <>
                    <p className="text-xs text-muted-foreground">{t.noTron}</p>
                    <button
                      type="button"
                      onClick={payWithTron}
                      disabled={sending || !hasTron}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-background disabled:opacity-50"
                    >
                      <Wallet className="h-4 w-4" /> {sending ? t.paying : t.pay}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={tonConnected ? payWithTon : undefined}
                    disabled={sending}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-background disabled:opacity-50"
                  >
                    <Wallet className="h-4 w-4" />
                    {sending ? t.paying : tonConnected ? t.pay : t.connect}
                  </button>
                )}
                {!tonConnected && invoice.asset !== "usdt_tron" && (
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    <button type="button" className="underline" onClick={() => tonConnectUI.openModal()}>
                      {t.connect}
                    </button>
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-5 flex flex-col items-center gap-4">
                <p className="text-center text-xs text-muted-foreground">{t.fallback}</p>
                <canvas ref={qrCanvas} className="rounded-xl bg-white p-2" />
                <div className="w-full rounded-xl border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">{t.amount}</p>
                  <p className="text-base font-semibold tabular-nums">
                    {invoice.payAmount} <span className="text-xs font-normal text-muted-foreground">{invoice.label}</span>
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">{t.address}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-xs">{invoice.wallet}</code>
                    <button type="button" onClick={copyAddress} className="shrink-0 rounded-lg bg-muted px-2 py-1 text-xs">
                      {copied ? t.copied : t.copy}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {status === "pending" && (
              <p className="mt-4 inline-flex items-center gap-2 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" /> {t.waiting}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CryptoCheckoutProviders({ children }: { children: React.ReactNode }) {
  const manifestUrl =
    typeof window !== "undefined" && !window.location.hostname.startsWith("localhost")
      ? `${window.location.origin}/tonconnect-manifest.json`
      : "https://orange-ai-woad.vercel.app/tonconnect-manifest.json";
  return <TonConnectUIProvider manifestUrl={manifestUrl}>{children}</TonConnectUIProvider>;
}
