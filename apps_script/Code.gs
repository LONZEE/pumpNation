/**
 * Pump Nation — Workout Tracker backend
 * Google Apps Script Web App that connects the workouts page
 * to the PumpNation_Workouts Google Sheet.
 *
 * Endpoints:
 *   GET  ?email=<clientEmail>&token=<SECRET>
 *        → { client: {...}, program: [ {Day, Focus, Exercise, ...} ] }
 *
 *   POST  (JSON body: { token, email, name, date, programName, day, entries: [...] })
 *        → { ok: true, written: N }
 *
 * Deploy:
 *   1. Open the Google Sheet → Extensions → Apps Script
 *   2. Paste this file as Code.gs
 *   3. Set SHARED_SECRET below (any random string — must match index.html)
 *   4. Deploy → New deployment → Type: Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   5. Copy the /exec URL into workouts/index.html (APPS_SCRIPT_URL)
 */

// ---- CONFIG --------------------------------------------------------------
var SHARED_SECRET = "pn-7xK9mR2vQ4wL8jT"; // must match the token in index.html
var SHEET_CLIENTS  = "Clients";
var SHEET_PROGRAMS = "Programs";
var SHEET_LOGS     = "Logs";

// Emails allowed to hit the trainer-overview endpoint. Add other coaches here.
var TRAINER_EMAILS = ["edalopez90@gmail.com"];

// ─── MongoDB mirror (optional) ────────────────────────────────────────────
// Paste your Netlify Function URL here once the site is deployed, e.g.
//   "https://yoursite.netlify.app/.netlify/functions/mirror"
// Leave blank ("") to disable mirroring entirely — sheet writes still work.
var MIRROR_ENDPOINT = "";
var MIRROR_SECRET   = "CHANGE-ME-mongo-mirror";  // must match MIRROR_SECRET in Netlify env vars
// --------------------------------------------------------------------------


function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    if (params.token !== SHARED_SECRET) return _json({ error: "unauthorized" }, 401);

    var ss = SpreadsheetApp.getActive();

    // Debug mode: tell me exactly what sheet I'm bound to and which tabs/emails I see
    if (params.debug === "1") {
      var sheetNames = ss.getSheets().map(function (s) { return s.getName(); });
      var clientEmails = [];
      var sh = ss.getSheetByName(SHEET_CLIENTS);
      if (sh) {
        var v = sh.getDataRange().getValues();
        for (var i = 1; i < v.length; i++) clientEmails.push(String(v[i][0] || ""));
      }
      return _json({
        spreadsheetName: ss.getName(),
        spreadsheetId: ss.getId(),
        tabs: sheetNames,
        clientsTabFound: !!sh,
        clientEmails: clientEmails
      });
    }

    var email = (params.email || "").toString().trim().toLowerCase();
    if (!email) return _json({ error: "missing email" }, 400);

    // ── Trainer overview ───────────────────────────────────────────────
    if (params.action === "trainer_overview") {
      if (TRAINER_EMAILS.map(String).map(function (s) { return s.toLowerCase(); }).indexOf(email) === -1) {
        return _json({ error: "forbidden", email: email }, 403);
      }
      return _json(_buildTrainerOverview(ss));
    }

    // ── Trainer drill-down on a single client ─────────────────────────
    if (params.action === "trainer_client_detail") {
      if (TRAINER_EMAILS.map(String).map(function (s) { return s.toLowerCase(); }).indexOf(email) === -1) {
        return _json({ error: "forbidden" }, 403);
      }
      var targetEmail = (params.target || "").toString().trim().toLowerCase();
      if (!targetEmail) return _json({ error: "missing target email" }, 400);
      var c = _findClient(ss, targetEmail);
      if (!c) return _json({ error: "client not found", email: targetEmail }, 404);
      return _json({
        client: c,
        program: _getProgram(ss, c.AssignedProgram),
        history: _getRecentLogs(ss, targetEmail, 500)
      });
    }

    var client = _findClient(ss, email);
    if (!client) return _json({ error: "client not found", email: email }, 404);

    var program = _getProgram(ss, client.AssignedProgram);
    var history = _getRecentLogs(ss, email, 500);

    return _json({ client: client, program: program, history: history });
  } catch (err) {
    return _json({ error: String(err) }, 500);
  }
}


