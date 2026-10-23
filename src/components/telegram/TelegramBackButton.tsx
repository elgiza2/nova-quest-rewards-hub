/** @doc Drives Telegram's native Back button from the router: shown on every
 *  screen except the home/chat screen, and it navigates back in-app. */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

type BackBtn = { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };

const ROOTS = new Set(["/", "/chat", "/index", "/welcome"]);

export default function TelegramBackButton() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const btn = (window as unknown as { Telegram?: { WebApp?: { BackButton?: BackBtn; initData?: string } } }).Telegram
      ?.WebApp?.BackButton;
    if (!btn) return;
    const wa = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
    if (!wa?.initData) return;
    document.documentElement.classList.add("tg-app");
    const onBack = () => {
      if (window.history.length > 1 && (window.history.state?.idx ?? 1) > 0) navigate(-1);
      else navigate("/chat", { replace: true });
    };
    if (ROOTS.has(location.pathname)) btn.hide();
    else btn.show();
    btn.onClick(onBack);
    return () => btn.offClick(onBack);
  }, [location.pathname, navigate]);

  return null;
}
