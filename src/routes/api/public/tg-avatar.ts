/** Same-origin proxy for Telegram profile pictures (t.me/i/userpic only).
 *  Telegram's redirecting SVG links often fail to render inside the Mini App. */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/tg-avatar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const raw = new URL(request.url).searchParams.get("u") ?? "";
        let target: URL;
        try { target = new URL(raw); } catch { return new Response("bad", { status: 400 }); }
        if (target.protocol !== "https:" || target.hostname !== "t.me" || !target.pathname.startsWith("/i/userpic/")) {
          return new Response("forbidden", { status: 403 });
        }
        const res = await fetch(target.toString(), { redirect: "follow" });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !type.startsWith("image/")) return new Response("not found", { status: 404 });
        return new Response(res.body, {
          headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" },
        });
      },
    },
  },
});
