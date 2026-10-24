import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useUserLang } from "@/lib/authI18n";
import SEOHead from "@/components/common/SEOHead";
import { openTaskLink } from "@/lib/telegramAuth";
import { ORANGE_TASK_KEYS, canCheckIn, isOrangeTask } from "@/lib/orangeTasks";
const logo = { url: "/orange-logo.png" };
import xArt from "@/assets/tasks/follow_x.jpg";
import communityArt from "@/assets/tasks/join_channel.jpg";
import coinArt from "@/assets/tasks/buy_orange.jpg";
import planArt from "@/assets/tasks/first_subscription.jpg";
import dailyArt from "@/assets/tasks/daily_checkin.jpg";

type Task = {
  id: string;
  task_key: string;
  title: string;
  reward_credits: number;
  action_url: string | null;
  image_url: string | null;
};
const taskOrder = (task: Task) => {
  const index = ORANGE_TASK_KEYS.findIndex((key) => key === task.task_key);
  return index < 0 ? ORANGE_TASK_KEYS.length : index;
};
const sortTasks = (list: Task[]) => list.sort((a, b) => taskOrder(a) - taskOrder(b));
const art: Record<string, string> = {
  follow_x: xArt,
  join_channel: communityArt,
  buy_orange: coinArt,
  first_subscription: planArt,
  daily_checkin: dailyArt,
};
const labels: Record<string, [string, string]> = {
  follow_x: ["Follow ORANGE on X", "تابع ORANGE على إكس"],
  join_channel: ["Join the community", "انضم للمجتمع"],
  buy_orange: ["Buy ORANGE", "اشتري ORANGE"],
  first_subscription: ["Monthly subscription", "الاشتراك الشهري"],
  daily_checkin: ["Daily check-in", "الحضور اليومي"],
};

function taskImageSrc(task: Task): string {
  if (task.image_url?.startsWith("tg:")) {
    return `/api/public/task-image?file_id=${encodeURIComponent(task.image_url.slice(3))}`;
  }
  return task.image_url || art[task.task_key] || logo.url;
}

