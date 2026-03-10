# 💰 Budget Tracker PWA — Deploy Guide

A personal finance app that works **offline**, installs on your phone like a native app,
and optionally syncs to Google Sheets as a backup.

---

## What's in this folder

| File | Purpose |
|------|---------|
| `index.html` | The full app UI |
| `app.js` | All logic + offline storage (IndexedDB) |
| `sw.js` | Service worker — makes it work offline |
| `manifest.json` | Makes it installable on your phone |
| `icons/` | App icons for home screen |
| `Code.gs` | Google Apps Script for optional Sheets sync |

---

## PART 1 — Deploy to GitHub Pages (free, ~10 minutes)

### Step 1 — Create a GitHub account
Go to **github.com** → Sign Up (free). You only need to do this once.

### Step 2 — Create a new repository
1. Click the **+** button (top right) → **New repository**
2. Name it: `budget-tracker` (or anything you like)
3. Set it to **Public**
4. Click **Create repository**

### Step 3 — Upload your files
1. On your new repository page, click **uploading an existing file**
2. Drag and drop ALL files from this folder:
   - `index.html`
   - `app.js`
   - `sw.js`
   - `manifest.json`
   - The entire `icons/` folder (drag both icon files)
3. Scroll down, click **Commit changes**

### Step 4 — Enable GitHub Pages
1. Click **Settings** (top of your repository)
2. Scroll down to **Pages** (left sidebar)
3. Under **Source**, select **Deploy from a branch**
4. Under **Branch**, select **main** → **/ (root)** → click **Save**
5. Wait 1–2 minutes, then your app is live at:
   **`https://YOUR-USERNAME.github.io/budget-tracker`**

### Step 5 — Install on your phone
**On iPhone (Safari):**
1. Open the link in Safari
2. Tap the **Share** button (box with arrow)
3. Scroll down → tap **Add to Home Screen**
4. Tap **Add** — done! 🎉

**On Android (Chrome):**
1. Open the link in Chrome
2. Tap the **⋮** menu (top right)
3. Tap **Add to Home screen** or look for the install banner
4. Tap **Add** — done! 🎉

---

## PART 2 — Enable Google Sheets Sync (optional, ~10 minutes)

This is optional. Your app works perfectly without it.
Set this up if you want a cloud backup or to restore data on a new phone.

### Step 1 — Create a Google Sheet
1. Go to **sheets.google.com** → create a new blank spreadsheet
2. Name it: `Budget Tracker Sync`

### Step 2 — Open Apps Script
1. In your spreadsheet, click **Extensions** → **Apps Script**
2. Delete all existing code in the editor
3. Copy the entire contents of `Code.gs` and paste it in
4. Click **Save** (floppy disk icon)

### Step 3 — Deploy as Web App
1. Click **Deploy** (top right) → **New deployment**
2. Click the gear ⚙️ next to "Type" → select **Web app**
3. Set **Execute as**: Me
4. Set **Who has access**: Anyone
5. Click **Deploy**
6. Click **Authorize access** → choose your Google account → Allow
7. Copy the **Web app URL** — it looks like:
   `https://script.google.com/macros/s/ABC123.../exec`

### Step 4 — Connect in the app
1. Open your Budget Tracker app
2. Tap the ⚙️ settings icon (top right)
3. Paste your URL into the **Apps Script URL** field
4. Tap **Connect**
5. You'll see "✓ Synced" appear — your data now backs up automatically!

### Restore data on a new phone
1. Install the app on your new phone (follow Part 1 Step 5)
2. Go to Settings → paste your Apps Script URL → tap **Connect**
3. Tap **Restore from Sheets**
4. All your data comes back instantly ✓

---

## PART 3 — Share with others

Once your app is deployed, anyone can use it by visiting your link:
```
https://YOUR-USERNAME.github.io/budget-tracker
```

Each person:
- Gets their own **private** copy of the app on their device
- Their data is completely separate from yours
- They can optionally connect their own Google Sheet for backup
- It works offline on their phone too

Just send them the link and tell them to follow **Part 1 Step 5** to install it.

---

## Updating the app

If you make changes to the files:
1. Go to your GitHub repository
2. Click on the file you want to update
3. Click the **pencil** ✏️ icon to edit
4. Paste the new content
5. Click **Commit changes**

The live app updates automatically within a minute.

---

## Troubleshooting

**App doesn't install on iPhone:**
Make sure you're using Safari, not Chrome or Firefox. iOS only supports PWA install from Safari.

**"Sync failed" error:**
Check that your Apps Script URL is correct and that you authorized access during deployment.

**Data disappeared:**
If you cleared your browser data or switched browsers, local data may be gone.
This is why Google Sheets sync is recommended — use **Restore from Sheets** to get it back.

**App not updating after I changed files:**
Hard-refresh the page: on mobile, clear the browser cache or reinstall the app.

---

## Your app link

Once deployed, write your link here:
```
https://_________________________________.github.io/budget-tracker
```

---

*Built with ❤️ — IndexedDB · Service Worker · Google Sheets API*
