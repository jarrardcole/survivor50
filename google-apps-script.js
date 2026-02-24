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

    // Default: return state
    var sheet = getOrCreateSheet();
    var data = sheet.getRange('A1').getValue();
    var updated = sheet.getRange('A2').getValue();
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      state: data,
      lastUpdated: updated
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
