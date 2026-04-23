# Survivor 50 Fantasy Draft App

## Project Overview
Single-page HTML app (`index.html`, ~6300 lines, ~600KB) for running a fantasy league around Survivor Season 50. Everything is in one file including embedded base64 castaway photos. Backend is a Google Apps Script (`google-apps-script.js`, ~340 lines) deployed as a web app that reads/writes a Google Sheet.

### Season state (as of 2026-04-22)
- 24 castaways (S50 is all returnees — **not** 18; earlier note was wrong)
- 8 episodes scored; 8 castaways eliminated
- 9 players registered
- **Merge draft complete** (all 9 picks in). Final picks: Martina→Rizo, Jim→Ozzy, Jarrard→Aubry, Will→Stephenie, Matt→Aubry, M Ragazz→Cirie, James→Tiffany, Henry→Christian, Ryan→Ozzy
- `settings.mergeDraftMode` turned back `off` — viewers see leaderboard again

### Features / Tabs
- **Setup** — configure players/teams
- **Prop Bets** — pre-season prop bets (e.g., first boot)
- **Draft** — snake-draft castaways to players
- **Leaderboard** — standings and scores
- **Scoring** — per-episode scoring
- **Cast** — all 24 castaways with embedded base64 photos
- **Merge Draft** — second draft at merge (remote email-auth flow + auto-applied picks)
- **Power Rankings** and **Head-to-Head** views
- **Tribe War Map** — mobile-friendly visualization
- 3 tribes: Vatu (purple), Kalo (teal), Cila (orange)

## Data Storage — CURRENT STATUS

### localStorage (WORKING)
- `saveState()` writes state to `localStorage` (strips base64 photos to save space)
- `loadState()` reads from `localStorage` and restores photos from `DEFAULT_CASTAWAYS`
- `saveState()` is called after state mutations
- Data persists across page refreshes on the same browser/device

### Google Sheets Sync (DEPLOYED + LIVE)
- `SHEET_API_URL` in `index.html` (~line 2856) points at the deployed Apps Script web app
- Admin (`?mode=admin`) → **Publish** button pushes state to the Sheet
- Viewer (default) → auto-fetches every 60s (5s during live merge draft)
- Sync banner shows status
- The Sheet also has a **Registrations** tab (name, email, castawayId, timestamp) used for the pre-season prop bet join flow and merge-draft email auth

## URL Modes
| URL param | Who | What they see |
|---|---|---|
| `?mode=admin` | Commissioner (Jarrard) | Full app + Publish button + pending-pick approvals |
| *(none)* | Viewers | Read-only live view; auto-redirects to merge draft when admin flips `settings.mergeDraftMode='active'` |
| `?mode=join` | New registrants | Pre-season prop bet / winner-pick registration form |
| `?mode=remote&player=Name1,Name2` | Remote drafters during initial draft | Submit picks for admin approval |
| `?mode=mergedraft` | Remote merge drafters | Email lookup → live draft board; picks auto-apply |
| `?reset=true` | Anyone | Clears local join/registration state |

## Merge Draft Flow (live-ready)
1. Admin opens Setup → **Start Merge Draft & Notify** → backend emails player #1.
2. Each remote player visits `?mode=mergedraft`, enters their email, is matched against the Registrations sheet and mapped to a `playerIdx`.
3. On their turn, the board becomes clickable; pick POSTs `action=merge_pick` to the Apps Script, which validates turn + availability, applies the pick to the sheet, and emails the next player via `notifyNextPicker()`.
4. All viewers' 5s polling picks up the new state automatically.
5. Rich inline draft-order view shows every slot, current picker, and completed picks with castaway names.

## Key Architecture Notes
- `state` object contains: `players`, `settings`, `castaways`, `draftOrder`, `draftPicks`, `episodes`, `propBets`, `powerRankings`, `mergeDraftOrder`, `mergePicks`, `mergeDraftStarted`, `mergeDraftComplete`, etc.
- `renderAll()` re-renders all views from state
- `exportData()` / `importData()` — JSON roundtrip
- `publishToSheet()` POSTs state (sans photos) to the Apps Script
- `fetchFromSheet()` GETs state and merges into memory
- `stateForSheet()` / `restorePhotos()` strip/restore base64 photos for transport
- Commissioner vs Viewer controlled by `?mode=admin`
- `IS_ADMIN`, `IS_JOIN`, `IS_REMOTE`, `IS_MERGE_REMOTE`, `SHEET_API_URL` are the key config constants

