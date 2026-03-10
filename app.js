// ============================================================
// Budget Tracker PWA — app.js
// IndexedDB-first storage + optional Google Sheets sync
// ============================================================

// ── CONFIG ───────────────────────────────────────────────
const DB_NAME    = 'BudgetTrackerDB';
const DB_VERSION = 1;
const STORES     = ['transactions','categories','settings','limits','recurring','goals','budgetPlan','networth','syncQueue'];

// Google Sheets sync — user fills these in Settings after deploying Code.gs
let SHEETS_SCRIPT_URL = localStorage.getItem('sheetsScriptUrl') || '';

// ── INDEXEDDB ─────────────────────────────────────────────
let db = null;

async function openDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      STORES.forEach(store => {
        if (!d.objectStoreNames.contains(store)) {
          d.createObjectStore(store, { keyPath: 'id' });
        }
      });
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbGet(store, id) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => res(req.result || null);
    req.onerror   = () => rej(req.error);
  });
}

async function dbGetAll(store) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror   = () => rej(req.error);
  });
}

async function dbPut(store, item) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(item);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function dbDelete(store, id) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(id);
    req.onsuccess = () => res(true);
    req.onerror   = () => rej(req.error);
  });
}

async function dbClear(store) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx  = d.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => res(true);
    req.onerror   = () => rej(req.error);
  });
}

// ── ID GENERATION ─────────────────────────────────────────
function newId(prefix = '') {
  return prefix + Date.now().toString() + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
}

// ── DEFAULT DATA ──────────────────────────────────────────
const DEFAULT_CATS = {
  income:  ['Salary', 'Freelance', 'Investment', 'Gift', 'Other Income'],
  expense: ['Food', 'Transport', 'Utilities', 'Rent', 'Entertainment', 'Healthcare', 'Shopping', 'Education', 'Other'],
  debt:    ['Personal Loan', 'Business Debt', 'Credit Card', 'Other']
};
const DEFAULT_RATE = 89500;

