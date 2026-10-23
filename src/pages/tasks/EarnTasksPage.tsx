import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useUserLang } from "@/lib/authI18n";
import SEOHead from "@/components/common/SEOHead";
import { openTaskLink } from "@/lib/telegramAuth";
import { ORANGE_TASK_KEYS, canCheckIn } from "@/lib/orangeTasks";
const logo = { url: "/orange-logo.png" };
import xArt from "@/assets/tasks/follow_x.jpg";
import communityArt from "@/assets/tasks/join_channel.jpg";
import coinArt from "@/assets/tasks/buy_orange.jpg";
import planArt from "@/assets/tasks/first_subscription.jpg";
import dailyArt from "@/assets/tasks/daily_checkin.jpg";
type Task={id:string;task_key:string;title:string;reward_credits:number;action_url:string|null;image_url:string|null};
const taskOrder=(t:Task)=>{const i=ORANGE_TASK_KEYS.findIndex(k=>k===t.task_key);return i<0?ORANGE_TASK_KEYS.length:i};
const sortTasks=(list:Task[])=>list.sort((a,b)=>taskOrder(a)-taskOrder(b));
const art:Record<string,string>={follow_x:xArt,join_channel:communityArt,buy_orange:coinArt,first_subscription:planArt,daily_checkin:dailyArt};
const labels:Record<string,[string,string]>={follow_x:["Follow ORANGE on X","تابع ORANGE على إكس"],join_channel:["Join the community","انضم للمجتمع"],buy_orange:["Buy ORANGE","اشتري ORANGE"],first_subscription:["Monthly subscription","الاشتراك الشهري"],daily_checkin:["Daily check-in","الحضور اليومي"]};
export default function EarnTasksPage(){
 const ar=useUserLang()==="ar-eg";const navigate=useNavigate();
 const [tasks,setTasks]=useState<Task[]>([]);const [done,setDone]=useState<Record<string,string>>({});const [credits,setCredits]=useState<number|null>(null);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState("");const [error,setError]=useState("");const [openedKeys,setOpenedKeys]=useState<Record<string,boolean>>({});
 const load=useCallback(async()=>{setLoading(true);try{
 const publicTasks=await supabase.from("reward_tasks").select("id,task_key,title,reward_credits,action_url").eq("active",true).in("task_key",[...ORANGE_TASK_KEYS]);
 if(!publicTasks.error)setTasks((publicTasks.data??[]).sort((a,b)=>ORANGE_TASK_KEYS.findIndex(k=>k===a.task_key)-ORANGE_TASK_KEYS.findIndex(k=>k===b.task_key)));
 const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error(ar?"افتح التطبيق من تليجرام لاستلام نقاطك":"Open the app from Telegram to claim your points");
 const [tk,ut,p]=await Promise.all([supabase.from("reward_tasks").select("id,task_key,title,reward_credits,action_url").eq("active",true).in("task_key",[...ORANGE_TASK_KEYS]),supabase.from("user_reward_tasks").select("task_id,completed_at").eq("user_id",user.id),supabase.from("profiles").select("credits").eq("id",user.id).maybeSingle()]);
 if(tk.error||ut.error||p.error)throw new Error(ar?"تعذر تحميل المهام":"Could not load tasks");
 setTasks((tk.data??[]).sort((a,b)=>ORANGE_TASK_KEYS.findIndex(k=>k===a.task_key)-ORANGE_TASK_KEYS.findIndex(k=>k===b.task_key)));setDone(Object.fromEntries((ut.data??[]).filter(r=>r.completed_at).map(r=>[r.task_id,r.completed_at as string])));setCredits(Number(p.data?.credits??0));setError("");
 }catch(e){setError(e instanceof Error?e.message:"Could not load tasks")}finally{setLoading(false)}},[ar]);
 useEffect(()=>{void load()},[load]);
 async function verify(task:Task){setBusy(task.task_key);try{const {data}=await supabase.auth.getSession();if(!data.session)return;const res=await fetch("/api/tasks/complete",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify({taskKey:task.task_key})});const result=await res.json();if(!result.ok){const msg=result.error==="x_verification_unavailable"?(ar?"متابعة إكس تحتاج ربط حساب إكس؛ لن تُمنح نقاط قبل التحقق":"X account verification is required before points can be awarded"):result.error==="wallet_ownership_verification_required"?(ar?"شراء العملة يحتاج إثبات ملكية المحفظة؛ لا تكفي كتابة عنوانها":"Coin purchase requires proof of wallet ownership; entering an address is not enough"):(ar?"لم يتم تأكيد المهمة بعد":"Task is not confirmed yet");toast.info(msg);return}toast.success(`+${result.credits??0}`);await load()}catch{toast.error(ar?"تعذّر التحقق":"Could not verify")}finally{setBusy("")}}
 function open(task:Task){if(task.action_url?.startsWith("/"))navigate(task.action_url);else if(task.action_url)openTaskLink(task.action_url)}
 return <main className="min-h-dvh bg-background text-foreground" dir={ar?"rtl":"ltr"}><SEOHead title="Tasks — Orange AI" description="Your Orange AI tasks and points." path="/tasks"/><div className="mx-auto max-w-md px-4 py-6">
 <h1 className="text-xl font-semibold">{ar?"المهام":"Tasks"}</h1><div className="mt-4 mb-6 flex items-center gap-3 rounded-2xl bg-muted/50 p-4"><img src={logo.url} alt="Orange" className="h-10 w-10 rounded-full object-contain"/><div><p className="text-xs text-muted-foreground">{ar?"رصيد النقاط":"Points balance"}</p><p className="text-2xl font-semibold tabular-nums">{credits===null?"—":credits.toLocaleString()}</p></div></div>
 {error&&<p role="alert" className="mb-5 text-sm text-destructive">{error}</p>}
 <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">{tasks.map(task=>{const daily=task.task_key==="daily_checkin";const completed=daily?!canCheckIn(done[task.id]??null):Boolean(done[task.id]);const opened=daily||Boolean(openedKeys[task.task_key]);return <li key={task.id} className="flex items-center gap-3 px-3 py-2.5"><img src={art[task.task_key]} alt="" className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted object-cover" style={{borderRadius:"9999px",aspectRatio:"1/1"}}/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{labels[task.task_key]?.[ar?1:0]??task.title}</p><p className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums"><img src={logo.url} alt="" className="h-3.5 w-3.5"/>+{task.reward_credits}</p></div>{completed?<Check aria-label={ar?"اكتملت":"Completed"} className="h-5 w-5 shrink-0 text-primary"/>:<Button size="sm" className="h-7 shrink-0 rounded-full px-3 text-xs" disabled={busy===task.task_key} onClick={()=>{if(!opened){setOpenedKeys(o=>({...o,[task.task_key]:true}));open(task);}else void verify(task);}}>{busy===task.task_key?"…":opened&&!daily?(ar?"تحقّق":"Verify"):(ar?"يلا":"Go")}</Button>}</li>})}</ul>
 </div></main>
}