function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || "{}");
    if (body.token !== SHARED_SECRET) return _json({ error: "unauthorized" }, 401);

    var email = (body.email || "").toString().trim().toLowerCase();
    var name  = (body.name || "").toString();
    var date  = body.date || _today();
    var programName = body.programName || "";
    var day = body.day || "";
    var entries = body.entries || [];

    if (!email)   return _json({ error: "missing email" }, 400);
    if (!entries.length) return _json({ error: "no entries to log" }, 400);

    var ss = SpreadsheetApp.getActive();
    var sh = _getOrCreateLogsSheet(ss);

    var ts = new Date();
    var rows = entries.map(function (en) {
      return [
        ts,
        email,
        name,
        date,
        programName,
        day,
        en.exercise || "",
        en.setNumber || "",
        en.reps || "",
        en.weight || "",
        en.rpe || "",
        en.notes || "",
        en.type || "",         // cardio modality: run / bike / row / etc., or "" for strength
        en.distance || "",     // cardio distance (mi or km)
        en.duration || "",     // cardio duration (mm:ss or hh:mm:ss)
        en.pace || "",         // auto-calculated pace string e.g. "8:00/mi"
        en.calories || ""      // cardio calories
      ];
    });

    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

    // Mirror to MongoDB (silent fail — never break the client's save)
    _mirrorToMongo("logs_bulk", rows.map(function (r) {
      return {
        Timestamp: r[0], ClientEmail: r[1], ClientName: r[2], Date: r[3],
        ProgramName: r[4], Day: r[5], Exercise: r[6], SetNumber: r[7],
        Reps: r[8], Weight: r[9], RPE: r[10], Notes: r[11],
        Type: r[12], Distance: r[13], Duration: r[14], Pace: r[15], Calories: r[16]
      };
    }));

    return _json({ ok: true, written: rows.length });
  } catch (err) {
    return _json({ error: String(err) }, 500);
  }
}


// ---- helpers -------------------------------------------------------------

// Normalise a header for lookup: lowercase, strip spaces / underscores / dashes
function _norm(s) {
  return String(s || "").toLowerCase().replace(/[\s_\-]+/g, "");
}

// Find a column index by trying multiple possible header names (any spacing/case)
function _col(headers, /* aliases */) {
  var aliases = [].slice.call(arguments, 1).map(_norm);
  for (var i = 0; i < headers.length; i++) {
    if (aliases.indexOf(_norm(headers[i])) !== -1) return i;
  }
  return -1;
}

// Build {Canonical: value} object from a row. We expose canonical names
// regardless of how the user labeled their columns.
function _row(headers, row, canonicalMap) {
  var obj = {};
  // also include the raw column values keyed by their original header
  for (var k = 0; k < headers.length; k++) obj[headers[k]] = row[k];
  // and add canonical aliases on top
  Object.keys(canonicalMap).forEach(function (canon) {
    var idx = _col.apply(null, [headers].concat(canonicalMap[canon]));
    if (idx !== -1) obj[canon] = row[idx];
  });
  return obj;
}


function _findClient(ss, email) {
  var sh = ss.getSheetByName(SHEET_CLIENTS);
  if (!sh) return null;
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return null;
  var headers = values[0];
  var emailIdx = _col(headers, "Email", "ClientEmail", "E-mail");
  if (emailIdx === -1) return null;

  var canonical = {
    Email:          ["Email", "ClientEmail", "E-mail"],
    Name:           ["Name", "ClientName", "FullName"],
    AssignedProgram:["AssignedProgram", "Assigned Program", "Program", "ProgramName"],
    StartDate:      ["StartDate", "Start Date"],
    Active:         ["Active", "Status"]
  };

  for (var i = 1; i < values.length; i++) {
    var rowEmail = (values[i][emailIdx] || "").toString().trim().toLowerCase();
    if (rowEmail === email) return _row(headers, values[i], canonical);
  }
  return null;
}

