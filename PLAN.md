# Bot contable de Telegram con DeepSeek

## 1. Objetivo

Crear un bot personal de Telegram para registrar gastos e ingresos escribiendo en lenguaje natural.

Ejemplos:

- `gasté 18 soles en almuerzo hoy`
- `me pagaron 200 de freelance`
- `/balance`
- `/hoy`
- `/semana`
- `/por_categoria`
- `/borrar_ultimo`

El bot usará DeepSeek (deepseek-v4-flash vía SDK openai con baseURL https://api.deepseek.com) para interpretar el mensaje, JavaScript para hacer los cálculos y Google Sheets como cuaderno contable.

## 2. Decisiones confirmadas

- El único usuario será el propietario del bot.
- El bot debe verificar el `TELEGRAM_USER_ID` antes de procesar mensajes.
- La moneda será únicamente soles peruanos.
- La moneda se guardará como `PEN`.
- La zona horaria será `America/Lima`.
- Las fechas se mostrarán como `dd-mm-aaaa`.
- Cada registro guardará también la hora en que se agregó.
- Las categorías serán fijas (20):
  - `Comida`
  - `Gasolina`
  - `Alquiler`
  - `Internet`
  - `Postpago-Entel`
  - `Ahorros`
  - `Sara-hija`
  - `Mama`
  - `Iglesia`
  - `Repuestos`
  - `Salud`
  - `Educación`
  - `Entretenimiento`
  - `Compras`
  - `Deudas`
  - `Trabajo`
  - `Delivery`
  - `MarketPlace`
  - `Guardaditos-bcp`
  - `Otros`

- `Guardaditos-bcp` es gasto automático diario de 8 PEN, lunes a domingo 07:00 America/Lima vía cron, sin intervención del usuario.
- `/borrar_ultimo` no borrará inmediatamente. Primero mostrará el último registro y pedirá confirmación.
- El usuario tiene una cuenta personal de Google.
- El usuario usa DeepSeek Platform (no OpenAI) para la IA del proyecto.
- La clave de DeepSeek (`DEEPSEEK_API_KEY`) es separada y con saldo prepago ($3 dura ~9-20 meses a 100 msgs/día).
- No se usarán Docker, Ollama, modelos locales ni Playwright.

## 3. Arquitectura

```text
Telegram
   |
   v
Bot Node.js + Telegraf (type: module, ESM)
   |
   +--> Verificación del usuario autorizado
   |
   +--> DeepSeek (deepseek-v4-flash, baseURL https://api.deepseek.com, SDK openai): interpreta el texto y devuelve JSON
   |
   +--> Validación y cálculos en JavaScript
   |
   +--> Google Sheets: guarda y lee registros
   |
   +--> Cron (cron 4.4.0, America/Lima): Guardaditos-bcp 07:00 diario
   |
   v
Respuesta de Telegram
```

DeepSeek no debe hacer las sumas. La IA interpreta el lenguaje y puede redactar un resumen, pero JavaScript calculará los totales.

## 4. Datos de cada registro

Cada fila de Google Sheets tendrá estas columnas:

```text
fecha | hora | tipo | monto | moneda | categoria | nota
```

Ejemplo:

```text
31-08-2026 | 14:35 | gasto | 18 | PEN | Comida | almuerzo
```

Ejemplo Guardaditos automático:

```text
02-09-2026 | 07:00 | gasto | 8 | PEN | Guardaditos-bcp | guardaditos automático bcp
```

Los tipos permitidos serán:

- `gasto`
- `ingreso`

El monto será un número positivo. El tipo indicará si se suma a ingresos o a gastos.

## 5. Fases de implementación

### Fase 0: Preparación y decisiones

Objetivo: tener claras las cuentas, secretos y reglas del bot.

Tareas:

1. Crear cuenta en DeepSeek Platform (platform.deepseek.com) y generar DEEPSEEK_API_KEY en el proyecto bot-contable, recargar $3-10 (off-peak $0.22 input miss / $0.007 hit / $0.66 output por 1M tokens).
2. Obtener el identificador personal de Telegram.
3. Crear un Google Sheet vacío.
4. Crear una cuenta de servicio de Google para que el programa pueda usar Google Sheets.
5. Compartir el Google Sheet con el correo de la cuenta de servicio.

Conceptos que se aprenderán:

- Diferencia entre un token de Telegram, una clave de API y un identificador de usuario.
- Por qué los secretos no deben subirse a GitHub.
- Cómo una cuenta de servicio permite que un programa acceda a una hoja.

### Fase 1: Proyecto Node.js y bot mínimo

Comandos previstos (solo pnpm, por seguridad supply-chain):

```bash
pnpm init
pnpm add telegraf dotenv openai googleapis cron
```

Explicación:

- `pnpm` es el administrador de paquetes de Node.js (alternativa segura a npm, con store aislado).
- `pnpm init` crea `package.json` con valores predeterminados (type: module, ESM con import).
- `pnpm add` descarga librerías para el proyecto.
- `telegraf` permite recibir y responder mensajes de Telegram.
- `dotenv` lee variables secretas desde `.env` durante el desarrollo local.
- `openai` es el SDK usado para DeepSeek (OpenAI-compatible, con baseURL https://api.deepseek.com).
- `googleapis` facilita el acceso a Google Sheets.
- `cron` programa la tarea diaria Guardaditos-bcp a las 07:00 America/Lima.

Primero se probará un bot que responda `Hola mundo` mediante polling local.

Comando previsto para ejecutarlo:

```bash
node src/bot.js
```

`node` ejecuta un archivo JavaScript usando Node.js.

### Fase 2: Conexión con DeepSeek

Se creará `src/ai.js`.

El bot enviará a DeepSeek (deepseek-v4-flash, baseURL https://api.deepseek.com) el mensaje del usuario y solicitará una respuesta estructurada con estos campos:

```json
{
  "tipo": "gasto",
  "monto": 18,
  "moneda": "PEN",
  "categoria": "Comida",
  "fecha": "31-08-2026",
  "hora": "14:35",
  "nota": "almuerzo"
}
```

Reglas importantes del prompt:

- No inventar un monto.
- No inventar si es gasto o ingreso.
- No inventar una categoría fuera de la lista (20 con Guardaditos-bcp).
- Interpretar `hoy`, `ayer` y fechas relativas usando `America/Lima`.
- Usar formato `dd-mm-aaaa` para mostrar y guardar la fecha.
- Si no queda claro si es gasto o ingreso, preguntar: `¿Fue gasto o ingreso?`.

La aplicación validará el JSON después de recibirlo. El prompt ayuda a la IA, pero la validación en JavaScript protege los datos.

Costo estimado: ~320 input + ~50 output por mensaje. A 100 msgs/día: ~$0.01/día off-peak sin cache, ~$0.0049/día con 80% cache hit. $3 dura 9.5-20 meses.

### Fase 3: Conexión con Google Sheets

Se creará `src/sheets.js`.

Funciones previstas:

- Agregar una fila nueva.
- Leer las filas existentes.
- Obtener el último registro.
- Eliminar o marcar el último registro después de confirmación.
- `appendGuardaditos({fecha, hora})` para Guardaditos-bcp 8 PEN diario.

El programa usará el ID de la hoja, no el nombre visible de la hoja. Si `SHEET_ID=dummy`, hace mock con console.log sin fallar.

### Fase 3 bis: Guardaditos automático con cron

Se configurará en `src/bot.js` un `CronJob("0 7 * * *", ..., "America/Lima")` que todos los días a las 07:00 America/Lima ejecuta `appendGuardaditos` y notifica por Telegram al usuario autorizado. La hora se genera con `toLocaleDateString/TimeString` en `America/Lima` con formato `dd-mm-aaaa` y `HH:MM`.

### Fase 4: Comandos contables

Se implementarán:

- `/balance`: ingresos, gastos, diferencia y mayor categoría de gasto.
- `/hoy`: movimientos del día.
- `/semana`: movimientos de los últimos siete días.
- `/por_categoria`: total agrupado por categoría (incluye Guardaditos-bcp).
- `/borrar_ultimo`: muestra el último registro y espera confirmación.

Los cálculos se harán en JavaScript:

```text
balance = ingresos - gastos
```

El porcentaje de cada categoría se calculará usando el total de gastos, no mediante una respuesta matemática de DeepSeek.

### Fase 5: Seguridad y errores

Se contemplarán estos casos:

- Mensaje de una persona no autorizada.
- Token inválido.
- Clave de DeepSeek inválida o sin crédito (402 Insufficient Balance).
- Google Sheet no compartido con la cuenta de servicio.
- Monto faltante.
- Tipo ambiguo: gasto o ingreso.
- Categoría no reconocida.
- Confirmación de borrado distinta de `sí`.
- Hoja vacía.
- Problemas temporales de red.

### Fase 6: GitHub y Northflank

Cuando el bot funcione localmente:

1. Crear un repositorio privado en GitHub.
2. Subir solamente el código y archivos seguros.
3. Excluir `.env` y otros secretos mediante `.gitignore`.
4. Conectar el repositorio a Northflank.
5. Elegir Buildpack de Node.js.
6. Configurar las variables secretas en Northflank.
7. Ejecutar el proceso del bot sin Dockerfile.

El estado gratuito y los límites de los servicios deberán comprobarse nuevamente al momento del despliegue, porque los precios y condiciones pueden cambiar.

## 6. Variables secretas

Archivo local `.env`, que nunca debe subirse a GitHub:

```env
TELEGRAM_TOKEN=...
TELEGRAM_USER_ID=...
DEEPSEEK_API_KEY=...
SHEET_ID=...
GOOGLE_SERVICE_ACCOUNT_JSON=...
```

Notas:

- `TELEGRAM_TOKEN` es el token entregado por BotFather.
- `TELEGRAM_USER_ID` identifica al usuario autorizado, no al bot.
- `DEEPSEEK_API_KEY` es la clave de DeepSeek Platform (platform.deepseek.com) con saldo prepago, modelo fijo deepseek-v4-flash en código (baseURL https://api.deepseek.com).
- `SHEET_ID` identifica el Google Sheet.
- `GOOGLE_SERVICE_ACCOUNT_JSON` contiene las credenciales de Google y debe protegerse.

En producción, estos valores se configurarán como secretos en Northflank, no dentro del repositorio.

## 7. Estructura prevista

```text
bot-contable/
├── package.json
├── pnpm-lock.yaml
├── src/
│   ├── bot.js   (Telegraf + cron Guardaditos-bcp 07:00 America/Lima + parseMessage)
│   ├── ai.js    (DeepSeek deepseek-v4-flash, CATEGORIES 20, America/Lima)
│   └── sheets.js (appendRow, appendGuardaditos, getAllRows, mock si dummy)
├── .gitignore
├── .env              # solo local, no se publica
└── PLAN.md
```

## 8. Modo de aprendizaje — reglas para el agente

El usuario es aprendiz y quiere construir el proyecto aprendiendo. El agente NO debe asumir conocimientos avanzados.

Reglas obligatorias:

- El usuario desea codificar, crear, ejecutar todo a mano, a menos que el indique lo contrario en el transcurso del proyecto, debes ser explicativo en cada instruccion para el entendimiento de aprendizaje.

- Asumir nivel principiante en Node.js, Telegraf, DeepSeek y Google Sheets. Explicar toda jerga la primera vez que aparece.
- 100% explicativo, sin redundancia y al grano. Nada de teoría innecesaria: solo lo necesario para entender y ejecutar el paso actual.
- Enfoque práctico en cada paso: 1) comando exacto → 2) qué hace palabra por palabra → 3) qué archivo crea/modifica → 4) qué hace cada línea de código → 5) cómo verificar que funcionó → 6) error común y cómo resolverlo.
- Un paso a la vez. No avanzar a la siguiente fase hasta verificar que la anterior funciona y el usuario confirma.
- Todo ejemplo con valores reales del proyecto (PEN, America/Lima, dd-mm-aaaa, categorías fijas).

