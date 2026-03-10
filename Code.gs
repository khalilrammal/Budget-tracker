// ============================================
// BUDGET TRACKER — Code.gs (PWA Sync Edition)
// Supports both GET (restore) and POST (sync)
// ============================================

const DEFAULT_EXCHANGE_RATE = 89500;
const MAX_FIELD_LENGTH      = 200;

const DEFAULT_CATEGORIES = {
  income:  ['Salary', 'Freelance', 'Investment', 'Gift', 'Other Income'],
  expense: ['Food', 'Transport', 'Utilities', 'Rent', 'Entertainment',
            'Healthcare', 'Shopping', 'Education', 'Other'],
  debt:    ['Personal Loan', 'Business Debt', 'Credit Card', 'Other']
};

// ── ENTRY POINTS ─────────────────────────────
function doGet(e) {
  ensureInitialized();
  const action = e?.parameter?.action;
  if (action) {
    // REST-style GET for restore: ?action=getTransactions
    return jsonResponse(handleAction(action, e.parameter || {}));
  }
  // Serve the PWA (if you want to host it here too — optional)
  return HtmlService.createHtmlOutput('<p>Budget Tracker Sync API — use your PWA app.</p>');
}

function doPost(e) {
  try {
    ensureInitialized();
    if (!e?.postData?.contents) return jsonResponse({ success: false, error: 'Empty body' });
    const payload = JSON.parse(e.postData.contents);
    return jsonResponse(handleAction(payload.action, payload.data || {}));
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// Called directly from Apps Script context (optional local use)
function apiHandler(action, data) {
  try { ensureInitialized(); return handleAction(action, data); }
  catch (err) { return { success: false, error: err.toString() }; }
}

function handleAction(action, data) {
  switch (action) {
    case 'initialize':           return initializeSystem();
    case 'getTransactions':      return getTransactions(data.month, data.year);
    case 'saveTransaction':      return saveTransaction(data);
    case 'deleteTransaction':    return deleteTransaction(data.id);
    case 'settleDebt':           return settleDebt(data.id);
    case 'getCategories':        return getCategories();
    case 'saveCategory':         return saveCategory(data.type, data.category);
    case 'deleteCategory':       return deleteCategory(data.type, data.category);
    case 'getSettings':          return getSettings();
    case 'saveSettings':         return saveSettings(data);
    case 'getSpendingLimits':    return getSpendingLimits();
    case 'saveSpendingLimit':    return saveSpendingLimit(data.category, data.limitUSD);
    case 'deleteSpendingLimit':  return deleteSpendingLimit(data.category);
    case 'getLastMonthTotals':   return getLastMonthTotals(data.month, data.year);
    case 'getRecurring':         return getRecurring();
    case 'saveRecurring':        return saveRecurring(data);
    case 'deleteRecurring':      return deleteRecurring(data.id);
    case 'applyRecurring':       return applyRecurring(data.month, data.year);
    case 'getSavingsGoals':      return getSavingsGoals();
    case 'saveSavingsGoal':      return saveSavingsGoal(data);
    case 'deleteSavingsGoal':    return deleteSavingsGoal(data.id);
    case 'updateGoalProgress':   return updateGoalProgress(data.id, data.amount);
    case 'getBudgetPlan':        return getBudgetPlan(data.month, data.year);
    case 'saveBudgetPlan':       return saveBudgetPlan(data);
    case 'deleteBudgetPlanItem': return deleteBudgetPlanItem(data.id);
    case 'getNetWorth':          return getNetWorth();
    case 'saveNetWorthItem':     return saveNetWorthItem(data);
    case 'deleteNetWorthItem':   return deleteNetWorthItem(data.id);
    default: return { success: false, error: 'Unknown action: ' + action };
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── INITIALIZATION ────────────────────────────
function ensureInitialized() {
  if (PropertiesService.getScriptProperties().getProperty('initialized') !== 'true')
    initializeSystem();
}

function initializeSystem() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = {
      Transactions:  [['ID','Type','AmountUSD','AmountLBP','Category','Description','Date','Currency','OriginalAmount','Settled'], '#e0e7ff'],
      Categories:    [['Type','Category'], '#e0e7ff'],
      Settings:      [['Key','Value'], '#e0e7ff'],
      SpendingLimits:[['Category','LimitUSD'], '#fde68a'],
      Recurring:     [['ID','Type','AmountUSD','AmountLBP','Category','Description','DayOfMonth'], '#d1fae5'],
      SavingsGoals:  [['ID','Name','TargetUSD','CurrentUSD','Deadline','Notes'], '#fce7f3'],
      BudgetPlan:    [['ID','Month','Year','Type','Category','PlannedUSD'], '#dbeafe'],
      NetWorth:      [['ID','Label','Type','AmountUSD','Notes'], '#f3e8ff'],
    };
    Object.entries(sheets).forEach(([name, [headers, color]]) => {
      if (!ss.getSheetByName(name)) {
        const s = ss.insertSheet(name);
        s.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground(color);
      }
    });
    const catSheet = ss.getSheetByName('Categories');
    if (catSheet.getLastRow() <= 1) {
      const rows = [];
      Object.keys(DEFAULT_CATEGORIES).forEach(t => DEFAULT_CATEGORIES[t].forEach(c => rows.push([t,c])));
      catSheet.getRange(2,1,rows.length,2).setValues(rows);
    }
    const setSheet = ss.getSheetByName('Settings');
    if (setSheet.getLastRow() <= 1) setSheet.appendRow(['exchangeRate', DEFAULT_EXCHANGE_RATE]);
    PropertiesService.getScriptProperties().setProperty('initialized','true');
    return { success: true };
  } catch(err) { return { success: false, error: err.toString() }; }
}

// ── TRANSACTIONS ──────────────────────────────
function getTransactions(month, year) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transactions');
    if (!sheet) return { success: false, error: 'Sheet not found' };
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, transactions: [] };
    const tz = Session.getScriptTimeZone();
    let list = data.slice(1).filter(r=>r[0]!=='').map(r=>({
      id: r[0].toString(), type: r[1], amountUSD: parseFloat(r[2])||0,
      amountLBP: parseFloat(r[3])||0, category: r[4], description: r[5],
      date: formatDateValue(r[6],tz), currency: r[7]||'USD',
      originalAmount: parseFloat(r[8])||parseFloat(r[2])||0,
      settled: r[9]===true||r[9]==='TRUE'
    }));
    if (month !== undefined && year !== undefined) {
      const m=parseInt(month,10),y=parseInt(year,10);
      list=list.filter(t=>{const p=(t.date||'').split('-');return parseInt(p[0])===y&&parseInt(p[1])-1===m;});
    }
    return { success: true, transactions: list };
  } catch(err) { return { success: false, error: err.toString() }; }
}

