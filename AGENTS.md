# AGENTS.md — bot-contable

Telegram bot for personal accounting. Single user only. Reads natural-language messages, interprets via DeepSeek, stores in Google Sheets, responds with balances.

## Stack

- **Runtime:** Node.js (type: module, ESM)
- **Bot framework:** Telegraf (polling)
- **AI:** DeepSeek `deepseek-v4-flash` via OpenAI SDK (baseURL `https://api.deepseek.com`, structured JSON output)
- **Storage:** Google Sheets API via `googleapis`
- **Scheduler:** `cron` 4.4.0 — daily Guardaditos-bcp 07:00 `America/Lima`
- **Config:** `dotenv` (`.env` file, never committed)
- **Package manager:** `pnpm` only (supply-chain security, isolated store)
- **Deploy:** Northflank (Buildpack `heroku/builder:24`, no Docker) — status `Running` since 03-09-2026. Requires `start: node src/bot.js`, `engines node 22.x`, `packageManager pnpm@11.8.0`. No public port (polling bot).

## Commands

```bash
pnpm init
pnpm add telegraf dotenv openai googleapis cron
node src/bot.js          # run the bot (polling + cron)
node src/ai.js "gasté 18 soles en almuerzo hoy"  # test DeepSeek parser
```

No test framework, linter, or type checker configured yet.

## Project structure

```
src/
  bot.js      — Telegraf bot, user verification (bot.use), message routing, cron Guardaditos-bcp 07:00 America/Lima, parseMessage + appendRow, Fase 4 commands (/balance /hoy /semana /por_categoria /borrar_ultimo), /comandos + /help + greeting
  ai.js       — DeepSeek deepseek-v4-flash prompt (returns JSON), categories 20, timezone America/Lima, string-monto coercion ("20,51")
  sheets.js   — Google Sheets read/write (appendRow, appendGuardaditos, getAllRows, parseRows, parseMonto, getLastRow, deleteLastRow; mock if SHEET_ID=dummy)
```

## Key conventions

- Currency: always `PEN` (soles peruanos). No other currencies.
- Timezone: `America/Lima`. All dates stored as `dd-mm-aaaa` and time as `HH:MM`.
- Fixed category list (20) — never add new categories without user confirmation:
  `Comida, Gasolina, Alquiler, Internet, Postpago-Entel, Ahorros, Sara-hija, Mama, Iglesia, Repuestos, Salud, Educación, Entretenimiento, Compras, Deudas, Trabajo, Delivery, MarketPlace, Guardaditos-bcp, Otros`
- `Guardaditos-bcp` is automatic daily gasto 8 PEN at 07:00 America/Lima via cron, no user input.
- DeepSeek interprets text; JavaScript does all math. Never trust AI for totals.
- `/borrar_ultimo` requires confirmation with `sí` before deleting (shows last record first).
- Greeting-only messages (`hola`, etc.) reply with greeting + command list without calling DeepSeek (saves cost).
- `/comandos` and `/help` list available commands.
- User authorized via `TELEGRAM_USER_ID` env var — reject all other users via `bot.use`.
- Secrets live in `.env` (local) or Northflank env vars (prod). Never commit.

## Env vars (required)

```
TELEGRAM_TOKEN
TELEGRAM_USER_ID
DEEPSEEK_API_KEY
SHEET_ID
GOOGLE_SERVICE_ACCOUNT_JSON
```

- `DEEPSEEK_API_KEY` is from platform.deepseek.com (prepaid, separate from any OpenAI key)
- Model is fixed in code as `deepseek-v4-flash` at `https://api.deepseek.com` — not via env var
- `SHEET_ID=dummy` and `GOOGLE_SERVICE_ACCOUNT_JSON=dummy` enable mock mode (console.log)

## Gotchas

- Google Sheet must be shared with the service account email before API calls work.
- Sheet tab must be named exactly `Hoja1` (else `Unable to parse range: Hoja1!A:G`).
- `GOOGLE_SERVICE_ACCOUNT_JSON` must be 1 line in `.env` (between `'...'`); in Northflank without outer quotes.
- Never run local `node src/bot.js` while Northflank is `Running` (same token → `409 Conflict`).
- The DeepSeek key should be separate and prepaid ($3 lasts ~9-20 months at 100 msgs/day).
- `429 Insufficient Balance` means no DeepSeek credit — recharge at platform.deepseek.com/billing.
- `/borrar_ultimo` shows the last record and waits for `sí` confirmation (any other text cancels).
- Ambiguous messages (unclear gasto/ingreso or missing monto) → reply `¿Fue gasto o ingreso?`.
- Use `pnpm` only — do not use `npm`. `openai` is the SDK package name but provider is DeepSeek.
