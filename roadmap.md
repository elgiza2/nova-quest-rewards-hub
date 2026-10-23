# Roadmap

- [x] Rename Megsy/Nova AI → Orange AI (UI + translations + support links @Torekr)
- [x] Telegram login (Mini App initData → session) + /api/public/telegram-auth
- [x] Reward tasks migration (telegram_join, daily_checkin; old Trustpilot/X tasks deactivated)
- [x] /tasks page — server-verified completion, credits awarded by /api/tasks/complete
- [x] Telegram button on the sign-in page
- [x] Crypto wallet addresses saved as secrets (TON / ETH / BSC / SOL / TRON)
- [x] crypto_payments migration
- [x] /api/crypto/invoice — invoice creation + on-chain verification + fulfilment
- [ ] Crypto checkout page (/checkout/crypto) + TonConnect auto-payment + wiring on pricing/credit packs
- [x] Bot /start auto-link: webhook route deployed and registered (verified via getWebhookInfo)
- [x] New bot token: TELEGRAM_BOT_TOKEN secret replaced
- [x] Bot admin panel /101 — user count + add/edit/delete tasks (name, link, image)
- [x] Bot /start welcome image + two daily channel posts (English, bold captions, Open Orange AI button) + admin "post now" button
- [x] Orange AI logo + favicon/icons applied from the uploaded circular logo
- [x] reward_tasks image_url column + tasks UI shows task image
- [ ] EVM auto-pay (WalletConnect) needs a WalletConnect project ID from the user — fallback address+QR shipped
- [ ] Publish (Vercel token exposed in chat — do not use; publish via Lovable instead)

- [x] Start message rewrite (bold, characters, community + buy ORANGE buttons), daily user notifications, Telegram-only login, full-screen Mini App with top safe area
- [ ] Confirm /start and daily notification in real Telegram
- [x] Short start message + characters image, fixed broken images on Vercel, tasks (channel/X/ORANGE) with verification, Telegram Back button, crypto replaces Google Pay
- [ ] Bot must be admin in @oraien for channel-join verification