function saveTransaction(data) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transactions');
    const tz = Session.getScriptTimeZone();
    const row = [sanitize(data.type),parseFloat(data.amountUSD)||0,parseFloat(data.amountLBP)||0,
      sanitize(data.category),sanitize(data.description),formatDateValue(data.date,tz),
      data.currency==='LBP'?'LBP':'USD',parseFloat(data.originalAmount)||parseFloat(data.amountUSD)||0,
      data.settled===true];
    if (data.id) {
      const vals = sheet.getDataRange().getValues();
      for (let i=1;i<vals.length;i++) if(vals[i][0].toString()===data.id.toString()){sheet.getRange(i+1,2,1,9).setValues([row]);return{success:true};}
    }
    const id = data.id || (Date.now().toString()+Math.floor(Math.random()*10000).toString().padStart(4,'0'));
    sheet.appendRow([id,...row]);
    return { success: true, id };
  } catch(err) { return { success: false, error: err.toString() }; }
}

function deleteTransaction(id) {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transactions');
    const vals=sheet.getDataRange().getValues();
    for(let i=1;i<vals.length;i++) if(vals[i][0].toString()===id.toString()){sheet.deleteRow(i+1);return{success:true};}
    return { success: false, error: 'Not found' };
  } catch(err) { return { success: false, error: err.toString() }; }
}

function settleDebt(id) {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Transactions');
    const vals=sheet.getDataRange().getValues();
    for(let i=1;i<vals.length;i++) if(vals[i][0].toString()===id.toString()){sheet.getRange(i+1,10).setValue(true);return{success:true};}
    return { success: false };
  } catch(err) { return { success: false, error: err.toString() }; }
}

