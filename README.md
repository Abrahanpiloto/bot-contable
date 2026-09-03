# <img src="https://cdn.simpleicons.org/telegram/26A5E4" height="28" align="center"> <img src="https://cdn.simpleicons.org/googlesheets/34A853" height="28" align="center"> 🤖 bot-contable — Telegram + Google Sheets + DeepSeek

> <img src="https://cdn.simpleicons.org/telegram/26A5E4" height="16" align="center"> Bot personal de Telegram para contabilidad en **soles (PEN)**. Escribes en lenguaje natural, <img src="https://cdn.simpleicons.org/deepseek/7B5EFF" height="16" align="center"> **DeepSeek** interpreta, <img src="https://cdn.simpleicons.org/javascript/F7DF1E" height="16" align="center"> **JavaScript** calcula y <img src="https://cdn.simpleicons.org/googlesheets/34A853" height="16" align="center"> **Google Sheets** guarda. Solo tú puedes usarlo.

[![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Telegraf](https://img.shields.io/badge/Telegraf-4.16-polling-2CA5E0?logo=telegram)](https://telegraf.js.org)
[![DeepSeek](https://img.shields.io/badge/DeepSeek-deepseek--v4--flash-7B5EFF?logo=openai)](https://api-docs.deepseek.com)
[![Google Sheets](https://img.shields.io/badge/Google%20Sheets-API-34A853?logo=googlesheets&logoColor=white)](https://developers.google.com/sheets)
[![pnpm](https://img.shields.io/badge/pnpm-11.8-F69220?logo=pnpm)](https://pnpm.io)
[![cron](https://img.shields.io/badge/cron-4.4.0_07%3A00_America%2FLima-FF6B6B?logo=clockify)](https://www.npmjs.com/package/cron)
[![Northflank](https://img.shields.io/badge/Northflank-Buildpack-00D1FF?logo=northflank&logoColor=white)](https://northflank.com/docs/v1/application/build/build-with-buildpacks)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

---

## ✨ Qué hace

```text
Tú: gasté 18 soles en almuerzo hoy
Bot: Registrado: gasto 18 PEN en Comida el 03-09-2026 14:56 (almuerzo) → Hoja1!A:G

Tú: /balance
Bot: Ingresos: 200 PEN | Gastos: 38 PEN | Balance: 162 PEN | Mayor gasto: Comida 18 PEN
```

- 🧠 **DeepSeek `deepseek-v4-flash`** (`https://api.deepseek.com` vía SDK `openai`) solo interpreta → devuelve JSON estricto.
- 🧮 **JavaScript** hace todas las sumas (`balance = ingresos - gastos`, % por categoría). Nunca confía en la IA para totales.
- 📊 **Google Sheets** es el cuaderno: `fecha | hora | tipo | monto | moneda | categoria | nota`.

---

## 🏗️ Arquitectura

```text
Telegram
   │
   ▼
Bot Node.js + Telegraf (ESM, type: module, polling)
   ├─► bot.use → verifica TELEGRAM_USER_ID (rechaza a todos los demás)
   ├─► DeepSeek deepseek-v4-flash → {tipo,monto,categoria,fecha,hora,nota}
   ├─► Validación JS + cálculos
   ├─► Google Sheets Hoja1!A:G (appendRow / getAllRows / parseRows / deleteLastRow)
   └─► Cron 0 7 * * * America/Lima → Guardaditos-bcp 8 PEN diario + notificación
   ▼
Respuesta en Telegram
```

---

## 🧰 Stack

| Icono | Herramienta | Uso en proyecto |
|-------|-------------|-----------------|
| 🟢 | **Node.js** `type: module` | Runtime ESM (`import`) |
| ✈️ | **Telegraf `4.16.3`** | Polling, `bot.use`, `message("text")` |
| 🧠 | **DeepSeek `deepseek-v4-flash`** | Prompt JSON, `response_format: json_object`, `America/Lima` |
| 📦 | **openai `7.8.0`** | SDK compatible (solo `baseURL` cambia a `https://api.deepseek.com`) |
| 📊 | **googleapis `178.0.0`** | `sheets.spreadsheets.values.append/get` + `batchUpdate deleteDimension` |
| ⏰ | **cron `4.4.0`** | `CronJob("0 7 * * *", ..., "America/Lima")` Guardaditos |
| 📦 | **dotenv `17.4.2`** | Carga `.env` local (nunca a Git) |
| 📦 | **pnpm `11.8.0`** | Gestor único (store aislado, evita phantom dependencies) |
| ☁️ | **Northflank Buildpack** | Deploy sin Dockerfile, 24/7 |

---

## 🏷️ Categorías (20 fijas)

> Nunca añadas una nueva sin confirmar con el usuario.

| | | | |
|---|---|---|---|
| `Comida` | `Gasolina` | `Alquiler` | `Internet` |
| `Postpago-Entel` | `Ahorros` | `Sara-hija` | `Mama` |
| `Iglesia` | `Repuestos` | `Salud` | `Educación` |
| `Entretenimiento` | `Compras` | `Deudas` | `Trabajo` |
| `Delivery` | `MarketPlace` | `Guardaditos-bcp` | `Otros` |

- `Guardaditos-bcp` = gasto automático **8 PEN diario 07:00 `America/Lima`** sin intervención. `cron` + `appendGuardaditos`.

---

## 📂 Estructura

```text
bot-contable/
├── package.json          # type: module, pnpm, telegraf, openai, googleapis, cron
├── pnpm-lock.yaml
├── src/
│   ├── bot.js            # Telegraf + guard + parseMessage + comandos Fase 4 + cron 07:00
│   ├── ai.js             # DeepSeek deepseek-v4-flash, CATEGORIES 20, getNowInLima()
│   └── sheets.js         # appendRow, appendGuardaditos, getAllRows, parseRows, getLastRow, deleteLastRow
├── .gitignore            # node_modules/ , .env
├── .env                  # solo local, nunca commit
├── PLAN.md               # fases y decisiones
└── README.md
```

- Zona horaria: `America/Lima`. Fechas `dd-mm-aaaa`, hora `HH:MM`.
- Moneda: siempre `PEN`.

---

## 🚀 Instalación

```bash
# 1. Clonar (repo privado)
git clone git@github.com:Abrahanpiloto/bot-contable.git
cd bot-contable

# 2. Instalar con pnpm (no uses npm)
pnpm init
pnpm add telegraf dotenv openai googleapis cron

# 3. Configurar secretos (ver tabla abajo)
cp .env.example .env
# edita .env en VS Code

# 4. Probar parser DeepSeek
node src/ai.js "gasté 18 soles en almuerzo hoy"

# 5. Probar Sheets real
node -e "import './src/sheets.js' then ..."

# 6. Iniciar bot + cron
node src/bot.js
# → [cron] Guardaditos-bcp programado: todos los días 07:00 America/Lima
# → Bot iniciado con polling. Esperando mensajes...
```

---

## ⚙️ Variables de entorno

Crea `bot-contable/.env` (nunca a GitHub, ver `AGENTS.md`):

```env
TELEGRAM_TOKEN=123456:ABC...               # BotFather
TELEGRAM_USER_ID=TU_TELEGRAM_ID            # tu ID numérico, para bot.use
DEEPSEEK_API_KEY=sk-...                    # platform.deepseek.com (prepago)
SHEET_ID=TU_SHEET_ID                       # de la URL /d/TU_SHEET_ID/edit
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' # JSON en 1 línea entre ' '
```

| Variable | Origen | Nota |
|----------|--------|------|
| `TELEGRAM_TOKEN` | @BotFather | Token del bot |
| `TELEGRAM_USER_ID` | @userinfobot | Solo este ID pasa `bot.use` |
| `DEEPSEEK_API_KEY` | platform.deepseek.com | Modelo fijo en código `deepseek-v4-flash` |
| `SHEET_ID` | URL del Sheet `/d/<ID>/edit` | Pestaña debe llamarse exactamente `Hoja1` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Cloud IAM | Compartir Sheet como **Editor** con `client_email` |

> `SHEET_ID=dummy` + `GOOGLE_SERVICE_ACCOUNT_JSON=dummy` = modo mock `[sheets mock]` sin fallar.

---

## 💬 Uso

En Telegram (solo tu usuario autorizado):

| Mensaje | Respuesta del bot |
|---------|-------------------|
| `gasté 18 soles en almuerzo hoy` | `Registrado: gasto 18 PEN en Comida el 03-09-2026 14:56 (almuerzo)` |
| `me pagaron 200 de freelance` | `Registrado: ingreso 200 PEN en Trabajo ...` |
| `hola` (ambiguo) | `¿Fue gasto o ingreso? No pude entender...` |
| `/balance` | `Ingresos: 200 | Gastos: 26 | Balance: 174 | Mayor gasto: Comida 18 PEN (69%)` |
| `/hoy` | Lista del día `America/Lima` + totales |
| `/semana` | Últimos 7 días |
| `/por_categoria` | `Comida: 18 PEN (69%) → ...` ordenado desc |
| `/borrar_ultimo` | Muestra último → responde `sí` para borrar, otro texto cancela |
| `/start` | `Hola mundo — bot contable activo...` |

Datos en Sheets (`Hoja1!A:G`):

```text
fecha      | hora  | tipo   | monto | moneda | categoria       | nota
03-09-2026 | 14:56 | gasto  | 18    | PEN    | Comida          | almuerzo
03-09-2026 | 07:00 | gasto  | 8     | PEN    | Guardaditos-bcp | guardaditos automático bcp
```

---

## ⏰ Guardaditos-bcp automático

- `src/bot.js:105` `CronJob("0 7 * * *", ..., "America/Lima")` diario **07:00 Lima**.
- Escribe `gasto 8 PEN Guardaditos-bcp` vía `appendGuardaditos` y te notifica por Telegram.
- En local requiere que `node src/bot.js` esté corriendo. En producción corre 24/7 en Northflank.

---

## 💰 Costos DeepSeek

Prompt ~320 input + ~50 output por mensaje.

| Escenario (100 msgs/día) | Costo/día off-peak | $3 dura |
|--------------------------|--------------------|---------|
| Sin cache | $0.010 | 9.5 meses |
| 80% cache hit (`$0.007` hit) | $0.0049 | ~20 meses |

Recarga en `platform.deepseek.com/billing`. Saldo no expira. `402 Insufficient Balance` = sin crédito.

---

## ⚠️ Gotchas

- **Sheet no compartido** → `403 The caller does not have permission` → comparte como **Editor** con `bot-contable-telegram@...iam.gserviceaccount.com`.
- **Pestaña mal nombrada** → `Unable to parse range: Hoja1!A:G` → renombra abajo a exactamente `Hoja1` (sin espacio).
- **JSON multilínea** → `Error parseando GOOGLE_SERVICE_ACCOUNT_JSON` → debe ser 1 línea entre `'...'` en `.env`.
- **`/borrar_ultimo`** espera literal `sí`/`si` (con o sin tilde) → otro texto cancela.
- **Ambiguo** sin monto/tipo → `¿Fue gasto o ingreso?`.
- **Usa `pnpm` only** → no `npm`. `openai` es solo el nombre del SDK, proveedor es DeepSeek.
- **`429` / `402`** → sin saldo DeepSeek.

---

## 🗺️ Roadmap

- [x] Fase 0-1: Bot mínimo + pnpm + Telegraf polling + guard `TELEGRAM_USER_ID`
- [x] Fase 2: DeepSeek `deepseek-v4-flash` + `parseMessage()` 20 categorías + `America/Lima`
- [x] Fase 3: Sheets real `TU_SHEET_ID` + `Hoja1` + service account + `appendRow`
- [x] Fase 3bis: Cron Guardaditos `07:00 America/Lima`
- [x] Fase 4: Comandos `/balance /hoy /semana /por_categoria /borrar_ultimo` (JS calcula)
- [x] Fase 5: Seguridad y errores (guard, 402, permisos, hoja vacía, confirmación `sí`)
- [ ] Fase 6: Northflank Buildpack deploy 24/7 (siguiente)

---

## 📚 Referencias

- [DeepSeek API - Your First API Call](https://api-docs.deepseek.com/)
- [DeepSeek Pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [Telegram Bot API](https://core.telegram.org/bots/api/)
- [Google Sheets API append](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append)
- [Northflank Buildpacks](https://northflank.com/docs/v1/application/build/build-with-buildpacks)

---

## 📄 Licencia

ISC — uso personal. Secrets en `.env` / Northflank env vars, nunca en Git.
