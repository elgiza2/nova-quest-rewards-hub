/** Crypto checkout — create + verify crypto invoices (TON first-class, plus
 *  USDT on Ethereum, BSC, Tron and Solana).
 *
 *  POST /api/crypto/invoice { tier, interval } or { sku, asset } → creates a
 *  pending invoice row with a unique on-chain amount and returns the receiving
 *  wallet address + exact amount.
 *  GET  /api/crypto/invoice?id=… → verifies the invoice against public chain
 *  APIs, fulfils the purchase (credits/plan) the same way card payments do,
 *  and returns the current status. The browser can never fulfil itself.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { matchPaymentEvent } from "@/lib/crypto/verification";

type Asset = "ton" | "usdt_ton";
const ASSETS = {
 ton:{network:"ton",decimals:9,walletEnv:"CRYPTO_TON_WALLET_ADDRESS",label:"TON"},
 usdt_ton:{network:"ton",decimals:6,walletEnv:"CRYPTO_TON_WALLET_ADDRESS",label:"USDT (TON)"},
};

function json(headers: Record<string, string> = {}, status = 200) {
  return (body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
}

async function requireUserId(request: Request): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return null;
  const bearer = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const supabase = createClient(url, anon, { auth: { persistSession: false } });
  const { data } = await supabase.auth.getUser(bearer);
  return data.user?.id ?? null;
}

let tonPriceCache: { usd: number; at: number } | null = null;

async function tonPrice(): Promise<number> {
  if (tonPriceCache && Date.now() - tonPriceCache.at < 120_000) return tonPriceCache.usd;
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
      { signal: AbortSignal.timeout(8000) },
    );
    const j = (await res.json()) as { "the-open-network"?: { usd?: number } };
    const usd = j["the-open-network"]?.usd;
    if (usd && usd > 0.01) {
      tonPriceCache = { usd, at: Date.now() };
      return usd;
    }
  } catch {
    /* fall through */
  }
  throw new Error("price_unavailable");
}

async function resolvePlan(db: any, tier?: string, interval?: string, sku?: string) {
  if (sku) {
    const { data } = await db
      .from("billing_catalog")
      .select("tier, interval, credits, usd_price")
      .eq("tier", "credits")
      .eq("interval", sku)
      .eq("active", true)
      .maybeSingle();
    return data;
  }
  if (tier && interval) {
    const { data } = await db
      .from("billing_catalog")
      .select("tier, interval, credits, usd_price")
      .eq("tier", tier)
      .eq("interval", interval)
      .eq("active", true)
      .maybeSingle();
    return data;
  }
  return null;
}

async function verifyInvoice(inv: any): Promise<string | null> {
  if (!["ton", "usdt_ton"].includes(inv.asset)) return null;
  try {
    const res = await fetch(`https://tonapi.io/v2/accounts/${encodeURIComponent(inv.wallet_address)}/events?limit=100&start_date=${Math.floor(Date.parse(inv.created_at)/1000)}`, {signal:AbortSignal.timeout(12000)});
    if (!res.ok) return null;
    const data = await res.json() as {events?: any[]};
    for (const event of data.events ?? []) {
      const tx = matchPaymentEvent(event, {asset:inv.asset,wallet:inv.wallet_address,amount:String(inv.expected_nano),memo:inv.memo,createdAt:inv.created_at,expiresAt:inv.expires_at});
      if (tx) return tx;
    }
  } catch { /* A provider failure is never payment confirmation. */ }
  return null;
}

export const Route = createFileRoute("/api/crypto/invoice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const done = json();
        const userId = await requireUserId(request);
        if (!userId) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

        const body = (await request.json().catch(() => ({}))) as {
          tier?: string;
          interval?: string;
          sku?: string;
          asset?: string;
        };
        if (body.asset && !["ton", "usdt_ton"].includes(body.asset)) return Response.json({ok:false,error:"network_verification_unavailable"},{status:400});
        const asset = (body.asset || "usdt_ton") as Asset;
        if (!["ton", "usdt_ton"].includes(asset)) return Response.json({ok:false,error:"network_verification_unavailable"},{status:400});

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;

        const plan = await resolvePlan(db, body.tier, body.interval, body.sku);
        if (!plan) return done({ ok: false, error: "plan_not_found" });

        const cfg = ASSETS[asset];
        const wallet = process.env[cfg.walletEnv];
        if (!wallet) return done({ ok: false, error: "wallet_not_configured" });

        const usd = Number(plan.usd_price);
        let base: number;
        if (asset === "ton") {
          let price: number;
          try { price = await tonPrice(); } catch { return Response.json({ok:false,error:"price_unavailable"},{status:503}); }
          base = usd / price;
        } else {
          base = usd;
        }
        const payAmount = Math.ceil(base * 1_000_000) / 1_000_000;
        const expectedNano = BigInt(Math.round(payAmount * 10 ** cfg.decimals));
        const {data: identity} = await db.from("telegram_profiles").select("username,telegram_user_id").eq("user_id",userId).maybeSingle();
        const account = String(identity?.username || identity?.telegram_user_id || userId.slice(0,8)).replace(/[^A-Za-z0-9_]/g,"").slice(0,32);
        const memo = `OAI-${account}-${crypto.randomUUID().replace(/-/g, "")}`;
        const { data: inv, error } = await db
          .from("crypto_payments")
          .insert({
            user_id: userId,
            tier: plan.tier,
            interval: plan.interval,
            asset,
            network: cfg.network,
            wallet_address: wallet,
            amount_usd: usd,
            pay_amount: payAmount,
            decimals: cfg.decimals,
            expected_nano: expectedNano.toString(),
            memo,
            credits: plan.credits ?? 0,
          })
          .select()
          .single();
        if (error) {
          console.error("[crypto] insert failed", error);
          return done({ ok: false, error: "create_failed" });
        }

        return Response.json({
          ok: true,
          invoice: {
            id: inv.id,
            asset,
            label: cfg.label,
            network: cfg.network,
            wallet: wallet,
            payAmount: payAmount,
            decimals: cfg.decimals,
            expectedNano: expectedNano.toString(),
            memo,
            usd,
            credits: plan.credits ?? 0,
            expiresAt: inv.expires_at,
          },
        });
      },
      GET: async ({ request }) => {
        const done = json();
        const userId = await requireUserId(request);
        if (!userId) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

        const id = new URL(request.url).searchParams.get("id");
        if (!id) return done({ ok: false, error: "missing_id" });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;
        const { data: inv } = await db
          .from("crypto_payments")
          .select("*")
          .eq("id", id)
          .eq("user_id", userId)
          .maybeSingle();
        if (!inv) return done({ ok: false, error: "not_found" });
        if (inv.status !== "pending") return Response.json({ ok: true, status: inv.status, invoice: inv });

        if (new Date(inv.expires_at).getTime() < Date.now()) {
          await db.from("crypto_payments").update({ status: "expired" }).eq("id", inv.id);
          return Response.json({ ok: true, status: "expired", invoice: inv });
        }

        const tx = await verifyInvoice(inv);
        if (tx) {
          const {data: confirmation,error} = await db.rpc("confirm_crypto_payment",{p_invoice:inv.id,p_tx:tx});
          if (!error && confirmation?.ok) return Response.json({ok:true,status:"paid"});
        }
        return Response.json({ ok: true, status: "pending", invoice: inv });
      },
    },
  },
});