// ── CATEGORIES ────────────────────────────────
function getCategories() {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Categories');
    const data=sheet.getDataRange().getValues();
    const cats={income:[],expense:[],debt:[]};
    for(let i=1;i<data.length;i++){const t=data[i][0],c=data[i][1];if(t&&c&&cats[t]!==undefined)cats[t].push(c);}
    Object.keys(DEFAULT_CATEGORIES).forEach(t=>{if(!cats[t].length)cats[t]=[...DEFAULT_CATEGORIES[t]];});
    return { success: true, categories: cats };
  } catch(err) { return { success: false, error: err.toString() }; }
}

function saveCategory(type,category) {
  try {
    if(!['income','expense','debt'].includes(type)) return {success:false,error:'Invalid type'};
    const cat=sanitize(category);if(!cat) return {success:false};
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Categories');
    const vals=sheet.getDataRange().getValues();
    for(let i=1;i<vals.length;i++) if(vals[i][0]===type&&vals[i][1]===cat) return {success:false,error:'Exists'};
    sheet.appendRow([type,cat]);return {success:true};
  } catch(err) { return {success:false,error:err.toString()}; }
}

function deleteCategory(type,category) {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Categories');
    const vals=sheet.getDataRange().getValues();
    for(let i=1;i<vals.length;i++) if(vals[i][0]===type&&vals[i][1]===category){sheet.deleteRow(i+1);return{success:true};}
    return {success:false};
  } catch(err) { return {success:false,error:err.toString()}; }
}

// ── SETTINGS ──────────────────────────────────
function getSettings() {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Settings');
    const data=sheet.getDataRange().getValues();
    const s={};for(let i=1;i<data.length;i++) if(data[i][0]) s[data[i][0]]=data[i][1];
    if(!s.exchangeRate) s.exchangeRate=DEFAULT_EXCHANGE_RATE;
    return {success:true,settings:s};
  } catch(err) { return {success:false,error:err.toString()}; }
}

function saveSettings(data) {
  try {
    const rate=parseFloat(data.exchangeRate);if(!rate||rate<=0) return {success:false};
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Settings');
    const vals=sheet.getDataRange().getValues();
    for(let i=1;i<vals.length;i++) if(vals[i][0]==='exchangeRate'){sheet.getRange(i+1,2).setValue(rate);return{success:true};}
    sheet.appendRow(['exchangeRate',rate]);return {success:true};
  } catch(err) { return {success:false,error:err.toString()}; }
}

// ── SPENDING LIMITS ───────────────────────────
function getSpendingLimits() {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SpendingLimits');
    const data=sheet.getDataRange().getValues();
    const lims={};for(let i=1;i<data.length;i++) if(data[i][0]) lims[data[i][0]]=parseFloat(data[i][1])||0;
    return {success:true,limits:lims};
  } catch(err) { return {success:false,error:err.toString()}; }
}

function saveSpendingLimit(category,limitUSD) {
  try {
    const cat=sanitize(category),lim=parseFloat(limitUSD);if(!cat||isNaN(lim)) return {success:false};
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SpendingLimits');
    const vals=sheet.getDataRange().getValues();
    for(let i=1;i<vals.length;i++) if(vals[i][0]===cat){sheet.getRange(i+1,2).setValue(lim);return{success:true};}
    sheet.appendRow([cat,lim]);return {success:true};
  } catch(err) { return {success:false,error:err.toString()}; }
}

function deleteSpendingLimit(category) {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SpendingLimits');
    const vals=sheet.getDataRange().getValues();
    for(let i=1;i<vals.length;i++) if(vals[i][0]===category){sheet.deleteRow(i+1);return{success:true};}
    return {success:false};
  } catch(err) { return {success:false,error:err.toString()}; }
}

// ── COMPARISON ────────────────────────────────
function getLastMonthTotals(month,year) {
  try {
    let pm=parseInt(month,10)-1,py=parseInt(year,10);if(pm<0){pm=11;py--;}
    const r=getTransactions(pm,py);if(!r.success) return {success:false};
    let iU=0,eU=0;r.transactions.forEach(t=>{if(t.type==='income')iU+=t.amountUSD||0;if(t.type==='expense')eU+=t.amountUSD||0;});
    return {success:true,totals:{incomeUSD:iU,expenseUSD:eU,month:pm,year:py}};
  } catch(err) { return {success:false,error:err.toString()}; }
}

// ── RECURRING ─────────────────────────────────
function getRecurring() {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Recurring');
    const data=sheet.getDataRange().getValues();
    if(data.length<=1) return {success:true,recurring:[]};
    return {success:true,recurring:data.slice(1).filter(r=>r[0]!='').map(r=>({id:r[0].toString(),type:r[1],amountUSD:parseFloat(r[2])||0,amountLBP:parseFloat(r[3])||0,category:r[4],description:r[5],dayOfMonth:parseInt(r[6])||1}))};
  } catch(err) { return {success:false,error:err.toString()}; }
}

