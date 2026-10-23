import { useEffect, useState } from "react";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useUserLang } from "@/lib/authI18n";
type Invoice = {id:string;wallet:string;payAmount:number;memo:string;expiresAt:string};
export default function ManualCryptoPayment({tier,interval,sku}:{tier:string;interval:string;sku?:string|null}) {
  const ar=useUserLang()==="ar-eg";
  const [asset,setAsset]=useState("usdt_ton");
  const [invoice,setInvoice]=useState<Invoice|null>(null);
  const [status,setStatus]=useState("loading");
  const [error,setError]=useState("");
  const [retry,setRetry]=useState(0);
  async function request(url:string,body?:object) {
    const {data}=await supabase.auth.getSession();
    if (!data.session) throw new Error(ar?"افتح التطبيق من تليجرام للدفع":"Open the app from Telegram to pay");
    const res=await fetch(url,{method:body?"POST":"GET",headers:{Authorization:`Bearer ${data.session.access_token}`,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
    const result=await res.json();
    if (!res.ok || !result.ok) throw new Error(ar?"الدفع غير متاح الآن، جرّب تاني":"Payment is unavailable right now. Please retry.");
    return result;
  }
  useEffect(()=>{
    let alive=true;
    setInvoice(null);setStatus("loading");setError("");
    request("/api/crypto/invoice",sku?{sku,asset}:{tier,interval,asset}).then(data=>{if(alive){setInvoice(data.invoice);setStatus("pending")}}).catch(e=>{if(alive){setStatus("error");setError(e.message)}});
    return ()=>{alive=false};
  },[tier,interval,sku,asset,retry]);
  useEffect(()=>{
    if(!invoice || status!=="pending") return;
    let alive=true;
    const check=async()=>{try{const data=await request(`/api/crypto/invoice?id=${invoice.id}`);if(alive){setStatus(data.status);setError("")}}catch{if(alive)setError(ar?"التحقق متأخر؛ لم يتم تأكيد الدفع بعد":"Verification is delayed; payment is not confirmed yet")}};
    const timer=setInterval(()=>void check(),12000);
    return ()=>{alive=false;clearInterval(timer)};
  },[invoice,status]);
  const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value)}catch{setError(ar?"تعذّر النسخ":"Could not copy")}};
  return <div className="space-y-5 text-foreground" dir={ar?"rtl":"ltr"}>
    <div className="flex gap-2" role="tablist" aria-label="Crypto asset">{["usdt_ton","ton"].map(key=><Button key={key} variant={asset===key?"default":"outline"} role="tab" aria-selected={asset===key} onClick={()=>setAsset(key)}>{key==="ton"?"TON":"USDT · TON"}</Button>)}</div>
    {status==="loading" && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>{ar?"بنجهز الدفع…":"Preparing payment…"}</p>}
    {invoice && status!=="paid" && <>
      <div><p className="text-xs text-muted-foreground">{ar?"المبلغ":"Amount"}</p><p className="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">{invoice.payAmount} {asset==="ton"?"TON":"USDT"}</p></div>
      {[{label:ar?"عنوان الاستلام · شبكة TON فقط":"Receiving address · TON network only",value:invoice.wallet},{label:ar?"التعليق المطلوب":"Required payment comment",value:invoice.memo}].map(field=><div key={field.label}><p className="mb-2 text-xs text-muted-foreground">{field.label}</p><div className="flex items-start gap-2 border-b border-border pb-2"><code className="min-w-0 flex-1 break-all text-sm" dir="ltr">{field.value}</code><Button size="icon" variant="ghost" aria-label={`${ar?"انسخ":"Copy"} ${field.label}`} onClick={()=>void copy(field.value)}><Copy className="h-4 w-4"/></Button></div></div>)}
      <p className="text-xs leading-relaxed text-muted-foreground">{ar?"ابعت المبلغ كامل مع التعليق ده؛ المرجع مرتبط بحسابك وعام على الشبكة. بدون التعليق مش هنقدر نثبت الدفع. رسوم الشبكة منفصلة.":"Send the exact amount with this comment. The reference is linked to your account and publicly visible on-chain. Without it, payment cannot be confirmed. Network fees are separate."}</p>
      <p role="status" className="flex items-center gap-2 text-sm"><RefreshCw className="h-4 w-4"/>{status==="expired"?(ar?"انتهت صلاحية الطلب؛ لا ترسل إليه":"Invoice expired; do not send payment"):(ar?"بانتظار التحويل والتحقق":"Waiting for transfer and verification")}</p>
    </>}
    {status==="paid" && <p role="status" className="flex items-center gap-2 font-semibold"><Check className="h-5 w-5"/>{ar?"الدفع مؤكد والاشتراك اتفعّل":"Payment confirmed and purchase activated"}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {["expired","error"].includes(status) && <Button variant="outline" onClick={()=>setRetry(v=>v+1)}><RefreshCw className="h-4 w-4"/>{ar?"طلب جديد":"New invoice"}</Button>}
  </div>;
}