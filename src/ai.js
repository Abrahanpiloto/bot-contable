import "dotenv/config";
import OpenAI from "openai";

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});
const MODEL = "deepseek-v4-flash";

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
  if (!["gasto", "ingreso", "aclarar"].includes(data.tipo))
    data.tipo = "aclarar";
  if (
    data.monto !== null &&
    (typeof data.monto !== "number" || data.monto <= 0)
  )
    data.monto = null;
  if (data.tipo === "aclarar") {
    data.monto = null;
    data.categoria = null;
  }
  if (data.categoria && !CATEGORIES.includes(data.categoria))
    data.categoria = "Otros";
  if (!data.moneda) data.moneda = "PEN";
  if (!data.fecha) data.fecha = today;
  if (!data.hora) data.hora = currentTime;

  return data;
}

// Quick test: node src/ai.js "gasté 18 soles en almuerzo hoy"
if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))
) {
  const testText =
    process.argv.slice(2).join(" ") || "gasté 18 soles en almuerzo hoy";
  parseMessage(testText)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch(console.error);
}