function saveRecurring(data) {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Recurring');
    const day=Math.min(Math.max(parseInt(data.dayOfMonth)||1,1),28);
    const row=[sanitize(data.type),parseFloat(data.amountUSD)||0,parseFloat(data.amountLBP)||0,sanitize(data.category),sanitize(data.description),day];
    if(data.id){const vals=sheet.getDataRange().getValues();for(let i=1;i<vals.length;i++) if(vals[i][0].toString()===data.id.toString()){sheet.getRange(i+1,2,1,6).setValues([row]);return{success:true};}}
    const id=data.id||('R'+Date.now());sheet.appendRow([id,...row]);return {success:true,id};
  } catch(err) { return {success:false,error:err.toString()}; }
}

function deleteRecurring(id) {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Recurring');
    const vals=sheet.getDataRange().getValues();
    for(let i=1;i<vals.length;i++) if(vals[i][0].toString()===id.toString()){sheet.deleteRow(i+1);return{success:true};}
    return {success:false};
  } catch(err) { return {success:false,error:err.toString()}; }
}

function applyRecurring(month,year) {
  try {
    const rr=getRecurring();if(!rr.success||!rr.recurring.length) return {success:true,applied:0};
    const tx=getTransactions(month,year);const ex=tx.success?tx.transactions:[];
    const tz=Session.getScriptTimeZone();let applied=0;
    rr.recurring.forEach(r=>{
      if(ex.some(t=>t.type===r.type&&t.category===r.category&&t.description===r.description)) return;
      const ty=parseInt(year,10),tm=parseInt(month,10),day=Math.min(r.dayOfMonth,new Date(ty,tm+1,0).getDate());
      saveTransaction({id:r.id+'_'+ty+'_'+tm,type:r.type,amountUSD:r.amountUSD,amountLBP:r.amountLBP,category:r.category,description:r.description,date:formatDateValue(new Date(ty,tm,day),tz),currency:'USD',originalAmount:r.amountUSD});
      applied++;
    });
    return {success:true,applied};
  } catch(err) { return {success:false,error:err.toString()}; }
}

// ── SAVINGS GOALS ─────────────────────────────
function getSavingsGoals() {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SavingsGoals');
    const data=sheet.getDataRange().getValues();
    if(data.length<=1) return {success:true,goals:[]};
    const tz=Session.getScriptTimeZone();
    return {success:true,goals:data.slice(1).filter(r=>r[0]!='').map(r=>({id:r[0].toString(),name:r[1],targetUSD:parseFloat(r[2])||0,currentUSD:parseFloat(r[3])||0,deadline:r[4]?formatDateValue(r[4],tz):'',notes:r[5]||''}))};
  } catch(err) { return {success:false,error:err.toString()}; }
}

function saveSavingsGoal(data) {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SavingsGoals');
    const tz=Session.getScriptTimeZone();
    const row=[sanitize(data.name),parseFloat(data.targetUSD)||0,parseFloat(data.currentUSD)||0,data.deadline?formatDateValue(data.deadline,tz):'',sanitize(data.notes||'')];
    if(data.id){const vals=sheet.getDataRange().getValues();for(let i=1;i<vals.length;i++) if(vals[i][0].toString()===data.id.toString()){sheet.getRange(i+1,2,1,5).setValues([row]);return{success:true};}}
    const id=data.id||('G'+Date.now());sheet.appendRow([id,...row]);return {success:true,id};
  } catch(err) { return {success:false,error:err.toString()}; }
}

function deleteSavingsGoal(id) {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SavingsGoals');
    const vals=sheet.getDataRange().getValues();
    for(let i=1;i<vals.length;i++) if(vals[i][0].toString()===id.toString()){sheet.deleteRow(i+1);return{success:true};}
    return {success:false};
  } catch(err) { return {success:false,error:err.toString()}; }
}

function updateGoalProgress(id,amount) {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SavingsGoals');
    const vals=sheet.getDataRange().getValues();
    for(let i=1;i<vals.length;i++) if(vals[i][0].toString()===id.toString()){
      const nv=Math.max(0,(parseFloat(vals[i][3])||0)+(parseFloat(amount)||0));
      sheet.getRange(i+1,4).setValue(nv);return{success:true,currentUSD:nv};
    }
    return {success:false};
  } catch(err) { return {success:false,error:err.toString()}; }
}