function _getProgram(ss, programName) {
  var sh = ss.getSheetByName(SHEET_PROGRAMS);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var nameIdx = _col(headers, "ProgramName", "Program", "Program Name");
  if (nameIdx === -1) return [];

  var canonical = {
    ProgramName:  ["ProgramName", "Program", "Program Name"],
    Day:          ["Day"],
    Focus:        ["Focus", "Theme"],
    Exercise:     ["Exercise", "Movement"],
    TargetSets:   ["TargetSets", "Sets", "Target Sets"],
    TargetReps:   ["TargetReps", "Reps", "Target Reps"],
    TargetWeight: ["TargetWeight", "Weight", "Target Weight"],
    Notes:        ["Notes", "Note"],
    Type:         ["Type", "Modality", "Category"]   // "cardio" / "strength" / "" (default strength)
  };

  var wanted = _norm(programName);
  var out = [];
  for (var i = 1; i < values.length; i++) {
    if (_norm(values[i][nameIdx]) === wanted) {
      out.push(_row(headers, values[i], canonical));
    }
  }
  return out;
}

function _getRecentLogs(ss, email, limit) {
  var sh = ss.getSheetByName(SHEET_LOGS);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var emailIdx = _col(headers, "ClientEmail", "Email");
  if (emailIdx === -1) return [];

  var canonical = {
    Timestamp:    ["Timestamp", "Time"],
    ClientEmail:  ["ClientEmail", "Email"],
    ClientName:   ["ClientName", "Name"],
    Date:         ["Date"],
    ProgramName:  ["ProgramName", "Program"],
    Day:          ["Day"],
    Exercise:     ["Exercise"],
    SetNumber:    ["SetNumber", "Set"],
    Reps:         ["Reps"],
    Weight:       ["Weight"],
    RPE:          ["RPE"],
    Notes:        ["Notes"],
    Type:         ["Type", "Modality"],
    Distance:     ["Distance"],
    Duration:     ["Duration"],
    Pace:         ["Pace"],
    Calories:     ["Calories", "Cal"]
  };

  var rows = [];
  for (var i = values.length - 1; i >= 1 && rows.length < limit; i--) {
    if (String(values[i][emailIdx] || "").toLowerCase() === email) {
      rows.push(_row(headers, values[i], canonical));
    }
  }
  return rows;
}

// Make sure the Logs tab exists with the right headers; create it if missing.
function _getOrCreateLogsSheet(ss) {
  var sh = ss.getSheetByName(SHEET_LOGS);
  var headers = ["Timestamp","ClientEmail","ClientName","Date","ProgramName","Day","Exercise","SetNumber","Reps","Weight","RPE","Notes","Type","Distance","Duration","Pace","Calories"];
  if (!sh) {
    sh = ss.insertSheet(SHEET_LOGS);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  } else if (sh.getLastRow() === 0) {
    // Empty sheet — add header row
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }
  return sh;
}

function _json(obj, status) {
  var out = ContentService.createTextOutput(JSON.stringify(obj));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}

function _today() {
  var d = new Date();
  var mm = String(d.getMonth() + 1).padStart(2, "0");
  var dd = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + mm + "-" + dd;
}


// ─── MongoDB mirror helpers ──────────────────────────────────────────────
// Fire-and-forget POST to the Netlify Function. Never throws — any error
// is just logged so the original sheet write still returns success.
function _mirrorToMongo(type, data) {
  if (!MIRROR_ENDPOINT) return;        // mirroring disabled
  try {
    var res = UrlFetchApp.fetch(MIRROR_ENDPOINT, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ token: MIRROR_SECRET, type: type, data: data }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      Logger.log("Mirror " + type + " returned " + code + ": " + res.getContentText());
    }
  } catch (err) {
    Logger.log("Mirror " + type + " failed: " + err);
  }
}


