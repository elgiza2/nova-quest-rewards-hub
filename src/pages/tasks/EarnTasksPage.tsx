/** @doc Tasks — complete tasks, earn points. Points are Orange credits (MC)
 *  granted server-side by /api/tasks/complete after verifying each task's
 *  real condition; the browser never awards itself. */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bot,
  CalendarCheck,
  Check,
  Coins,
  Crown,
  Image as ImageIcon,
  MessageCircle,
  RefreshCw,
  Send,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useUserLang } from "@/lib/authI18n";
import SEOHead from "@/components/common/SEOHead";

type RewardTask = {
  id: string;
  task_key: string;
  title: string;
  description: string | null;
  image_url: string | null;
  reward_credits: number;
  action_type: string | null;
  action_url: string | null;
  icon: string | null;
};

type UserTask = { task_id: string; completed_at: string | null; awarded_credits: number | null };

const ICONS: Record<string, typeof Bot> = {
  telegram: Send,
  calendar: CalendarCheck,
  chat: MessageCircle,
  image: ImageIcon,
  profile: UserRound,
  subscription: Crown,
  invite: Users,
};

const T = {
  en: {
    title: "Tasks",
    subtitle: "Complete tasks and earn points you can spend in Orange AI.",
    balance: "Your points",
    done: "Done",
    claim: "Claim",
    verify: "Verify",
    open: "Open",
    checkin: "Check in",
    checkedIn: "Come back tomorrow",
    dailyNote: "Daily check-in unlocks again every 24 hours.",
    invite: "Invite friends from the referrals page",
    goReferrals: "Referrals",
    failed: "Could not complete the task",
    tryAgain: "Not yet — finish the task first, then verify.",
    points: "pts",
  },
  ar: {
    title: "المهام",
    subtitle: "كمّل المهام واكسب نقاط تستخدمها في أورانج.",
    balance: "نقاطك",
    done: "خلصت",
    claim: "استلم",
    verify: "تحقّق",
    open: "افتح",
    checkin: "سجّل حضورك",
    checkedIn: "ارجع بكرة",
    dailyNote: "الحضور اليومي بيفتح تاني كل ٢٤ ساعة.",
    invite: "ادعُ أصحابك من صفحة الإحالات",
    goReferrals: "الإحالات",
    failed: "مقدرناش نكمّل المهمة",
    tryAgain: "لسه — خلّص المهمة الأول وبعدين تحقّق.",
    points: "نقطة",
  },
};

export default function EarnTasksPage() {
  const navigate = useNavigate();
  const lang = useUserLang();
  const ar = lang === "ar-eg";
  const t = ar ? T.ar : T.en;

  const [tasks, setTasks] = useState<RewardTask[]>([]);
  const [userTasks, setUserTasks] = useState<UserTask[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: auth }] = await Promise.all([supabase.auth.getUser()]);
      const user = auth.user;
      if (!user) return;
      const [tk, ut, prof] = await Promise.all([
        supabase.from("reward_tasks").select("*").eq("active", true).order("sort_order"),
        supabase.from("user_reward_tasks").select("task_id, completed_at, awarded_credits").eq("user_id", user.id),
        supabase.from("profiles").select("credits").eq("id", user.id).maybeSingle(),
      ]);
      setTasks((tk.data as RewardTask[]) ?? []);
      setUserTasks((ut.data as UserTask[]) ?? []);
      setCredits(prof.data?.credits != null ? Number(prof.data.credits) : null);
    } catch {
      // keep the page usable even if a lookup fails
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const completeTask = async (task: RewardTask) => {
    setBusy(task.task_key);
    try {
      // Daily check-in completes directly; everything else opens its action first.
      if (task.action_type === "open_url" && task.action_url) {
        window.open(task.action_url, "_blank", "noopener,noreferrer");
      }
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) {
        toast.error(t.failed);
        return;
      }
      const res = await fetch("/api/tasks/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ taskKey: task.task_key }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        if (json?.error === "condition_not_met") toast.info(t.tryAgain);
        else if (json?.error === "already_claimed_today") toast.info(t.checkedIn);
        else toast.error(t.failed);
        return;
      }
      if ((json.credits ?? 0) > 0) toast.success(`+${json.credits} ${t.points}`);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const isDone = (task: RewardTask) =>
    userTasks.some((u) => u.task_id === task.id && u.completed_at);

  const order = ["daily_checkin", "telegram_join", "first_chat", "first_image", "complete_profile", "first_subscription", "invite_friend"];
  const sorted = [...tasks].sort(
    (a, b) => (order.indexOf(a.task_key) + 1 || 99) - (order.indexOf(b.task_key) + 1 || 99),
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEOHead title="Tasks — Earn points | Orange AI" description="Complete tasks and earn points in Orange AI." path="/tasks" />
      <div className="mx-auto max-w-xl px-4 py-8">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {ar ? "رجوع" : "Back"}
        </button>

        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>

        <div className="mt-6 flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4">
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            <Coins className="h-4 w-4 text-amber-500" /> {t.balance}
          </span>
          <span className="text-xl font-semibold tabular-nums">
            {credits == null ? "—" : credits.toLocaleString()}
          </span>
        </div>

        <div className="mt-6 space-y-3">
          {loading && (
            <div className="flex justify-center py-10 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin" />
            </div>
          )}
          {!loading &&
            sorted.map((task) => {
              const Icon = ICONS[task.icon ?? ""] ?? Coins;
              const done = isDone(task);
              const daily = task.task_key === "daily_checkin";
              const invite = task.task_key === "invite_friend";
              return (
                <div key={task.id} className="flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-4">
                  {task.image_url ? (
                    <img
                      src={task.image_url}
                      alt=""
                      loading="lazy"
                      className="h-10 w-10 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                      <Icon className="h-5 w-5" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {task.description ?? ""}
                      {daily ? ` ${t.dailyNote}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-amber-500 tabular-nums">
                    +{task.reward_credits}
                  </span>
                  {done ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      <Check className="h-3.5 w-3.5" /> {t.done}
                    </span>
                  ) : invite ? (
                    <button
                      type="button"
                      onClick={() => navigate("/referrals")}
                      className="shrink-0 rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background"
                    >
                      {t.goReferrals}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === task.task_key}
                      onClick={() => completeTask(task)}
                      className="shrink-0 rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
                    >
                      {busy === task.task_key
                        ? "…"
                        : daily
                          ? t.checkin
                          : task.action_type === "open_url"
                            ? t.open
                            : t.verify}
                    </button>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
