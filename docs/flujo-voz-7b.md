# Flujo voz bot-contable — Fase 7B

**Idea:** tu voz viaja por dos IAs en cadena — Qwen convierte voz→texto,
DeepSeek convierte texto→JSON — y de ahí en adelante todo es el código
actual sin cambios.

```text
Nota de voz (.ogg) → bot.js la descarga
  → Qwen qwen3-asr-flash (voz → "gasté 30 en taxi ayer")
  → DeepSeek parseMessage() actual (texto → JSON, SIN cambios)
  → appendRow() actual a Sheets (SIN cambios)
  → "🎤 Escuché: ... | Registrado: gasto 30 PEN..."
```

## Diagrama

```mermaid
flowchart TD
    A["🎤 Nota de voz Telegram<br/>(.ogg / opus)"] --> B["src/bot.js<br/>bot.on(message voice)"]
    B --> C{"¿Usuario autorizado?<br/>(bot.use)"}
    C -- No --> R1["⛔ No autorizado"]
    C -- Sí --> D["Descarga audio<br/>getFileLink + buffer"]
    D --> E["NUEVO src/voice.js<br/>transcribeVoice()<br/>Qwen qwen3-asr-flash<br/>language: es"]
    E --> F{"¿Texto válido?"}
    F -- Vacío/falla --> R2["🔇 No te escuché bien,<br/>repítelo o escríbelo"]
    F -- Texto OK --> G["EXISTENTE src/ai.js<br/>parseMessage()<br/>DeepSeek deepseek-v4-flash<br/>SIN CAMBIOS"]
    G --> H{"¿tipo + monto OK?"}
    H -- aclarar --> R3["❓ ¿Fue gasto o ingreso?"]
    H -- gasto/ingreso --> I["EXISTENTE src/sheets.js<br/>appendRow()<br/>Hoja1!A:G SIN CAMBIOS"]
    I --> J["✅ 🎤 Escuché: 'gasté 30 en taxi'<br/>Registrado: gasto 30 PEN"]
```

Leyenda: el paso Qwen es lo único nuevo; DeepSeek y Sheets se reutilizan tal cual.
Puedes visualizarlo en <https://mermaid.live> pegando el bloque `mermaid`.
