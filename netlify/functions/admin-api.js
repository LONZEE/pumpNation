/**
 * Pump Nation — Admin API
 *
 * Express app served as a Netlify Function. Provides CRUD for Clients and
 * Programs directly against the Google Sheet via a Service Account.
 *
 * Required Netlify env vars (Site config → Environment variables):
 *   ADMIN_SECRET                — any strong password you choose for the admin panel
 *   GOOGLE_SERVICE_ACCOUNT_KEY  — base64-encoded Service Account JSON key
 *   SPREADSHEET_ID              — the Google Sheet ID (from the URL: /spreadsheets/d/<ID>/edit)
 *   MONGODB_URI                 — already set (used by mirror.js)
 *   MONGODB_DB                  — already set (default "pumpnation")
 *
 * Setup (one-time):
 *   1. console.cloud.google.com → APIs & Services → Enable "Google Sheets API"
 *   2. IAM & Admin → Service Accounts → Create → download JSON key
 *   3. base64-encode it:  node -e "console.log(Buffer.from(require('fs').readFileSync('key.json')).toString('base64'))"
 *   4. Set GOOGLE_SERVICE_ACCOUNT_KEY in Netlify with that base64 string
 *   5. Open your Google Sheet → Share → paste the service account email → Editor
 */

const express    = require("express");
const serverless = require("serverless-http");
const { google } = require("googleapis");
const { MongoClient } = require("mongodb");

const app = express();
app.use(express.json());

// ── Auth ──────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
    if (req.method === "OPTIONS") return next();
    const expected = process.env.ADMIN_SECRET;
    const provided  = req.headers["x-admin-secret"];
    if (!expected) return res.status(500).json({ error: "ADMIN_SECRET not configured" });
    if (provided !== expected) return res.status(401).json({ error: "unauthorized" });
    next();
});

// ── CORS ──────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-admin-secret");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

// ── Google Sheets helper ──────────────────────────────────────────────────
async function getSheets() {
    const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyB64) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not configured");
    const credentials = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8"));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
    return google.sheets({ version: "v4", auth: await auth.getClient() });
}

const SID = () => {
    const id = process.env.SPREADSHEET_ID;
    if (!id) throw new Error("SPREADSHEET_ID not configured");
    return id;
};

function sheetToObjects(values) {
    if (!values || values.length < 2) return { headers: [], items: [] };
    const [headers, ...rows] = values;
    return {
        headers,
        items: rows.map(row => {
            const obj = {};
            headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? String(row[i]) : ""; });
            return obj;
        })
    };
}

async function getSheetId(sheets, tabName) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SID() });
    const tab  = meta.data.sheets.find(s => s.properties.title === tabName);
    if (!tab) throw new Error(`Sheet "${tabName}" not found`);
    return tab.properties.sheetId;
}

// ── MongoDB helper ────────────────────────────────────────────────────────
let mongoClient = null;
async function getMongo() {
    if (mongoClient) return mongoClient;
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI not configured");
    mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await mongoClient.connect();
    return mongoClient;
}

