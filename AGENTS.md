# AGENTS.md — bot-contable

Telegram bot for personal accounting. Single user only. Reads natural-language messages, interprets via OpenAI, stores in Google Sheets, responds with balances.

## Stack

- **Runtime:** Node.js
- **Bot framework:** Telegraf (polling)
- **AI:** OpenAI SDK (structured JSON output)
- **Storage:** Google Sheets API via googleapis
- **Config:** dotenv (`.env` file, never committed)
- **Deploy:** Northflank (Buildpack, no Docker)

## Commands

```bash
npm init -y
npm install telegraf dotenv openai googleapis
node src/bot.js          # run the bot
```

No test framework, linter, or type checker configured yet.

## Project structure (planned)

```
src/
  bot.js      — Telegraf bot, message routing, user verification
  ai.js       — OpenAI structured-output prompt (returns JSON)
  sheets.js   — Google Sheets read/write/delete
```

## Key conventions

- Currency: always `PEN` (soles peruanos). No other currencies.
- Timezone: `America/Lima`. All dates stored as `dd-mm-aaaa`.
- Fixed category list — never add new categories without user confirmation.
- OpenAI interprets text; JavaScript does all math. Never trust AI for totals.
- `/borrar_ultimo` requires confirmation before deleting.
- User authorized via `TELEGRAM_USER_ID` env var — reject all other users.
- Secrets live in `.env` (local) or Northflank env vars (prod). Never commit.

## Env vars (required)

```
TELEGRAM_TOKEN
TELEGRAM_USER_ID
OPENAI_API_KEY
OPENAI_MODEL
SHEET_ID
GOOGLE_SERVICE_ACCOUNT_JSON
```

## Gotchas

- Google Sheet must be shared with the service account email before API calls work.
- `OPENAI_MODEL` controls the model — change it via env, not code.
- The OpenAI key should be separate from any other project's key.
- `/borrar_ultimo` shows the last record and waits for `sí` confirmation.
- Ambiguous messages (unclear gasto/ingreso) prompt the user to clarify.
