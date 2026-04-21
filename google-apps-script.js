// =============================================================
// SURVIVOR 50 FANTASY— Google Apps Script Backend
// ================================================================
// SETUP INSTRUCTIONS:
// 1. Go to https://script.google.com and create a new project
// 2. Paste this entire file into Code.gs (replace any existing code)
// 3. Click Deploy → New deployment
// 4. Select type: "Web app"
// 5. Set "Execute as": Me
// 6. Set "Who has access": Anyone
// 7. Click Deploy and authorize when prompted
// 8. Copy the Web App URL — paste it into your index.html SHEET_API_URL
//
// Google Sheet Setup:
// - The script auto-creates a sheet called "State" if it doesn't exist
// - Cell A1 stores the full JSON state
// - Cell A2 stores the last-updated timestamp
// - A "Registrations" sheet stores player sign-ups from the join page
// - A "Pending" sheet stores remote draft pick requests (cell A1)
// =============================================================

function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('State');
  if (!sheet) {
    sheet = ss.insertSheet('State');
    sheet.getRange('A1').setValue('{}');
    sheet.getRange('A2').setValue(new Date().toISOString());
  }
  return sheet;
}

function getOrCreateRegistrationsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Registrations');
  if (!sheet) {
    sheet = ss.insertSheet('Registrations');
    sheet.getRange('A1:D1').setValues([['Name', 'Email', 'CastawayId', 'Timestamp']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreatePendingSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Pending');
  if (!sheet) {
    sheet = ss.insertSheet('Pending');
    sheet.getRange('A1').setValue('');
  }
  return sheet;
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'state';

    if (action === 'registrations') {
      var regSheet = getOrCreateRegistrationsSheet();
      var data = regSheet.getDataRange().getValues();
      var registrations = [];
      for (var i = 1; i < data.length; i++) {
        registrations.push({
          name: data[i][0],
          email: data[i][1],
          castawayId: data[i][2],
          timestamp: data[i][3]
        });
      }
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        registrations: registrations
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Default: return state + pending picks
    var sheet = getOrCreateSheet();
    var data = sheet.getRange('A1').getValue();
    var updated = sheet.getRange('A2').getValue();
    var pendingSheet = getOrCreatePendingSheet();
    var pendingRaw = pendingSheet.getRange('A1').getValue();
    var pendingPick = null;
    if (pendingRaw) {
      try { pendingPick = JSON.parse(pendingRaw); } catch(pe) { pendingPick = null; }
    }
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      state: data,
      lastUpdated: updated,
      pendingPick: pendingPick
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    // Registration action
    if (payload.action === 'register') {
      return handleRegistration(payload);
    }

    // Remote draft pick submission
    if (payload.action === 'remote_pick') {
      var pendingSheet = getOrCreatePendingSheet();
      pendingSheet.getRange('A1').setValue(JSON.stringify({
        player: payload.player,
        castawayId: payload.castawayId,
        castawayName: payload.castawayName,
        timestamp: new Date().toISOString()
      }));
      return ContentService.createTextOutput(JSON.stringify({
        success: true
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Clear pending pick (admin accepted or rejected)
    if (payload.action === 'clear_pending') {
      var pendingSheet = getOrCreatePendingSheet();
      pendingSheet.getRange('A1').setValue('');
      return ContentService.createTextOutput(JSON.stringify({
        success: true
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // MERGE DRAFT — remote player auto-applies a pick (no admin approval)
    if (payload.action === 'merge_pick') {
      return handleMergePick(payload);
    }

    // MERGE DRAFT — admin has just started the draft; email player #1
    if (payload.action === 'start_merge_draft') {
      return handleStartMergeDraft();
    }

    // Default: publish state (commissioner)
    var sheet = getOrCreateSheet();
    sheet.getRange('A1').setValue(JSON.stringify(payload.state));
    sheet.getRange('A2').setValue(new Date().toISOString());
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      lastUpdated: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// =============================================================
// MERGE DRAFT HANDLERS
// =============================================================

function handleMergePick(payload) {
  var lock = LockService.getScriptLock();
  try {
    // Serialize merge picks so we don't double-apply if two people race to the same turn
    lock.waitLock(8000);
  } catch (e) {
    return jsonOut({ success: false, error: 'server_busy' });
  }

  try {
    var playerIdx = payload.playerIdx;
    var castawayId = payload.castawayId;
    var playerName = payload.playerName;

    if (playerIdx === undefined || playerIdx === null || castawayId === undefined || castawayId === null) {
      return jsonOut({ success: false, error: 'missing_fields' });
    }

    var sheet = getOrCreateSheet();
    var raw = sheet.getRange('A1').getValue();
    var state;
    try { state = JSON.parse(raw); } catch (e) { return jsonOut({ success: false, error: 'no_state' }); }

    if (!state) return jsonOut({ success: false, error: 'no_state' });
    if (!state.mergeDraftStarted) return jsonOut({ success: false, error: 'draft_not_started' });
    if (!state.mergeDraftOrder) return jsonOut({ success: false, error: 'no_order' });
    if (!state.mergePicks) state.mergePicks = [];

    var currentIdx = state.mergePicks.length;
    if (currentIdx >= state.mergeDraftOrder.length) {
      return jsonOut({ success: false, error: 'draft_complete' });
    }

    var expectedPlayer = state.mergeDraftOrder[currentIdx];
    if (expectedPlayer !== playerIdx) {
      return jsonOut({ success: false, error: 'not_your_turn', expected: expectedPlayer });
    }

    // Validate castaway
    if (!state.castaways || !state.castaways[castawayId]) {
      return jsonOut({ success: false, error: 'castaway_not_found' });
    }
    var castaway = state.castaways[castawayId];
    if (castaway.status !== 'active') {
      return jsonOut({ success: false, error: 'castaway_not_active' });
    }
    if (!castaway.mergePickedBy) castaway.mergePickedBy = [];
    if (castaway.mergePickedBy.length >= 2) {
      return jsonOut({ success: false, error: 'castaway_off_board' });
    }
    if (castaway.pickedBy && castaway.pickedBy.indexOf(playerIdx) !== -1) {
      return jsonOut({ success: false, error: 'already_on_your_roster' });
    }

    // Apply the pick
    castaway.mergePickedBy.push(playerIdx);
    state.mergePicks.push({ playerIdx: playerIdx, castawayId: castawayId });
    if (state.mergePicks.length >= state.mergeDraftOrder.length) {
      state.mergeDraftComplete = true;
    }

    // Save updated state
    sheet.getRange('A1').setValue(JSON.stringify(state));
    sheet.getRange('A2').setValue(new Date().toISOString());

    // Notify the NEXT picker (if any)
    try { notifyNextPicker(state); } catch (mailErr) { /* don't fail the pick if email fails */ }

    return jsonOut({ success: true, mergePicks: state.mergePicks.length, total: state.mergeDraftOrder.length });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function handleStartMergeDraft() {
  // Called by the admin right after they click Start — we just email player #1
  var sheet = getOrCreateSheet();
  var raw = sheet.getRange('A1').getValue();
  var state;
  try { state = JSON.parse(raw); } catch (e) { return jsonOut({ success: false, error: 'no_state' }); }
  if (!state || !state.mergeDraftStarted) return jsonOut({ success: false, error: 'draft_not_started' });
  try {
    notifyNextPicker(state);
    return jsonOut({ success: true });
  } catch (err) {
    return jsonOut({ success: false, error: err.message });
  }
}

function notifyNextPicker(state) {
  if (!state) return;
  if (state.mergeDraftComplete) return;
  if (!state.mergeDraftOrder || !state.mergePicks) return;
  var nextIdx = state.mergeDraftOrder[state.mergePicks.length];
  if (nextIdx === undefined || nextIdx === null) return;
  if (!state.players || !state.players[nextIdx]) return;
  var nextPlayerName = state.players[nextIdx].name;
  if (!nextPlayerName) return;

  // Look up email in Registrations sheet (match by name, case-insensitive)
  var regSheet = getOrCreateRegistrationsSheet();
  var rows = regSheet.getDataRange().getValues();
  var email = null;
  var targetName = nextPlayerName.toString().trim().toLowerCase();
  for (var i = 1; i < rows.length; i++) {
    var rowName = (rows[i][0] || '').toString().trim().toLowerCase();
    if (rowName === targetName) {
      email = rows[i][1];
      break;
    }
  }
  if (!email) return;

  var draftLink = 'https://jarrardcole.github.io/survivor50/?mode=mergedraft';
  var pickNum = state.mergePicks.length + 1;
  var totalPicks = state.mergeDraftOrder.length;

  MailApp.sendEmail({
    to: email,
    subject: "You're up — Survivor 50 Merge Draft",
    htmlBody: '<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#1a2a18;color:#fff;border-radius:12px">' +
      '<h2 style="color:#F5C842;margin:0 0 12px">🔥 You\'re on the clock!</h2>' +
      '<p>Hey ' + nextPlayerName + ',</p>' +
      '<p>You\'re up for <strong>pick #' + pickNum + ' of ' + totalPicks + '</strong> in the Survivor 50 merge draft. Tap below to make your pick:</p>' +
      '<p style="text-align:center;margin:24px 0"><a href="' + draftLink + '" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#E8751A,#F5C842);color:#000;text-decoration:none;border-radius:8px;font-weight:800;font-size:16px">MAKE YOUR PICK</a></p>' +
      '<p style="font-size:13px;color:#aaa">Or copy this link: <a href="' + draftLink + '" style="color:#F5C842">' + draftLink + '</a></p>' +
      '<p style="font-size:12px;color:#888;margin-top:24px">— Claude 🤖, your AI commissioner</p>' +
      '</div>'
  });
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleRegistration(payload) {
  var sheet = getOrCreateRegistrationsSheet();
  var email = (payload.email || '').trim().toLowerCase();
  var name = (payload.name || '').trim();
  var castawayId = payload.castawayId;

  // Validate required fields
  if (!email || !name || castawayId === undefined || castawayId === null) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: 'Missing required fields: name, email, castawayId'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // Check for duplicate email or duplicate name
  var data = sheet.getDataRange().getValues();
  var nameLower = name.toLowerCase();
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] && data[i][1].toString().trim().toLowerCase() === email) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: 'duplicate',
        existingName: data[i][0]
      })).setMimeType(ContentService.MimeType.JSON);
    }
    if (data[i][0] && data[i][0].toString().trim().toLowerCase() === nameLower) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: 'duplicate_name'
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // Append registration
  var timestamp = new Date().toISOString();
  sheet.appendRow([name, email, castawayId, timestamp]);

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    timestamp: timestamp
  })).setMimeType(ContentService.MimeType.JSON);
}