// ── STORAGE API (mirrors Apps Script apiHandler interface) ─
const Storage = {

  // ── INIT ────────────────────────────────────────────────
  async init() {
    await openDB();
    // Seed categories if empty
    const existing = await dbGetAll('categories');
    if (!existing.length) {
      for (const [type, cats] of Object.entries(DEFAULT_CATS)) {
        for (const cat of cats) {
          await dbPut('categories', { id: type + '|' + cat, type, category: cat });
        }
      }
    }
    // Seed exchange rate if not set
    const rate = await dbGet('settings', 'exchangeRate');
    if (!rate) await dbPut('settings', { id: 'exchangeRate', value: DEFAULT_RATE });
  },

  // ── SETTINGS ────────────────────────────────────────────
  async getSettings() {
    const r = await dbGet('settings', 'exchangeRate');
    return { exchangeRate: r ? r.value : DEFAULT_RATE };
  },

  async saveSettings({ exchangeRate }) {
    const rate = parseFloat(exchangeRate);
    if (!rate || rate <= 0) throw new Error('Invalid rate');
    await dbPut('settings', { id: 'exchangeRate', value: rate });
    await queueSync('saveSettings', { exchangeRate: rate });
  },

  // ── TRANSACTIONS ────────────────────────────────────────
  async getTransactions(month, year) {
    const all = await dbGetAll('transactions');
    if (month === undefined) return all;
    const m = parseInt(month), y = parseInt(year);
    return all.filter(t => {
      const p = (t.date || '').split('-');
      return parseInt(p[0]) === y && parseInt(p[1]) - 1 === m;
    }).sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  async saveTransaction(data) {
    const id = data.id || newId('T');
    const item = {
      id,
      type:           data.type,
      amountUSD:      parseFloat(data.amountUSD) || 0,
      amountLBP:      parseFloat(data.amountLBP) || 0,
      category:       (data.category || '').trim(),
      description:    (data.description || '').trim(),
      date:           data.date,
      currency:       data.currency || 'USD',
      originalAmount: parseFloat(data.originalAmount) || parseFloat(data.amountUSD) || 0,
      settled:        data.settled === true,
      updatedAt:      Date.now()
    };
    await dbPut('transactions', item);
    await queueSync('saveTransaction', item);
    return id;
  },

  async deleteTransaction(id) {
    await dbDelete('transactions', id);
    await queueSync('deleteTransaction', { id });
  },

  async settleDebt(id) {
    const t = await dbGet('transactions', id);
    if (!t) throw new Error('Not found');
    t.settled = true;
    t.updatedAt = Date.now();
    await dbPut('transactions', t);
    await queueSync('settleDebt', { id });
  },

  // ── CATEGORIES ──────────────────────────────────────────
  async getCategories() {
    const all = await dbGetAll('categories');
    const cats = { income: [], expense: [], debt: [] };
    all.forEach(c => { if (cats[c.type]) cats[c.type].push(c.category); });
    Object.keys(DEFAULT_CATS).forEach(t => { if (!cats[t].length) cats[t] = [...DEFAULT_CATS[t]]; });
    return cats;
  },

  async saveCategory(type, category) {
    const id = type + '|' + category;
    await dbPut('categories', { id, type, category });
    await queueSync('saveCategory', { type, category });
  },

  async deleteCategory(type, category) {
    await dbDelete('categories', type + '|' + category);
    await queueSync('deleteCategory', { type, category });
  },

  // ── SPENDING LIMITS ─────────────────────────────────────
  async getSpendingLimits() {
    const all = await dbGetAll('limits');
    const limits = {};
    all.forEach(l => { limits[l.category] = l.limitUSD; });
    return limits;
  },

  async saveSpendingLimit(category, limitUSD) {
    await dbPut('limits', { id: 'limit|' + category, category, limitUSD: parseFloat(limitUSD) });
    await queueSync('saveSpendingLimit', { category, limitUSD });
  },

  async deleteSpendingLimit(category) {
    await dbDelete('limits', 'limit|' + category);
    await queueSync('deleteSpendingLimit', { category });
  },

  // ── RECURRING ───────────────────────────────────────────
  async getRecurring() {
    return dbGetAll('recurring');
  },

  async saveRecurring(data) {
    const id = data.id || newId('R');
    const item = { id, type: data.type, amountUSD: parseFloat(data.amountUSD)||0, amountLBP: parseFloat(data.amountLBP)||0, category: data.category, description: data.description, dayOfMonth: Math.min(Math.max(parseInt(data.dayOfMonth)||1,1),28) };
    await dbPut('recurring', item);
    await queueSync('saveRecurring', item);
    return id;
  },

  async deleteRecurring(id) {
    await dbDelete('recurring', id);
    await queueSync('deleteRecurring', { id });
  },

  async applyRecurring(month, year) {
    const items = await dbGetAll('recurring');
    if (!items.length) return 0;
    const existing = await this.getTransactions(month, year);
    let applied = 0;
    for (const r of items) {
      const exists = existing.some(t => t.type===r.type && t.category===r.category && t.description===r.description);
      if (exists) continue;
      const ty = parseInt(year), tm = parseInt(month);
      const day = Math.min(r.dayOfMonth, new Date(ty, tm+1, 0).getDate());
      const date = ty + '-' + String(tm+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
      await this.saveTransaction({ type:r.type, amountUSD:r.amountUSD, amountLBP:r.amountLBP, category:r.category, description:r.description, date, currency:'USD', originalAmount:r.amountUSD });
      applied++;
    }
    return applied;
  },

  // ── SAVINGS GOALS ────────────────────────────────────────
  async getSavingsGoals() {
    return dbGetAll('goals');
  },

  async saveSavingsGoal(data) {
    const id = data.id || newId('G');
    const item = { id, name: data.name, targetUSD: parseFloat(data.targetUSD)||0, currentUSD: parseFloat(data.currentUSD)||0, deadline: data.deadline||'', notes: data.notes||'' };
    await dbPut('goals', item);
    await queueSync('saveSavingsGoal', item);
    return id;
  },

  async deleteSavingsGoal(id) {
    await dbDelete('goals', id);
    await queueSync('deleteSavingsGoal', { id });
  },

  async updateGoalProgress(id, amount) {
    const g = await dbGet('goals', id);
    if (!g) throw new Error('Not found');
    g.currentUSD = Math.max(0, (g.currentUSD||0) + (parseFloat(amount)||0));
    await dbPut('goals', g);
    await queueSync('updateGoalProgress', { id, amount });
    return g.currentUSD;
  },

  // ── BUDGET PLAN ─────────────────────────────────────────
  async getBudgetPlan(month, year) {
    const all = await dbGetAll('budgetPlan');
    const m = parseInt(month), y = parseInt(year);
    return all.filter(p => p.month === m && p.year === y);
  },

  async saveBudgetPlan(data) {
    const id = data.id || newId('B');
    const item = { id, month: parseInt(data.month), year: parseInt(data.year), type: data.type, category: data.category, plannedUSD: parseFloat(data.plannedUSD)||0 };
    await dbPut('budgetPlan', item);
    await queueSync('saveBudgetPlan', item);
    return id;
  },

  async deleteBudgetPlanItem(id) {
    await dbDelete('budgetPlan', id);
    await queueSync('deleteBudgetPlanItem', { id });
  },

  // ── NET WORTH ────────────────────────────────────────────
  async getNetWorth() {
    return dbGetAll('networth');
  },

  async saveNetWorthItem(data) {
    const id = data.id || newId('N');
    const item = { id, label: data.label, type: data.type, amountUSD: parseFloat(data.amountUSD)||0, notes: data.notes||'' };
    await dbPut('networth', item);
    await queueSync('saveNetWorthItem', item);
    return id;
  },

  async deleteNetWorthItem(id) {
    await dbDelete('networth', id);
    await queueSync('deleteNetWorthItem', { id });
  },

  // ── MULTI-MONTH CHART ────────────────────────────────────
  async getMultiMonthTotals(month, year, count = 6) {
    const all = await dbGetAll('transactions');
    const MLABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const buckets = [];
    let m = parseInt(month), y = parseInt(year);
    for (let i = 0; i < count; i++) {
      buckets.unshift({ month: m, year: y, incomeUSD: 0, expenseUSD: 0, label: MLABELS[m] + ' ' + String(y).slice(2) });
      if (--m < 0) { m = 11; y--; }
    }
    all.forEach(t => {
      const p = (t.date||'').split('-');
      const ty = parseInt(p[0]), tm = parseInt(p[1])-1;
      const b  = buckets.find(x => x.year===ty && x.month===tm);
      if (!b) return;
      const u = parseFloat(t.amountUSD)||0;
      if (t.type==='income')  b.incomeUSD  += u;
      if (t.type==='expense') b.expenseUSD += u;
    });
    return buckets;
  },

  async getLastMonthTotals(month, year) {
    let m = parseInt(month)-1, y = parseInt(year);
    if (m < 0) { m = 11; y--; }
    const txs = await this.getTransactions(m, y);
    let incomeUSD = 0, expenseUSD = 0;
    txs.forEach(t => {
      if (t.type==='income')  incomeUSD  += parseFloat(t.amountUSD)||0;
      if (t.type==='expense') expenseUSD += parseFloat(t.amountUSD)||0;
    });
    return { incomeUSD, expenseUSD, month: m, year: y };
  }
};

// ── SYNC QUEUE ────────────────────────────────────────────
async function queueSync(action, data) {
  if (!SHEETS_SCRIPT_URL) return; // Sheets sync not configured
  const item = { id: newId('Q'), action, data, timestamp: Date.now() };
  await dbPut('syncQueue', item);
  // Try immediate sync if online
  if (navigator.onLine) triggerSync();
}

let syncInProgress = false;
async function triggerSync() {
  if (syncInProgress || !SHEETS_SCRIPT_URL) return;
  syncInProgress = true;
  try {
    const queue = await dbGetAll('syncQueue');
    if (!queue.length) { syncInProgress = false; return; }
    for (const item of queue.sort((a,b) => a.timestamp - b.timestamp)) {
      try {
        const res = await fetch(SHEETS_SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify({ action: item.action, data: item.data })
        });
        if (res.ok) await dbDelete('syncQueue', item.id);
      } catch (e) { break; } // Stop on network error, retry later
    }
    updateSyncStatus();
  } finally { syncInProgress = false; }
}

function updateSyncStatus() {
  dbGetAll('syncQueue').then(q => {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    if (!SHEETS_SCRIPT_URL) { el.textContent = ''; return; }
    if (q.length === 0) { el.innerHTML = '<span style="color:var(--green2)">✓ Synced</span>'; }
    else { el.innerHTML = `<span style="color:var(--amber)">⏳ ${q.length} pending</span>`; }
  });
}

// Sync on coming back online
window.addEventListener('online',  () => { triggerSync(); updateSyncStatus(); });
window.addEventListener('offline', () => updateSyncStatus());

// Listen for SW sync message
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'SYNC_SHEETS') triggerSync();
  });
}

