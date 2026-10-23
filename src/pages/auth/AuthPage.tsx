/** @doc Telegram-only sign-in. Inside the Mini App the user is signed in
 *  automatically and sent to chat; outside Telegram we hand off to the bot. */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { isInsideTelegram, openBotForLogin, signInWithTelegram } from "@/lib/telegramAuth";
const logo = { url: "/orange-logo.png" };

export default function AuthPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [inTg, setInTg] = useState(false);
  const [failed, setFailed] = useState(false);
  const target = params.get("redirect")?.startsWith("/") ? params.get("redirect")! : "/";

  useEffect(() => {
    let alive = true;
    const tg = isInsideTelegram();
    setInTg(tg);
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) return navigate(target, { replace: true });
      if (!tg) return;
      const r = await signInWithTelegram();
      if (!alive) return;
      if (r.ok) navigate(target, { replace: true });
      else setFailed(true);
    })();
    return () => {
      alive = false;
    };
  }, [navigate, target]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-6 text-center text-foreground">
      <img src={logo.url} alt="Orange AI" className="h-20 w-20 rounded-full" />
      <h1 className="text-2xl font-bold">Orange AI</h1>
      {inTg && !failed ? (
        <p className="text-muted-foreground" role="status">Signing you in with Telegram...</p>
      ) : (
        <>
          <p className="max-w-xs text-muted-foreground">
            {failed ? "We couldn't sign you in. Please try again." : "Orange AI works inside Telegram. Open it there to sign in automatically."}
          </p>
          <button
            type="button"
            onClick={() => (failed ? window.location.reload() : void openBotForLogin())}
            className="rounded-full bg-primary px-8 py-3 font-semibold text-primary-foreground"
          >
            {failed ? "Try again" : "Open in Telegram"}
          </button>
        </>
      )}
    </div>
  );
}
