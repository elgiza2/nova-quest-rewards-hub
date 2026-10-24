/** Tasks & points — server-verified completion of reward tasks.
 *
 *  The browser cannot award itself credits: this route verifies the caller's
 *  bearer session and the task condition before the privileged claim RPC runs.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isOrangeTask } from "@/lib/orangeTasks";

type TaskKey = string;
type TaskRow = {
  id: string;
  title: string;
  reward_credits: number;
  target_count: number;
  active: boolean;
  action_type: string | null;
  action_url: string | null;
};

async function verifyTelegramChannel(
  db: SupabaseClient,
  userId: string,
  url: string | null,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const handle = (url ?? "").match(/t\.me\/([A-Za-z0-9_]+)/)?.[1];
  if (!token || !handle) return false;
  const { data } = await db
    .from("telegram_profiles")
    .select("telegram_user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.telegram_user_id) return false;
  const response = await fetch(
    `https://api.telegram.org/bot${token}/getChatMember?chat_id=@${handle}&user_id=${data.telegram_user_id}`,
  );
  const result = (await response.json().catch(() => null)) as {
    ok?: boolean;
    result?: { status?: string; is_member?: boolean };
  } | null;
  return (
    result?.ok === true &&
    (["member", "administrator", "creator"].includes(result?.result?.status) ||
      (result?.result?.status === "restricted" && result.result.is_member === true))
  );
}

function serverClients() {
  const url = process.env.SUPABASE_URL as string | undefined;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !publishableKey) throw new Error("missing_supabase_env");
  return { url, publishableKey };
}

async function requireUser(request: Request): Promise<string | null> {
  const { url, publishableKey } = serverClients();
  const bearer = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const supabase = createClient(url, publishableKey, { auth: { persistSession: false } });
  const { data } = await supabase.auth.getUser(bearer);
  return data.user?.id ?? null;
}

async function verifyCondition(
  db: SupabaseClient,
  userId: string,
  taskKey: TaskKey,
  task: TaskRow,
): Promise<boolean> {
  if (task.action_type === "telegram_channel")
    return verifyTelegramChannel(db, userId, task.action_url);
  if (taskKey === "daily_checkin") return true;
  if (taskKey === "first_subscription") {
    const { data, error } = await db
      .from("subscriptions")
      .select("current_period_end")
      .eq("user_id", userId)
      .eq("status", "active")
      .gt("current_period_end", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    return (
      !error && Boolean(data) && Date.parse(data.current_period_end) <= Date.now() + 32 * 86400_000
    );
  }
  return false;
}

export const Route = createFileRoute("/api/tasks/complete")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const userId = await requireUser(request);
          if (!userId) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin
            .from("task_starts")
            .select("task_id,started_at")
            .eq("user_id", userId)
            .order("started_at", { ascending: false })
            .limit(250);
          if (error)
            return Response.json({ ok: false, error: "status_unavailable" }, { status: 500 });
          return Response.json({ ok: true, started: data ?? [] });
        } catch (cause) {
          console.error("[tasks] status error", cause);
          return Response.json({ ok: false, error: "server_error" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const userId = await requireUser(request);
          if (!userId) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
          const body = (await request.json().catch(() => null)) as {
            taskKey?: string;
            action?: string;
            wallet?: string;
          } | null;
          const taskKey = body?.taskKey as TaskKey | undefined;
          if (!taskKey || typeof taskKey !== "string" || !/^[a-z0-9_-]{1,64}$/i.test(taskKey)) {
            return Response.json({ ok: false, error: "unknown_task" }, { status: 400 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin;
          const { data: task } = await db
            .from("reward_tasks")
            .select("id,title,reward_credits,target_count,active,action_type,action_url")
            .eq("task_key", taskKey)
            .eq("active", true)
            .maybeSingle();
          if (!task) return Response.json({ ok: false, error: "task_not_found" }, { status: 404 });

          if (body?.action === "start") {
            if (!task.action_url)
              return Response.json({ ok: false, error: "task_link_missing" }, { status: 409 });
            const { error: startError } = await db
              .from("task_starts")
              .upsert(
                { user_id: userId, task_id: task.id, started_at: new Date().toISOString() },
                { onConflict: "user_id,task_id", ignoreDuplicates: true },
              );
            if (startError) {
              console.error("[tasks] start write failed", startError);
              return Response.json({ ok: false, error: "start_failed" }, { status: 500 });
            }
            return Response.json({ ok: true, started: true });
          }

          // Only tasks in the shared allowlist have a server-verifiable completion condition.
          // Opening an arbitrary third-party URL is not proof that the task was completed.
          if (!isOrangeTask(taskKey)) {
            return Response.json({ ok: false, error: "verification_unavailable" }, { status: 409 });
          }
          if (taskKey === "follow_x") {
            return Response.json(
              { ok: false, error: "x_verification_unavailable" },
              { status: 409 },
            );
          }
          if (taskKey === "buy_orange") {
            return Response.json(
              { ok: false, error: "wallet_ownership_verification_required" },
              { status: 409 },
            );
          }

          if (taskKey === "daily_checkin") {
            const { data: recent } = await db
              .from("user_reward_tasks")
              .select("completed_at")
              .eq("user_id", userId)
              .eq("task_id", task.id)
              .gte("completed_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
              .limit(1)
              .maybeSingle();
            if (recent)
              return Response.json({ ok: false, error: "already_claimed_today" }, { status: 409 });
          } else {
            const { data: done } = await db
              .from("user_reward_tasks")
              .select("completed_at")
              .eq("user_id", userId)
              .eq("task_id", task.id)
              .not("completed_at", "is", null)
              .limit(1)
              .maybeSingle();
            if (done) return Response.json({ ok: true, already: true, credits: 0 });

            const verified = await verifyCondition(db, userId, taskKey, task as TaskRow);
            if (!verified)
              return Response.json({ ok: false, error: "condition_not_met" }, { status: 400 });
          }

          const { data: grant, error: grantError } = await db.rpc("claim_orange_task", {
            p_user: userId,
            p_task: task.id,
          });
          if (grantError) {
            console.error("[tasks] grant failed", grantError);
            return Response.json({ ok: false, error: "grant_failed" }, { status: 500 });
          }
          return Response.json(grant, { status: grant?.ok ? 200 : 409 });
        } catch (cause) {
          console.error("[tasks] complete error", cause);
          return Response.json({ ok: false, error: "server_error" }, { status: 500 });
        }
      },
    },
  },
});
