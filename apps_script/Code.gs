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
var SHARED_SECRET = "PumpNationNationLONZ"; // must match the token in index.html
var SHEET_CLIENTS  = "Clients";
var SHEET_PROGRAMS = "Programs";
var SHEET_LOGS     = "Logs";
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
        en.notes || ""
      ];
    });

    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
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
    Notes:        ["Notes", "Note"]
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
    Notes:        ["Notes"]
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
  var headers = ["Timestamp","ClientEmail","ClientName","Date","ProgramName","Day","Exercise","SetNumber","Reps","Weight","RPE","Notes"];
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

// Manual test helper — run from the editor with your own email
function _testGet() {
  var res = doGet({ parameter: { token: SHARED_SECRET, email: "YOUR_EMAIL_HERE" } });
  Logger.log(res.getContent());
}
