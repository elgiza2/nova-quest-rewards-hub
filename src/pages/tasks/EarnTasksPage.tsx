import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useUserLang } from "@/lib/authI18n";
import SEOHead from "@/components/common/SEOHead";
import { openTaskLink } from "@/lib/telegramAuth";
import { ORANGE_TASK_KEYS, canCheckIn } from "@/lib/orangeTasks";
import logo from "@/assets/orange-logo.png.asset.json";
import xArt from "@/assets/tasks/follow_x.jpg";
import communityArt from "@/assets/tasks/join_channel.jpg";
import coinArt from "@/assets/tasks/buy_orange.jpg";
import planArt from "@/assets/tasks/first_subscription.jpg";
import dailyArt from "@/assets/tasks/daily_checkin.jpg";
type Task={id:string;task_key:string;title:string;reward_credits:number;action_url:string|null};
const art:Record<string,string>={follow_x:xArt,join_channel:communityArt,buy_orange:coinArt,first_subscription:planArt,daily_checkin:dailyArt};
const labels:Record<string,[string,string]>={follow_x:["Follow ORANGE on X","تابع ORANGE على إكس"],join_channel:["Join the community","انضم للمجتمع"],buy_orange:["Buy ORANGE","اشتري ORANGE"],first_subscription:["Monthly subscription","الاشتراك الشهري"],daily_checkin:["Daily check-in","الحضور اليومي"]};
export default function EarnTasksPage(){
 const ar=useUserLang()==="ar-eg";const navigate=useNavigate();
 const [tasks,setTasks]=useState<Task[]>([]);const [done,setDone]=useState<Record<string,string>>({});const [credits,setCredits]=useState<number|null>(null);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState("");const [error,setError]=useState("");
 const load=useCallback(async()=>{setLoading(true);try{
 const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error(ar?"افتح التطبيق من تليجرام لعرض مهامك":"Open the app from Telegram to see your tasks");
 const [tk,ut,p]=await Promise.all([supabase.from("reward_tasks").select("id,task_key,title,reward_credits,action_url").eq("active",true).in("task_key",[...ORANGE_TASK_KEYS]),supabase.from("user_reward_tasks").select("task_id,completed_at").eq("user_id",user.id),supabase.from("profiles").select("credits").eq("id",user.id).maybeSingle()]);
 if(tk.error||ut.error||p.error)throw new Error(ar?"تعذر تحميل المهام":"Could not load tasks");
 setTasks((tk.data??[]).sort((a,b)=>ORANGE_TASK_KEYS.findIndex(k=>k===a.task_key)-ORANGE_TASK_KEYS.findIndex(k=>k===b.task_key)));setDone(Object.fromEntries((ut.data??[]).filter(r=>r.completed_at).map(r=>[r.task_id,r.completed_at as string])));setCredits(Number(p.data?.credits??0));setError("");
 }catch(e){setError(e instanceof Error?e.message:"Could not load tasks")}finally{setLoading(false)}},[ar]);
 useEffect(()=>{void load()},[load]);
 async function verify(task:Task){setBusy(task.task_key);try{const {data}=await supabase.auth.getSession();if(!data.session)return;const res=await fetch("/api/tasks/complete",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify({taskKey:task.task_key})});const result=await res.json();if(!result.ok){const msg=result.error==="x_verification_unavailable"?(ar?"متابعة إكس تحتاج ربط حساب إكس؛ لن تُمنح نقاط قبل التحقق":"X account verification is required before points can be awarded"):result.error==="wallet_ownership_verification_required"?(ar?"شراء العملة يحتاج إثبات ملكية المحفظة؛ لا تكفي كتابة عنوانها":"Coin purchase requires proof of wallet ownership; entering an address is not enough"):(ar?"لم يتم تأكيد المهمة بعد":"Task is not confirmed yet");toast.info(msg);return}toast.success(`+${result.credits??0}`);await load()}catch{toast.error(ar?"تعذّر التحقق":"Could not verify")}finally{setBusy("")}}
 function open(task:Task){if(task.action_url?.startsWith("/"))navigate(task.action_url);else if(task.action_url)openTaskLink(task.action_url)}
 return <main className="min-h-dvh bg-background text-foreground" dir={ar?"rtl":"ltr"}><SEOHead title="Tasks — Orange AI" description="Your Orange AI tasks and points." path="/tasks"/><div className="mx-auto max-w-5xl px-5 py-8 md:px-10 md:py-12">
 <div className="flex items-start justify-between gap-4 border-b border-border pb-6"><div><p className="mb-2 text-sm font-medium text-primary">Orange AI</p><h1 className="text-3xl font-semibold">{ar?"المهام":"Tasks"}</h1></div><Button variant="ghost" size="icon" aria-label={ar?"تحديث":"Refresh"} disabled={loading} onClick={()=>void load()}><RefreshCw className={loading?"animate-spin":""}/></Button></div>
 <div className="flex items-center gap-3 py-7"><img src={logo.url} alt="Orange" className="h-11 w-11 object-contain"/><div><p className="text-xs text-muted-foreground">{ar?"رصيد النقاط":"Points balance"}</p><p className="mt-1 text-3xl font-semibold tabular-nums">{credits===null?"—":credits.toLocaleString()}</p></div></div>
 {error&&<p role="alert" className="mb-5 text-sm text-destructive">{error}</p>}
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{tasks.map(task=>{const daily=task.task_key==="daily_checkin";const completed=daily?!canCheckIn(done[task.id]??null):Boolean(done[task.id]);return <article key={task.id} className="overflow-hidden rounded-lg border border-border bg-card"><div className="h-48 overflow-hidden bg-muted"><img src={art[task.task_key]} alt="" className="h-full w-full object-cover object-[center_28%]"/></div><div className="p-5"><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums"><img src={logo.url} alt="Orange points" className="h-5 w-5"/>+{task.reward_credits}</span>{completed&&<Check className="h-4 w-4 text-primary"/>}</div><h2 className="mt-3 text-lg font-semibold">{labels[task.task_key]?.[ar?1:0]??task.title}</h2><div className="mt-5 flex gap-2">{completed?<p className="text-sm text-muted-foreground">{daily?(ar?"ارجع بعد ٢٤ ساعة":"Come back after 24 hours"):(ar?"اكتملت":"Completed")}</p>:<>{!daily&&<Button variant="outline" className="flex-1" onClick={()=>open(task)}>{ar?"افتح":"Open"}<ArrowUpRight className="h-4 w-4"/></Button>}<Button className="flex-1" disabled={busy===task.task_key} onClick={()=>void verify(task)}>{busy===task.task_key?"…":daily?(ar?"سجّل حضورك":"Check in"):(ar?"تحقّق":"Verify")}</Button></>}</div></div></article>})}</div>
 </div></main>
}
