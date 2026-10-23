<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Generative UI: chat models answer with a ```ui JSON block validated by src/components/chat/genui/schema.ts and rendered by GenUIBlock; the prompt lives in genui/prompt.ts and is copied into supabase/functions/_shared/genui.ts (used by chat-fast and chat-alibaba; Deno cannot import src) — keep both in sync. ui blocks render outside the markdown pipeline so math/sanitize plugins cannot break them.
- Chat HTML widgets: ```widget blocks render in a sandboxed iframe (allow-scripts only) via genui/HtmlWidget.tsx with a built-in stylesheet; replies go back through megsy.send/postMessage. Why: rich model-drawn UI without access to the app session.
- Chat interactive answers use the vendored thesysdev/open-intelligent-ui component catalogue with @openuidev/react-lang, lazy-loaded behind ClientOnly; native openui fences and translated legacy ui specs share this renderer. Why: preserve original library behavior without importing Next.js or changing the primary agent.
- OpenUI SearchImage uses the existing browser-safe search resolver, and its CSS tokens are scoped to the chat and derived from Megsy's theme. Why: retain real searched photos and prevent library styles from changing the rest of the app.
- Domain cards extend the existing OpenUI catalogue and reuse its photo resolver and rendered action children; instructions are shared by browser and agent prompts. Why: keep places, menus and schedules interactive without a separate renderer or booking engine.
- Chat transport attaches the caller's bearer session to local proxy requests and waits for completion or explicit cancellation without browser generation deadlines; reasoning-only or empty streams are not successful answers. Why: avoid unauthorized proxy fallback, discarded generation and false completion.
- Manual crypto checkout shares one inline payment panel; only supported comment-bearing networks are offered, and confirmation calls the service-only atomic settlement function. Why: prevent reference ambiguity, reused transactions and partial credit activation.
- Reward task eligibility uses a shared allowlist and server-only atomic claims; unavailable external verification must not award points. Why: prevent arbitrary tasks and fabricated completions.
- Telegram fullscreen and inset events update shared safe-area variables, and profile pictures synchronize after verified Telegram sign-in. Why: keep native controls clear and returning-user identity current.