// Snapshot the Clients + Programs tabs into MongoDB. Run this manually from
// the Apps Script editor whenever you update those tabs, OR set up a
// time-based trigger (e.g. daily) under Triggers in the Apps Script UI.
function mirrorSheetSnapshot() {
  var ss = SpreadsheetApp.getActive();
  var totals = { clients: 0, programs: 0 };

  // ── Clients ──
  var csh = ss.getSheetByName(SHEET_CLIENTS);
  if (csh) {
    var cvals = csh.getDataRange().getValues();
    if (cvals.length >= 2) {
      var cHeaders = cvals[0];
      var clients = [];
      for (var i = 1; i < cvals.length; i++) {
        var obj = {};
        for (var j = 0; j < cHeaders.length; j++) obj[String(cHeaders[j])] = cvals[i][j];
        if (obj.Email || obj.email) clients.push(obj);
      }
      _mirrorToMongo("clients_snapshot", clients);
      totals.clients = clients.length;
    }
  }

  // ── Programs ──
  var psh = ss.getSheetByName(SHEET_PROGRAMS);
  if (psh) {
    var pvals = psh.getDataRange().getValues();
    if (pvals.length >= 2) {
      var pHeaders = pvals[0];
      var programs = [];
      for (var i = 1; i < pvals.length; i++) {
        var obj = {};
        for (var j = 0; j < pHeaders.length; j++) obj[String(pHeaders[j])] = pvals[i][j];
        programs.push(obj);
      }
      _mirrorToMongo("programs_snapshot", programs);
      totals.programs = programs.length;
    }
  }

  Logger.log("Snapshot complete: " + JSON.stringify(totals));
  return totals;
}

