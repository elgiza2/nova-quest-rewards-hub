import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "./CardPreview";
import { BrandIcon } from "./PaymentMethodMark";
import artCoat from "@/assets/orange-coat.png.asset.json";

import {
  applePaySupported,
  loadKashierSdk,
  openApplePaySession,
  onlyDigits,
  payWithCard,
  requestWalletPayment,
  watchWalletPayment,
  type KashierOrder,
} from "@/lib/payments/kashier";
import { startDodoCheckout } from "@/lib/payments/dodo";
import type { PlanTier } from "@/data/pricingData";

type Props = { open: boolean; tier: PlanTier; interval: "monthly" | "yearly"; onClose: () => void };

function formatCardNumber(value: string) {
  return onlyDigits(value)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

export default function CustomCardForm({ open, tier, interval, onClose }: Props) {
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [cvv, setCvv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threeDsUrl, setThreeDsUrl] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [result, setResult] = useState<"idle" | "processing" | "success">("idle");
  const [stage, setStage] = useState<"main" | "wallet">("main");
  const [method, setMethod] = useState<TileId>("visa");
  const [phone, setPhone] = useState("");
  const [walletWaiting, setWalletWaiting] = useState(false);
  const [applePay, setApplePay] = useState(false);
  const [startingMethod, setStartingMethod] = useState<string | null>(null);
  const [methodNote, setMethodNote] = useState<string | null>(null);
  const stopWatchRef = useRef<(() => void) | null>(null);

  // Apple Pay exists only on Apple devices with a card in Wallet.
  useEffect(() => {
    if (open) setApplePay(applePaySupported());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const listener = (event: MessageEvent) => {
      const data = event.data as { message?: string; params?: { status?: string } } | null;
      if (data?.message !== "merchantStoreRedirect") return;
      setThreeDsUrl(null);
      setBusy(false);
      if (data.params?.status === "SUCCESS") setResult("success");
      else setError("Your bank didn’t confirm the payment. Try another card or a different method.");
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setNumber("");
      setName("");
      setMonth("");
      setYear("");
      setCvv("");
      setBusy(false);
      setError(null);
      setThreeDsUrl(null);
      setOrderId(null);
      setResult("idle");
      setStage("main");
      setPhone("");
      setWalletWaiting(false);
      setStartingMethod(null);
      setMethodNote(null);
    }
    if (!open) {
      stopWatchRef.current?.();
      stopWatchRef.current = null;
    }
  }, [open]);

  useEffect(() => () => stopWatchRef.current?.(), []);
  if (!open) return null;

  const fail = (cause: unknown, fallback: string) => {
    setError(cause instanceof Error ? cause.message : fallback);
    setBusy(false);
  };

  const submitCard = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    setResult("processing");
    try {
      const outcome = await payWithCard(tier, interval, { number, name, month, year, cvv });
      setOrderId(outcome.orderId);
      if (outcome.kind === "3ds") setThreeDsUrl(outcome.url);
      else setResult("success");
    } catch (cause) {
      fail(cause, "Something went wrong while paying.");
      setResult("idle");
    } finally {
      setNumber("");
      setName("");
      setMonth("");
      setYear("");
      setCvv("");
    }
  };

  const submitWallet = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const order: KashierOrder = await requestWalletPayment(tier, interval, phone);
      setOrderId(order.order_id);
      setWalletWaiting(true);
      setBusy(false);
      stopWatchRef.current?.();
      stopWatchRef.current = watchWalletPayment(order, (status) => {
        stopWatchRef.current = null;
        setWalletWaiting(false);
        setBusy(false);
        if (status === "success") setResult("success");
        else if (status === "expired") setError("The approval window expired. Please try again.");
        else setError("The wallet declined the payment or its window expired. Please try again.");
      });
    } catch (cause) {
      fail(cause, "Something went wrong while paying.");
    }
  };

  const cancelWallet = () => {
    stopWatchRef.current?.();
    stopWatchRef.current = null;
    setWalletWaiting(false);
    setBusy(false);
    setError(null);
  };

  const back = () => {
    if (walletWaiting) {
      cancelWallet();
      return;
    }
    if (busy) return;
    if (stage !== "main" && !threeDsUrl && result !== "success") {
      setStage("main");
      setError(null);
    } else onClose();
  };

  /** Sends the customer to the Dodo Payments checkout for the extra methods. */
  const startRedirect = async (methodId: string | null, label: string) => {
    if (busy || walletWaiting || startingMethod) return;
    setError(null);
    setMethodNote(null);
    setStartingMethod(methodId ?? "more");

    const outcome = await startDodoCheckout({
      tier,
      interval,
      methodId: methodId ?? undefined,
    });
    setStartingMethod(null);
    if (outcome.ok) return;

    const { reason, message } = outcome;
    setMethodNote(
      reason === "not-configured"
        ? `${label} is being connected — it goes live shortly. Card and Vodafone Cash work right now.`
        : reason === "unauthenticated"
          ? "Please sign in again to continue."
          : message ?? "We couldn’t open the secure checkout. Please try again.",
    );
  };

  const view = threeDsUrl ? "verify" : result === "success" ? "done" : stage;

  return (
    <section
      className="botanical-pricing megsy-checkout z-[120]"
      data-wide={view === "verify" ? "true" : undefined}
      dir="ltr"
      aria-labelledby="checkout-title"
    >
      <div aria-hidden="true" className="botanical-art">
        <img src={artCoat.url} alt="" fetchPriority="high" width={768} height={1376} />
      </div>
      <div aria-hidden="true" className="botanical-scrim" />
      <div className="botanical-content botanical-checkout-content">
        <header className="checkout-nav">
          <Button
            variant="ghost"
            type="button"
            onClick={back}
            disabled={busy}
            aria-label="Back"
            title="Back"
            className="megsy-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </header>

        <div key={view} className="checkout-stage">
          <h1 id="checkout-title" className="checkout-title">
            {result === "success" ? "Payment complete" : threeDsUrl ? "Confirm your payment" : "Payment"}
          </h1>

          {threeDsUrl ? (
            <div className="mt-6 flex flex-1 flex-col space-y-4">
              <p className="checkout-note">Complete your bank’s verification to finish the payment.</p>
              <div className="checkout-frame checkout-frame--verify">
                <iframe title="Bank verification" src={threeDsUrl} allow="payment *" />
              </div>
            </div>
          ) : result === "success" ? (
            <div className="flex flex-1 flex-col">
              <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
                <span className="checkout-success-badge">
                  <Check aria-hidden="true" />
                </span>
                <h2 className="checkout-subtitle mt-6 text-xl font-semibold">Thank you</h2>
                <p className="checkout-note mt-3">
                  We’re confirming the payment and activating your subscription in a moment.
                </p>
                {orderId && (
                  <p className="mt-2 max-w-full break-all font-mono text-xs text-muted-foreground">{orderId}</p>
                )}
              </div>
              <Button variant="ghost" type="button" className="megsy-pay-cta" onClick={onClose}>
                Continue
              </Button>
            </div>
          ) : (
            <div className="checkout-allinone">
              <div className="checkout-methods" role="tablist" aria-label="Payment method">
                {METHODS.filter((m) => m.id !== "apple_pay" || applePay).map((m) => (
                  <Button
                    variant="ghost"
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={m.redirect === undefined && method === m.id}
                    data-selected={m.redirect === undefined && method === m.id}
                    disabled={busy || walletWaiting || startingMethod !== null}
                    onClick={() => {
                      if (m.redirect !== undefined) {
                        void startRedirect(m.redirect, m.label);
                        return;
                      }
                      setError(null);
                      setMethod(m.id);
                    }}
                    className="checkout-method"
                  >
                    {startingMethod === m.id ? (
                      <Loader2 className="h-[22px] w-[22px] animate-spin" />
                    ) : (
                      <TileLogo id={m.id} />
                    )}
                    <span>{m.label}</span>
                  </Button>
                ))}
              </div>

              <div key={method} className="checkout-panel">
                {method === "visa" ? (
                  <form onSubmit={submitCard} className="checkout-card-form" autoComplete="off">
                    <Field label="Card number">
                      <input
                        inputMode="numeric"
                        autoComplete="cc-number"
                        dir="ltr"
                        value={formatCardNumber(number)}
                        onChange={(e) => setNumber(e.target.value)}
                        placeholder="1234 5678 9012 3456"
                      />
                    </Field>
                    <Field label="Name on card">
                      <input
                        autoComplete="cc-name"
                        dir="ltr"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Full name"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Expiry">
                        <input
                          inputMode="numeric"
                          autoComplete="cc-exp"
                          value={month ? `${month}${month.length === 2 ? " / " : ""}${year}` : ""}
                          onChange={(e) => {
                            const d = e.target.value.replace(/\D/g, "").slice(0, 4);
                            setMonth(d.slice(0, 2));
                            setYear(d.slice(2));
                          }}
                          placeholder="MM / YY"
                        />
                      </Field>
                      <Field label="CVV">
                        <input
                          type="password"
                          inputMode="numeric"
                          autoComplete="cc-csc"
                          value={cvv}
                          onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                          placeholder="•••"
                        />
                      </Field>
                    </div>
                    {error && <ErrorBox text={error} />}
                    <Button variant="ghost" type="submit" data-plain disabled={busy} className="megsy-pay-cta">
                      {busy ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" /> Processing…
                        </>
                      ) : (
                        "Pay now"
                      )}
                    </Button>
                  </form>
                ) : method === "vodafone" ? (
                  <form onSubmit={submitWallet} className="checkout-card-form" autoComplete="off">
                    {walletWaiting ? (
                      <div className="flex flex-col items-center py-6 text-center">
                        <Loader2 className="h-9 w-9 animate-spin" />
                        <h2 className="checkout-subtitle mt-4 text-lg font-semibold">
                          Approve the payment on your phone
                        </h2>
                        <p className="checkout-note mt-2">
                          Request sent to <span dir="ltr">+20 {phone}</span>. Open Ana Vodafone or dial *9#,
                          then enter your PIN.
                        </p>
                        <Button variant="ghost" type="button" onClick={cancelWallet} className="megsy-pay-quiet mt-4">
                          Change number or cancel
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Field label="Wallet number">
                          <span className="wallet-prefix">+20</span>
                          <input
                            inputMode="tel"
                            autoComplete="tel-national"
                            dir="ltr"
                            aria-label="Vodafone Cash wallet number"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                            placeholder="10 0000 0000"
                          />
                        </Field>
                        <p className="checkout-note">We'll send a payment request to approve on your phone.</p>
                        {error && <ErrorBox text={error} />}
                        <Button variant="ghost" type="submit" data-plain disabled={busy} className="megsy-pay-cta">
                          {busy ? (
                            <>
                              <Loader2 className="h-5 w-5 animate-spin" /> Sending…
                            </>
                          ) : (
                            "Send payment request"
                          )}
                        </Button>
                      </>
                    )}
                  </form>
                ) : (
                  <ApplePayPanel
                    tier={tier}
                    interval={interval}
                    onPaid={(id) => {
                      setOrderId(id);
                      setResult("success");
                    }}
                  />
                )}
              </div>

              {methodNote && (
                <p
                  role="status"
                  className="mt-4 text-center text-[12.5px] leading-relaxed text-foreground/75"
                >
                  {methodNote}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Apple Pay straight inside our checkout: Kashier's SDK draws the real Apple Pay
 * button and the Wallet sheet opens on top of Megsy — no redirect anywhere.
 */
function ApplePayPanel({
  tier,
  interval,
  onPaid,
}: {
  tier: PlanTier;
  interval: "monthly" | "yearly";
  onPaid: (orderId: string) => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let alive = true;
    (async () => {
      try {
        const sessionInfo = await openApplePaySession(tier, interval);
        await loadKashierSdk();
        const sdk = (window as any).kashierSDK;
        if (!sdk?.load) throw new Error("Apple Pay isn’t available on this device.");
        sdk.load({
          data: { mode: sessionInfo.mode, sessionId: sessionInfo.sessionId },
          locale: "en",
          onSuccess: () => {
            if (alive) onPaid(sessionInfo.orderId);
          },
          onFailure: (detail: any) => {
            if (!alive) return;
            setState("failed");
            setMessage(
              detail?.messages?.en || "Apple Pay couldn’t finish the payment. Try the card option.",
            );
          },
          onPaymentMethodRender: () => {
            if (alive) setState("ready");
          },
        });
        if (alive) setState("ready");
      } catch (cause) {
        if (!alive) return;
        setState("failed");
        setMessage(
          cause instanceof Error ? cause.message : "Apple Pay isn’t available right now.",
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [tier, interval, onPaid]);

  return (
    <div className="checkout-card-form">
      <div id="kashier-sdk-id" className="apay-slot" />
      <div id="kashier-success-id" hidden />
      <div id="kashier-failure-id" hidden />
      {state === "loading" && (
        <p className="checkout-note flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Preparing Apple Pay…
        </p>
      )}
      {state === "failed" && <ErrorBox text={message ?? "Apple Pay isn’t available right now."} />}
      <p className="checkout-note">
        Confirm with Face ID or Touch ID — your card details stay with Apple.
      </p>
    </div>
  );
}

type TileId = "visa" | "apple_pay" | "vodafone" | "google_pay" | "more";
type Tile = { id: TileId; label: string; redirect?: string | null };
const METHODS: Tile[] = [
  { id: "visa", label: "Card" },
  { id: "apple_pay", label: "Apple Pay" },
  { id: "vodafone", label: "Vodafone" },
  { id: "google_pay", label: "Google Pay", redirect: "google_pay" },
  { id: "more", label: "More", redirect: null },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="checkout-field">
      <span>{label}</span>
      <div className="checkout-input-wrap">{children}</div>
    </label>
  );
}

function TileLogo({ id }: { id: TileId }) {
  switch (id) {
    case "visa":
      return (
        <span className="payment-card-pair" aria-hidden="true">
          <BrandMark brand="visa" />
          <BrandMark brand="mastercard" />
        </span>
      );
    case "apple_pay":
      return (
        <svg viewBox="0 0 17 20" className="h-[17px] w-[15px]" fill="currentColor">
          <path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM11.5 3c.7-.9 1.2-2 1-3.2-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3.1 1.1.1 2.2-.6 2.9-1.4z" />
        </svg>
      );
    case "google_pay":
      return <BrandIcon slug="googlepay" className="h-[22px] w-[22px]" />;
    case "more":
      return <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2} />;
    case "vodafone":
      return (
        <svg viewBox="0 0 24 24" className="h-[20px] w-[20px]">
          <circle cx="12" cy="12" r="12" className="payment-red" />
          <path
            className="payment-white"
            d="M12.6 5.2c2.3-.6 4.4.2 5 .6-1.8.1-3.5 1.4-3.5 3.6 2 .5 3.4 2 3.4 4.2 0 2.700-2.300 4.900-5.200 4.900-3.300 0-5.700-2.700-5.700-6 0-3.600 2.500-6.500 6-7.300z"
          />
        </svg>
      );
  }
}

function ErrorBox({ text }: { text: string }) {
  return (
    <p role="alert" className="checkout-error">
      {text}
    </p>
  );
}