// ── RESTORE FROM SHEETS ───────────────────────────────────
async function restoreFromSheets() {
  if (!SHEETS_SCRIPT_URL) { showToast('Set your Sheets URL in Settings first'); return; }
  showToast('Restoring from Google Sheets…');
  try {
    const actions = ['getTransactions','getCategories','getSettings','getSpendingLimits','getRecurring','getSavingsGoals','getBudgetPlan','getNetWorth'];
    const storeMap = { getTransactions:'transactions', getCategories:'categories', getSettings:'settings', getSpendingLimits:'limits', getRecurring:'recurring', getSavingsGoals:'goals', getNetWorth:'networth' };

    for (const action of actions) {
      const res = await fetch(SHEETS_SCRIPT_URL + '?action=' + action);
      if (!res.ok) continue;
      const json = await res.json();
      if (!json.success) continue;

      if (action === 'getTransactions' && json.transactions) {
        await dbClear('transactions');
        for (const t of json.transactions) await dbPut('transactions', t);
      }
      if (action === 'getCategories' && json.categories) {
        await dbClear('categories');
        for (const [type, cats] of Object.entries(json.categories))
          for (const cat of cats) await dbPut('categories', { id: type+'|'+cat, type, category: cat });
      }
      if (action === 'getSettings' && json.settings?.exchangeRate)
        await dbPut('settings', { id: 'exchangeRate', value: parseFloat(json.settings.exchangeRate) });
      if (action === 'getSavingsGoals' && json.goals) {
        await dbClear('goals');
        for (const g of json.goals) await dbPut('goals', g);
      }
      if (action === 'getNetWorth' && json.items) {
        await dbClear('networth');
        for (const n of json.items) await dbPut('networth', n);
      }
    }
    showToast('Restored from Google Sheets ✓');
    await loadAll();
  } catch (e) { showToast('Restore failed: ' + e.message); }
}

// ── PWA INSTALL PROMPT ────────────────────────────────────
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('installBtn');
  if (btn) btn.classList.remove('hidden');
});

async function promptInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') {
    document.getElementById('installBtn')?.classList.add('hidden');
    showToast('App installed! 🎉');
  }
  deferredInstallPrompt = null;
}

window.addEventListener('appinstalled', () => {
  document.getElementById('installBtn')?.classList.add('hidden');
});

// ── SERVICE WORKER REGISTRATION ───────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      console.log('SW registered:', reg.scope);
      // Register background sync if supported
      if ('sync' in reg) {
        window.addEventListener('online', () => reg.sync.register('sync-sheets').catch(()=>{}));
      }
    } catch (e) { console.log('SW registration failed:', e); }
  });
}

// Export for use in index.html
window.Storage   = Storage;
window.triggerSync = triggerSync;
window.restoreFromSheets = restoreFromSheets;
window.promptInstall = promptInstall;
window.updateSyncStatus = updateSyncStatus;
