import "dotenv/config";
import { google } from "googleapis";

const SHEET_ID = process.env.SHEET_ID;
const SERVICE_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

let sheetsClient = null;
let authClient = null;

function getAuth() {
  if (!SHEET_ID || !SERVICE_JSON || SERVICE_JSON === "dummy") {
    return null;
  }
  if (authClient) return authClient;
  try {
    const credentials = JSON.parse(SERVICE_JSON);
    authClient = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    return authClient;
  } catch (err) {
    console.error("Error parseando GOOGLE_SERVICE_ACCOUNT_JSON:", err.message);
    return null;
  }
}

function getSheets() {
  if (sheetsClient) return sheetsClient;
  const auth = getAuth();
  if (!auth) return null;
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

// Append a row: [fecha, hora, tipo, monto, moneda, categoria, nota]
export async function appendRow({ fecha, hora, tipo, monto, moneda, categoria, nota }) {
  const sheets = getSheets();
  if (!sheets) {
    console.log(`[sheets mock] ${fecha} | ${hora} | ${tipo} | ${monto} | ${moneda} | ${categoria} | ${nota} (SHEET_ID no configurado)`);
    return { mocked: true };
  }
  const values = [[fecha, hora, tipo, monto, moneda, categoria, nota]];
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Hoja1!A:G",
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
  console.log(`[sheets] Fila guardada: ${fecha} | ${hora} | ${tipo} | ${monto} | ${categoria}`);
  return res.data;
}

// Specific helper for Guardaditos daily job
export async function appendGuardaditos({ fecha, hora }) {
  return appendRow({
    fecha,
    hora,
    tipo: "gasto",
    monto: 8,
    moneda: "PEN",
    categoria: "Guardaditos-bcp",
    nota: "guardaditos automático bcp",
  });
}

// Read all rows (for future /balance etc.)
export async function getAllRows() {
  const sheets = getSheets();
  if (!sheets) {
    console.log("[sheets mock] getAllRows: SHEET_ID no configurado, devolviendo []");
    return [];
  }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Hoja1!A:G",
  });
  return res.data.values || [];
}
