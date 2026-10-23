# Roadmap

- [x] Redesign Tasks with Orange point icon and five character images; restrict active tasks to the five requested types.
- [x] Remove main Agents +; remove Earn tasks and rename Earn to Referral with Telegram-only invite links.
- [x] Inline manual TON/USDT-TON checkout; strict reference matching and atomic settlement with transaction reuse prevention.
- [x] Synchronize returning Telegram profile photos and fullscreen/safe-area events; native Back navigation.
- [x] Remove visible old sharing/help branding; restore readable shimmering thinking text.
- [x] 13 targeted tests passed; public Tasks and inline Crypto navigation checked on mobile without runtime errors.
- [ ] Real transfer and authenticated read-back: unavailable without a real payment/session; other networks are disabled pending reliable verification.
- [ ] X follow and ORANGE purchase rewards: require X account verification and cryptographic wallet ownership proof; opening links never grants points.
- [ ] Verify fullscreen, native Back and profile image inside an actual Telegram client.

- [x] Rename Megsy/Nova AI → Orange AI (UI + translations + support links @Torekr)
- [x] Telegram login (Mini App initData → session) + /api/public/telegram-auth
- [x] Reward tasks migration (telegram_join, daily_checkin; old Trustpilot/X tasks deactivated)
- [x] /tasks page — server-verified completion, credits awarded by /api/tasks/complete
- [x] Telegram button on the sign-in page
- [x] Crypto wallet addresses saved as secrets (TON / ETH / BSC / SOL / TRON)
- [x] crypto_payments migration
- [x] /api/crypto/invoice — invoice creation + on-chain verification + fulfilment
- [x] Legacy crypto page now uses the manual panel; current checkout keeps crypto inline.
- [x] Bot /start auto-link: webhook route deployed and registered (verified via getWebhookInfo)
- [x] New bot token: TELEGRAM_BOT_TOKEN secret replaced
- [x] Bot admin panel /101 — user count + add/edit/delete tasks (name, link, image)
- [x] Bot /start welcome image + two daily channel posts (English, bold captions, Open Orange AI button) + admin "post now" button
- [x] Orange AI logo + favicon/icons applied from the uploaded circular logo
- [x] reward_tasks image_url column + tasks UI shows task image
- [ ] Additional payment networks require transaction-specific secure verification; wallet-connect is no longer requested.
- [ ] Publish (Vercel token exposed in chat — do not use; publish via Lovable instead)

- [x] Start message rewrite (bold, characters, community + buy ORANGE buttons), daily user notifications, Telegram-only login, full-screen Mini App with top safe area
- [ ] Confirm /start and daily notification in real Telegram
- [x] Short start message + characters image, fixed broken images on Vercel, tasks (channel/X/ORANGE) with verification, Telegram Back button, crypto replaces Google Pay
- [ ] Bot must be admin in @oraien for channel-join verification
- [x] Tasks entry in app menu, real full screen, Telegram back button, crypto page Buffer crash, start image characters together, combined crypto icon
