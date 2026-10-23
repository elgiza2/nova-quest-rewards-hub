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
- [ ] Bot /start auto-link: deploy new public webhook route, switch webhook, remove "set your Telegram username" flow
- [ ] New bot token: replace TELEGRAM_BOT_TOKEN secret
- [ ] Bot admin panel /101 — user count + add/edit/delete tasks (name, link, image)
- [ ] reward_tasks image_url column + tasks UI shows task image
- [ ] EVM auto-pay (WalletConnect) needs a WalletConnect project ID from the user — fallback address+QR shipped
- [ ] Publish (Vercel token exposed in chat — do not use; publish via Lovable instead)
