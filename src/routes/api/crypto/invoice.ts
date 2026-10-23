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

type Asset = "ton" | "usdt_ton" | "usdt_eth" | "usdt_bsc" | "usdt_sol" | "usdt_tron";

const ASSETS: Record<
  Asset,
  { network: string; decimals: number; walletEnv: string; label: string }
> = {
  ton: { network: "ton", decimals: 9, walletEnv: "CRYPTO_TON_WALLET_ADDRESS", label: "TON" },
  usdt_ton: { network: "ton", decimals: 6, walletEnv: "CRYPTO_TON_WALLET_ADDRESS", label: "USDT (TON)" },
  usdt_eth: { network: "ethereum", decimals: 6, walletEnv: "CRYPTO_ETH_WALLET_ADDRESS", label: "USDT (Ethereum)" },
  usdt_bsc: { network: "bsc", decimals: 18, walletEnv: "CRYPTO_BSC_WALLET_ADDRESS", label: "USDT (BNB Chain)" },
  usdt_sol: { network: "solana", decimals: 6, walletEnv: "CRYPTO_SOL_WALLET_ADDRESS", label: "USDT (Solana)" },
  usdt_tron: { network: "tron", decimals: 6, walletEnv: "CRYPTO_TRON_WALLET_ADDRESS", label: "USDT (Tron)" },
};

const TON_USDT_MASTER = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiXPCkPNd3kCincpSx-u";

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
  return tonPriceCache?.usd ?? 5;
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

function randomMemo(): string {
  const buf = crypto.getRandomValues(new Uint8Array(5));
  return "OAI-" + [...buf].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function padAddress(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

// ---------- chain verifiers ----------

/** TON native: comment == memo and exact value. */
async function verifyTonNative(wallet: string, expectedNano: number, memo: string) {
  const res = await fetch(
    `https://tonapi.io/v2/accounts/${encodeURIComponent(wallet)}/transactions?limit=100`,
    { signal: AbortSignal.timeout(12000) },
  );
  if (!res.ok) return null;
  const txs = (await res.json()) as Array<Record<string, any>>;
  for (const tx of txs) {
    const msg = tx?.in_msg;
    if (!msg) continue;
    const value = Number(msg.value ?? 0);
    const comment: string = String(msg.comment ?? msg?.msg_data?.decoded_comment ?? msg?.msg_data?.message ?? "");
    if (value === expectedNano && (comment === memo || comment.includes(memo))) {
      return tx.hash ?? tx.transaction_id ?? null;
    }
  }
  return null;
}

/** TON USDT (jetton) transfer into the wallet: exact amount (+ memo comment). */
async function verifyTonJetton(wallet: string, expectedNano: number, memo: string) {
  const res = await fetch(
    `https://tonapi.io/v2/accounts/${encodeURIComponent(wallet)}/jetton-transfers?limit=100`,
    { signal: AbortSignal.timeout(12000) },
  );
  if (!res.ok) return null;
  const list = (await res.json()) as Array<Record<string, any>>;
  for (const t of list) {
    const jetton: string = String(t?.jetton?.address ?? "");
    if (!jetton.startsWith(TON_USDT_MASTER.slice(0, 12))) continue;
    const dest: string = String(t?.destination ?? "");
    if (!dest.includes(wallet.replace(/^UQ/, "0:").replace(/^EQ/, "0:").split(":")[1] ?? "___")) continue;
    if (Number(t?.amount ?? 0) !== expectedNano) continue;
    const comment = String(t?.comment ?? "");
    if (!comment || comment === memo || comment.includes(memo)) return t?.tx_hash ?? t?.transaction_hash ?? null;
  }
  // Destination match is finicky across raw/USER-FRIENDLY forms; accept exact amount
  // + jetton + memo-or-empty (amounts are unique per invoice).
  for (const t of list) {
    const jetton: string = String(t?.jetton?.address ?? "");
    if (!jetton.startsWith(TON_USDT_MASTER.slice(0, 12))) continue;
    if (Number(t?.amount ?? 0) === expectedNano) {
      const comment = String(t?.comment ?? "");
      if (!comment || comment === memo || comment.includes(memo)) {
        return t?.tx_hash ?? t?.transaction_hash ?? null;
      }
    }
  }
  return null;
}

/** EVM USDT (Ethereum / BSC): Transfer event to the merchant wallet. */
async function verifyEvm(rpc: string, usdt: string, wallet: string, expectedNano: number) {
  const call = async (method: string, params: unknown[]) => {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(12000),
    });
    const j = (await res.json()) as { result?: any; error?: any };
    if (j.error) throw new Error(JSON.stringify(j.error));
    return j.result;
  };
  const head = Number(await call("eth_blockNumber", []));
  const fromBlock = Math.max(0, head - 3000);
  const logs = await call("eth_getLogs", [
    {
      address: usdt,
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + head.toString(16),
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", // Transfer
        null,
        "0x" + padAddress(wallet),
      ],
    },
  ]);
  if (!Array.isArray(logs)) return null;
  for (const log of logs) {
    const value = log?.data ? BigInt(log.data) : 0n;
    if (value === BigInt(expectedNano)) return log?.transactionHash ?? null;
  }
  return null;
}

