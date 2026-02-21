// ============================================================
// SURVIVOR 50 FANTASY — Google Apps Script Backend
// ============================================================
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
// ============================================================

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

function doGet(e) {
  try {
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
