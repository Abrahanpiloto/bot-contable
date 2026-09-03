import "dotenv/config";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { CronJob } from "cron";
import { appendGuardaditos, appendRow } from "./sheets.js";
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

bot.start((ctx) =>
  ctx.reply("Hola mundo — bot contable activo. Envíame un mensaje."),
);
bot.command("balance", (ctx) =>
  ctx.reply("Comando /balance aún no implementado (Fase 4)."),
);
bot.command("hoy", (ctx) =>
  ctx.reply("Comando /hoy aún no implementado (Fase 4)."),
);

bot.on(message("text"), async (ctx) => {
  const text = ctx.message.text;
  console.log(`Mensaje de ${ctx.from.id}: ${text}`);

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
