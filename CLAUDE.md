# Survivor 50 Fantasy Draft App

## Project Overview
Single-page HTML app (`index.html`, ~4100 lines, ~600KB) for running a fantasy league around Survivor Season 50. Everything is in one file including embedded base64 castaway photos.

### Features/Tabs
- **Setup** — configure players/teams
- **Prop Bets** — pre-season prop bets (e.g., first boot)
- **Draft** — snake-draft castaways to players
- **Leaderboard** — standings and scores
- **Scoring** — per-episode scoring
- **Cast** — all 18 castaways with embedded base64 photos
- **Merge Draft** — second draft at the merge
- **Power Rankings** and **Head-to-Head** views
- 3 tribes: Vatu (purple), Kalo (teal), Cila (orange)

## Data Storage — CURRENT STATUS

### localStorage (DONE, WORKING)
- `saveState()` (line ~2407) writes state to `localStorage` (strips base64 photos to save space)
- `loadState()` (line ~2417) reads from `localStorage` and restores photos from `DEFAULT_CASTAWAYS`
- `saveState()` is called after state mutations (import, draft actions, scoring, etc.)
- Data persists across page refreshes on the same browser/device

### Google Sheets Sync (CODE DONE, NEEDS DEPLOYMENT)
- `google-apps-script.js` — ready to paste into Google Apps Script
- `SHEET_API_URL` constant (line ~2280) — currently empty string `''`, needs the deployed Apps Script URL
- Commissioner mode (`?mode=admin`) — shows **Publish** button to push state to Sheet
- Viewer mode (default) — auto-fetches from Sheet every 60 seconds
- Sync status indicator in a banner bar

### What's LEFT to do (requires `claude --chrome`):
1. **Create a Google Sheet** (blank)
2. Open **Extensions > Apps Script** in the sheet
3. Paste contents of `google-apps-script.js` into `Code.gs`
4. **Deploy > New deployment > Web app** — set "Who has access" to **Anyone**
5. Copy the deployed URL
6. Paste it into `SHEET_API_URL` on line ~2280 of `index.html`
7. Commit and push the updated URL

## Key Architecture Notes
- `state` object (line ~2281) contains: players, settings, castaways, draftOrder, draftPicks, episodes, propBets, powerRankings, mergePicks, etc.
- `renderAll()` re-renders all views from state
- `exportData()` downloads state as JSON file
- `importData()` loads JSON file into state and calls `saveState()`
- `publishToSheet()` POSTs state (sans photos) to the Apps Script web app
- `fetchFromSheet()` GETs state from the Sheet and merges into memory
- `stateForSheet()` / `restorePhotos()` handle stripping/restoring base64 photos for transport
- 18 castaways in `DEFAULT_CASTAWAYS` with embedded base64 photos
- Commissioner vs Viewer mode controlled by `?mode=admin` URL param
- `IS_ADMIN` and `SHEET_API_URL` are the key config constants

## Branch
- Working branch: `claude/check-github-access-ewqcq`
- Base: `main`