export default function EarnTasksPage() {
  const ar = useUserLang() === "ar-eg";
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [done, setDone] = useState<Record<string, string>>({});
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [openedKeys, setOpenedKeys] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const columns = "id,task_key,title,reward_credits,action_url,image_url";
      const publicTasks = await supabase.from("reward_tasks").select(columns).eq("active", true);
      if (!publicTasks.error) setTasks(sortTasks(publicTasks.data ?? []));

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user)
        throw new Error(
          ar
            ? "افتح التطبيق من تليجرام لاستلام نقاطك"
            : "Open the app from Telegram to claim your points",
        );
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session)
        throw new Error(
          ar
            ? "انتهت جلسة الدخول؛ افتح التطبيق من تليجرام مرة أخرى"
            : "Your session expired; reopen the app from Telegram",
        );

      const [taskResult, userTaskResult, profileResult, startsResponse] = await Promise.all([
        supabase.from("reward_tasks").select(columns).eq("active", true),
        supabase.from("user_reward_tasks").select("task_id,completed_at").eq("user_id", user.id),
        supabase.from("profiles").select("credits").eq("id", user.id).maybeSingle(),
        fetch("/api/tasks/complete", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);
      const startsResult = await startsResponse.json().catch(() => null);
      if (
        taskResult.error ||
        userTaskResult.error ||
        profileResult.error ||
        !startsResponse.ok ||
        !startsResult?.ok
      ) {
        throw new Error(ar ? "تعذر تحميل المهام" : "Could not load tasks");
      }
      const loadedTasks = sortTasks(taskResult.data ?? []);
      const startedIds = new Set<string>(
        (startsResult.started ?? []).map((row: { task_id: string }) => row.task_id),
      );
      setTasks(loadedTasks);
      setDone(
        Object.fromEntries(
          (userTaskResult.data ?? [])
            .filter((row) => row.completed_at)
            .map((row) => [row.task_id, row.completed_at as string]),
        ),
      );
      setOpenedKeys(
        Object.fromEntries(
          loadedTasks
            .filter((task) => startedIds.has(task.id))
            .map((task) => [task.task_key, true]),
        ),
      );
      setCredits(Number(profileResult.data?.credits ?? 0));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load tasks");
    } finally {
      setLoading(false);
    }
  }, [ar]);

  useEffect(() => {
    void load();
  }, [load]);

  function open(task: Task) {
    if (task.action_url?.startsWith("/")) navigate(task.action_url);
    else if (task.action_url) openTaskLink(task.action_url);
  }

  async function startTask(task: Task) {
    setBusy(task.task_key);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session)
        throw new Error(
          ar
            ? "افتح التطبيق من تليجرام لاستلام نقاطك"
            : "Open the app from Telegram to claim your points",
        );
      const response = await fetch("/api/tasks/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ taskKey: task.task_key, action: "start" }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "start_failed");
      setOpenedKeys((current) => ({ ...current, [task.task_key]: true }));
      if (task.action_url) open(task);
      else toast.info(ar ? "رابط المهمة غير متاح حاليًا" : "This task has no destination link yet");
    } catch (cause) {
      toast.error(
        cause instanceof Error && cause.message !== "start_failed"
          ? cause.message
          : ar
            ? "تعذر بدء المهمة؛ حاول مرة أخرى"
            : "Could not start the task. Please try again.",
      );
    } finally {
      setBusy("");
    }
  }

  async function verify(task: Task) {
    setBusy(task.task_key);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        toast.error(
          ar
            ? "افتح التطبيق من تليجرام لاستلام نقاطك"
            : "Open the app from Telegram to claim your points",
        );
        return;
      }
      const response = await fetch("/api/tasks/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ taskKey: task.task_key }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        let message = ar ? "لم يتم تأكيد المهمة بعد" : "Task is not confirmed yet";
        if (result?.error === "task_not_started")
          message = ar
            ? "افتح المهمة أولاً بالضغط على «يلا»"
            : "Open the task first by pressing Go";
        else if (result?.error === "verification_unavailable")
          message = ar
            ? "لا يتوفر تحقق آمن لهذه المهمة الخارجية؛ لن تُمنح نقاط دون إثبات من الخدمة"
            : "This external task has no secure verification yet; points require proof from the provider";
        else if (result?.error === "task_not_ready") {
          const seconds = Number(result.retryAfterSeconds) || 30;
          message = ar
            ? `ارجع بعد ${seconds} ثانية من فتح المهمة واضغط تحقّق`
            : `Return ${seconds} seconds after opening the task and verify again`;
        } else if (result?.error === "x_verification_unavailable")
          message = ar
            ? "متابعة إكس تحتاج ربط حساب إكس؛ لن تُمنح نقاط قبل التحقق"
            : "X account verification is required before points can be awarded";
        else if (result?.error === "wallet_ownership_verification_required")
          message = ar
            ? "شراء العملة يحتاج إثبات ملكية المحفظة؛ لا تكفي كتابة عنوانها"
            : "Coin purchase requires proof of wallet ownership; entering an address is not enough";
        toast.info(message);
        return;
      }
      toast.success(`+${result.credits ?? 0}`);
      await load();
    } catch {
      toast.error(ar ? "تعذّر التحقق" : "Could not verify");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="min-h-dvh bg-background text-foreground" dir={ar ? "rtl" : "ltr"}>
      <SEOHead
        title="Tasks — Orange AI"
        description="Your Orange AI tasks and points."
        path="/tasks"
      />
      <div className="mx-auto max-w-md px-4 py-6">
        <h1 className="text-xl font-semibold">{ar ? "المهام" : "Tasks"}</h1>
        <div className="mt-4 mb-6 flex items-center gap-3 rounded-2xl bg-muted/50 p-4">
          <img src={logo.url} alt="Orange" className="h-10 w-10 rounded-full object-contain" />
          <div>
            <p className="text-xs text-muted-foreground">{ar ? "رصيد النقاط" : "Points balance"}</p>
            <p className="text-2xl font-semibold tabular-nums">
              {credits === null ? "—" : credits.toLocaleString()}
            </p>
          </div>
        </div>
        {error && (
          <p role="alert" className="mb-5 text-sm text-destructive">
            {error}
          </p>
        )}
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {loading && tasks.length === 0 ? (
            <li className="px-3 py-4 text-sm text-muted-foreground">
              {ar ? "جارٍ تحميل المهام…" : "Loading tasks…"}
            </li>
          ) : (
            tasks.map((task) => {
              const daily = task.task_key === "daily_checkin";
              const completed = daily ? !canCheckIn(done[task.id] ?? null) : Boolean(done[task.id]);
              const opened = daily || Boolean(openedKeys[task.task_key]);
              const fallbackImage = art[task.task_key] || logo.url;
              return (
                <li key={task.id} className="flex items-center gap-3 px-3 py-2.5">
                  <img
                    src={taskImageSrc(task)}
                    alt=""
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = fallbackImage;
                    }}
                    className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted object-cover"
                    style={{ borderRadius: "9999px", aspectRatio: "1/1" }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {labels[task.task_key]?.[ar ? 1 : 0] ?? task.title}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                      <img src={logo.url} alt="" className="h-3.5 w-3.5" />+{task.reward_credits}
                    </p>
                    {opened && !daily && !isOrangeTask(task.task_key) && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {ar
                          ? "لا يتوفر تحقق آمن لهذه المهمة بعد"
                          : "Secure verification is not available for this task yet"}
                      </p>
                    )}
                  </div>
                  {completed ? (
                    <Check
                      aria-label={ar ? "اكتملت" : "Completed"}
                      className="h-5 w-5 shrink-0 text-primary"
                    />
                  ) : (
                    <Button
                      size="sm"
                      className="h-7 shrink-0 rounded-full px-3 text-xs"
                      disabled={
                        busy === task.task_key || (opened && !daily && !isOrangeTask(task.task_key))
                      }
                      onClick={() => {
                        if (opened) void verify(task);
                        else void startTask(task);
                      }}
                    >
                      {busy === task.task_key
                        ? "…"
                        : opened && !daily
                          ? ar
                            ? "تحقّق"
                            : "Verify"
                          : opened && !daily
                            ? ar
                              ? "غير متاح"
                              : "Unavailable"
                            : ar
                              ? "يلا"
                              : "Go"}
                    </Button>
                  )}
                </li>
              );
            })
          )}
        </ul>
      </div>
    </main>
  );
}
