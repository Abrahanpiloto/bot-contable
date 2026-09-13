import "dotenv/config";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { CronJob } from "cron";
import {
  appendGuardaditos,
  appendRow,
  getAllRows,
  parseRows,
  getLastRow,
  deleteLastRow,
} from "./sheets.js";
import { parseMessage, parseReceiptImage, correctReceipt } from "./ai.js";

const token = process.env.TELEGRAM_TOKEN;
const allowedUserId = String(process.env.TELEGRAM_USER_ID || "");

if (!token) {
  console.error("Falta TELEGRAM_TOKEN en .env");
  process.exit(1);
}
if (!allowedUserId) {
  console.error("Falta TELEGRAM_USER_ID en .env");
  process.exit(1);
}

const bot = new Telegraf(token);

// middleware = filtro que se ejecuta ANTES de cada mensaje
bot.use((ctx, next) => {
  const fromId = String(ctx.from?.id || "");

  if (fromId !== allowedUserId) {
    console.log(`Rechazado usuario no autorizado: ${fromId}`);
    return ctx.reply("No estás autorizado para usar este bot.");
  }
  return next();
});

// --- Helpers fecha America/Lima ---
function getTodayInLima() {
  return new Date()
    .toLocaleDateString("es-PE", {
      timeZone: "America/Lima",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
    .replace(/\//g, "-");
}

function parseFechaDDMMAAAA(str) {
  const [dd, mm, yyyy] = str.split("-").map(Number);
  return new Date(yyyy, mm - 1, dd);
}

function formatRow(r) {
  return `${r.fecha} ${r.hora} | ${r.tipo} ${r.monto} PEN | ${r.categoria} | ${r.nota}`;
}

// Estado para /borrar_ultimo confirmación
let pendingDelete = null; // { userId, row }

// Estado para foto de comprobante pendiente de confirmación
// { userId, data, awaitingCorrection: boolean }
let pendingPhoto = null;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB

function formatProposal(d) {
  return (
    `Voy a guardar:\n` +
    `Tipo: ${d.tipo}\n` +
    `Monto: ${d.monto} ${d.moneda}\n` +
    `Categoría: ${d.categoria}\n` +
    `Fecha: ${d.fecha} ${d.hora}\n` +
    `Nota: ${d.nota}`
  );
}

function photoKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Sí", callback_data: "photo_yes" },
          { text: "✏️ Corregir", callback_data: "photo_fix" },
          { text: "❌ Cancelar", callback_data: "photo_no" },
        ],
      ],
    },
  };
}

// --- Texto compartido /comandos + saludo ---
const COMANDOS_TEXT =
  `Comandos disponibles:\n` +
  `/start — activa y muestra bienvenida\n` +
  `/balance — ingresos, gastos y balance (PEN)\n` +
  `/hoy — movimientos de hoy (America/Lima)\n` +
  `/semana — últimos 7 días\n` +
  `/por_categoria — gastos por categoría con %\n` +
  `/borrar_ultimo — muestra último y espera sí para borrar\n` +
  `/comandos — esta lista\n\n` +
  `También puedes enviarme la foto de una boleta, voucher o depósito y la registro previa confirmación.`;

function buildGreeting(ctx) {
  const name = ctx.from?.first_name || "Abrahan";
  return (
    `Hola ${name}, soy un bot que te ayudará con tu economía día a día, fui desarrollado por Abrahan Piloto.\n\n` +
    `${COMANDOS_TEXT}\n\n` +
    `Ejemplo: escribe "gasté 18 soles en almuerzo hoy" o "me pagaron 200 de freelance" y lo registro en tu hoja.`
  );
}

// Detecta saludo puro (sin monto ni movimiento): hola, buenas, etc.
function isGreeting(text) {
  const norm = text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[!¡?¿.,;:()"-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [
    "hola",
    "buenas",
    "buenos dias",
    "buenas tardes",
    "buenas noches",
    "hey",
    "holi",
    "saludos",
    "que tal",
    "como estas",
    "hola bot",
  ].includes(norm);
}

