'use strict';

const { app, BrowserWindow, ipcMain, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./db');

let win = null;
let authed = false;
let currentDbPath = null;

// --- database file selection -------------------------------------------------
// Priority: --db CLI argument > OTM_DB_PATH env var > remembered choice
// (db-choice.json in userData) > default location.

function dbChoiceFile() {
  return path.join(app.getPath('userData'), 'db-choice.json');
}

function readDbChoice() {
  try {
    const j = JSON.parse(fs.readFileSync(dbChoiceFile(), 'utf8'));
    return (j && typeof j.customDbPath === 'string' && j.customDbPath.trim()) ? j.customDbPath : null;
  } catch {
    return null;
  }
}

function writeDbChoice(customPath) {
  try {
    if (customPath) fs.writeFileSync(dbChoiceFile(), JSON.stringify({ customDbPath: customPath }, null, 2));
    else fs.unlinkSync(dbChoiceFile());
  } catch {}
}

function resolveDbPath() {
  let fromArg = null;
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--db=')) fromArg = a.slice(5).trim();
    else if (a === '--db' && process.argv[i + 1]) fromArg = process.argv[i + 1].trim();
  }
  if (fromArg === 'default') fromArg = null; // escape hatch: --db=default forces the default file
  return fromArg || process.env.OTM_DB_PATH || readDbChoice() || defaultDbPath();
}

// Packaged Windows apps keep their database in a "data" folder next to the
// executable, so the whole folder is self-contained (copy it to a USB stick and
// everything travels together). Falls back to the OS-standard data folder when
// that folder is not writable (e.g. an installed copy under Program Files). On
// macOS/Linux the database always lives in the standard per-user data folder
// (userData) — writing inside a Mac .app bundle or a read-only AppImage mount
// would break the package. Dev runs (npm start) keep using userData so the
// repo folder stays clean.
function defaultDbPath() {
  if (app.isPackaged && process.platform === 'win32') {
    const dir = path.join(path.dirname(process.execPath), 'data');
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      const target = path.join(dir, 'offering-tithe.db');
      migrateLegacyDb(target);
      return target;
    } catch {}
  }
  return path.join(app.getPath('userData'), 'offering-tithe.db');
}

// One-time carry-over: when a packaged build first runs with the new
// exe-relative location, bring along an existing database from the legacy
// AppData spot so users do not lose their data on update.
function migrateLegacyDb(targetPath) {
  try {
    if (fs.existsSync(targetPath)) return;
    if (readDbChoice()) return; // user manages their own location already
    const legacy = path.join(app.getPath('userData'), 'offering-tithe.db');
    if (!fs.existsSync(legacy)) return;
    fs.copyFileSync(legacy, targetPath);
    for (const ext of ['-wal', '-shm']) {
      const src = legacy + ext;
      if (fs.existsSync(src)) fs.copyFileSync(src, targetPath + ext);
    }
  } catch {}
}

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

// IPC handlers throw plain Errors; Electron only serializes `message` to the renderer,
// so user-facing text lives in the message itself.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return await fn(payload || {});
    } catch (err) {
      throw new Error((err && err.message) || 'Something went wrong.');
    }
  });
}

function requireAdmin() {
  if (!authed) throw new Error('Admin sign-in required.');
}

// ---------------------------------------------------------------------------

handle('auth:status', () => ({ authed }));
handle('auth:login', ({ password }) => {
  if (!db.verifyPassword(password)) throw new Error('Incorrect password.');
  authed = true;
  return { authed };
});
handle('auth:logout', () => {
  authed = false;
  return { authed };
});
handle('auth:changePassword', ({ currentPassword, newPassword, confirmation }) => {
  requireAdmin();
  db.changePassword(currentPassword, newPassword, confirmation);
  return { ok: true };
});

// donors
handle('donors:list', () => db.listDonors());
handle('donors:find', ({ query }) => db.findDonors(query));
handle('donors:findExact', (fields) => db.findDonorExact(fields));
handle('donors:newest', () => db.newestEntryDonor());
handle('donors:insert', (fields) => {
  requireAdmin();
  return db.insertDonor(fields);
});
handle('donors:update', (fields) => {
  requireAdmin();
  return db.updateDonor(fields);
});
handle('donors:delete', ({ titheId }) => {
  requireAdmin();
  return db.deleteDonor(titheId);
});

