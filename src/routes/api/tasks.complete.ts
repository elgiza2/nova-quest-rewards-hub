/** Tasks & points — server-verified completion of reward tasks.
 *
 *  The browser can never award itself credits: POST /api/tasks/complete
 *  verifies the caller's bearer session, checks the task's real condition
 *  against the database with the admin client, then grants the points through
 *  the existing privileged credit-bucket function and records the completion.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

type TaskKey = string;
const ORANGE_JETTON = "EQCY5dx1kTGT-r1RPXA-LTRyv73_LtfcaTl0g1E_WBlRdUyI";
const LINK_MIN_SECONDS = 15;

type TaskRow = { id: string; title: string; reward_credits: number; target_count: number; action_type: string | null; action_url: string | null };

async function verifyTelegramChannel(db: any, userId: string, url: string | null): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const handle = (url ?? "").match(/t\.me\/([A-Za-z0-9_]+)/)?.[1];
  if (!token || !handle) return false;
  const { data } = await db.from("telegram_profiles").select("telegram_user_id").eq("user_id", userId).maybeSingle();
  if (!data?.telegram_user_id) return false;
  const res = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=@${handle}&user_id=${data.telegram_user_id}`);
  const j = (await res.json().catch(() => null)) as any;
  return ["member", "administrator", "creator", "restricted"].includes(j?.result?.status);
}

async function verifyJetton(db: any, userId: string, wallet: string | undefined): Promise<boolean> {
  const w = (wallet ?? "").trim();
  if (!/^[A-Za-z0-9_\-:]{40,70}$/.test(w)) return false;
  const res = await fetch(`https://tonapi.io/v2/accounts/${encodeURIComponent(w)}/jettons/${ORANGE_JETTON}`);
  if (!res.ok) return false;
  const j = (await res.json().catch(() => null)) as any;
  if (!(Number(j?.balance ?? 0) > 0)) return false;
  const raw = String(j?.wallet_address?.owner?.address ?? j?.wallet_address?.address ?? w);
  const { data: claim } = await db.from("task_wallet_claims").select("user_id").eq("wallet", raw).maybeSingle();
  if (claim && claim.user_id !== userId) return false;
  if (!claim) await db.from("task_wallet_claims").insert({ wallet: raw, user_id: userId });
  return true;
}

async function verifyLinkVisit(db: any, userId: string, taskId: string): Promise<boolean> {
  const { data } = await db.from("task_starts").select("started_at").eq("user_id", userId).eq("task_id", taskId).maybeSingle();
  if (!data) return false;
  return Date.now() - new Date(data.started_at).getTime() >= LINK_MIN_SECONDS * 1000;
}

function serverClients() {
  const url = process.env.SUPABASE_URL as string | undefined;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !anon) throw new Error("missing_supabase_env");
  return { url, anon };
}

async function requireUser(request: Request): Promise<string | null> {
  const { url, anon } = serverClients();
  const bearer = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const supabase = createClient(url, anon, { auth: { persistSession: false } });
  const { data } = await supabase.auth.getUser(bearer);
  return data.user?.id ?? null;
}

async function verifyCondition(db: any, userId: string, taskKey: TaskKey, task: TaskRow, wallet?: string): Promise<boolean> {
  if (task.action_type === "telegram_channel") return verifyTelegramChannel(db, userId, task.action_url);
  if (task.action_type === "buy_jetton") return verifyJetton(db, userId, wallet);
  switch (taskKey) {
    case "first_chat": {
      const { count } = await db
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      return (count ?? 0) > 0;
    }
    case "first_image": {
      const { count } = await db
        .from("image_generations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      return (count ?? 0) > 0;
    }
    case "complete_profile": {
      const { data } = await db
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", userId)
        .maybeSingle();
      return Boolean(data?.display_name || data?.avatar_url);
    }
    case "first_subscription": {
      const { data } = await db
        .from("subscriptions")
        .select("id")
        .eq("user_id", userId)
        .in("status", ["active", "trialing", "past_due"])
        .limit(1)
        .maybeSingle();
      if (data) return true;
      const { data: prof } = await db.from("profiles").select("plan").eq("id", userId).maybeSingle();
      return Boolean(prof?.plan && prof.plan !== "free");
    }
    case "telegram_join": {
      const { data } = await db
        .from("telegram_profiles")
        .select("user_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      return Boolean(data);
    }
    case "invite_friend": {
      const { count } = await db
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("referrer_id", userId);
      return (count ?? 0) > 0;
    }
    case "daily_checkin":
      return true; // cooldown is checked separately
    default:
      // Admin-created / social link tasks: the user must have opened the link a while ago.
      return verifyLinkVisit(db, userId, task.id);
  }
}

export const Route = createFileRoute("/api/tasks/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const userId = await requireUser(request);
          if (!userId) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

          const body = (await request.json().catch(() => null)) as { taskKey?: string; action?: string; wallet?: string } | null;
          const taskKey = body?.taskKey as TaskKey | undefined;
          if (!taskKey || typeof taskKey !== "string" || taskKey.length > 80) {
            return Response.json({ ok: false, error: "unknown_task" }, { status: 400 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin as any;

          const { data: task } = await db
            .from("reward_tasks")
            .select("id, title, reward_credits, target_count, active, action_type, action_url")
            .eq("task_key", taskKey)
            .eq("active", true)
            .maybeSingle();
          if (!task) return Response.json({ ok: false, error: "task_not_found" }, { status: 404 });

          if (body?.action === "start") {
            await db.from("task_starts").upsert({ user_id: userId, task_id: task.id, started_at: new Date().toISOString() }, { onConflict: "user_id,task_id", ignoreDuplicates: true });
            return Response.json({ ok: true, started: true });
          }

          // Daily check-in: one claim per 24h.
          if (taskKey === "daily_checkin") {
            const { data: recent } = await db
              .from("user_reward_tasks")
              .select("completed_at")
              .eq("user_id", userId)
              .eq("task_id", task.id)
              .gte("completed_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
              .limit(1)
              .maybeSingle();
            if (recent) {
              return Response.json({ ok: false, error: "already_claimed_today" }, { status: 409 });
            }
          } else {
            // One-time tasks: already completed?
            const { data: done } = await db
              .from("user_reward_tasks")
              .select("completed_at")
              .eq("user_id", userId)
              .eq("task_id", task.id)
              .not("completed_at", "is", null)
              .limit(1)
              .maybeSingle();
            if (done) return Response.json({ ok: true, already: true, credits: 0 });

            const verified = await verifyCondition(db, userId, taskKey, task as TaskRow, body?.wallet);
            if (!verified) {
              return Response.json({ ok: false, error: "condition_not_met" }, { status: 400 });
            }
          }

          const amount = Number(task.reward_credits ?? 0);
          const opKey =
            taskKey === "daily_checkin"
              ? `task:${userId}:${taskKey}:${new Date().toISOString().slice(0, 10)}`
              : `task:${userId}:${taskKey}`;

          const { data: grant, error: grantErr } = await db.rpc("grant_credit_bucket", {
            p_user_id: userId,
            p_bucket: "bonus",
            p_amount: amount,
            p_action_type: "reward_task",
            p_description: `Task: ${task.title}`,
            p_operation_key: opKey,
          });
          if (grantErr) {
            console.error("[tasks] grant failed", grantErr);
            return Response.json({ ok: false, error: "grant_failed" }, { status: 500 });
          }

          await db.from("user_reward_tasks").upsert(
            {
              user_id: userId,
              task_id: task.id,
              progress: Math.max(1, Number(task.target_count ?? 1)),
              completed_at: new Date().toISOString(),
              awarded_credits: amount,
            },
            { onConflict: "user_id,task_id" },
          );

          return Response.json({ ok: true, credits: amount, total: grant?.total ?? null });
        } catch (e) {
          console.error("[tasks] complete error", e);
          return Response.json({ ok: false, error: "server_error" }, { status: 500 });
        }
      },
    },
  },
});