bot.start((ctx) => ctx.reply(`${buildGreeting(ctx)}`));

bot.command("comandos", (ctx) => ctx.reply(COMANDOS_TEXT));
bot.command("help", (ctx) => ctx.reply(COMANDOS_TEXT));

// --- Fase 4: Comandos contables (JS hace las sumas) ---

bot.command("balance", async (ctx) => {
  try {
    const rows = await getAllRows();
    const data = parseRows(rows);
    if (data.length === 0) return ctx.reply("Hoja vacía, aún no hay registros.");

    let ingresos = 0;
    let gastos = 0;
    const porCategoria = {};
    for (const r of data) {
      if (r.tipo === "ingreso") ingresos += r.monto;
      else if (r.tipo === "gasto") {
        gastos += r.monto;
        porCategoria[r.categoria] = (porCategoria[r.categoria] || 0) + r.monto;
      }
    }
    const balance = ingresos - gastos;
    let mayorCat = "-";
    let mayorMonto = 0;
    for (const [cat, total] of Object.entries(porCategoria)) {
      if (total > mayorMonto) {
        mayorMonto = total;
        mayorCat = cat;
      }
    }
    const pctMayor = gastos ? ((mayorMonto / gastos) * 100).toFixed(1) : "0.0";
    return ctx.reply(
      `Balance (PEN):\nIngresos: ${ingresos}\nGastos: ${gastos}\nBalance: ${balance}\nMayor gasto: ${mayorCat} ${mayorMonto} PEN (${pctMayor}%)`,
    );
  } catch (err) {
    console.error("Error /balance:", err.message);
    return ctx.reply(`Error en /balance: ${err.message}`);
  }
});

bot.command("hoy", async (ctx) => {
  try {
    const today = getTodayInLima();
    const rows = await getAllRows();
    const data = parseRows(rows).filter((r) => r.fecha === today);
    if (data.length === 0) return ctx.reply(`Hoy ${today}: sin movimientos.`);
    let gastos = 0;
    let ingresos = 0;
    const lines = data.map((r) => {
      if (r.tipo === "gasto") gastos += r.monto;
      else ingresos += r.monto;
      return `- ${formatRow(r)}`;
    });
    return ctx.reply(
      `Hoy ${today} (${data.length} movs):\n${lines.join("\n")}\nTotal gastos: ${gastos} PEN | ingresos: ${ingresos} PEN`,
    );
  } catch (err) {
    console.error("Error /hoy:", err.message);
    return ctx.reply(`Error en /hoy: ${err.message}`);
  }
});

bot.command("semana", async (ctx) => {
  try {
    const todayStr = getTodayInLima();
    const todayDate = parseFechaDDMMAAAA(todayStr);
    const hace7 = new Date(todayDate);
    hace7.setDate(todayDate.getDate() - 6);
    const rows = await getAllRows();
    const data = parseRows(rows).filter((r) => {
      const d = parseFechaDDMMAAAA(r.fecha);
      return d >= hace7 && d <= todayDate;
    });
    if (data.length === 0) return ctx.reply(`Últimos 7 días (${todayStr}): sin movimientos.`);
    let gastos = 0;
    let ingresos = 0;
    const lines = data.map((r) => {
      if (r.tipo === "gasto") gastos += r.monto;
      else ingresos += r.monto;
      return `- ${formatRow(r)}`;
    });
    return ctx.reply(
      `Últimos 7 días (${hace7.toLocaleDateString("es-PE", { timeZone: "America/Lima" }).replace(/\//g, "-")} al ${todayStr}) (${data.length} movs):\n${lines.join("\n")}\nTotal gastos: ${gastos} PEN | ingresos: ${ingresos} PEN`,
    );
  } catch (err) {
    console.error("Error /semana:", err.message);
    return ctx.reply(`Error en /semana: ${err.message}`);
  }
});

