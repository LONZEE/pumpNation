/**
 * Pump Nation — Mirror endpoint
 *
 * Receives authenticated POSTs from Apps Script and writes them to MongoDB Atlas.
 * The Google Sheet stays the source of truth; Mongo is an append-only mirror /
 * snapshot for backup and future querying.
 *
 * Required Netlify environment variables:
 *   MONGODB_URI     — full Atlas connection string (mongodb+srv://...)
 *   MONGODB_DB      — database name, e.g. "pumpnation"
 *   MIRROR_SECRET   — shared secret; must match MIRROR_SECRET in Apps Script
 *
 * Accepted payloads (POST JSON body):
 *   { token, type: "log",            data: { ...singleLogRow... } }
 *   { token, type: "logs_bulk",      data: [ ...multipleLogRows... ] }
 *   { token, type: "clients_snapshot",  data: [ ...allClientRows... ] }
 *   { token, type: "programs_snapshot", data: [ ...allProgramRows... ] }
 *
 * Snapshot payloads replace the entire collection (delete + insertMany) so the
 * Mongo copy always matches the sheet. Log payloads are append-only.
 */
const { MongoClient } = require("mongodb");

let cachedClient = null;
let indexesEnsured = false;

async function getClient() {
    if (cachedClient) return cachedClient;
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI env var is not set");
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    cachedClient = client;
    return client;
}

// Idempotent — Mongo skips index creation if the same index already exists.
// Runs once per cold-start of the function (cached afterwards).
async function ensureIndexes(db) {
    if (indexesEnsured) return;
    try {
        const logs = db.collection("workout_logs");
        await logs.createIndexes([
            { key: { ClientEmail: 1, Date: -1 }, name: "client_date" },     // a client's history sorted newest first
            { key: { Exercise: 1, Weight: -1 }, name: "exercise_weight" }, // PR lookups
            { key: { Type: 1 }, name: "type" },                            // cardio vs strength filter
            { key: { Timestamp: -1 }, name: "timestamp_desc" },            // global recent activity
            { key: { ProgramName: 1, Day: 1 }, name: "program_day" }       // pull all logs for a program
        ]);

        await db.collection("clients").createIndex(
            { Email: 1 },
            { name: "email_unique", unique: true, partialFilterExpression: { Email: { $type: "string" } } }
        );

        await db.collection("programs").createIndexes([
            { key: { ProgramName: 1, Day: 1 }, name: "program_day" },
            { key: { Exercise: 1 }, name: "exercise" }
        ]);

        indexesEnsured = true;
    } catch (err) {
        // Don't kill the request if index creation hiccups — it'll retry on the next cold start
        console.error("ensureIndexes warning:", err && err.message);
    }
}

function json(status, body) {
    return {
        statusCode: status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Mirror-Token"
        },
        body: JSON.stringify(body)
    };
}

exports.handler = async (event) => {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "POST")    return json(405, { error: "method not allowed" });

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch (e) { return json(400, { error: "invalid JSON" }); }

    // Auth
    const expected = process.env.MIRROR_SECRET;
    const supplied = body.token || event.headers["x-mirror-token"];
    if (!expected) return json(500, { error: "MIRROR_SECRET not configured" });
    if (supplied !== expected) return json(401, { error: "unauthorized" });

    const type = String(body.type || "");
    const data = body.data;

    try {
        const client = await getClient();
        const db = client.db(process.env.MONGODB_DB || "pumpnation");
        await ensureIndexes(db);   // no-op after first run per cold-start

        if (type === "log") {
            if (!data || typeof data !== "object") return json(400, { error: "missing data" });
            const doc = { ...data, _mirroredAt: new Date() };
            const r = await db.collection("workout_logs").insertOne(doc);
            return json(200, { ok: true, inserted: 1, id: r.insertedId });
        }

        if (type === "logs_bulk") {
            if (!Array.isArray(data) || !data.length) return json(400, { error: "missing data array" });
            const docs = data.map(d => ({ ...d, _mirroredAt: new Date() }));
            const r = await db.collection("workout_logs").insertMany(docs);
            return json(200, { ok: true, inserted: r.insertedCount });
        }

        if (type === "clients_snapshot") {
            if (!Array.isArray(data)) return json(400, { error: "missing data array" });
            const coll = db.collection("clients");
            await coll.deleteMany({});
            if (data.length) {
                const docs = data.map(d => ({ ...d, _mirroredAt: new Date() }));
                await coll.insertMany(docs);
            }
            return json(200, { ok: true, replaced: data.length, collection: "clients" });
        }

        if (type === "programs_snapshot") {
            if (!Array.isArray(data)) return json(400, { error: "missing data array" });
            const coll = db.collection("programs");
            await coll.deleteMany({});
            if (data.length) {
                const docs = data.map(d => ({ ...d, _mirroredAt: new Date() }));
                await coll.insertMany(docs);
            }
            return json(200, { ok: true, replaced: data.length, collection: "programs" });
        }

        return json(400, { error: "unknown type", type });
    } catch (err) {
        console.error("mirror.js error:", err);
        return json(500, { error: String(err && err.message || err) });
    }
};