// giving — recordGift honors the real session state server-side
handle('giving:list', ({ search }) => db.listGiving(search));
handle('giving:recordGift', (payload) => db.recordGift(payload, { isAdmin: authed }));
handle('giving:delete', ({ id }) => {
  requireAdmin();
  return db.deleteGiving(id);
});
handle('giving:findDates', ({ search }) => db.findGivingDatesByPerson(search));
handle('giving:findByPersonDate', ({ search, date }) => db.findGivingByPersonAndDate(search, date));
handle('giving:update', (payload) => {
  requireAdmin();
  return db.updateGiving(payload.id, payload);
});

// reports
handle('report:month', ({ year, month }) => db.monthReport(year, month));
handle('report:year', ({ year, includeFees }) => db.yearReport(year, { includeFees }));
handle('report:other', ({ year, month }) => db.otherReport(year, month));
handle('report:funds', ({ year, month }) => db.fundTotals(year, month));

// deposits
handle('deposit:list', () => db.listDeposits());
handle('deposit:titheSheetTotal', ({ date }) => db.titheSheetTotal(date));
handle('deposit:insert', (payload) => db.insertDeposit(payload, { isAdmin: authed }));
handle('deposit:delete', ({ depositNumber }) => {
  requireAdmin();
  return db.deleteDeposit(depositNumber);
});

// csv data export (renderer builds/downloads the file)
handle('csv:exportDonors', () => {
  requireAdmin();
  return db.listDonors();
});
handle('csv:exportGiving', () => {
  requireAdmin();
  return db.listGiving();
});

// csv import
handle('csv:importDonors', (rows) => {
  requireAdmin();
  return db.importDonors(rows);
});
handle('csv:importGiving', (rows) => {
  requireAdmin();
  return db.importGiving(rows);
});

// settings
// The Brevo API key and sender are only surfaced to authenticated admin sessions.
// Non-admin volunteers can still send deposit emails (the key is read internally
// by sendDepositEmail in the main process) but never receive the raw key.
handle('settings:get', () => ({
  orgName: db.getSetting('org_name', 'OTMP'),
  brevoApiKey: authed ? db.getSetting('brevo_api_key', '') : '',
  brevoSenderEmail: authed ? db.getSetting('brevo_sender_email', '') : '',
  emailRecipients: db.getEmailRecipients(),
}));
handle('settings:set', ({ key, value }) => {
  requireAdmin();
  const allowed = ['org_name', 'brevo_api_key', 'brevo_sender_email'];
  if (!allowed.includes(key)) throw new Error('Unknown setting.');
  db.setSetting(key, String(value == null ? '' : value));
  return { ok: true };
});
handle('settings:setRecipients', ({ list }) => {
  requireAdmin();
  return db.setEmailRecipients(list);
});

// Brevo transactional email for a deposit slip
function brevoNetworkError(err) {
  const raw = ((err && err.code) || '') + ' ' + ((err && err.message) || '');
  if (/ENOTFOUND|EAI_AGAIN|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ETIMEDOUT|ECONNRESET|ECONNREFUSED|TIMEOUT/i.test(raw)) {
    return new Error('Not connected to the internet \u2014 the deposit email was not sent.');
  }
  return new Error('Could not reach Brevo (' + ((err && err.message) || 'network error') + ') \u2014 the deposit email was not sent.');
}

