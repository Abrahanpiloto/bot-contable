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
export async function appendRow({
  fecha,
  hora,
  tipo,
  monto,
  moneda,
  categoria,
  nota,
}) {
  const sheets = getSheets();
  if (!sheets) {
    console.log(
      `[sheets mock] ${fecha} | ${hora} | ${tipo} | ${monto} | ${moneda} | ${categoria} | ${nota} (SHEET_ID no configurado)`,
    );
    return { mocked: true };
  }
  const values = [[fecha, hora, tipo, monto, moneda, categoria, nota]];
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Hoja1!A:G",
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
  console.log(
    `[sheets] Fila guardada: ${fecha} | ${hora} | ${tipo} | ${monto} | ${categoria} | ${nota}`,
  );
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

// Read all rows (for /balance etc.)
export async function getAllRows() {
  const sheets = getSheets();
  if (!sheets) {
    console.log(
      "[sheets mock] getAllRows: SHEET_ID no configurado, devolviendo []",
    );
    return [];
  }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Hoja1!A:G",
  });
  return res.data.values || [];
}

// --- Fase 4: helpers (JS hace las sumas, no DeepSeek) ---

// Convierte filas crudas en objetos, salta encabezado si existe
export function parseRows(rows) {
  if (!rows || rows.length === 0) return [];
  const hasHeader = rows[0][0] === "fecha";
  const data = hasHeader ? rows.slice(1) : rows;
  return data.map((r) => ({
    fecha: r[0] || "",
    hora: r[1] || "",
    tipo: r[2] || "",
    monto: Number(r[3] || 0),
    moneda: r[4] || "PEN",
    categoria: r[5] || "Otros",
    nota: r[6] || "",
  }));
}

export async function getLastRow() {
  const rows = await getAllRows();
  const parsed = parseRows(rows);
  if (parsed.length === 0) return null;
  return parsed[parsed.length - 1];
}

export async function deleteLastRow() {
  const sheets = getSheets();
  if (!sheets) {
    console.log("[sheets mock] deleteLastRow: SHEET_ID no configurado");
    return { mocked: true };
  }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Hoja1!A:G",
  });
  const values = res.data.values || [];
  if (values.length <= 1) throw new Error("Hoja vacía, nada que borrar");
  const lastIndex = values.length; // 1-indexed para rango A:G (incluye encabezado)
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: 0,
                dimension: "ROWS",
                startIndex: lastIndex - 1,
                endIndex: lastIndex,
              },
            },
          },
        ],
      },
    });
  } catch {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `Hoja1!A${lastIndex}:G${lastIndex}`,
    });
  }
  console.log(`[sheets] Fila ${lastIndex} borrada`);
  return { deleted: lastIndex };
}
