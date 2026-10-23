/** Route Telegram profile pictures through our own proxy so they render. */
export function avatarSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("https://t.me/i/userpic/")) return `/api/public/tg-avatar?u=${encodeURIComponent(url)}`;
  return url;
}