// ── CLIENTS ───────────────────────────────────────────────────────────────
app.get("/api/clients", async (req, res) => {
    try {
        const sheets = await getSheets();
        const r = await sheets.spreadsheets.values.get({
            spreadsheetId: SID(),
            range: "Clients!A:Z"
        });
        const { items } = sheetToObjects(r.data.values);
        res.json({ clients: items });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/clients", async (req, res) => {
    try {
        const { Email, Name, AssignedProgram = "", StartDate = "", Active = "Yes" } = req.body;
        if (!Email || !Name) return res.status(400).json({ error: "Email and Name are required" });

        const sheets = await getSheets();
        // Ensure header row exists
        const hRes = await sheets.spreadsheets.values.get({ spreadsheetId: SID(), range: "Clients!1:1" });
        if (!hRes.data.values || !hRes.data.values[0] || !hRes.data.values[0].length) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SID(), range: "Clients!A1",
                valueInputOption: "RAW",
                requestBody: { values: [["Email", "Name", "AssignedProgram", "StartDate", "Active"]] }
            });
        }
        await sheets.spreadsheets.values.append({
            spreadsheetId: SID(), range: "Clients!A:E",
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[Email, Name, AssignedProgram, StartDate, Active]] }
        });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/clients/:email", async (req, res) => {
    try {
        const targetEmail = decodeURIComponent(req.params.email).toLowerCase();
        const sheets = await getSheets();
        const r = await sheets.spreadsheets.values.get({ spreadsheetId: SID(), range: "Clients!A:Z" });
        const rows = r.data.values || [];
        if (!rows.length) return res.status(404).json({ error: "Clients sheet is empty" });

        const headers  = rows[0];
        const emailIdx = headers.map(h => h.toLowerCase()).indexOf("email");
        if (emailIdx === -1) return res.status(500).json({ error: "Email column not found" });
        const rowIdx   = rows.findIndex((row, i) => i > 0 && String(row[emailIdx] || "").toLowerCase() === targetEmail);
        if (rowIdx === -1) return res.status(404).json({ error: "Client not found" });

        const existing = rows[rowIdx];
        const updated  = headers.map((h, i) => req.body[h] !== undefined ? req.body[h] : (existing[i] || ""));
        await sheets.spreadsheets.values.update({
            spreadsheetId: SID(),
            range: `Clients!A${rowIdx + 1}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [updated] }
        });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/clients/:email", async (req, res) => {
    try {
        const targetEmail = decodeURIComponent(req.params.email).toLowerCase();
        const sheets  = await getSheets();
        const sheetId = await getSheetId(sheets, "Clients");
        const r = await sheets.spreadsheets.values.get({ spreadsheetId: SID(), range: "Clients!A:Z" });
        const rows = r.data.values || [];
        const headers  = rows[0] || [];
        const emailIdx = headers.map(h => h.toLowerCase()).indexOf("email");
        const rowIdx   = rows.findIndex((row, i) => i > 0 && String(row[emailIdx] || "").toLowerCase() === targetEmail);
        if (rowIdx === -1) return res.status(404).json({ error: "Client not found" });

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SID(),
            requestBody: {
                requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowIdx, endIndex: rowIdx + 1 } } }]
            }
        });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PROGRAMS ──────────────────────────────────────────────────────────────
app.get("/api/programs", async (req, res) => {
    try {
        const sheets = await getSheets();
        const r = await sheets.spreadsheets.values.get({ spreadsheetId: SID(), range: "Programs!A:Z" });
        const { items } = sheetToObjects(r.data.values);

        // Group rows by program name for the UI
        const grouped = {};
        for (const row of items) {
            const name = row.ProgramName || row["Program Name"] || row.Program || "";
            if (!grouped[name]) grouped[name] = [];
            grouped[name].push(row);
        }
        res.json({ programs: items, grouped, programNames: Object.keys(grouped) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/programs — body: array of exercise rows for one program
app.post("/api/programs", async (req, res) => {
    try {
        const rows = Array.isArray(req.body) ? req.body : [req.body];
        if (!rows.length || !rows[0].ProgramName) return res.status(400).json({ error: "ProgramName required" });

        const sheets = await getSheets();
        const hRes = await sheets.spreadsheets.values.get({ spreadsheetId: SID(), range: "Programs!1:1" });
        if (!hRes.data.values || !hRes.data.values[0] || !hRes.data.values[0].length) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SID(), range: "Programs!A1",
                valueInputOption: "RAW",
                requestBody: { values: [["ProgramName", "Day", "Focus", "Exercise", "TargetSets", "TargetReps", "TargetWeight", "Notes", "Type"]] }
            });
        }
        const values = rows.map(r => [
            r.ProgramName || "", r.Day || "", r.Focus || "", r.Exercise || "",
            r.TargetSets || "", r.TargetReps || "", r.TargetWeight || "",
            r.Notes || "", r.Type || "strength"
        ]);
        await sheets.spreadsheets.values.append({
            spreadsheetId: SID(), range: "Programs!A:I",
            valueInputOption: "USER_ENTERED",
            requestBody: { values }
        });
        res.json({ ok: true, added: values.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/programs/:name — removes all rows for that program
app.delete("/api/programs/:name", async (req, res) => {
    try {
        const targetName = decodeURIComponent(req.params.name).toLowerCase().trim();
        const sheets  = await getSheets();
        const sheetId = await getSheetId(sheets, "Programs");
        const r = await sheets.spreadsheets.values.get({ spreadsheetId: SID(), range: "Programs!A:Z" });
        const rows = r.data.values || [];
        if (!rows.length) return res.json({ ok: true, deleted: 0 });

        const headers = rows[0];
        const nameIdx = headers.findIndex(h => ["programname","program name","program"].includes(h.toLowerCase().trim()));
        if (nameIdx === -1) return res.status(500).json({ error: "ProgramName column not found" });

        // Collect matching row indices (1-based sheet rows), process in reverse to preserve indices
        const toDelete = [];
        for (let i = 1; i < rows.length; i++) {
            if (String(rows[i][nameIdx] || "").toLowerCase().trim() === targetName) toDelete.push(i);
        }
        if (!toDelete.length) return res.status(404).json({ error: "Program not found" });

        // Delete in reverse order so row indices stay valid
        const requests = toDelete.reverse().map(idx => ({
            deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: idx, endIndex: idx + 1 } }
        }));
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: SID(), requestBody: { requests } });
        res.json({ ok: true, deleted: toDelete.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Health check ──────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ ok: true }));

module.exports.handler = serverless(app, { basePath: "/.netlify/functions/admin-api" });
