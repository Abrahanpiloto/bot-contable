import "dotenv/config";
import OpenAI from "openai";

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});
const MODEL = "deepseek-v4-flash";
// Modelo vision: nombre actual según docs (legacy -vision-exp redirige a Flash)
const VISION_MODEL = process.env.DEEPSEEK_VISION_MODEL || "deepseek-flash";

const CATEGORIES = [
  "Comida",
  "Gasolina",
  "Alquiler",
  "Internet",
  "Postpago-Entel",
  "Ahorros",
  "Sara-hija",
  "Mama",
  "Iglesia",
  "Repuestos",
  "Salud",
  "Educación",
  "Entretenimiento",
  "Compras",
  "Deudas",
  "Trabajo",
  "Delivery",
  "MarketPlace",
  "Guardaditos-bcp",
  "Otros",
];

// Current date/time in America/Lima, format dd-mm-aaaa and HH:MM
function getNowInLima() {
  const now = new Date();
  const date = now
    .toLocaleDateString("es-PE", {
      timeZone: "America/Lima",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
    .replace(/\//g, "-"); // 02/09/2026 -> 02-09-2026
  const time = now.toLocaleTimeString("es-PE", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { date, time };
}

export async function parseMessage(text) {
  const { date: today, time: currentTime } = getNowInLima();

  const prompt = `Eres el intérprete contable del bot. Hoy es ${today} ${currentTime} en America/Lima.
Categorías fijas: ${CATEGORIES.join(", ")}.
Moneda siempre PEN.

Devuelve SOLO JSON válido sin markdown con estos campos:
{
  "tipo": "gasto" | "ingreso" | "aclarar",
  "monto": number | null,
  "moneda": "PEN",
  "categoria": string | null,
  "fecha": "dd-mm-aaaa" | null,
  "hora": "HH:MM" | null,
  "nota": string | null
}

Reglas:
- No inventes monto. Si no hay número, monto=null y tipo="aclarar".
- No inventes si es gasto o ingreso. Palabras como "gasté","pagué","compré" -> gasto. "me pagaron","ingresó","recibí" -> ingreso. Si ambiguo, tipo="aclarar".
- No inventes categoría fuera de la lista. Elige la más cercana o "Otros". Si tipo="aclarar", categoria=null.
- Fecha: interpreta "hoy" como ${today}, "ayer" como día anterior. Si no menciona fecha, usa ${today}. Formato dd-mm-aaaa.
- Hora: si no menciona hora, usa ${currentTime}.
- Nota: resumen corto del concepto sin monto (ej: "almuerzo").
Texto del usuario: """${text}"""`;

  const response = await deepseek.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "Eres un parser contable estricto. Solo JSON.",
      },
      { role: "user", content: prompt },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`DeepSeek did not return valid JSON: ${raw}`);
  }

  // Validation in JavaScript (do not trust AI for totals, PLAN.md:67)
  return validateParsed(data, today, currentTime);
}

function validateParsed(data, today, currentTime) {
  if (!data || typeof data !== "object") data = {};
  if (!["gasto", "ingreso", "aclarar"].includes(data.tipo)) data.tipo = "aclarar";
  // Acepta montos numéricos o strings con coma/punto ("20,51" / "20.51")
  if (typeof data.monto === "string") {
    const s = data.monto.trim().replace(/\s+/g, "");
    const norm = s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, "");
    const n = Number(norm);
    data.monto = Number.isNaN(n) ? null : n;
  }
  if (
    data.monto !== null &&
    (typeof data.monto !== "number" || Number.isNaN(data.monto) || data.monto <= 0)
  )
    data.monto = null;
  if (data.tipo === "aclarar") {
    data.monto = null;
    data.categoria = null;
  }
  if (data.categoria && !CATEGORIES.includes(data.categoria)) data.categoria = "Otros";
  if (!data.moneda) data.moneda = "PEN";
  if (!data.fecha) data.fecha = today;
  if (!data.hora) data.hora = currentTime;

  return data;
}

