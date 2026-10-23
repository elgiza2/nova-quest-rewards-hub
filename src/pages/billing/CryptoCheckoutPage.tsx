/** @doc Crypto checkout route wrapper — keeps TonConnect out of the SSR graph
 *  by lazy-loading the browser-only checkout behind Suspense. */
import { Suspense, lazy } from "react";
import { ClientOnly } from "@tanstack/react-router";

// Buffer must be global before @ton/core / TonConnect modules evaluate, so it
// loads as its own chunk first.
const Inner = lazy(async () => {
  const { Buffer } = await import("buffer");
  const g = globalThis as unknown as { Buffer?: unknown };
  if (!g.Buffer) g.Buffer = Buffer;
  return import("./CryptoCheckoutInner");
});

export default function CryptoCheckoutPage() {
  return (
    <ClientOnly fallback={null}>
      <Suspense fallback={null}>
        <Inner />
      </Suspense>
    </ClientOnly>
  );
}