// ── BUDGET PLAN ───────────────────────────────
function getBudgetPlan(month,year) {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('BudgetPlan');
    const data=sheet.getDataRange().getValues();
    const m=parseInt(month,10),y=parseInt(year,10);
    const plan=data.slice(1).filter(r=>r[0]!=''&&parseInt(r[1],10)===m&&parseInt(r[2],10)===y).map(r=>({id:r[0].toString(),month:parseInt(r[1],10),year:parseInt(r[2],10),type:r[3],category:r[4],plannedUSD:parseFloat(r[5])||0}));
    return {success:true,plan};
  } catch(err) { return {success:false,error:err.toString()}; }
}

function saveBudgetPlan(data) {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('BudgetPlan');
    const m=parseInt(data.month,10),y=parseInt(data.year,10);
    const row=[m,y,sanitize(data.type),sanitize(data.category),parseFloat(data.plannedUSD)||0];
    if(data.id){const vals=sheet.getDataRange().getValues();for(let i=1;i<vals.length;i++) if(vals[i][0].toString()===data.id.toString()){sheet.getRange(i+1,2,1,5).setValues([row]);return{success:true};}}
    const id=data.id||('B'+Date.now());sheet.appendRow([id,...row]);return {success:true,id};
  } catch(err) { return {success:false,error:err.toString()}; }
}

function deleteBudgetPlanItem(id) {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('BudgetPlan');
    const vals=sheet.getDataRange().getValues();
    for(let i=1;i<vals.length;i++) if(vals[i][0].toString()===id.toString()){sheet.deleteRow(i+1);return{success:true};}
    return {success:false};
  } catch(err) { return {success:false,error:err.toString()}; }
}

// ── NET WORTH ─────────────────────────────────
function getNetWorth() {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('NetWorth');
    const data=sheet.getDataRange().getValues();
    if(data.length<=1) return {success:true,items:[]};
    return {success:true,items:data.slice(1).filter(r=>r[0]!='').map(r=>({id:r[0].toString(),label:r[1],type:r[2],amountUSD:parseFloat(r[3])||0,notes:r[4]||''}))};
  } catch(err) { return {success:false,error:err.toString()}; }
}

function saveNetWorthItem(data) {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('NetWorth');
    const row=[sanitize(data.label),data.type==='liability'?'liability':'asset',parseFloat(data.amountUSD)||0,sanitize(data.notes||'')];
    if(data.id){const vals=sheet.getDataRange().getValues();for(let i=1;i<vals.length;i++) if(vals[i][0].toString()===data.id.toString()){sheet.getRange(i+1,2,1,4).setValues([row]);return{success:true};}}
    const id=data.id||('N'+Date.now());sheet.appendRow([id,...row]);return {success:true,id};
  } catch(err) { return {success:false,error:err.toString()}; }
}

function deleteNetWorthItem(id) {
  try {
    const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('NetWorth');
    const vals=sheet.getDataRange().getValues();
    for(let i=1;i<vals.length;i++) if(vals[i][0].toString()===id.toString()){sheet.deleteRow(i+1);return{success:true};}
    return {success:false};
  } catch(err) { return {success:false,error:err.toString()}; }
}

// ── UTILITIES ─────────────────────────────────
function formatDateValue(value,tz) {
  if(!value&&value!==0) return '';
  tz=tz||Session.getScriptTimeZone();
  let d=value instanceof Date?value:(()=>{const s=value.toString().trim();return s.match(/^\d{4}-\d{2}-\d{2}$/)?new Date(s+'T12:00:00'):new Date(s);})();
  if(isNaN(d.getTime())) return value.toString();
  return Utilities.formatDate(d,tz,'yyyy-MM-dd');
}

function sanitize(v) {
  if(v===null||v===undefined) return '';
  return v.toString().trim().substring(0,MAX_FIELD_LENGTH);
}

// ── TEST HELPERS ──────────────────────────────
function testSetup()  { PropertiesService.getScriptProperties().deleteProperty('initialized'); Logger.log(initializeSystem()); }
function testGet()    { Logger.log(getTransactions()); }
function testGoal()   { Logger.log(saveSavingsGoal({name:'Test Goal',targetUSD:1000,currentUSD:0})); }