// ── Trainer overview: every client + summary stats ────────────────────────
function _buildTrainerOverview(ss) {
  var csh = ss.getSheetByName(SHEET_CLIENTS);
  if (!csh) return { clients: [], generatedAt: new Date().toISOString() };
  var cvals = csh.getDataRange().getValues();
  if (cvals.length < 2) return { clients: [], generatedAt: new Date().toISOString() };
  var cHeaders = cvals[0];
  var emailIdx = _col(cHeaders, "Email", "ClientEmail");
  var nameIdx  = _col(cHeaders, "Name", "ClientName");
  var progIdx  = _col(cHeaders, "AssignedProgram", "Assigned Program", "Program");
  var activeIdx = _col(cHeaders, "Active", "Status");

  // All logs, grouped by email
  var lsh = ss.getSheetByName(SHEET_LOGS);
  var logsByEmail = {};
  if (lsh) {
    var lvals = lsh.getDataRange().getValues();
    if (lvals.length >= 2) {
      var lHeaders = lvals[0];
      var lEmail    = _col(lHeaders, "ClientEmail", "Email");
      var lDate     = _col(lHeaders, "Date");
      var lExer     = _col(lHeaders, "Exercise");
      var lReps     = _col(lHeaders, "Reps");
      var lWeight   = _col(lHeaders, "Weight");
      var lType     = _col(lHeaders, "Type", "Modality");
      var lDistance = _col(lHeaders, "Distance");
      for (var r = 1; r < lvals.length; r++) {
        var em = String(lvals[r][lEmail] || "").toLowerCase().trim();
        if (!em) continue;
        (logsByEmail[em] = logsByEmail[em] || []).push({
          Date:     lvals[r][lDate],
          Exercise: lvals[r][lExer],
          Reps:     lvals[r][lReps],
          Weight:   lvals[r][lWeight],
          Type:     lType     === -1 ? "" : lvals[r][lType],
          Distance: lDistance === -1 ? "" : lvals[r][lDistance]
        });
      }
    }
  }

  // Per-client summary
  var now = new Date();
  var weekStart = _startOfIsoWeek(now);
  var clients = [];
  for (var i = 1; i < cvals.length; i++) {
    var row = cvals[i];
    var em = String(row[emailIdx] || "").toLowerCase().trim();
    if (!em) continue;
    var logs = logsByEmail[em] || [];

    var sessionDates = {};
    var totalVol = 0;
    var prByEx = {};
    var lastDate = null;
    var cardioMilesThisWeek = 0;
    var totalCardioMiles = 0;

    logs.forEach(function (l) {
      var d = _toDateOnly(l.Date);
      if (!d) return;
      sessionDates[d] = true;
      var dObj = new Date(d);
      if (!lastDate || dObj > lastDate) lastDate = dObj;
      var reps = parseFloat(l.Reps) || 0;
      var w = parseFloat(String(l.Weight).replace(/[^\d.]/g, "")) || 0;
      totalVol += reps * w;
      var ex = String(l.Exercise || "");
      if (ex && w > 0 && (!prByEx[ex] || w > prByEx[ex].weight)) {
        prByEx[ex] = { weight: w, reps: reps };
      }
      // Cardio aggregation
      var dist = parseFloat(String(l.Distance).replace(/[^\d.]/g, "")) || 0;
      if (dist > 0) {
        totalCardioMiles += dist;
        if (dObj >= weekStart) cardioMilesThisWeek += dist;
      }
    });

    var thisWeekDays = {};
    Object.keys(sessionDates).forEach(function (d) {
      if (new Date(d) >= weekStart) thisWeekDays[d] = true;
    });

    var prList = [];
    Object.keys(prByEx).forEach(function (k) {
      prList.push({ exercise: k, weight: prByEx[k].weight, reps: prByEx[k].reps });
    });
    prList.sort(function (a, b) { return b.weight - a.weight; });
    prList = prList.slice(0, 3);

    var daysSince = lastDate ? Math.floor((now - lastDate) / 86400000) : null;

    clients.push({
      email: em,
      name:  String(row[nameIdx] || ""),
      program: String(row[progIdx] || ""),
      active: activeIdx === -1 ? "" : String(row[activeIdx] || ""),
      totalSessions: Object.keys(sessionDates).length,
      sessionsThisWeek: Object.keys(thisWeekDays).length,
      totalVolume: Math.round(totalVol),
      cardioMilesThisWeek: Math.round(cardioMilesThisWeek * 10) / 10,
      totalCardioMiles: Math.round(totalCardioMiles * 10) / 10,
      lastSessionDate: lastDate ? lastDate.toISOString().slice(0,10) : null,
      daysSinceLast: daysSince,
      topPRs: prList
    });
  }

  // Sort: anyone idle 7+ days (or never) first, then by most recent activity
  clients.sort(function (a, b) {
    var aIdle = (a.daysSinceLast === null || a.daysSinceLast >= 7) ? 1 : 0;
    var bIdle = (b.daysSinceLast === null || b.daysSinceLast >= 7) ? 1 : 0;
    if (aIdle !== bIdle) return bIdle - aIdle;
    return (a.daysSinceLast === null ? 9999 : a.daysSinceLast) - (b.daysSinceLast === null ? 9999 : b.daysSinceLast);
  });

  return {
    generatedAt: new Date().toISOString(),
    clientCount: clients.length,
    needsAttention: clients.filter(function (c) { return c.daysSinceLast === null || c.daysSinceLast >= 7; }).length,
    clients: clients
  };
}

function _toDateOnly(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0,10);
  var s = String(v);
  if (s.indexOf("T") !== -1) return s.slice(0,10);
  var d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0,10);
}

function _startOfIsoWeek(d) {
  var x = new Date(d);
  var day = x.getDay() || 7;
  if (day !== 1) x.setHours(-24 * (day - 1));
  x.setHours(0, 0, 0, 0);
  return x;
}

// Manual test helper — run from the editor with your own email
function _testGet() {
  var res = doGet({ parameter: { token: SHARED_SECRET, email: "YOUR_EMAIL_HERE" } });
  Logger.log(res.getContent());
}

function _testTrainer() {
  var res = doGet({ parameter: { token: SHARED_SECRET, email: "edalopez90@gmail.com", action: "trainer_overview" } });
  Logger.log(res.getContent());
}