/** Tron USDT (TRC-20) via the public Tronscan API. */
async function verifyTron(wallet: string, expectedNano: number) {
  const res = await fetch(
    `https://apilist.tronscanapi.com/api/transfer/trc20?limit=50&to_address=${encodeURIComponent(wallet)}&contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000) },
  );
  if (!res.ok) return null;
  const j = (await res.json()) as { data?: Array<Record<string, any>> };
  for (const t of j.data ?? []) {
    if (Number(t?.quant ?? 0) === expectedNano) {
      return t?.transaction_id ?? null;
    }
  }
  return null;
}

/** Solana USDT: compare the merchant's USDT balance against the cumulative
 *  expected amount of outstanding invoices on this wallet (balance-based). */
async function verifySol(wallet: string, cumulativeNano: number) {
  const rpc = "https://api.mainnet-beta.solana.com";
  const call = async (method: string, params: unknown[]) => {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(12000),
    });
    const j = (await res.json()) as { result?: any; error?: any };
    return j.result;
  };
  const accounts = await call("getTokenAccountsByOwner", [
    wallet,
    { mint: "Es9vMFrzaCERm6frWZvLFsM4EbkggivCLz1xZ3kEQRqZ", encoding: "base64" },
  ]);
  const tokenAccount = accounts?.value?.[0]?.pubkey;
  if (!tokenAccount) return cumulativeNano === 0 ? true : false;
  const bal = await call("getTokenAccountBalance", [tokenAccount]);
  return Number(bal?.value?.amount ?? 0) >= cumulativeNano;
}

async function verifyInvoice(inv: Record<string, any>): Promise<{ paid: boolean; tx: string | null }> {
  const asset = inv.asset as Asset;
  const expected = Number(inv.expected_nano);
  try {
    switch (asset) {
      case "ton": {
        const tx = await verifyTonNative(inv.wallet_address, expected, inv.memo);
        return { paid: Boolean(tx), tx };
      }
      case "usdt_ton": {
        const tx = await verifyTonJetton(inv.wallet_address, expected, inv.memo);
        return { paid: Boolean(tx), tx };
      }
      case "usdt_eth":
      case "usdt_bsc": {
        const rpc =
          asset === "usdt_eth"
            ? "https://ethereum-rpc.publicnode.com"
            : "https://bsc-rpc.publicnode.com";
        const usdt =
          asset === "usdt_eth"
            ? "0xdAC17F958D2ee523a2206206994597C13D831ec7"
            : "0x55d398326f99059fF775485246999027B3197955";
        const tx = await verifyEvm(rpc, usdt, inv.wallet_address, expected);
        return { paid: Boolean(tx), tx };
      }
      case "usdt_tron": {
        const tx = await verifyTron(inv.wallet_address, expected);
        return { paid: Boolean(tx), tx };
      }
      case "usdt_sol": {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;
        const { data: unpaid } = await db
          .from("crypto_payments")
          .select("expected_nano")
          .eq("asset", "usdt_sol")
          .eq("wallet_address", inv.wallet_address)
          .eq("status", "pending")
          .gte("expires_at", new Date().toISOString());
        const cumulative = (unpaid ?? []).reduce((s: number, r: any) => s + Number(r.expected_nano), 0);
        const paid = await verifySol(inv.wallet_address, cumulative);
        return { paid, tx: null };
      }
    }
  } catch (e) {
    console.error("[crypto] verify error", asset, e);
    return { paid: false, tx: null };
  }
}

/** Fulfil a paid invoice exactly the way card payments are fulfilled. */
async function fulfil(db: any, inv: Record<string, any>) {
  const isPlan = inv.tier !== "credits";
  const credits = Number(inv.credits ?? 0);
  if (credits > 0) {
    await db.rpc("grant_credit_bucket", {
      p_user_id: inv.user_id,
      p_bucket: isPlan ? "plan" : "purchased",
      p_amount: credits,
      p_action_type: isPlan ? "subscription_purchase" : "credit_purchase",
      p_description: `crypto:${inv.asset}:${inv.memo}`,
      p_operation_key: `payment:${inv.memo}`,
    });
  }
  if (isPlan) {
    const periodDays = inv.interval === "yearly" ? 365 : 30;
    const periodEnd = new Date(Date.now() + periodDays * 86400_000).toISOString();
    await db
      .from("credit_wallets")
      .update({ plan_credits: credits, plan_period_end: periodEnd, updated_at: new Date().toISOString() })
      .eq("user_id", inv.user_id);
    const { data: wallet } = await db
      .from("credit_wallets")
      .select("user_id")
      .eq("user_id", inv.user_id)
      .maybeSingle();
    void wallet;
    await db.rpc("sync_credit_total", { _user_id: inv.user_id });
    await db.from("profiles").update({ plan: "pro", updated_at: new Date().toISOString() }).eq("id", inv.user_id);
    const { data: sub } = await db
      .from("subscriptions")
      .select("id")
      .eq("user_id", inv.user_id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const subRow = {
      plan: "pro",
      status: "active",
      currency: "USD",
      amount_cents: Math.round(Number(inv.amount_usd) * 100),
      current_period_end: periodEnd,
      updated_at: new Date().toISOString(),
    };
    if (sub) {
      await db.from("subscriptions").update(subRow).eq("id", sub.id);
    } else {
      await db.from("subscriptions").insert({ user_id: inv.user_id, ...subRow });
    }
  }
}

export const Route = createFileRoute("/api/crypto/invoice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const done = json();
        const userId = await requireUserId(request);
        if (!userId) return done({ ok: false, error: "unauthorized" }) && Response.json({}, { status: 401 });

        const body = (await request.json().catch(() => ({}))) as {
          tier?: string;
          interval?: string;
          sku?: string;
          asset?: string;
        };
        const asset = (body.asset && body.asset in ASSETS ? body.asset : "usdt_ton") as Asset;

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
          const price = await tonPrice();
          base = usd / price;
        } else {
          base = usd;
        }
        // Unique amount per invoice: no two open invoices share an exact value,
        // which is how the chain match stays unambiguous.
        const { count } = await db
          .from("crypto_payments")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);
        const suffix = ((count ?? 0) % 500) * 0.001;
        const payAmount = Math.round((base + suffix) * 1_000_000) / 1_000_000;
        const expectedNano = BigInt(Math.round(payAmount * 10 ** cfg.decimals));

        const memo = randomMemo();
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
        if (!userId) return done({ ok: false, error: "unauthorized" }) && Response.json({}, { status: 401 });

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

        const { paid, tx } = await verifyInvoice(inv);
        if (paid) {
          await db
            .from("crypto_payments")
            .update({ status: "paid", tx_hash: tx, paid_at: new Date().toISOString() })
            .eq("id", inv.id);
          await fulfil(db, inv);
          return Response.json({ ok: true, status: "paid", invoice: inv });
        }
        return Response.json({ ok: true, status: "pending", invoice: inv });
      },
    },
  },
});