bot.command("por_categoria", async (ctx) => {
  try {
    const rows = await getAllRows();
    const data = parseRows(rows).filter((r) => r.tipo === "gasto");
    if (data.length === 0) return ctx.reply("Sin gastos registrados.");
    const totales = {};
    let totalGastos = 0;
    for (const r of data) {
      totales[r.categoria] = (totales[r.categoria] || 0) + r.monto;
      totalGastos += r.monto;
    }
    const sorted = Object.entries(totales).sort((a, b) => b[1] - a[1]);
    const lines = sorted.map(([cat, tot]) => {
      const pct = ((tot / totalGastos) * 100).toFixed(1);
      return `- ${cat}: ${tot} PEN (${pct}%)`;
    });
    return ctx.reply(`Gastos por categoría (total ${totalGastos} PEN):\n${lines.join("\n")}`);
  } catch (err) {
    console.error("Error /por_categoria:", err.message);
    return ctx.reply(`Error en /por_categoria: ${err.message}`);
  }
});

bot.command("borrar_ultimo", async (ctx) => {
  try {
    const last = await getLastRow();
    if (!last) return ctx.reply("Hoja vacía, nada que borrar.");
    pendingDelete = { userId: String(ctx.from.id), row: last };
    return ctx.reply(
      `Último registro:\n${formatRow(last)}\n¿Borrar? Responde sí para confirmar o cualquier otro texto para cancelar.`,
    );
  } catch (err) {
    console.error("Error /borrar_ultimo:", err.message);
    return ctx.reply(`Error en /borrar_ultimo: ${err.message}`);
  }
});

bot.on(message("text"), async (ctx) => {
  const text = ctx.message.text;
  console.log(`Mensaje de ${ctx.from.id}: ${text}`);

  // Si hay foto pendiente en modo corrección, este texto es la corrección
  if (
    pendingPhoto &&
    String(ctx.from.id) === pendingPhoto.userId &&
    pendingPhoto.awaitingCorrection
  ) {
    try {
      const updated = await correctReceipt(pendingPhoto.data, text);
      console.log("Corregido:", updated);
      if (updated.tipo === "aclarar" || !updated.monto) {
        pendingPhoto.data = updated;
        return ctx.reply(
          `No entendí la corrección. El objeto sigue así:\n${formatProposal({ ...updated, tipo: updated.tipo, monto: updated.monto ?? "?" })}`,
          photoKeyboard(),
        );
      }
      pendingPhoto.data = updated;
      pendingPhoto.awaitingCorrection = false;
      return ctx.reply(`${formatProposal(updated)}\n¿Confirmas?`, photoKeyboard());
    } catch (err) {
      console.error("Error correctReceipt:", err.message);
      if (err.message.includes("402") || err.message.includes("Insufficient Balance")) {
        return ctx.reply("Sin saldo DeepSeek. Recarga en platform.deepseek.com/billing");
      }
      return ctx.reply(`Error aplicando corrección: ${err.message}`);
    }
  }

  // Si hay borrado pendiente, este texto es la confirmación
  if (pendingDelete && String(ctx.from.id) === pendingDelete.userId) {
    const norm = text.trim().toLowerCase();
    const isSi =
      norm === "sí" || norm === "si" || norm === "sí," || norm === "si," || norm === "sì";
    const row = pendingDelete.row;
    pendingDelete = null;
    if (isSi) {
      try {
        await deleteLastRow();
        return ctx.reply(`Borrado: ${formatRow(row)}`);
      } catch (err) {
        console.error("Error borrando:", err.message);
        return ctx.reply(`Error al borrar: ${err.message}`);
      }
    } else if (isGreeting(text)) {
      return ctx.reply(`Cancelado, no se borró nada.\n\n${buildGreeting(ctx)}`);
    } else {
      return ctx.reply("Cancelado, no se borró nada.");
    }
  }

  if (text.startsWith("/")) return;

  // Si hay foto pendiente esperando botón, recordar usar botones
  if (
    pendingPhoto &&
    String(ctx.from.id) === pendingPhoto.userId &&
    !pendingPhoto.awaitingCorrection
  ) {
    return ctx.reply(
      `Tienes una foto pendiente de confirmación.\n${formatProposal(pendingPhoto.data)}\nUsa los botones ✅ Sí / ✏️ Corregir / ❌ Cancelar.`,
      photoKeyboard(),
    );
  }

  // Saludo puro antes de DeepSeek (ahorra costo IA)
  if (isGreeting(text)) {
    console.log(`Saludo de ${ctx.from.id}: ${text}`);
    return ctx.reply(buildGreeting(ctx));
  }

  try {
    const data = await parseMessage(text);
    console.log("Parseado:", data);

    if (data.tipo === "aclarar" || !data.monto) {
      return ctx.reply(
        `¿Fue gasto o ingreso? No pude entender el monto o tipo.\n` +
          `Texto: "${text}"\n` +
          `Intenta: "gasté 18 soles en almuerzo hoy" o "me pagaron 200 freelance"`,
      );
    }

    await appendRow({
      fecha: data.fecha,
      hora: data.hora,
      tipo: data.tipo,
      monto: data.monto,
      moneda: data.moneda,
      categoria: data.categoria,
      nota: data.nota,
    });

    return ctx.reply(
      `Registrado: ${data.tipo} ${data.monto} ${data.moneda} en ${data.categoria} el ${data.fecha} ${data.hora} (${data.nota})`,
    );
  } catch (err) {
    console.error("Error parseMessage:", err.message);
    if (err.message.includes("402") || err.message.includes("Insufficient Balance")) {
      return ctx.reply("Sin saldo DeepSeek. Recarga en platform.deepseek.com/billing");
    }
    return ctx.reply(`Error interpretando mensaje: ${err.message}`);
  }
});

