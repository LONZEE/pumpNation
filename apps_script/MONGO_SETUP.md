# MongoDB Mirror — Setup Guide

Every workout save will write to your Google Sheet (unchanged) **and** mirror to MongoDB Atlas. The sheet stays your daily working surface; Mongo is a clean append-only backup you can query later.

If Mongo ever fails, the sheet write still succeeds and clients see a normal save. Mirror failures are silently logged in Apps Script's execution log.

---

## 1 · MongoDB Atlas — what you need

Since you already have an Atlas account, you just need:

1. A cluster (any tier — free **M0** is fine for this project).
2. A database — call it **`pumpnation`** (or anything; you'll tell Netlify the name).
3. A database user (Atlas → Database Access → Add New Database User). Give it `readWrite` on the `pumpnation` database. Save the username and password.
4. Network access (Atlas → Network Access). Add `0.0.0.0/0` so Netlify Functions can reach it. (Locks down later if you want — you'd need to allow Netlify's outbound IP ranges.)
5. Your connection string. Atlas → Database → Connect → "Drivers" → copy the `mongodb+srv://...` URL. Replace `<password>` with your real password.

The function will auto-create `workout_logs`, `clients`, and `programs` collections the first time they're written to — you don't need to create them manually.

---

## 2 · Netlify — set the environment variables

Netlify dashboard → your site → **Site settings → Environment variables** → **Add a variable**:

| Key | Value |
|---|---|
| `MONGODB_URI` | `mongodb+srv://username:password@cluster.xxxx.mongodb.net/?retryWrites=true&w=majority` (your connection string with real password) |
| `MONGODB_DB` | `pumpnation` |
| `MIRROR_SECRET` | Any random string — pick something you'll remember to put in Apps Script too. Example: `mirror-pump-2026-q3-abc` |

Save. Then **redeploy** the site (Deploys tab → "Trigger deploy → Deploy site") so the function picks up the new env vars.

---

## 3 · Get your function URL

After the deploy finishes, the mirror endpoint lives at:

```
https://YOUR-SITE.netlify.app/.netlify/functions/mirror
```

Or, if you've set a custom domain:

```
https://yourdomain.com/.netlify/functions/mirror
```

Quick smoke test — open this URL in your browser. You should see:

```json
{"error":"method not allowed"}
```

That's correct — it only accepts POST. If you see anything else (404, blank page), the function didn't deploy. Check the deploy log under Netlify → Functions tab.

---

## 4 · Apps Script — paste the URL and secret

Open `Code.gs` in your Apps Script editor. Near the top, find:

```js
var MIRROR_ENDPOINT = "";
var MIRROR_SECRET   = "CHANGE-ME-mongo-mirror";
```

Change to:

```js
var MIRROR_ENDPOINT = "https://YOUR-SITE.netlify.app/.netlify/functions/mirror";
var MIRROR_SECRET   = "mirror-pump-2026-q3-abc";   // exact same string as in Netlify env vars
```

Save. **Deploy → Manage deployments → pencil icon → Version: New version → Deploy.**

---

## 5 · Test it

### Test the log mirror (real-time):

1. Log in at `/workouts/` as yourself.
2. Fill in a set, hit **Save Workout**.
3. Check your sheet's Logs tab — row appears, as always.
4. Open MongoDB Atlas → Browse Collections → `pumpnation.workout_logs` — your set(s) should appear within a few seconds.

### Test the Clients + Programs snapshot (manual):

The first time, run it once by hand from the Apps Script editor:

1. In the editor, open `Code.gs`.
2. From the function dropdown at the top, select **`mirrorSheetSnapshot`**.
3. Click **▶ Run**.
4. Check Atlas → `pumpnation.clients` and `pumpnation.programs` — they'll have one document per row from each sheet tab.

### Set up an automatic daily snapshot (optional but recommended):

1. Apps Script editor → left sidebar → **Triggers** (clock icon).
2. **Add Trigger.**
3. Function: `mirrorSheetSnapshot`
4. Deployment: Head
5. Event source: **Time-driven**
6. Type of time-based trigger: **Day timer** → pick an early-morning hour (e.g. 3am–4am).
7. Save. Authorize when prompted.

That's it. Every morning your Clients + Programs tabs get snapshotted into Mongo; every workout save mirrors in real time.

---

## 6 · How to read the mirrored data later

For now, all the website's reads still come from the Google Sheet. Your Mongo data is a clean parallel copy that you can:

- **Browse in Atlas** — Atlas → Browse Collections → run filters/queries.
- **Connect from any analytics tool** — Atlas → Charts (built-in), or MongoDB Compass desktop app.
- **Migrate the website's reads to Mongo later** — when the sheet hits a performance ceiling (probably 10k+ logs / dozens of clients), I can swap the trainer endpoints to read from Mongo without changing the UI.

---

## Disabling the mirror

If you ever need to turn it off (e.g. Atlas downtime), just set `MIRROR_ENDPOINT = ""` in `Code.gs` and redeploy. Sheet writes keep working untouched — Mongo just stops getting new data until you turn it back on.

---

## Troubleshooting

**Mirror writes silently failing?**
Apps Script editor → **Executions** (left sidebar). You'll see one log line per save attempt. If mirror failed, the log entry includes the HTTP status code and response body. Common causes:

- `401 unauthorized` → `MIRROR_SECRET` in Apps Script doesn't match the Netlify env var.
- `500 MONGODB_URI not set` → the env var didn't save in Netlify, or you didn't redeploy after adding it.
- `serverSelectionTimeout` → Atlas Network Access list doesn't allow Netlify's IPs. Set it to `0.0.0.0/0`.
- Connection string still has literal `<password>` → replace with your real password (URL-encode special characters).

**Snapshot didn't replace old data?**
The function calls `deleteMany({})` then `insertMany([...])`. If you see duplicates, an old version of the function is still deployed — make sure `mirror.js` is current and Netlify rebuilt the function.
