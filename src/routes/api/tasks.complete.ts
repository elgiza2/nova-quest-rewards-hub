/** Tasks & points — authenticated reward claims.
 *
 *  Regular tasks are completed by user confirmation after opening the task.
 *  The monthly subscription reward remains tied to an active in-app subscription.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type TaskKey = string;

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

async function verifyMonthlySubscription(db: SupabaseClient, userId: string): Promise<boolean> {
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

            if (
              taskKey === "first_subscription" &&
              !(await verifyMonthlySubscription(db, userId))
            ) {
              return Response.json(
                { ok: false, error: "monthly_subscription_required" },
                { status: 400 },
              );
            }
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
