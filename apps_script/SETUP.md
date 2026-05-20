# Pump Nation — Workout Tracker Setup

This connects your `/workouts/` page to a Google Sheet so:

- **You (the trainer)** edit programs in the sheet → clients see them on the site
- **Clients** log their sets/reps/weight on the site → entries land back in the sheet

Total setup time: about 15 minutes.

---

## 1. Get the spreadsheet into Google Sheets

1. Open **drive.google.com** → **New → File upload** → choose `PumpNation_Workouts.xlsx` from your `pumpNation` folder.
2. Once uploaded, right-click it → **Open with → Google Sheets**.
3. **File → Save as Google Sheets** (this converts it from .xlsx to a real Google Sheet).
4. Rename it to **Pump Nation Workouts** so it's easy to find.

The sheet has three tabs:

- **Clients** — one row per client. Columns: Email, Name, AssignedProgram, StartDate, Active.
- **Programs** — your weekly workouts. Columns: ProgramName, Day, Focus, Exercise, TargetSets, TargetReps, TargetWeight, Notes, **Type** (optional — leave blank for strength, set to `cardio` / `run` / `bike` / `row` / `swim` / `walk` / `hike` / `elliptical` for cardio rows).
- **Logs** — leave this empty. Clients' saved workouts append here automatically.

### Strength vs. cardio rows

For a regular lift, leave the `Type` column blank or set it to `strength`. Use `TargetSets`, `TargetReps`, `TargetWeight` as before.

For a cardio session, set `Type` to one of: `cardio`, `run`, `bike`, `row`, `swim`, `walk`, `hike`, `elliptical`. The workout page detects this and shows distance/duration/calories inputs instead of reps/weight/RPE. `TargetReps` and `TargetWeight` become guidance text (e.g., `5 mi @ easy pace`).

Example Programs rows:

| ProgramName | Day | Focus | Exercise | TargetSets | TargetReps | TargetWeight | Notes | Type |
|---|---|---|---|---|---|---|---|---|
| Foundations | Monday | Strength | Back Squat | 5 | 5 | 225 lb | Heavy 5 | |
| Foundations | Tuesday | Easy Run | Morning Jog | 1 | 3 mi | easy pace | Zone 2 | run |
| Foundations | Friday | Conditioning | Row | 1 | 2000m | hard | All-out | row |

---

## 2. Add the backend script

1. With the Google Sheet open, click **Extensions → Apps Script**.
2. Delete whatever's in the editor and paste the full contents of `Code.gs` (in this same folder).
3. Find this line near the top:
   ```js
   var SHARED_SECRET = "CHANGE-ME-pump-nation-2026";
   ```
   Change it to your own random string. **Copy that string** — you'll paste it into the website in step 4.
4. Click **Save** (disk icon).

### Deploy as a Web App

1. Top right: **Deploy → New deployment**.
2. Gear icon → **Web app**.
3. Settings:
   - **Description**: Pump Nation workouts
   - **Execute as**: Me (your Google account)
   - **Who has access**: **Anyone** (this is fine — the SHARED_SECRET keeps it private)
4. Click **Deploy**. Authorize the script when prompted (it'll ask permission to read/write the sheet).
5. Copy the **Web app URL**. It looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

---

## 3. Wire up the website

Open `workouts/index.html` and find this block near the top:

```html
<script>
    const APPS_SCRIPT_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
    const SHARED_TOKEN    = "CHANGE-ME-pump-nation-2026";
</script>
```

Replace both values:

- `APPS_SCRIPT_URL` → the `/exec` URL from step 2.
- `SHARED_TOKEN` → the same string you put in `SHARED_SECRET` inside `Code.gs`.

Commit & push to deploy on Netlify.

---

## 4. Invite your clients

You're already using **Netlify Identity** for member login. To add a client:

1. Netlify dashboard → your site → **Identity** → **Invite users**.
2. Enter the client's email. They'll get a sign-up link.
3. **Add the same email** to the **Clients** tab of the Google Sheet, with their assigned program (e.g. `Foundations`).

The email in the sheet must exactly match their Netlify login email — that's how the app knows which program to show them.

---

## 5. Day-to-day usage

### As the trainer

- **Change anyone's workouts** → edit the **Programs** tab.
- **Make a new program** → add rows with a new `ProgramName` value (e.g. `Hypertrophy-12wk`), then update that client's `AssignedProgram` in the **Clients** tab.
- **See client progress** → open the **Logs** tab. Filter by `ClientEmail` or pivot on Exercise to see PR progression.

### As the client

1. Log in at `/login.html`.
2. Their assigned week's workouts auto-load on `/workouts/`.
3. Tap a day, fill in reps/weight/RPE for each set, hit **Save Workout**.
4. Their session shows up in **Recent Sessions** and gets appended to the **Logs** tab in your sheet.

---

## Updating the script later

When you edit `Code.gs`, you need to **redeploy** for the change to go live:

- **Deploy → Manage deployments → pencil/edit icon → Version: New version → Deploy**.
- Keep the same Web app URL — no need to update the website.

---

## Troubleshooting

**"Client not found"** — the email in the **Clients** tab doesn't match the email the client used to sign up on Netlify. Check capitalization, typos.

**"Unauthorized"** — `SHARED_TOKEN` in `index.html` doesn't match `SHARED_SECRET` in `Code.gs`.

**Save button spins forever** — open browser dev tools → Network tab → click Save → look at the failed request. Usually a CORS issue means the deployment was set to "Only myself" instead of "Anyone".

**Empty program loaded** — the client's `AssignedProgram` value in the sheet doesn't match any `ProgramName` in the **Programs** tab.
