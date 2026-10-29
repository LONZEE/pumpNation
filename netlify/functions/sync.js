/**
 * Pump Nation — Scheduled sync: Apps Script → MongoDB Atlas
 *
 * Runs every hour. Pulls data from the Apps Script web app (no UrlFetchApp
 * auth needed — Apps Script just responds to GET requests) and writes it
 * directly to MongoDB Atlas.
 *
 * Pull strategy:
 *   • Clients + Programs  → full replace (snapshot) every run
 *   • Workout logs        → incremental, using a timestamp cursor stored in _meta
 *
 * Required Netlify environment variables (Site config → Environment variables):
 *   APPS_SCRIPT_URL  — Apps Script /exec URL (same one as APPS_SCRIPT_URL in workouts/index.html)
 *   SHARED_TOKEN     — "pn-7xK9mR2vQ4wL8jT"  (same as SHARED_SECRET in Code.gs)
 *   MONGODB_URI      — Atlas connection string  (already set for mirror.js)
 *   MONGODB_DB       — database name, default "pumpnation"  (already set)
 */

const { schedule } = require("@netlify/functions");
const { MongoClient } = require("mongodb");

let cachedClient = null;

async function getClient() {
    if (cachedClient) return cachedClient;
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI env var not set");
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    cachedClient = client;
    return client;
}

async function fetchJson(url) {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`Apps Script returned HTTP ${res.status}`);
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error("Apps Script returned non-JSON: " + text.slice(0, 300));
    }
}

async function syncAll() {
    const scriptUrl = process.env.APPS_SCRIPT_URL;
    const token     = process.env.SHARED_TOKEN;
    if (!scriptUrl || !token) throw new Error("APPS_SCRIPT_URL or SHARED_TOKEN not set");

    const mongoClient = await getClient();
    const db = mongoClient.db(process.env.MONGODB_DB || "pumpnation");
    const results = { clients: 0, programs: 0, logs: 0 };

    // ── 1. Snapshot: Clients + Programs ──────────────────────────────────
    const snapUrl = `${scriptUrl}?token=${encodeURIComponent(token)}&action=snapshot`;
    const snap = await fetchJson(snapUrl);
    if (snap.error) throw new Error("Snapshot error from Apps Script: " + snap.error);

    if (Array.isArray(snap.clients) && snap.clients.length > 0) {
        const coll = db.collection("clients");
        await coll.deleteMany({});
        await coll.insertMany(snap.clients.map(c => ({ ...c, _syncedAt: new Date() })));
        results.clients = snap.clients.length;
    }

    if (Array.isArray(snap.programs) && snap.programs.length > 0) {
        const coll = db.collection("programs");
        await coll.deleteMany({});
        await coll.insertMany(snap.programs.map(p => ({ ...p, _syncedAt: new Date() })));
        results.programs = snap.programs.length;
    }

    // ── 2. Incremental logs ───────────────────────────────────────────────
    const meta   = db.collection("_meta");
    const cursor = await meta.findOne({ _id: "logs_cursor" });
    const since  = cursor ? cursor.lastTimestamp : null;

    let logsUrl = `${scriptUrl}?token=${encodeURIComponent(token)}&action=logs_export`;
    if (since) logsUrl += `&since=${encodeURIComponent(since)}`;

    const logsData = await fetchJson(logsUrl);
    if (logsData.error) throw new Error("Logs export error from Apps Script: " + logsData.error);

    if (Array.isArray(logsData.logs) && logsData.logs.length > 0) {
        const logsColl = db.collection("workout_logs");
        await logsColl.insertMany(logsData.logs.map(l => ({ ...l, _syncedAt: new Date() })));
        results.logs = logsData.logs.length;

        // Advance cursor to the newest Timestamp in this batch
        let latestMs = 0;
        for (const l of logsData.logs) {
            const ms = l.Timestamp ? new Date(l.Timestamp).getTime() : 0;
            if (ms > latestMs) latestMs = ms;
        }
        if (latestMs > 0) {
            await meta.updateOne(
                { _id: "logs_cursor" },
                { $set: { lastTimestamp: new Date(latestMs).toISOString(), updatedAt: new Date() } },
                { upsert: true }
            );
        }
    }

    return results;
}

const handler = schedule("@hourly", async () => {
    try {
        const result = await syncAll();
        console.log("[sync] complete:", JSON.stringify(result));
        return { statusCode: 200 };
    } catch (err) {
        console.error("[sync] failed:", err);
        return { statusCode: 500 };
    }
});

module.exports = { handler };