bot.on(message("photo"), async (ctx) => {
  const userId = String(ctx.from.id);
  console.log(`Foto de ${userId}`);

  // Exclusión mutua con borrado pendiente
  if (pendingDelete && userId === pendingDelete.userId) {
    return ctx.reply(
      "Tienes un borrado pendiente. Responde sí para confirmar o cualquier otro texto para cancelar antes de enviar fotos.",
    );
  }
  if (pendingPhoto && userId === pendingPhoto.userId && !pendingPhoto.awaitingCorrection) {
    return ctx.reply(
      `Tienes una foto pendiente de confirmación.\n${formatProposal(pendingPhoto.data)}\nUsa los botones ✅ Sí / ✏️ Corregir / ❌ Cancelar.`,
      photoKeyboard(),
    );
  }

  const photos = ctx.message.photo || [];
  if (photos.length === 0) return ctx.reply("No recibí la foto. Envíala de nuevo.");
  const best = photos[photos.length - 1]; // mayor resolución
  const caption = ctx.message.caption || "";

  await ctx.reply("Procesando foto…").catch(() => {});
  try {
    const link = await ctx.telegram.getFileLink(best.file_id);
    const res = await fetch(link.href || String(link));
    if (!res.ok) throw new Error(`No pude descargar la foto (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_PHOTO_BYTES) {
      return ctx.reply(
        "La foto es muy pesada (más de 10MB). Tómala con menor resolución o haz captura y envíala de nuevo.",
      );
    }
    const imageBase64 = buf.toString("base64");
    // buf se libera al salir del handler (no se guarda en disco ni en Sheets)

    const data = await parseReceiptImage({ imageBase64, mimeType: "image/jpeg", hint: caption });
    console.log("Foto parseada:", data);

    if (data.tipo === "aclarar" || !data.monto) {
      return ctx.reply(
        "No pude leer el comprobante (monto o tipo ilegible). Envíame otra foto más clara, de frente y con buena luz.",
      );
    }

    pendingPhoto = { userId, data, awaitingCorrection: false };
    return ctx.reply(`${formatProposal(data)}\n¿Confirmas?`, photoKeyboard());
  } catch (err) {
    console.error("Error foto:", err.message);
    if (err.message.includes("402") || err.message.includes("Insufficient Balance")) {
      return ctx.reply("Sin saldo DeepSeek. Recarga en platform.deepseek.com/billing");
    }
    return ctx.reply(`Error procesando foto: ${err.message}. Envíame otra foto.`);
  }
});

bot.action("photo_yes", async (ctx) => {
  const userId = String(ctx.from.id);
  if (!pendingPhoto || userId !== pendingPhoto.userId) {
    await ctx.answerCbQuery("Sin foto pendiente").catch(() => {});
    return;
  }
  const data = pendingPhoto.data;
  pendingPhoto = null;
  await ctx.answerCbQuery("Guardando").catch(() => {});
  try {
    await appendRow({
      fecha: data.fecha,
      hora: data.hora,
      tipo: data.tipo,
      monto: data.monto,
      moneda: data.moneda,
      categoria: data.categoria,
      nota: data.nota,
    });
    return ctx.reply(
      `Registrado: ${data.tipo} ${data.monto} ${data.moneda} en ${data.categoria} el ${data.fecha} ${data.hora} (${data.nota})`,
    );
  } catch (err) {
    console.error("Error guardando foto:", err.message);
    return ctx.reply(`Error guardando: ${err.message}`);
  }
});

bot.action("photo_fix", async (ctx) => {
  const userId = String(ctx.from.id);
  if (!pendingPhoto || userId !== pendingPhoto.userId) {
    await ctx.answerCbQuery("Sin foto pendiente").catch(() => {});
    return;
  }
  pendingPhoto.awaitingCorrection = true;
  await ctx.answerCbQuery().catch(() => {});
  return ctx.reply(
    `Dime qué corregir en texto libre. Ej: "cambia monto a 25", "es comida", "fue gasto", "fue ayer".`,
  );
});

bot.action("photo_no", async (ctx) => {
  const userId = String(ctx.from.id);
  if (!pendingPhoto || userId !== pendingPhoto.userId) {
    await ctx.answerCbQuery("Sin foto pendiente").catch(() => {});
    return;
  }
  pendingPhoto = null;
  await ctx.answerCbQuery("Cancelado").catch(() => {});
  return ctx.reply("Cancelado, no se guardó nada.");
});

bot.launch(() => console.log("Bot iniciado con polling. Esperando mensajes..."));

// Cron: Guardaditos-bcp automático Lunes a Domingo 07:00 America/Lima
function getNowInLimaForCron() {
  const now = new Date();
  const date = now
    .toLocaleDateString("es-PE", {
      timeZone: "America/Lima",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
    .replace(/\//g, "-");
  const time = now.toLocaleTimeString("es-PE", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { date, time };
}

const guardaditosJob = new CronJob(
  "0 7 * * *",
  async () => {
    const { date, time } = getNowInLimaForCron();
    console.log(`[cron] Ejecutando guardaditos automático ${date} ${time} America/Lima`);
    try {
      await appendGuardaditos({ fecha: date, hora: time });
      console.log(`[cron] Guardaditos-bcp 8 PEN registrado ${date} ${time}`);
      try {
        await bot.telegram.sendMessage(
          allowedUserId,
          `Guardaditos-bcp automático: 8 PEN guardados el ${date} a las ${time} (America/Lima). Categoría Guardaditos-bcp.`,
        );
      } catch (notifyErr) {
        console.log("[cron] No se pudo notificar por Telegram:", notifyErr.message);
      }
    } catch (err) {
      console.error("[cron] Error guardando guardaditos:", err.message);
    }
  },
  null,
  true,
  "America/Lima",
);

console.log(
  `[cron] Guardaditos-bcp programado: todos los días 07:00 America/Lima (activo: ${guardaditosJob.running})`,
);

process.once("SIGINT", () => {
  guardaditosJob.stop();
  bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
  guardaditosJob.stop();
  bot.stop("SIGTERM");
});
