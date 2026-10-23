/** Tasks & points — server-verified completion of reward tasks.
 *
 *  The browser can never award itself credits: POST /api/tasks/complete
 *  verifies the caller's bearer session, checks the task's real condition
 *  against the database with the admin client, then grants the points through
 *  the existing privileged credit-bucket function and records the completion.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

type TaskKey =
  | "first_chat"
  | "first_image"
  | "complete_profile"
  | "first_subscription"
  | "telegram_join"
  | "invite_friend"
  | "daily_checkin";

const ALLOWED: TaskKey[] = [
  "first_chat",
  "first_image",
  "complete_profile",
  "first_subscription",
  "telegram_join",
  "invite_friend",
  "daily_checkin",
];

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

async function verifyCondition(db: any, userId: string, taskKey: TaskKey): Promise<boolean> {
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
  }
}

export const Route = createFileRoute("/api/tasks/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const userId = await requireUser(request);
          if (!userId) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

          const body = (await request.json().catch(() => null)) as { taskKey?: string } | null;
          const taskKey = body?.taskKey as TaskKey | undefined;
          if (!taskKey || !ALLOWED.includes(taskKey)) {
            return Response.json({ ok: false, error: "unknown_task" }, { status: 400 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const db = supabaseAdmin as any;

          const { data: task } = await db
            .from("reward_tasks")
            .select("id, title, reward_credits, target_count, active")
            .eq("task_key", taskKey)
            .eq("active", true)
            .maybeSingle();
          if (!task) return Response.json({ ok: false, error: "task_not_found" }, { status: 404 });

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

            const verified = await verifyCondition(db, userId, taskKey);
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
