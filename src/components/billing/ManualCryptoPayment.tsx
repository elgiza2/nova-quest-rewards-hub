/** Crypto checkout entry: TON / USDT (TON) paid automatically from a connected
 *  wallet. Wallet code is browser-only, so it loads after hydration. */
import { Suspense, lazy } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

const Wallet = lazy(async () => {
  const { Buffer } = await import("buffer");
  const g = globalThis as unknown as { Buffer?: unknown };
  if (!g.Buffer) g.Buffer = Buffer;
  return import("./TonWalletPayment");
});

export default function ManualCryptoPayment(props: { tier: string; interval: string; sku?: string | null }) {
  const spin = <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  return (
    <ClientOnly fallback={spin}>
      <Suspense fallback={spin}>
        <Wallet {...props} />
      </Suspense>
    </ClientOnly>
  );
}
