/**
 * Pump Nation — Real-time log endpoint
 *
 * Called directly from the workouts frontend immediately after a successful
 * Apps Script save. Writes the same entries to MongoDB in real-time.
 *
 * Auth: SHARED_TOKEN env var — same value as the token in workouts/index.html
 * ("pn-7xK9mR2vQ4wL8jT"). Add this in Netlify: Site config → Env vars.
 *
 * This keeps Google Sheets as the source of truth while giving MongoDB
 * instant writes on every save without needing UrlFetchApp in Apps Script.
 */
const { MongoClient } = require("mongodb");

let cachedClient = null;

async function getClient() {
    if (cachedClient) return cachedClient;
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI not set");
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    cachedClient = client;
    return client;
}

function json(status, body) {
    return {
        statusCode: status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        body: JSON.stringify(body)
    };
}

exports.handler = async (event) => {
    if (event.httpMethod === "OPTIONS") return json(200, {});
    if (event.httpMethod !== "POST")    return json(405, { error: "method not allowed" });

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { error: "invalid JSON" }); }

    const expected = process.env.SHARED_TOKEN;
    if (!expected) return json(500, { error: "SHARED_TOKEN env var not configured" });
    if (body.token !== expected) return json(401, { error: "unauthorized" });

    const { email, name, date, programName, day, entries } = body;
    if (!email || !Array.isArray(entries) || !entries.length) {
        return json(400, { error: "missing required fields" });
    }

    try {
        const client = await getClient();
        const db = client.db(process.env.MONGODB_DB || "pumpnation");
        const ts = new Date();

        const docs = entries.map(en => ({
            Timestamp:   ts,
            ClientEmail: email,
            ClientName:  name  || "",
            Date:        date  || "",
            ProgramName: programName || "",
            Day:         day   || "",
            Exercise:    en.exercise  || "",
            SetNumber:   en.setNumber || "",
            Reps:        en.reps      || "",
            Weight:      en.weight    || "",
            RPE:         en.rpe       || "",
            Notes:       en.notes     || "",
            Type:        en.type      || "",
            Distance:    en.distance  || "",
            Duration:    en.duration  || "",
            Pace:        en.pace      || "",
            Calories:    en.calories  || "",
            _syncedAt:   ts
        }));

        const r = await db.collection("workout_logs").insertMany(docs);
        return json(200, { ok: true, inserted: r.insertedCount });
    } catch (err) {
        console.error("log.js error:", err);
        return json(500, { error: String(err && err.message || err) });
    }
};