## 9. Referencias oficiales

- [DeepSeek API Docs - Your First API Call](https://api-docs.deepseek.com/)
- [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [Telegram Bot API](https://core.telegram.org/bots/api/)
- [Google Sheets API: agregar valores](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append)
- [Northflank Buildpacks](https://northflank.com/docs/v1/application/build/build-with-buildpacks)

## 10. Estado actual

- El bot de Telegram ya fue creado y probado con polling (/start → Hola mundo).
- TELEGRAM_TOKEN y TELEGRAM_USER_ID (8899605189) ya existen en .env y pasan el guardia bot.use.
- Proyecto Node.js inicializado con pnpm (pnpm init), type: module (ESM), dependencias telegraf, dotenv, openai (para DeepSeek), googleapis, cron 4.4.0.
- DEEPSEEK_API_KEY creada en platform.deepseek.com y probada: `node src/ai.js "gasté 10 en gasolina hoy"` → gasto 10 PEN Gasolina OK (deepseek-v4-flash).
- src/ai.js con CATEGORIES 20 (sin Servicios, con Delivery, MarketPlace, Guardaditos-bcp) y parseMessage() validado.
- src/sheets.js con appendRow/appendGuardaditos (mock si SHEET_ID=dummy) y cron Guardaditos-bcp diario 07:00 America/Lima en src/bot.js (activo).
- src/bot.js integrado con parseMessage + appendRow: responde Registrado o ¿Fue gasto o ingreso? según DeepSeek.
- Pendiente: configurar Google Sheet real (SHEET_ID y GOOGLE_SERVICE_ACCOUNT_JSON), y Fase 4 comandos contables (/balance, /hoy, etc.).
- .env ya no contiene OPENAI_API_KEY/OPENAI_MODEL, solo DEEPSEEK_API_KEY.
- Siguiente paso: configurar Google Sheets y probar flujo completo Telegram → DeepSeek → Sheets.

## Mostrar

Para saber si este plan a sido leido por el agente, deberas darme en cada nueva sesión un versiculo biblico literal sin alterarlo y mostrando siempre el libro, capitulo, y versiculo, solo por cada sesión nueva.