// Foto de comprobante (boleta, voucher, depósito) -> mismo objeto contable.
// imageBase64: base64 sin prefijo data:. mimeType: image/jpeg por defecto.
export async function parseReceiptImage({ imageBase64, mimeType = "image/jpeg", hint = "" }) {
  const { date: today, time: currentTime } = getNowInLima();

  const prompt = `Eres el intérprete contable del bot. Hoy es ${today} ${currentTime} en America/Lima.
Analizas la FOTO de un comprobante peruano: boleta, factura, ticket, voucher Yape/Plin/BCP, constancia de transferencia o depósito.
Categorías fijas: ${CATEGORIES.join(", ")}.
Moneda siempre PEN.

Devuelve SOLO JSON válido sin markdown con estos campos:
{
  "tipo": "gasto" | "ingreso" | "aclarar",
  "monto": number | null,
  "moneda": "PEN",
  "categoria": string | null,
  "fecha": "dd-mm-aaaa" | null,
  "hora": "HH:MM" | null,
  "nota": string | null
}

Reglas:
- No inventes monto. Lee el TOTAL del comprobante. Si es ilegible o no hay número, monto=null y tipo="aclarar".
- Tipo: boleta de compra, pago, ticket, "Yapeaste", "transferencia exitosa enviada", consumo -> gasto. Depósito recibido, abono, "te enviaron", sueldo, pago de cliente -> ingreso. Si ambiguo, tipo="aclarar".
- No inventes categoría fuera de la lista. Elige la más cercana o "Otros". Si tipo="aclarar", categoria=null.
- Fecha: lee la fecha impresa del comprobante si es visible (formato dd-mm-aaaa). Si no es visible, usa ${today}.
- Hora: lee la hora impresa si es visible (HH:MM). Si no, usa ${currentTime}.
- Nota: resumen corto sin monto (ej: "boleta almuerzo", "yape recibido", "depósito bcp").
${hint ? `Contexto del usuario: """${hint}"""` : ""}`;

  const response = await deepseek.chat.completions.create({
    model: VISION_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "Eres un parser contable estricto. Solo JSON.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
        ],
      },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`DeepSeek vision did not return valid JSON: ${raw}`);
  }

  return validateParsed(data, today, currentTime);
}

// Aplica una corrección en texto libre sobre un objeto ya propuesto.
// Ej: actual {monto: 30} + "cambia monto a 25" -> {monto: 25, resto igual}.
export async function correctReceipt(current, correctionText) {
  const { date: today, time: currentTime } = getNowInLima();

  const prompt = `Eres el intérprete contable del bot. Hoy es ${today} ${currentTime} en America/Lima.
Tienes el objeto contable actual (JSON) extraído de una foto y el usuario lo corrige en texto libre.
Categorías fijas: ${CATEGORIES.join(", ")}.
Moneda siempre PEN.

Objeto actual:
${JSON.stringify(current)}

Corrección del usuario: """${correctionText}"""

Devuelve SOLO JSON válido sin markdown con estos campos actualizados:
{
  "tipo": "gasto" | "ingreso" | "aclarar",
  "monto": number | null,
  "moneda": "PEN",
  "categoria": string | null,
  "fecha": "dd-mm-aaaa" | null,
  "hora": "HH:MM" | null,
  "nota": string | null
}

Reglas:
- Solo cambia lo que el usuario pide, mantén el resto del objeto actual.
- "cambia monto a 25" / "son 25" -> monto 25. Acepta coma decimal.
- "es comida" / "ponlo en salud" -> cambia categoria (solo valores de la lista, si no existe usa "Otros").
- "fue gasto" / "fue ingreso" -> cambia tipo.
- "ayer" / "hoy" / fecha explícita -> cambia fecha a dd-mm-aaaa.
- Si la corrección no es clara, devuelve el objeto actual sin cambios.`;

  const response = await deepseek.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "Eres un parser contable estricto. Solo JSON.",
      },
      { role: "user", content: prompt },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`DeepSeek did not return valid JSON: ${raw}`);
  }

  return validateParsed(data, today, currentTime);
}

// Quick test: node src/ai.js "gasté 18 soles en almuerzo hoy"
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const testText = process.argv.slice(2).join(" ") || "gasté 18 soles en almuerzo hoy";
  parseMessage(testText)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch(console.error);
}
