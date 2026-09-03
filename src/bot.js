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
import { parseMessage } from "./ai.js";

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

bot.start((ctx) =>
  ctx.reply(
    "Hola mundo — bot contable activo. Envíame un mensaje.\nComandos: /balance /hoy /semana /por_categoria /borrar_ultimo",
  ),
);

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
    if (data.length === 0)
      return ctx.reply(`Últimos 7 días (${todayStr}): sin movimientos.`);
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
    return ctx.reply(
      `Gastos por categoría (total ${totalGastos} PEN):\n${lines.join("\n")}`,
    );
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

  // Si hay borrado pendiente, este texto es la confirmación
  if (pendingDelete && String(ctx.from.id) === pendingDelete.userId) {
    const norm = text.trim().toLowerCase();
    const isSi = norm === "sí" || norm === "si" || norm === "sí," || norm === "si," || norm === "sì";
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
    } else {
      return ctx.reply("Cancelado, no se borró nada.");
    }
  }

  if (text.startsWith("/")) return;

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

console.log(`[cron] Guardaditos-bcp programado: todos los días 07:00 America/Lima (activo: ${guardaditosJob.running})`);

process.once("SIGINT", () => {
  guardaditosJob.stop();
  bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
  guardaditosJob.stop();
  bot.stop("SIGTERM");
});