## Apps Script Endpoints (`google-apps-script.js`)
- `GET /exec` → returns `{ state, timestamp, pendingPick }`
- `GET /exec?action=registrations` → list of registered players
- `POST {action:'register', ...}` → append to Registrations sheet (dedupes by email and by name)
- `POST {action:'remote_pick', ...}` → stage a draft pick for admin approval
- `POST {action:'clear_pending'}` → clear the pending pick slot
- `POST {action:'merge_pick', playerIdx, castawayId, ...}` → validate + apply merge pick atomically, then email the next picker
- `POST {action:'start_merge_draft'}` → email player #1 the kickoff notification
- All writes guarded by `LockService.getScriptLock()`

## Known Rough Edges
- `copyMergeDraftLink()` and `notifyNextPicker()` (Apps Script) both hard-code `https://jarrardcole.github.io/survivor50/?mode=mergedraft`. If the deploy URL ever changes, both need updating.
- `SHEET_API_URL` is committed in source — anyone can POST to it. Backend validates state transitions but there's no auth beyond email lookup.
- Several `_backup.html` / `_backup.js` files in the repo root are snapshots from earlier sessions; safe to delete once trust is established.

## Lessons learned (2026-04-21 merge draft fire drill)

**Apps Script deploy-dialog trap.** The live deployed code kept regressing to an older version mid-draft. Root cause: in Deploy → Manage deployments → pencil → Version dropdown, clicking coordinates rather than the "New version" accessibility ref frequently re-selected the existing version instead of creating a new one — silently re-deploying the stale code. Fix: always select "New version" via ref (`mcp__Claude_in_Chrome__find` for `"New version" option`), never by pixel coord.

**`doPost` default branch wiped state.** The original backend's fallthrough branch wrote `JSON.stringify(payload.state)` with zero validation. Any POST without a matching `action` and without a `.state` field stored `undefined` → blanked cell A1. Merge-pick POSTs (when the deployed code didn't have `handleMergePick`) fell into this branch and wiped the live state. Fixed with server-side guardrails (`missing_state`, `empty_players`, `insufficient_castaways`, anti-regression checks against current server picks, `would_reset_merge_draft`).

**Gmail silently drops self-sent MailApp mail.** `MailApp.sendEmail` from a script owned by `jarrard.cole@gmail.com` to `jarrard.cole@gmail.com` returns success but the message never reaches the inbox, spam, or even Sent. This blocked `notifyNextPicker` for the owner-as-recipient case throughout the draft. Workaround used: send notifications from Jarrard's Gmail directly via the Gmail MCP (plain-text, composed per pick) — lands in Primary inbox reliably.

**MailApp scope grant doesn't transfer from editor to deployment.** Running `authMail()` from the editor authorized the owner's token for `script.send_mail`, but the deployed web app still failed with "You do not have permission to call MailApp.sendEmail" until the next fresh "New version" deploy. Scopes are frozen per deployment version — always redeploy after adding a new scope.

**Publish-side frontend guardrail.** Added to `publishToSheet()` in `index.html`: refuses to publish if `state.players.length === 0` or `state.castaways.length < 18` (prevents a stale/empty tab from nuking the sheet), and refuses if server has more picks than local (prevents stale-admin-tab stomping). Both catch the realistic race without needing server-side version vectors.

**Admin-side UI additions.** Commissioner Controls card now has a 📧 Resend Email to Current Picker button that reliably re-fires `notifyNextPicker` for whoever is currently on the clock (uses `action=start_merge_draft` which the backend routes to the next picker based on sheet state). `startMergeDraftAndNotify` now checks `data.success` and alerts loudly on failure instead of the old silent "✓ First picker has been emailed" that masked scope errors.

## Operating playbook for future merge drafts

1. **Before starting:** confirm every registered email is reachable. Send a short test from your own Gmail to each registrant — Apps Script mail delivery is unreliable for self-sent and still benefits from warm inbox reputation.
2. **Default to manual email via Gmail MCP.** Don't count on `notifyNextPicker`. When it's someone's turn, send the "you're up" email from Jarrard's Gmail directly — short plain-text, includes the `?mode=mergedraft` link and the picks-so-far list. Lands in inbox, not Promotions.
3. **Never Publish from a tab you haven't verified.** Check the Sync banner shows "Published HH:MM" and the merge draft table looks populated before you hit Publish. The guardrails catch empty state, but not "outdated-but-populated" state unless server already has more picks.
4. **If email delivery is in doubt:** just text the next picker their direct URL. The draft does not need email to function — it only needs the URL to reach the right person.
5. **Deploy the Apps Script carefully.** Use the `find()` tool to select "New version" via ref, not by pixel coords. Always test the deployed behavior with a known action (e.g. `POST {action:"start_merge_draft"}`) before trusting the deploy.

## Branch
- Working branch: `main`
