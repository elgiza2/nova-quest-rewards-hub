import { createFileRoute } from "@tanstack/react-router";

const IMAGE_HEADERS = {
  "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600",
  "X-Content-Type-Options": "nosniff",
  "Content-Disposition": "inline",
};

export const Route = createFileRoute("/api/public/task-image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const fileId = new URL(request.url).searchParams.get("file_id") ?? "";
        if (!/^[A-Za-z0-9_-]{10,256}$/.test(fileId)) {
          return new Response("Invalid file id", { status: 400 });
        }
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) return new Response("Image service unavailable", { status: 503 });

        try {
          const metadataResponse = await fetch(
            `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
            { signal: AbortSignal.timeout(10_000) },
          );
          if (!metadataResponse.ok) return new Response("Image not found", { status: 404 });
          const metadata = (await metadataResponse.json()) as {
            ok?: boolean;
            result?: { file_path?: string };
          };
          const path = metadata.result?.file_path ?? "";
          if (!metadata.ok || !path || path.includes("..") || !/^[A-Za-z0-9_./-]+$/.test(path)) {
            return new Response("Image not found", { status: 404 });
          }

          const imageResponse = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
            signal: AbortSignal.timeout(15_000),
          });
          if (!imageResponse.ok) return new Response("Image unavailable", { status: 502 });
          const contentType = imageResponse.headers.get("content-type") ?? "";
          if (!contentType.toLowerCase().startsWith("image/"))
            return new Response("Unsupported image", { status: 415 });
          const size = Number(imageResponse.headers.get("content-length") ?? 0);
          if (size > 8 * 1024 * 1024) return new Response("Image too large", { status: 413 });

          return new Response(imageResponse.body, {
            status: 200,
            headers: { ...IMAGE_HEADERS, "Content-Type": contentType },
          });
        } catch (cause) {
          console.error("[task-image] Telegram image fetch failed", cause);
          return new Response("Image unavailable", { status: 502 });
        }
      },
    },
  },
});