async function postBrevo(apiKey, body) {
  return new Promise((resolve, reject) => {
    const req = net.request({
      method: 'POST',
      url: BREVO_ENDPOINT,
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
    });
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => { try { req.abort(); } catch {} });
      reject(new Error('Not connected to the internet (request timed out) \u2014 the deposit email was not sent.'));
    }, 15000);
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        finish(() => {});
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(text);
          return;
        }
        let detail = '';
        try {
          const j = JSON.parse(text);
          if (j && j.message) detail = ': ' + j.message;
        } catch {}
        if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error("The Brevo API key didn't work (error " + res.statusCode + detail + '). Check it under Email settings.'));
        } else if (res.statusCode >= 500) {
          reject(new Error('Brevo servers appear to be offline (error ' + res.statusCode + ') \u2014 the deposit email was not sent.'));
        } else {
          reject(new Error('Brevo error ' + res.statusCode + detail + ' \u2014 the deposit email was not sent.'));
        }
      });
    });
    req.on('error', (e) => finish(() => reject(brevoNetworkError(e))));
    req.end(JSON.stringify(body));
  });
}

handle('email:sendDeposit', ({ depositNumber, date, total }) => sendDepositEmail({ depositNumber, date, total }));

handle('deposit:markSkipped', ({ depositNumber }) => {
  requireAdmin();
  db.markDepositEmailed(depositNumber, 'skipped by admin');
  return { ok: true };
});

async function sendDepositEmail({ depositNumber, date, total }) {
  const apiKey = db.getSetting('brevo_api_key', '');
  const sender = db.getSetting('brevo_sender_email', '');
  const recipients = db.getEmailRecipients();
  if (!apiKey) throw new Error('The Brevo API key is not entered \u2014 add it under Email settings first.');
  if (!sender) throw new Error('The sender email address is not entered \u2014 add it under Email settings first.');
  if (!recipients.length) throw new Error('No recipient email addresses are entered \u2014 add one under Email recipients first.');

  const dollars = ((Number(total) || 0) / 100).toFixed(2);
  const subject = `Deposit ${depositNumber} \u2014 $${dollars}`;
  const text =
    `Deposit number: ${depositNumber}\n` +
    `Date: ${date}\n` +
    `Total: $${dollars}\n\n` +
    `Sent automatically by the Offering & Tithe Management Program.`;

  await postBrevo(apiKey, {
    sender: { email: sender, name: 'Offering & Tithe Management Program' },
    to: recipients.map((email) => ({ email })),
    subject,
    textContent: text,
    htmlContent: '<pre style="font:14px/1.5 sans-serif">' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>',
  });

  db.markDepositEmailed(depositNumber, recipients.join(', '));
  return { ok: true, emailedTo: recipients };
}

// misc
handle('app:getTemplate', () => fs.readFileSync(path.join(__dirname, 'src', 'deposit-template.xlsx')));

handle('db:backup', async () => {
  requireAdmin();
  const stamp = new Date().toISOString().slice(0, 10);
  const res = await dialog.showSaveDialog(win, {
    title: 'Back up database',
    defaultPath: path.join(app.getPath('documents'), `offering-tithe-backup-${stamp}.db`),
    filters: [{ name: 'SQLite database', extensions: ['db'] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  db.backupTo(res.filePath);
  return { canceled: false, filePath: res.filePath };
});

handle('db:getInfo', () => {
  requireAdmin();
  return { path: currentDbPath, isCustom: !!readDbChoice() };
});

// Pick a different database file; the app saves the choice and restarts on it.
handle('db:choose', async () => {
  requireAdmin();
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose database file',
    defaultPath: path.dirname(currentDbPath || app.getPath('documents')),
    properties: ['openFile', 'createDirectory', 'promptToCreate'],
    filters: [
      { name: 'SQLite database', extensions: ['db', 'sqlite', 'sqlite3'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { canceled: true };
  const chosen = path.resolve(res.filePaths[0]);
  if (chosen === currentDbPath) return { canceled: true, unchanged: true };
  writeDbChoice(chosen);
  app.relaunch({ args: ['--db=' + chosen] });
  app.exit(0);
  return { relaunching: true };
});

handle('db:resetDefault', () => {
  requireAdmin();
  if (!readDbChoice()) return { unchanged: true };
  writeDbChoice(null);
  app.relaunch({ args: ['--db=default'] });
  app.exit(0);
  return { relaunching: true };
});

// ---------------------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1220,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: 'Offering & Tithe Management Program',
    backgroundColor: '#f5f2ec',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  currentDbPath = resolveDbPath();
  db.init(currentDbPath);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  try { db.close(); } catch {}
});
